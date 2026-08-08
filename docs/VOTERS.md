# Voter directory & profile

How to browse the voters in your database and open a single voter to see — and edit — everything
about them.

- **Part 1 — For everyone** is plain language.
- **Part 2 — Technical reference** is for developers (and Claude): models, endpoints, the audit
  fields, and the components.

Related: [EARLY_VOTING.md](EARLY_VOTING.md) (voted status), [METRICS.md](METRICS.md),
[SURVEYS.md](SURVEYS.md) (the surveys whose responses appear on a voter's profile).

---

# Part 1 — For everyone

## Where voters live (org vs campaign)

Voter records are stored **per campaign**: each campaign that imports a person gets its **own
copy** of their record, attached to that campaign's own copy of their door. So when two campaigns
in your org target the same neighborhood — even the exact same people — each campaign has its own
voters, doors, statuses, and books, and nothing one campaign does re-shuffles the other.

The **person** is still one person to the org: the copies are tied together by their state Voter
ID, so org-wide facts follow them everywhere. **Do not contact** set in one campaign applies in
all of them, admin notes show on every copy's profile, and the org-wide Voters directory shows
each person **once** (with a chip for every campaign they're in). Campaign-specific facts —
**surveys, voted marks, knocks, "surveyed" status** — stay with each campaign's own copy.

## The directory (web: "Voters")

A searchable, paginated list of every voter in the org. Search by **name, Voter ID, or address**;
filter by **campaign, survey status, voted status, or party**. Each row → the voter's profile.
In an org running **more than one campaign**, the unfiltered view shows each person **once**
(their campaigns listed as chips; "surveyed" means surveyed in *any* of them); picking a campaign
filter shows that campaign's own records.

## The profile

One page with everything about a voter:

- **Identity & contact** — name, Voter ID, phone(s), party, gender, registration, districts/precinct.
- **Household & campaign** — address, the campaign, other people at the address (click to jump).
- **Voted status** — whether they've been marked early-voted.
- **Survey responses** — every survey they've given, with answers and notes. If a same-round
  re-survey by a **different canvasser** replaced someone's answers, the winning response says so
  ("Replaced X's earlier answers … preserved below") and the **preserved** earlier response shows
  beneath it as a muted read-only card with a **Restore this response…** action (admins).
- **Notes** — admin notes you add here, plus read-only notes captured in the field.
- **Canvass activity** — what's happened at the household.

## Surveyed vs. voted: two independent statuses

The directory's **Survey status** and **Voted status** filters look related, but they're two
completely separate facts — neither one sets or implies the other:

- **Surveyed** means **a canvasser recorded a survey** at the door, out in the field. It's the
  voter's survey status, and it's set *only* by submitting a survey in the app. (A survey *answer*
  like "Already Voted" is just a recorded answer — it does **not** mark the person voted.)
- **Voted** means **the person was in an Early-Voters CSV you uploaded** on the Early Voting page.
  It's set *only* by that upload (and the "sticky" re-apply of it), and it's tracked **per
  campaign**. See [EARLY_VOTING.md](EARLY_VOTING.md).

So all four combinations are normal: surveyed-not-voted, voted-not-surveyed, both, or neither.
**Order doesn't matter** — someone surveyed in the field weeks ago who later shows up on a
voted-list upload is exactly what you'd expect; the two stay true side by side and never conflict.

### How to read a voter's profile

- The **badges at the top** ("Surveyed", "✓ Voted") describe **the voter you opened**.
- The **Household members** list shows **other people at the same address** — each with *their own*
  status: `· not surveyed` (or `· surveyed`), plus `· voted` **only when that housemate voted**.
  A common mix-up: seeing `Debra Anderson · not surveyed` under Dana's profile is **Debra's**
  status, not Dana's — they're different people.
- A `· fully voted` tag on the **Campaign** line means the **whole door has dropped** off the
  canvassers' books. If it's **absent**, the door is still on the books.

### "Doorline staff access" — the audit footnote at the bottom of the profile

Every voter profile ends with a quiet card answering one question: **has anyone at Doorline
looked at this record?** Most of the time it reads *"Never accessed by Doorline staff."* — and
that's a real answer, not a default: Doorline staff can only open a customer org under a
time-limited, reasoned support grant, and every record they open or export under one is logged.
When there ARE entries, each shows the date, the staff member's first name, the reason they gave
for the support session, and an **export** tag when the record was swept up in a file export
rather than opened individually. Record-level detail begins July 19, 2026; earlier staff access
(if any) was logged per-request only. If a voter ever asks "who has seen my information?", this
panel is the answer you read them.

### Are houses with un-voted people being dropped? No.

A door drops off the canvassers' map and books **only when *every* resident has voted**. A single
un-voted housemate keeps the entire door on the books — so a home where Dana voted but Debra
hasn't will **not** drop. That's why you can have voted residents and still see the door in the
field. Full mechanics live in [EARLY_VOTING.md](EARLY_VOTING.md); the `audit:voted-doors` script
([server/src/utils/auditVotedDoors.js](../server/src/utils/auditVotedDoors.js)) can prove this
against live data.

## Do not contact: a third independent status

A voter can be marked **Do not contact** — "never knock on this person's door again." It's for
the real thing that happens at doors: someone asks, firmly, to be left alone. Unlike the two
statuses above it isn't about what happened; it's a standing request:

- It's **org-wide and permanent**: it follows the person into every future campaign (a vote resets
  each election; this doesn't), and it applies to **every campaign type — lit drop included**.
  "Never come to my door" covers literature.
- **Only an org admin can set or clear it**, always with a written reason. Both actions are
  recorded as a note on the voter, so the history lives in the profile and the Notes hub. You can
  also upload a whole **do-not-contact list** (a CSV of Voter IDs) from the Voters page — it works
  like the Early Voting upload, with a preview, per-upload undo, and "sticky" ids that flag voters
  who enter your universe later.
- **What it does**: the voter drops out of every walk-list voter set and **walk-list CSV export**
  (even lists saved before the flag), canvassers see a "Do not contact" badge on the voter and the
  survey is disabled for them (the server refuses one regardless), and once **every** voter at a
  door is flagged, the whole door drops off cutting, books, and canvasser maps — and shows up as
  its own **"Do not contact" segment** in the coverage bar instead of inflating "unknocked."
- **What it doesn't do**: nothing historical changes. Knocks already billed stay billed, past
  surveys stay in reports (marked, so an export can't be reused as a call list), and a mixed door —
  one flagged voter, one not — stays fully knockable for the housemates.
- A new resident moving into a fully-flagged door **reopens** it automatically on the next import.

> **When the ADDRESS is the one asking, this is the wrong flag.** "Never come to my door again"
> covers the housemates too, and Do not contact deliberately doesn't — a mixed door stays knockable.
> Its sibling feature, **[Do not knock](DO_NOT_KNOCK.md)**, suppresses the address itself in every
> campaign, permanently, without touching anyone's personal Do-not-contact status. The two are
> independent in both directions; note that Do not knock **never** auto-reopens for a new resident,
> the exact inverse of the bullet above.

## What you can change (web admin)

- **Edit voter info** — fix/maintain contact, party, gender, registration, districts, and name.
  The Voter ID, household link, and org are locked (they tie back to the source data).
  **Your hand edits are protected from re-imports**: fixing, say, a phone number confirmed at the
  door marks that field as locally corrected, and later voter-file uploads keep your value. If an
  upload carries a different value for a protected field, the import preview shows the conflict
  ("keeps X · file has Y") and keeps your edit unless you tick **Overwrite these hand edits** —
  which also clears the protection, and is not reversible by Undo import.
- **Mark / unmark Do not contact** — on the voter profile, with a required reason (see above).
- **Edit a survey response in place** — correct answers or the note. Edits are **audited**: we
  record who changed it and when, and keep the voter's "surveyed" status in sync. You can also
  delete a response.
- **Restore a replaced (preserved) response** — when a canvasser's same-round submit overwrote a
  teammate's earlier answers, the earlier response is preserved and shown on the profile as a
  muted read-only card. **Restore this response…** swaps it back losslessly: the current response
  is preserved in its place, the earlier one becomes current, and no counts move. You can also
  delete a preserved response outright. (Deleting a *current* response never touches its
  preserved siblings.)
- **Add notes** — free-form notes about the voter (with your name + timestamp), editable/deletable.

## On mobile (canvassers)

Canvassers get **lookup**: search voters in the **active campaign** (limited to the books assigned
to them), open a **read-only** profile, and **add a note** from the field. Editing voter fields and
survey answers is **web-admin only** — with one carve-out: an **org admin** can delete a duplicate
survey response — or **restore a preserved (overwritten) one** from its response-detail screen —
via the mobile **Duplicate surveys** report ([ADMIN_APP.md](ADMIN_APP.md)). The
mobile voter profile itself stays read-only; both actions live on that report, not here.

**At a door**, a canvasser sees a deliberately short line: **Party · Age · Gender** ("Democratic ·
34 yrs · Female"), plus a ✓ Voted tag and their survey status. It reads identically on the map's
house sheet and inside the household — both render one shared
[VoterMeta](../mobile/components/VoterMeta.jsx). Voter files are sparse, so any part the record
lacks is simply omitted (a voter with nothing on file shows only their name).

**Precinct is not shown at a door** — it's turf paperwork, not something you'd say on a porch. It
still appears on the mobile **voter profile** (above) and on admin response-details, which are fed
by different endpoints; it is no longer in the map/door bootstrap payload at all.

---

# Part 2 — Technical reference

## A. Data model

| Model | File | Notes |
|---|---|---|
| `Voter` | [models/Voter.js](../server/src/models/Voter.js) | **PER-CAMPAIGN rows** (unique `{campaignId, stateVoterId}`; org isolation holds transitively — a campaign belongs to one org). The same person in 2 campaigns of one org = 2 **sibling rows** (same `{organizationId, stateVoterId}`, non-unique index for sibling lookups). **Sibling invariant:** `doNotContact` must agree across siblings (writers write by the org+svid pair); `surveyStatus`, `householdId`, `locallyEditedFields` are per-row by design. Also: `lastEditedBy`/`lastEditedAt` (admin edit stamp), `{organizationId, lastName, firstName}` directory index. **`doNotContact`** typed subdoc `{flagged, at, byUserId, reason, source: 'admin'\|'upload', uploadId}` + partial index `{organizationId, 'doNotContact.flagged'}` (flagged rows only). Index changes ship via `migrate:voter-campaigns --apply` then `migrate:build-indexes --apply`. Import-safe **by omission**: never in csvImporter's `row.voter` `$set`; a flagged person imported into a NEW campaign gets the subdoc **seeded on insert** (`$setOnInsert`, original attribution kept, so upload-undo still reverts seeded copies). |
| `Household.doNotKnock` | [models/Household.js](../server/src/models/Household.js) | The ADDRESS-level sibling — see **[DO_NOT_KNOCK.md](DO_NOT_KNOCK.md)**. NOT derived from voters: mirrored from the org-level `DoNotKnockAddress` record (keyed `{organizationId, normalizedAddress}`, no campaignId, survives a campaign delete). Written ONLY by [recomputeDoNotKnock.js](../server/src/services/dnc/recomputeDoNotKnock.js), same unconditional-`$set`/`updatedAt` contract as `fullyDnc`. In `KNOCKABLE_DOOR_FILTER` as the 5th flag. Never auto-reopens. |
| `Household.fullyDnc` | [models/Household.js](../server/src/models/Household.js) | Derived: true when **every** voter at the door is flagged (≥1-voter guard — a voter-less door is never fullyDnc). Written ONLY by [services/dnc/recomputeFullyDnc.js](../server/src/services/dnc/recomputeFullyDnc.js), whose unconditional bulkWrite `$set` bumps `updatedAt` — the mobile `/changes` delta depends on that bump. Filtered via the shared [`KNOCKABLE_DOOR_FILTER`](../server/src/services/canvass/knockableDoorFilter.js) at every cut/serve/count site. |
| `DncUpload` / `DncPendingId` | [models/DncUpload.js](../server/src/models/DncUpload.js), [models/DncPendingId.js](../server/src/models/DncPendingId.js) | Org-level (no campaignId) audit + sticky-pending stores for DNC list uploads; pendings graduate on later imports via [services/dnc/reapplyDncLists.js](../server/src/services/dnc/reapplyDncLists.js), hooked in importProcessor beside the voted reapply. `DncPendingId.uploadId` is now **nullable**: deleting a campaign that held a flagged person's LAST row parks their request as a pending id (null uploadId = admin-set, `reason` carried) so a later import re-flags them — "never contact me" survives a campaign delete. Both models are in the org-delete `ORG_SCOPED` sweep. |
| `VoterNote` | [models/VoterNote.js](../server/src/models/VoterNote.js) | **New, org-level** admin/canvasser note that follows the person: `{ organizationId, voterId, authorId, body, editedBy, editedAt, timestamps }`. Index `{voterId, createdAt:-1}`. |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | New: `editedBy`/`editedAt` audit fields for in-place edits. `answers` = `[{questionKey, questionLabel, answer}]`. |
| `CanvassActivity` / `SurveyResponse` notes | — | Field notes shown read-only on the profile (no dedicated voter-note before this feature). |

## B. Shared profile builder
[`server/src/services/voters/voterProfile.js`](../server/src/services/voters/voterProfile.js) →
`buildVoterProfile(voterId, { orgId })` composes the whole payload (voter, household + campaign +
members, voted status, surveys **with their template question defs** for editing, household canvass
activity, and notes = admin `VoterNote`s + derived field notes). Used by **both** the admin and
mobile routes so the shape is identical.

**Staff-access panel**: `GET /admin/voters/:voterId/staff-access` (admin-gated, org-scoped in
[routes/admin/voters.js](../server/src/routes/admin/voters.js)) reads the org's `AccessLog` rows
whose record-level `subjects` include this voter, its household, or its person identity →
`{count, entries:[{at, staffFirstName, reason, kind, export}]}` (first-name-only — the same
disclosure the support-grant notice email makes). Subjects are written only for staff access
under a support grant (single-record opens + exports; see PLATFORM.md + the v4 stamps in
PRIVACY_VERIFICATION.md), so zero entries genuinely means never accessed. Multikey index
`{'subjects.id': 1, at: -1}` — needs `migrate:build-indexes --apply`.

## C. Endpoints

**Admin** (`/admin/voters`, [routes/admin/voters.js](../server/src/routes/admin/voters.js)) —
guarded by `requireAuth, orgContext, requireOrgRole('admin')`:

| Method · path | Purpose |
|---|---|
| `GET /admin/voters` | Directory: server-paginated (`limit`/`skip`/`total`). Search (name/Voter ID/address) + filters (`campaignId`, `party`, `surveyStatus`, `voted`, `precinct`, `dnc`). Rows carry a `dnc` boolean. `?campaignId` is a direct `filter.campaignId` (rows are per-campaign — always resolves that campaign's own row). The org-wide view of a **multi-campaign** org runs a dedupe-by-svid aggregation: one row per person (`$first` in directory order), additive `campaigns:[{id,name}]` chips, `surveyStatus` = surveyed-in-any; single-campaign orgs keep the plain indexed find. |
| `POST /admin/voters/:voterId/dnc` | Flag do-not-contact (body `{reason}`, required, min 3 chars). Idempotent — a re-flag never restamps (upload-undo attribution). Writes by `{organizationId, stateVoterId}` so **every sibling row flips together**, writes a VoterNote, then `recomputeFullyDnc` for **every sibling's door**. Returns the profile. |
| `DELETE /admin/voters/:voterId/dnc` | Clear the flag on **all sibling rows** (stamps the transition + VoterNote + recompute; doors may reopen in every campaign). |
| `GET /admin/voters/:voterId` | Full profile (`buildVoterProfile`). |
| `PATCH /admin/voters/:voterId` | Edit allowed fields (Zod). Locks `stateVoterId`/`householdId`/`organizationId`; stamps `lastEditedBy/At`; recomputes `fullName`. |
| `POST/PATCH/DELETE /admin/voters/:voterId/notes[/:noteId]` | Admin voter-note CRUD. |
| `PATCH /admin/voters/:voterId/surveys/:responseId` | Edit `answers`/`note`; sets `editedBy/At`; then `recomputeSurveyStatus`. |
| `DELETE /admin/voters/:voterId/surveys/:responseId` | Delete a response; then `recomputeSurveyStatus`. Never touches archived (preserved) siblings. |
| `POST /admin/voters/:voterId/surveys/:archiveId/restore` | **Lossless swap**: archive the displaced current response (`via:'restore'`), promote the preserved one verbatim, consume the archive row (re-restore = 404); resurrects (+1 `surveyCount`) if the current response was deleted meanwhile; then `recomputeSurveyStatus`. See [SURVEYS.md](SURVEYS.md) §F. |
| `DELETE /admin/voters/:voterId/surveys/archive/:archiveId` | Erase a preserved (overwritten) response outright. No counters move — archives were never counted. |

**Mobile** (`/mobile/voters`, [routes/mobile/voters.js](../server/src/routes/mobile/voters.js)) —
`requireAuth, orgContext, requireOrgMember`; **active-campaign-scoped, read + add-note only**.
Canvassers are restricted to households in their **assigned books on the active pass**:

| Method · path | Purpose |
|---|---|
| `GET /mobile/voters?campaignId=&search=` | Campaign-scoped search (≤50). Rows carry `dnc`. |
| `GET /mobile/voters/:voterId?campaignId=` | Read profile (403 if the voter isn't in the canvasser's books). |
| `POST /mobile/voters/:voterId/notes` | Add a `VoterNote` (`{campaignId, body}`). |

**DNC list upload** (`/admin/dnc`, [routes/admin/dnc.js](../server/src/routes/admin/dnc.js)) —
**org-level and org-admins-only** on purpose (the campaign-nested voted router's
`requireCampaignManager` gate admits leads; this one must not): `POST /preview` (dry run, incl.
`dropsByCampaign`), `POST /import` (flag + recompute; skip-already-flagged lives in the bulk op
filter so undo attribution stays clean), `POST /undo` (reverts only rows carrying this upload's
`uploadId` — admin-set flags are never touched), `GET /` (history + org totals).

## D. Invariants
- **`recomputeSurveyStatus`** ([status.js](../server/src/services/canvass/status.js)) runs after any
  survey edit/delete — `Voter.surveyStatus` is `surveyed` iff ≥1 `SurveyResponse` exists. Editing
  answers keeps it `surveyed`; deleting the last one flips it to `not_surveyed`.
- **Locked fields:** `stateVoterId`, `householdId`, `organizationId` are never editable here
  (identity/source integrity). Changing a household = a re-import concern, not a profile edit.
- **Scoping:** admin is org-wide; mobile is the active campaign and (for non-admins) the canvasser's
  assigned books.
- **Sibling rows (multi-campaign orgs):** the same person imported into 2 campaigns has one Voter
  row per campaign. Person-level history — surveys, VoterNotes, field notes, staff-access answers —
  is **unioned across siblings** in `buildVoterProfile` (each survey is labeled with its
  campaignId, and the profile carries an additive `otherCampaigns` array); door-level facts
  (household, members, activity, voted) stay the opened row's. `doNotContact` writers keep
  siblings in lockstep; `surveyStatus` never crosses rows.
- **Do-not-contact enforcement is layered** — no single gate is trusted alone: walk-list resolution
  excludes flagged voters unconditionally ([resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js) —
  applied after every filter, not a checkbox); the walk-list CSV export re-checks LIVE flag state
  (frozen lists predate flags); the mobile wire ships only a `dnc` **boolean** (the reason never
  reaches a phone's offline cache); the door UI disables the survey; and the server survey route
  403s `DO_NOT_CONTACT` regardless ([canvass.js](../server/src/routes/mobile/canvass.js)) — the
  authoritative backstop that also catches offline-queued submits flushed after a flag.
- **History is never rewritten:** flagging changes nothing already recorded — billed knocks stay
  billed, past survey responses stay in reports (marked "Do not contact", never deleted).

## E. Frontend mapping

**Web** ([client/src](../client/src)):
| File | Renders |
|---|---|
| [pages/VotersPage.jsx](../client/src/pages/VotersPage.jsx) | Directory: filters + server-paginated table; row → `/voters/:id`. Nav item in [navItems.js](../client/src/components/navItems.js); routes in [App.jsx](../client/src/App.jsx) under `requireOrgAdmin`. |
| [pages/VoterDetailPage.jsx](../client/src/pages/VoterDetailPage.jsx) | Profile: editable identity/contact, household + members, survey responses (edit-in-place by question type, shows edited-by/at; a winning response renders its `replacedEarlier` note, and preserved responses from `overwrittenSurveys[]` render as muted read-only cards with **Restore this response…**), admin notes CRUD + read-only field notes, activity. |

**Mobile** ([mobile/app/(app)/voters](../mobile/app/(app)/voters)):
| File | Renders |
|---|---|
| [voters/index.jsx](../mobile/app/(app)/voters/index.jsx) | Campaign-scoped search list; row → profile. Entry points: the "Voter search" row on the mobile admin **More** tab and tapped-voter links on the admin **Notes** screen (the old canvasser-facing "Voters" link in the books header was removed). |
| [voters/[id].jsx](../mobile/app/(app)/voters/[id].jsx) | Read-only profile (details, household, voted, surveys, notes) + add-note. **Management-only**: `GET /mobile/voters/:voterId` requires lead (per-campaign grant, entry voter must belong to the granted campaign) / admin / super — a plain canvasser gets 403. The profile carries cross-round survey answers, raw DOB, and phone; the door screen deliberately presents each round fresh, and none of that belongs in a canvasser's hands (see [PASSES_AND_TURF.md](PASSES_AND_TURF.md) → the round-fresh presentation). The search *list* stays canvasser-reachable (book-scoped, identity + status booleans only, no answers). |

## F. Status semantics (surveyed vs. voted)

Surveyed and voted are **independent** and backed by **different sources** — useful to know
because the two directory filters and the two profile badges look parallel but aren't.

| UI element | Field / source | Where |
|---|---|---|
| "Surveyed" badge | `voter.surveyStatus === 'surveyed'` (org-level `Voter` field) | [VoterDetailPage.jsx:277](../client/src/pages/VoterDetailPage.jsx#L277) |
| "✓ Voted" badge | `p.voted.isVoted` — a per-campaign `VotedVoter` lookup in [voterProfile.js](../server/src/services/voters/voterProfile.js) | [VoterDetailPage.jsx:280](../client/src/pages/VoterDetailPage.jsx#L280) |
| "· fully voted" (Campaign line) | `household.fullyVoted` (derived; see [EARLY_VOTING.md](EARLY_VOTING.md)) | [VoterDetailPage.jsx:299](../client/src/pages/VoterDetailPage.jsx#L299) |
| Household member line `· surveyed / · voted` | `m.surveyStatus` and `m.voted` (per-member, voted from a `VotedVoter` lookup) | [VoterDetailPage.jsx:308](../client/src/pages/VoterDetailPage.jsx#L308), [voterProfile.js](../server/src/services/voters/voterProfile.js) |
| **Survey-status filter** | direct field query `filter.surveyStatus = req.query.surveyStatus` | [routes/admin/voters.js](../server/src/routes/admin/voters.js) (`GET /admin/voters`) |
| **Voted-status filter** | campaign-scoped `VotedVoter.distinct('voterId')`, then `_id $in/$nin` | [routes/admin/voters.js](../server/src/routes/admin/voters.js) (`GET /admin/voters`) |

Key invariants:
- **Survey answers never create a voted mark.** The survey-submit path
  ([routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js)) writes a `SurveyResponse`
  and sets `surveyStatus`, and touches **no** `VotedVoter` row — even for an "Already Voted" answer.
- **`surveyStatus` and voted are BOTH per-campaign.** Survey status lives on each campaign's own
  `Voter` row (surveying a shared person in campaign A leaves campaign B's row `not_surveyed`);
  the voted mark is a campaign-scoped `VotedVoter` row. A `Voter` has **no** `voted` field. The
  org directory's unfiltered view reads surveyed-in-any across a person's sibling rows.
- **A door drops only when all of its voters are voted** (`recomputeFullyVoted`: `voterCount > 0 &&
  every voter has a VotedVoter row`) — one un-voted resident keeps it on the books. Auditable via
  `npm run audit:voted-doors` ([server/src/utils/auditVotedDoors.js](../server/src/utils/auditVotedDoors.js)).
