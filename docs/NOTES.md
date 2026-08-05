# Notes hub (every note in one place)

Where an admin reads **every note left on a campaign** — the ones a canvasser types at the door, the
ones attached to a submitted survey, and the ones an admin writes on a voter's profile — in one
searchable, filterable list. It is **view-only**: a place to read, not edit. Field door notes used to be
effectively invisible (buried on individual households); this surfaces them.

- **Part 1 — For everyone** is plain language: the three kinds of notes, where the hub lives on web and
  mobile, how you filter it, and what happens when you tap a note.
- **Part 2 — Technical reference** is for developers (and Claude): the one endpoint that merges the three
  sources, the response shape, the per-source caps, and the web + mobile frontends (including the map
  "jump to this door" deep-link).

Related: [SURVEYS.md](SURVEYS.md) (survey notes are one of the three sources), [VOTERS.md](VOTERS.md)
(admin/profile notes = `VoterNote`, and the voter profile a note links to), [MAPS.md](MAPS.md) (the
`?household=` deep-link a door-only note opens), [DATE_FILTERS.md](DATE_FILTERS.md) (the date window —
the hub now opens on **Today**), [ROLES.md](ROLES.md) (who can read it: admins, team leads for their
campaigns, super-admins), [AUDIT.md](AUDIT.md) (a sibling campaign-scoped review screen, same shape),
[TIMEZONES.md](TIMEZONES.md) (the campaign-day the window resolves in).

---

# Part 1 — For everyone

## What it's for

Three different people leave notes in three different places, and until now you had to go hunting for
each kind. The Notes hub pulls all three into one feed so you can answer "what did people actually write
about this campaign?" without clicking through voters and doors one by one.

**The three kinds of notes:**

| Source | Who writes it | Where it comes from |
|---|---|---|
| **Door** | A canvasser at the door | The optional note typed when marking a door (Not home, Refused, Lit drop, …). |
| **Survey** | A canvasser finishing a survey | The optional note left when submitting a survey response. |
| **Admin** | An admin (or lead) | A note written on a voter's profile — kept about that person over time. |

## Where you find it

**On the web:** inside a campaign, alongside Timeline, Map, and Audit — the **Notes** tab. It opens
showing **today's** notes; widen the date range for more.

**On mobile:** admins/leads get a **Notes** screen reached two ways — the **📝 Notes** row in the
**More** menu, and a **Notes** tile on a campaign's page. Same three sources, same filters. A phone
has no address bar to hold the campaign, so the screen carries a **campaign chip** at the top: tap
it to switch, and your pick carries across the other admin screens. Coming in from a campaign's own
**Notes** tile scopes the screen to *that* campaign. The chip lists **archived** campaigns too,
under an **Archived · read-only** divider, so a finished campaign's notes stay readable from the
phone — it never seats you in one on its own, you pick it.

## How you filter it

- **Date range** — defaults to **Today** (the campaign's today); Yesterday / 7 days / 30 days / All time
  / Custom are one tap away. All time makes it a full archive.
- **Type** — turn Door / Survey / Admin on or off (you can show more than one). Each chip shows its count.
- **Author** — narrow to notes written by one person.
- **Walk list** — if the campaign has more than one walk list, scope door + survey notes to it. (Admin
  notes aren't tied to a walk list, so they're hidden while a walk list is selected — the screen says so.)
- **Search** — type any text to match note contents.

## Tapping a note

Each note tells you who wrote it, when, and (when known) the voter and address. Tapping through:

- A note about a **specific voter** opens that **voter's profile**.
- A note about a **door only** (no specific voter) opens the **map, zoomed straight to that door** with
  its info panel. Because a note can be about an old knock, the map automatically shows **all time** so
  the door is guaranteed to be on screen.

## What it doesn't do

It's **read-only**. You can't edit or delete a note here — you edit an admin note on the voter's profile,
and door/survey notes are the canvasser's record of what happened. (Door notes also still appear on the
household's own panel on the map.)

---

# Part 2 — Technical reference

## One endpoint, three sources

`GET /admin/reports/notes` — [server/src/routes/admin/reports.js](../server/src/routes/admin/reports.js)
(handler ~`NOTES_RESULT_CAP`). A **read-only aggregator** that merges three collections into one
reverse-chronological list:

| `source` | Collection | Field | Notes |
|---|---|---|---|
| `door` | `CanvassActivity` | `.note` | Excludes the paired `survey_submitted` rows (those are the survey source) so a survey isn't counted twice. |
| `survey` | `SurveyResponse` | `.note` | `timestamp` = `submittedAt`. |
| `voter` | `VoterNote` | `.body` | Org-level, scoped to the campaign via a voter→household join (`$match campaignId`). Labeled **"Admin"** in the UI. |

**Auth:** `requireAuth` → `orgContext` → `requireOrgRole('admin','lead')`; super-admin bypasses the role
check, and a team **lead** is additionally scoped by `canManageCampaign(campaignId)`. It passes
`requireEntitlement` as a read, so it keeps working under billing suspension. The mobile `api()` helper
already attaches the Bearer token + `X-Org-Id`, so mobile reuses it **as-is** — no server change.

### Query params

| Param | Meaning |
|---|---|
| `campaignId` | **Required** — 400 (`A campaignId is required.`) without it. |
| `from`, `to` | Date-only `YYYY-MM-DD`, half-open window resolved in the campaign's anchor tz. Both absent = all-time. |
| `type` | CSV subset of `door,survey,voter` (absent/unrecognized = all three). |
| `userId` | Author filter — matches `CanvassActivity.userId`, `SurveyResponse.userId`, `VoterNote.authorId`. |
| `effortId` | Scopes door + survey to that walk list **and forces `includeVoter=false`** (VoterNote has no effort linkage → zero admin notes while set). |
| `q` | Case-insensitive substring (regex-escaped) over the three note fields. |
| `page`, `limit` | `page` default 0; `limit` default 50, **clamped 1..100**. |

### Response shape

```jsonc
{
  "notes": [{
    "id": "…", "source": "door|survey|voter",
    "note": "…", "timestamp": "<ISO>",
    "author": { "id", "name" } | null,
    "actionType": "not_home|survey_submitted|… | null",
    "household": { "id", "address" } | null,   // door may be null (household-scoped voter unknown)
    "voter": { "id", "name" } | null,
    "edited": { "by": {id,name}|null, "at": "<ISO>"|null } | null  // null for door
  }],
  "total": 87,                                  // pageable = merged WANTED-source length (post-cap)
  "counts": { "door", "survey", "voter", "total" }, // countDocuments — IGNORE the type filter (chips stay accurate)
  "capped": false, "page": 0, "limit": 50, "resultCap": 500,
  "timeZone": "America/Chicago", "tzAbbrev": "CDT"
}
```

**Caps & counts, watch out:**
- Each source is capped at `NOTES_RESULT_CAP` (**500**) before the merge/sort/in-memory paginate.
  `capped` is true when a *wanted* source's `countDocuments` exceeds the rows actually fetched → the UI
  shows a "showing the most recent 500 per type — narrow the range" hint.
- **Paginate off `total`, not `counts.total`.** `counts` deliberately ignore the `type` filter (so the
  chips show real totals), so `counts.total` can exceed `total` when `type` is narrowed.
- The timestamp field is **`note.timestamp`** (not `createdAt`); format it with the response's
  **`timeZone`/`tzAbbrev`** (server-resolved: campaign → org → ET), so every client shows the same clock.

## Web frontend

[client/src/pages/NotesPage.jsx](../client/src/pages/NotesPage.jsx) at `/campaigns/:id/notes` (nav slug
`notes`). Search + type chips (with counts) + author/effort filters + **Prev/Next** pages (`LIMIT 50`).
Defaults the date range to **Today** in the campaign tz (a `rangeTouchedRef` + tz-reseed mirrors
[AuditPage](../client/src/pages/AuditPage.jsx); a manual pick isn't clobbered). Voter-scoped notes link to
`/voters/:id`; door-only notes link to `/campaigns/:id/map?household=<id>` (the map opens **all-time** when
`?household=` is present, then flies to the pin). Household door-notes are also surfaced on
[HouseholdDetailPanel](../client/src/components/HouseholdDetailPanel.jsx).

## Mobile frontend

Ported to match the web, reusing the same endpoint. All JS-only → ships **over-the-air** (`eas update`),
no native rebuild, no server deploy.

| File | Role |
|---|---|
| [mobile/app/(app)/admin/notes.jsx](../mobile/app/(app)/admin/notes.jsx) | The screen. Hidden Tabs `href:null` (inherits admin/lead gating). `CampaignChip` scope (archived campaigns selectable, auto-default active-only) + `ArchivedCampaignBanner` + `useFocusEffect` re-sync + `prevCid` reset (this Tabs screen stays mounted); `DateRangeBar` default **Today** (full presets, incl. All time); source/author/walk-list filters; debounced search; **`useInfiniteQuery` "Load more"** (endpoint caps `limit` at 100, so it pages). |
| [mobile/app/(app)/admin/notes.jsx](../mobile/app/(app)/admin/notes.jsx) `noteRow` | One note as an inset row: source dot as the leading glyph, quoted body as the label, `author · time · voter · address` on the sub line. A note with a target is an `InsetNavRow` (taps through to the voter, or the map focused on that door); one with neither is an inert `InsetRow`. (The standalone `NoteCard.jsx` went when the inset-group grammar landed — the past-tense comment naming it at `notes.jsx` is the only surviving reference and is correct.) |
| [mobile/components/SourceChips.jsx](../mobile/components/SourceChips.jsx) | **New** multi-select chip row with counts (`TabSwitcher` is single-select only). |
| `admin/_layout.jsx`, `admin/more.jsx`, `admin/campaign/[campaignId].jsx` | Register the screen + two entry points (More-menu row, campaign Quick-actions tile), mirroring the GPS-audit screen. |

**Map "jump to this door" deep-link** — [mobile/app/(app)/admin/map.jsx](../mobile/app/(app)/admin/map.jsx).
The mobile admin map previously took only `effortId/passId/importId`; it now also reads
`?household=<id>&focusAt=<nonce>`. Because the map is an **always-mounted Tabs screen**, the focus is more
involved than the web's fresh-mount version:

- The map **re-syncs the active campaign on focus** (`useFocusEffect`, was mount-only) so a cross-campaign
  "view on map" (and a latent stale-campaign bug) works.
- On a household link it **widens to all-time and clears any stale status/canvasser/answer/scope filters**
  so the door is in the loaded set, then flies the camera + opens the door sheet once it arrives.
- The consumed param is **stripped via `router.setParams`** (a tab press re-applies existing params, which
  would otherwise pin the map to all-time forever); the range is held on all-time via `dateTouchedRef`
  while the pin is shown, and **reset to Today on a campaign switch**.
- The `focusAt` nonce lets re-tapping the *same* door re-focus (the id alone wouldn't change).
- **Known residual:** a link to a door with no map coordinates never focuses (nothing to fly to) and the
  range stays all-time until a campaign switch / manual date pick — a narrow edge (door/survey notes imply
  a knocked, geocoded door), accepted to avoid a cross-campaign race.
