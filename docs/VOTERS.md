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
