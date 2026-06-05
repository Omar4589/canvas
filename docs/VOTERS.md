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

Voters are stored at the **organization** level — one record per person (deduped by their state
Voter ID). Each voter is attached to **one household, which belongs to one campaign**, so a voter is
associated with a single campaign at a time. Campaign-specific data — **surveys, voted marks,
knocks** — is per campaign. That's why the directory is **org-wide with a campaign filter**.

## The directory (web: "Voters")

A searchable, paginated list of every voter in the org. Search by **name, Voter ID, or address**;
filter by **campaign, survey status, voted status, or party**. Each row → the voter's profile.

## The profile

One page with everything about a voter:

- **Identity & contact** — name, Voter ID, phone(s), party, gender, registration, districts/precinct.
- **Household & campaign** — address, the campaign, other people at the address (click to jump).
- **Voted status** — whether they've been marked early-voted.
- **Survey responses** — every survey they've given, with answers and notes.
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

### Are houses with un-voted people being dropped? No.

A door drops off the canvassers' map and books **only when *every* resident has voted**. A single
un-voted housemate keeps the entire door on the books — so a home where Dana voted but Debra
hasn't will **not** drop. That's why you can have voted residents and still see the door in the
field. Full mechanics live in [EARLY_VOTING.md](EARLY_VOTING.md); the `audit:voted-doors` script
([server/src/utils/auditVotedDoors.js](../server/src/utils/auditVotedDoors.js)) can prove this
against live data.

## What you can change (web admin)

- **Edit voter info** — fix/maintain contact, party, gender, registration, districts, and name.
  The Voter ID, household link, and org are locked (they tie back to the source data).
- **Edit a survey response in place** — correct answers or the note. Edits are **audited**: we
  record who changed it and when, and keep the voter's "surveyed" status in sync. You can also
  delete a response.
- **Add notes** — free-form notes about the voter (with your name + timestamp), editable/deletable.

## On mobile (canvassers)

Canvassers get **lookup**: search voters in the **active campaign** (limited to the books assigned
to them), open a **read-only** profile, and **add a note** from the field. Editing voter fields and
survey answers is **web-admin only**.

---

# Part 2 — Technical reference

## A. Data model

| Model | File | Notes |
|---|---|---|
| `Voter` | [models/Voter.js](../server/src/models/Voter.js) | Org-scoped (unique `{organizationId, stateVoterId}`). New: `lastEditedBy`/`lastEditedAt` (admin edit stamp) + index `{organizationId, lastName, firstName}` for the directory. |
| `VoterNote` | [models/VoterNote.js](../server/src/models/VoterNote.js) | **New, org-level** admin/canvasser note that follows the person: `{ organizationId, voterId, authorId, body, editedBy, editedAt, timestamps }`. Index `{voterId, createdAt:-1}`. |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | New: `editedBy`/`editedAt` audit fields for in-place edits. `answers` = `[{questionKey, questionLabel, answer}]`. |
| `CanvassActivity` / `SurveyResponse` notes | — | Field notes shown read-only on the profile (no dedicated voter-note before this feature). |

## B. Shared profile builder
[`server/src/services/voters/voterProfile.js`](../server/src/services/voters/voterProfile.js) →
`buildVoterProfile(voterId, { orgId })` composes the whole payload (voter, household + campaign +
members, voted status, surveys **with their template question defs** for editing, household canvass
activity, and notes = admin `VoterNote`s + derived field notes). Used by **both** the admin and
mobile routes so the shape is identical.

## C. Endpoints

**Admin** (`/admin/voters`, [routes/admin/voters.js](../server/src/routes/admin/voters.js)) —
guarded by `requireAuth, orgContext, requireOrgRole('admin')`:

| Method · path | Purpose |
|---|---|
| `GET /admin/voters` | Directory: server-paginated (`limit`/`offset`/`total`); search (name/Voter ID/address) + filters (`campaignId`, `party`, `surveyStatus`, `voted`, `precinct`). |
| `GET /admin/voters/:voterId` | Full profile (`buildVoterProfile`). |
| `PATCH /admin/voters/:voterId` | Edit allowed fields (Zod). Locks `stateVoterId`/`householdId`/`organizationId`; stamps `lastEditedBy/At`; recomputes `fullName`. |
| `POST/PATCH/DELETE /admin/voters/:voterId/notes[/:noteId]` | Admin voter-note CRUD. |
| `PATCH /admin/voters/:voterId/surveys/:responseId` | Edit `answers`/`note`; sets `editedBy/At`; then `recomputeSurveyStatus`. |
| `DELETE /admin/voters/:voterId/surveys/:responseId` | Delete a response; then `recomputeSurveyStatus`. |

**Mobile** (`/mobile/voters`, [routes/mobile/voters.js](../server/src/routes/mobile/voters.js)) —
`requireAuth, orgContext, requireOrgMember`; **active-campaign-scoped, read + add-note only**.
Canvassers are restricted to households in their **assigned books on the active pass**:

| Method · path | Purpose |
|---|---|
| `GET /mobile/voters?campaignId=&search=` | Campaign-scoped search (≤50). |
| `GET /mobile/voters/:voterId?campaignId=` | Read profile (403 if the voter isn't in the canvasser's books). |
| `POST /mobile/voters/:voterId/notes` | Add a `VoterNote` (`{campaignId, body}`). |

## D. Invariants
- **`recomputeSurveyStatus`** ([status.js](../server/src/services/canvass/status.js)) runs after any
  survey edit/delete — `Voter.surveyStatus` is `surveyed` iff ≥1 `SurveyResponse` exists. Editing
  answers keeps it `surveyed`; deleting the last one flips it to `not_surveyed`.
- **Locked fields:** `stateVoterId`, `householdId`, `organizationId` are never editable here
  (identity/source integrity). Changing a household = a re-import concern, not a profile edit.
- **Scoping:** admin is org-wide; mobile is the active campaign and (for non-admins) the canvasser's
  assigned books.

## E. Frontend mapping

**Web** ([client/src](../client/src)):
| File | Renders |
|---|---|
| [pages/VotersPage.jsx](../client/src/pages/VotersPage.jsx) | Directory: filters + server-paginated table; row → `/voters/:id`. Nav item in [navItems.js](../client/src/components/navItems.js); routes in [App.jsx](../client/src/App.jsx) under `requireOrgAdmin`. |
| [pages/VoterDetailPage.jsx](../client/src/pages/VoterDetailPage.jsx) | Profile: editable identity/contact, household + members, survey responses (edit-in-place by question type, shows edited-by/at), admin notes CRUD + read-only field notes, activity. |

**Mobile** ([mobile/app/(app)/voters](../mobile/app/(app)/voters)):
| File | Renders |
|---|---|
| [voters/index.jsx](../mobile/app/(app)/voters/index.jsx) | Campaign-scoped search list; row → profile. Entry point: "Voters" link in the [books](../mobile/app/(app)/books.jsx) header. |
| [voters/[id].jsx](../mobile/app/(app)/voters/[id].jsx) | Read-only profile (details, household, voted, surveys, notes) + add-note. |

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
- **`surveyStatus` is org-wide; voted is per-campaign.** Survey status lives on the shared `Voter`
  doc; the voted mark is a campaign-scoped `VotedVoter` row, so a voter can be voted in one
  campaign and not another (and a `Voter` has **no** `voted` field).
- **A door drops only when all of its voters are voted** (`recomputeFullyVoted`: `voterCount > 0 &&
  every voter has a VotedVoter row`) — one un-voted resident keeps it on the books. Auditable via
  `npm run audit:voted-doors` ([server/src/utils/auditVotedDoors.js](../server/src/utils/auditVotedDoors.js)).
