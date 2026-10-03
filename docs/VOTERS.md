# Voter directory & profile

How to browse the voters in your database and open a single voter to see — and edit — everything
about them.

- **Part 1 — For everyone** is plain language.
- **Part 2 — Technical reference** is for developers (and Claude): models, endpoints, the audit
  fields, and the components.

Related: [EARLY_VOTING.md](EARLY_VOTING.md) (voted status), [METRICS.md](METRICS.md),
[SURVEYS.md](SURVEYS.md) (the surveys whose responses appear on a voter's profile),
[ROLES.md](ROLES.md) (which Voters surface each role gets — the org-wide directory is admin-only; the
campaign tab admits team leads).

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
filter by **campaign, survey status, voted status, source ("Added at the door"), or party**. Each
row → the voter's profile.
In an org running **more than one campaign**, the unfiltered view shows each person **once**
(their campaigns listed as chips; "surveyed" means surveyed in *any* of them); picking a campaign
filter shows that campaign's own records. If that all-campaigns view takes too long, the page says so
and offers **Try again** — and picking a campaign always loads quickly.

This org-wide page is **admins only**. Once a campaign is selected, an **Open in campaign →** link
beside the campaign select jumps to the same list inside that campaign (below).

### The campaign Voters tab (admins and team leads)

Every campaign also has its own **Voters** tab (in the sidebar's Field group, after Map): one row
per voter in **this campaign** — the campaign's own records, nothing deduped, no chips — with the
same search box and the same filters minus the campaign dropdown (the campaign is the URL). Each
row opens the **campaign profile** (`/campaigns/<id>/voters/<voter>`), and the page header is the
campaign's name. A **team lead sees it only on campaigns they manage** — it is the voter lookup a
lead gets on the web, the same scope they already had in the phone's Voter search. It is also the
fast view: one campaign is an indexed, name-ordered page with an exact count and none of the
org-wide dedupe work — the same reason picking a campaign on the org page always loads quickly.
Admins get an **Org-wide directory →** link back to the page above; leads don't, because they
can't open it.

## The profile

One page with everything about a voter:

- **Identity & contact** — name, Voter ID, phone(s), email (if they volunteered one), party, gender,
  registration, districts/precinct.
- **Household & campaign** — address, the campaign, other people at the address (click to jump).
- **Voted status** — whether they've been marked early-voted.
- **Survey responses** — every survey they've given, with answers and notes. If a same-round
  re-survey by a **different canvasser** replaced someone's answers, the winning response says so
  ("Replaced X's earlier answers … preserved below") and the **preserved** earlier response shows
  beneath it as a muted read-only card with a **Restore this response…** action (admins).
- **Notes** — admin notes you add here, plus read-only notes captured in the field.
- **Canvass activity** — what's happened at the household: each knock's result in plain words
  ("Surveyed", "Not home"), who recorded it and when, and any note left with it. On campaigns that
  use **Not a target voter**, those knocks are listed too, with their note — the entry means whoever
  answered the door wasn't on the list, not that this voter isn't a target.

Admins reach a profile from either Voters page, and the two show the same person with one
difference: opened from the **org-wide** page — or by an admin from the campaign tab — the profile
lists **every campaign** the person is in, with links, and unions their survey answers and notes
across those campaigns. Opened from the **campaign Voters tab**, the page is campaign-relative:
household members and "Also in" links stay inside the campaign.

**Team leads** get the campaign profile **read-only**. Everything above is shown — contact details
and email, districts, the household and its members, this campaign's survey answers (including any
preserved earlier responses), this campaign's notes, canvass activity, and whether the person is
**Do not contact**, with the reason, who flagged them and when — but there is no Edit, no flag or
clear, no survey edit/delete/restore, no delete. A lead **can add a note**, and **can** mark or lift
the household's do-not-knock, both of which they could already do. A lead sees **only this
campaign's** survey answers and notes: if the same person is in another campaign of the org, that
campaign's answers, notes and name are neither shown nor linked.

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

Every voter profile an **org admin** opens ends with a quiet card answering one question: **has
anyone at Doorline looked at this record?** (Admins only — a team lead's campaign profile doesn't
carry it; it is an org-level audit footnote, not a campaign fact.) Most of the time it reads
*"Never accessed by Doorline staff."* — and
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
  who enter your universe later. **The list is for one state, and the upload asks which:** IDs are
  matched inside that state's campaigns only (leading zeros ignored, either way round), because two
  states can issue the same digits. Anything the file names outside that state is **reported with a
  download, never flagged**; a list covering two states is two uploads. A remembered id is stamped
  with the state and only ever flags a voter in that state's campaigns, when they arrive under the
  exact id the list carried (the do-not-contact graduation stays exact on purpose; re-upload the list
  after the import if it was spelled differently). Technical detail:
  [`parseAndMatchState`](../server/src/services/import/parseVoterIdList.js) and
  [`reapplyDncLists`](../server/src/services/dnc/reapplyDncLists.js); the reasoning in
  [PROPOSAL_VOTER_ID_KEYS.md](PROPOSAL_VOTER_ID_KEYS.md).
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
  delete a response. The editor lists only the questions that record an answer: a scripted survey's
  read-aloud statements and closings never appear in it, because nothing is ever recorded for them.
- **Restore a replaced (preserved) response** — when a canvasser's same-round submit overwrote a
  teammate's earlier answers, the earlier response is preserved and shown on the profile as a
  muted read-only card. **Restore this response…** swaps it back losslessly: the current response
  is preserved in its place, the earlier one becomes current, and no counts move. You can also
  delete a preserved response outright. (Deleting a *current* response never touches its
  preserved siblings.)
- **Add notes** — free-form notes about the voter (with your name + timestamp), editable/deletable.

## On mobile (admins and team leads)

The phone's **Voter search** (More tab) is **management-only**: it searches the **whole campaign**
named in the campaign chip — a lead's grant is the scope, no roster row needed — and opens a
**read-only** profile with an **add a note** action. Canvassers have no voter lookup there (the
profile route has refused them since 2026-07-30: it carries cross-round answers, raw DOB and phone,
none of which belongs in a walker's hands). A **team lead's** profile is **campaign-scoped**, exactly
like the web tab above — this campaign's survey answers and notes only, no other campaigns listed;
an **org admin's** keeps the person's full cross-campaign history. Editing voter fields and survey
answers is **web-admin only** — with one carve-out: an **org admin** can delete a duplicate survey
response — or **restore a preserved (overwritten) one** from its response-detail screen — via the
mobile **Duplicate surveys** report ([ADMIN_APP.md](ADMIN_APP.md)). The mobile voter profile itself
stays read-only; both actions live on that report, not here.

**At a door**, a canvasser sees a deliberately short line: **Party · Age · Gender** ("Democratic ·
34 yrs · Female"), plus a ✓ Voted tag and their survey status. It reads identically on the map's
house sheet and inside the household — both render one shared
[VoterMeta](../mobile/components/VoterMeta.jsx). Voter files are sparse, so any part the record
lacks is simply omitted (a voter with nothing on file shows only their name).

**Precinct is not shown at a door** — it's turf paperwork, not something you'd say on a porch. It
still appears on the mobile **voter profile** (above) and on admin response-details, which are fed
by different endpoints; it is no longer in the map/door bootstrap payload at all.

## Adding a person at the door (walk-up voters)

Sometimes the person who answers **lives there but isn't on the list** — voter files are always a
little stale. Canvassers on **survey campaigns** get an **＋ Add person** button on the door screen
(also offered on doors with no listed voters): first and last name required, **phone and email
optional** — those two are only for people who'd like to be contacted back. The person is **saved
immediately** to that address (they stay on the roster even if the conversation ends there), and
the survey opens for them right away. It works **offline** exactly like every other door action —
the add and its survey queue together and sync in order when signal returns. (If the door already
shows a different result this round — Not home, say — the survey screen asks first, *"Take a
survey instead?"*, and **Cancel** leaves the person added but not surveyed. See
[CANVASSER_APP.md](CANVASSER_APP.md) → *Changing a door's result*.)

**Someone who won't give a name can't be added** — Add person needs a first and last name. That
visit is what the **Not a target voter** button is for, on campaigns that have it turned on: one
tap, no name recorded, counted as a knock and as reaching a person but never as a survey. It's off
on every campaign until an org admin turns it on (survey campaigns only); where it's off, the
canvasser records the door as they do today and mentions it to their lead. See
[CANVASSER_APP.md](CANVASSER_APP.md) → *Not a target voter* and [CAMPAIGNS.md](CAMPAIGNS.md) →
*Off until you turn it on*.

What campaigns control and admins see:

- **Who can add** is a campaign setting on **App Customization** ("Adding people at the door"):
  everyone on the campaign (the default), or team leads & admins only. Editable by leads, like the
  outcome toggles, and audited in the campaign's history. A change reaches canvassers' phones on its
  own within about 30 seconds while they're on the map — no refresh needed (a phone with no signal
  gets it once it's back online; an app that hasn't taken the latest update still needs a refresh).
- Door-added people are **marked "Added at the door"** (who added them, and when) — as a badge in
  the Voters directory (with a filter to see only them), and as a banner on their profile.
- They flow into **reports, surveys, tags, and exports like any other voter**. They have **no
  state Voter ID** (nothing to match against a voter file), so the directory and exports show a
  blank/dash for that column, and demographic walk-list filters (party, age…) won't match them.
- **Billing does not change**: a knock is priced per door visit, not per person — surveying a
  second resident at an already-knocked door costs nothing extra, and neither does adding one.
- Admins can **edit** a door-added entry (including the new **email** field) and — uniquely for
  door-added entries — **delete** one that was mistaken or fraudulent. Deleting permanently
  removes the person, their survey answers, and notes; **the door visit itself stays recorded**
  (the knock genuinely happened). Imported voters can never be deleted this way.
- If the same person later arrives in a **voter-file import**, that import creates a **second,
  separate record** under their real Voter ID — nothing merges automatically. The clean-up is to
  delete the door-added duplicate.

---

# Part 2 — Technical reference

## A. Data model

| Model | File | Notes |
|---|---|---|
| `Voter` | [models/Voter.js](../server/src/models/Voter.js) | **PER-CAMPAIGN rows** (unique `{campaignId, stateVoterId}`; org isolation holds transitively — a campaign belongs to one org). The same person in 2 campaigns of one org = 2 **sibling rows** (same `{organizationId, stateVoterId}`, non-unique index for sibling lookups). **Sibling invariant:** `doNotContact` must agree across siblings (writers write by the org+svid pair); `surveyStatus`, `householdId`, `locallyEditedFields` are per-row by design. Also: `lastEditedBy`/`lastEditedAt` (admin edit stamp), `{organizationId, lastName, firstName}` directory index, plus the two **directory indexes added 2026-09-30 — key order is load-bearing**: the covering `{organizationId, lastName, firstName, _id, stateVoterId, campaignId, surveyStatus, party, 'doNotContact.flagged'}` (`organizationId` is the equality prefix; `lastName, firstName, _id` is the dedupe pipeline's pre-group sort *including the `_id` tie-break* no earlier index carried — without it every plan ran a blocking SORT over every org document, the 2026-09-30 H12; `stateVoterId`/`campaignId` feed the `$group`, and the party, survey-status and do-not-contact keys (plus `_id`, which the voted filter uses) keep those pages COVERED — 0 documents read; precinct, door-added and search still fetch documents, inside the same bound; ~37.5 MB at 462k rows) and the campaign-scoped `{organizationId, campaignId, lastName, firstName}` (index-provided name order within one campaign and a COUNT_SCAN for its total — `countDocuments({organizationId, campaignId})` used to fetch every org document on every page load). Prod `autoIndex` is OFF, so both exist only after `npm run migrate:build-indexes` (dry run) then `npm run migrate:build-indexes -- --apply` from the Run console — a gate on that release, not a follow-up ([OPERATIONS.md](OPERATIONS.md)). **`doNotContact`** typed subdoc `{flagged, at, byUserId, reason, source: 'admin'\|'upload', uploadId}` + partial index `{organizationId, 'doNotContact.flagged'}` (flagged rows only). Index changes ship via `migrate:voter-campaigns --apply` then `migrate:build-indexes --apply`. Import-safe **by omission**: never in csvImporter's `row.voter` `$set`; a flagged person imported into a NEW campaign gets the subdoc **seeded on insert** (`$setOnInsert`, original attribution kept, so upload-undo still reverts seeded copies). |
| `Household.doNotKnock` | [models/Household.js](../server/src/models/Household.js) | The ADDRESS-level sibling — see **[DO_NOT_KNOCK.md](DO_NOT_KNOCK.md)**. NOT derived from voters: mirrored from the org-level `DoNotKnockAddress` record (keyed `{organizationId, normalizedAddress}`, no campaignId, survives a campaign delete). Written ONLY by [recomputeDoNotKnock.js](../server/src/services/dnc/recomputeDoNotKnock.js), same unconditional-`$set`/`updatedAt` contract as `fullyDnc`. In `KNOCKABLE_DOOR_FILTER` as the 5th flag. Never auto-reopens. |
| `Household.fullyDnc` | [models/Household.js](../server/src/models/Household.js) | Derived: true when **every** voter at the door is flagged (≥1-voter guard — a voter-less door is never fullyDnc). Written ONLY by [services/dnc/recomputeFullyDnc.js](../server/src/services/dnc/recomputeFullyDnc.js), whose unconditional bulkWrite `$set` bumps `updatedAt` — the mobile `/changes` delta depends on that bump. Filtered via the shared [`KNOCKABLE_DOOR_FILTER`](../server/src/services/canvass/knockableDoorFilter.js) at every cut/serve/count site. |
| `DncUpload` / `DncPendingId` | [models/DncUpload.js](../server/src/models/DncUpload.js), [models/DncPendingId.js](../server/src/models/DncPendingId.js) | Org-level (no campaignId) audit + sticky-pending stores for DNC list uploads; pendings graduate on later imports via [services/dnc/reapplyDncLists.js](../server/src/services/dnc/reapplyDncLists.js), hooked in importProcessor beside the voted reapply. `DncPendingId.uploadId` is now **nullable**: deleting a campaign that held a flagged person's LAST row parks their request as a pending id (null uploadId = admin-set, `reason` carried) so a later import re-flags them — "never contact me" survives a campaign delete. Both models are in the org-delete `ORG_SCOPED` sweep. |
| `Voter.email` / `Voter.doorAdded` | [models/Voter.js](../server/src/models/Voter.js) | **Walk-up voter fields.** `email` (default null, lowercased) is **org-local contact info, not identity** — in the admin PATCH's `ORG_LOCAL_FIELDS`, never in `PERSON_IDENTITY_FIELDS`/propagateIdentity (Person has no email path), and **never in a canvasser wire** (`MOBILE_VOTER_PROJECTION` in [routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js) — bootstrap, `/changes`, the walk-up create response) nor in any export's column set; it rides only the **management-only profile routes** — web org + campaign (`buildVoterProfile` returns `voter.email`) and the mobile profile — like phone. `doorAdded` subdoc `{byUserId, at}`, default null — `doorAdded != null` IS the provenance marker (imports never set it; import-safe by omission like `doNotContact`), the directory filter (partial index `{organizationId, 'doorAdded.at'}` on `$exists`, needs `migrate:build-indexes --apply`), and the delete gate. Door-added rows carry a **synthetic per-row `stateVoterId` = `manual:<their own _id hex>`** — unique under `{campaignId, stateVoterId}` by construction; a shared placeholder is forbidden (it would merge unrelated people through every `{organizationId, stateVoterId}` sibling surface: profile union, DNC fan-out, directory dedupe, Person svidKeys, platform counters). |
| `VoterNote` | [models/VoterNote.js](../server/src/models/VoterNote.js) | **New, org-level** admin/canvasser note that follows the person: `{ organizationId, voterId, authorId, body, editedBy, editedAt, timestamps }`. Index `{voterId, createdAt:-1}`. |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | New: `editedBy`/`editedAt` audit fields for in-place edits. `answers` = `[{questionKey, questionLabel, answer}]`. |
| `CanvassActivity` / `SurveyResponse` notes | — | Field notes shown read-only on the profile (no dedicated voter-note before this feature). |

## B. Shared resolvers (one owner each)

**The list** — [`server/src/services/voters/voterDirectory.js`](../server/src/services/voters/voterDirectory.js)
→ `listVoters({ orgId, campaignId, query, limit, skip })` → `{ voters, total, limit, skip }` is the
**ONE** directory resolver: the filter builder (party, surveyStatus, precinct, dnc, doorAdded, voted
via `VotedVoter.distinct`, the Household address regex + `$or` search), the `campaignCount` /
`needsDedupe` gate, the bounded dedupe branch and the plain branch, the per-page lookups, the row
mapper and the per-request deadline all live there, extracted verbatim from the org handler, plus
`isDirectoryTimeout(err)` for the 503 mapping (and `pageParams` + the shared
`DIRECTORY_TIMEOUT_MESSAGE`, so both routes answer a timeout with the same sentence). **Two callers**: `GET /admin/voters` passes its
validated `?campaignId` or `null`; `GET /admin/campaigns/:campaignId/voters` passes
`req.campaign._id` and ignores any `?campaignId` (the URL is the scope). One refinement inside the
resolver: when `campaignId` is set, the address-search Household lookup filters on `campaignId` too.
The org list and the campaign list therefore cannot disagree on a count or a row.

**The profile** — [`server/src/services/voters/voterProfile.js`](../server/src/services/voters/voterProfile.js)
→ `buildVoterProfile(voterId, { orgId, scopeCampaignId })` composes the whole payload (voter incl.
`email`, household + campaign + members, voted status, surveys **with their template question
defs** for editing (answerable questions only: `.filter(isAnswerable)` drops statements, which
record nothing, so `VoterDetailPage`'s editor never renders a read-aloud paragraph as a text
input), household canvass activity, and notes = admin `VoterNote`s + derived field
notes). **Three callers** — the org route, the campaign route and the mobile profile route — so the
shape is identical everywhere. **The scope rule:** with `scopeCampaignId` unset, the person-level
unions run across the voter's sibling rows (every campaign); with it set, `personRowIds` collapses
to `[voter._id]`, so surveys, preserved responses, field notes and admin notes are **this
campaign's only** and `otherCampaigns` is `[]` — and the builder returns `null` when the voter's
`campaignId` differs from `scopeCampaignId`, so a mismatched scope can never widen a read. The
campaign route passes `scopeCampaignId: isOrgAdmin(req) ? null : req.campaign._id` (owner rulings
2026-09-30: an admin still sees every campaign with links; a lead sees only their own); the mobile
profile route passes it for every non-org-admin. (Never name a new option `campaignId` — the
builder has a local `const campaignId = household?.campaignId`.) **Canvass activity** is the door's
latest knocks (up to 50) whose `actionType` is in the builder's own `KNOCK_ACTIONS` — a hand copy of
the list in [services/reports/aggregations.js](../server/src/services/reports/aggregations.js) that
must carry every knock outcome. `not_target` is in it, so a Not a target voter knock and its `note`
are in every resident's `activity` — all three callers return it, only the web profile renders the
list ([notTarget.int.test.js](../server/test/notTarget.int.test.js) pins it). On the profile, that
is the only place its note shows: a door result carries no `voterId`, so it never joins the
voter-tagged field notes (the Notes hub and the `notes` export still list it as a door note).

**The note** — [`server/src/services/voters/voterNotes.js`](../server/src/services/voters/voterNotes.js)
→ `createVoterNote({ orgId, voterId, authorId, body })` is the **ONE** `VoterNote` writer, used by
the org route, the campaign route and the mobile route.

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
| `GET /admin/voters` | Directory — a thin caller of `listVoters` (§B) with `?campaignId` validated or `null`: server-paginated (`limit`/`skip`/`total`). Search (name/Voter ID/address) + filters (`campaignId`, `party`, `surveyStatus`, `voted`, `precinct`, `dnc`). Rows carry a `dnc` boolean. `?campaignId` is a direct `filter.campaignId` (rows are per-campaign — always resolves that campaign's own row). The org-wide view of a **multi-campaign** org (`campaignCount = Campaign.countDocuments({organizationId})` > 1 — archived and deleting campaigns included, their rows still exist) dedupes by svid, **bounded since 2026-09-30**: `$match(filter)` → `$sort {lastName, firstName, _id}` → `$limit (skip + limit) × campaignCount` (an index-ordered prefix of keys off the covering directory index — 0 documents for the unfiltered and covered-filter views) → a projected `$group {_id: $stateVoterId, docId/lastName/firstName: $first}` (never `$first: $$ROOT`) → `$sort` → `$skip`/`$limit`; the page's docs are then fetched by `_id` and re-ordered, and the additive `campaigns:[{id,name}]` chips + `surveyStatus` = surveyed-in-any come from a **sibling lookup under the same filter** (`Voter.find({...filter, stateVoterId: {$in: pageSvids}}, 'stateVoterId campaignId surveyStatus')`), so filter-then-dedupe semantics are unchanged. The prefix is exact because unique `{campaignId, stateVoterId}` caps a person at `campaignCount` rows; a **short-page guard** (fewer people than `min(limit, total − skip)`) logs `[voters] directory prefix under-delivered` and re-runs the same pipeline unbounded. The count is the untouched `$group {_id: $stateVoterId}` → `$count`, a covered DISTINCT_SCAN — the one cost still linear in people. **Every DB call** in the handler carries `maxTimeMS` = `VOTER_DIRECTORY_MAX_MS` (default 15 000, read per request); expiry (`MaxTimeMSExpired` / code 50) answers **503 `{error, code: 'DIRECTORY_TIMEOUT'}`** — the web client renders the sentence with **Try again** rather than auto-retrying — and anything else goes to `next(err)`. Single-campaign orgs and `?campaignId` keep the plain indexed find (its count is a COUNT_SCAN on the 4-key index). Incident + measurements: [PERFORMANCE.md](PERFORMANCE.md) § Database scaling. |
| `POST /admin/voters/:voterId/dnc` | Flag do-not-contact (body `{reason}`, required, min 3 chars). Idempotent — a re-flag never restamps (upload-undo attribution). Writes by `{organizationId, stateVoterId}` so **every sibling row flips together**, writes a VoterNote, then `recomputeFullyDnc` for **every sibling's door**. Returns the profile. |
| `DELETE /admin/voters/:voterId/dnc` | Clear the flag on **all sibling rows** (stamps the transition + VoterNote + recompute; doors may reopen in every campaign). |
| `GET /admin/voters/:voterId` | Full profile (`buildVoterProfile`; carries `voter.email` and `voter.doorAdded {at, by}`). |
| `PATCH /admin/voters/:voterId` | Edit allowed fields (Zod; incl. `email` — org-local, empty string → null; its phone fields stay deliberately LOOSE free-text because the form round-trips legacy file phones, unlike the strict `phoneSchema` on the walk-up create). Locks `stateVoterId`/`householdId`/`organizationId`; stamps `lastEditedBy/At`; recomputes `fullName`. |
| `DELETE /admin/voters/:voterId` | **Door-added rows ONLY** (`doorAdded != null`, else 400 `NOT_DOOR_ADDED`) — the only voter delete in the product; imported rows leave via re-import/undo-import or campaign deletion. Cascade: `SurveyResponse` rows deleted (+`bumpCampaignStats surveys: -n` — `surveyCount` counts response docs), `SurveyResponseArchive` + `VoterNote` + `VotedVoter` deleted, **`CanvassActivity` rows KEPT with `voterId` nulled** (the door visit genuinely happened and is billable; nothing joins the field — doorKey.js), then the Voter, then `recomputeFullyDnc` + `recomputeHouseholdActive` (deleting a door's only voter deactivates the door and the delta drops it from phones). Phones that hold the voter keep a **phantom row until their next full bootstrap** (a deleted doc can't ride the merge-only delta) — a survey against it 404s and the offline queue drops it. |
| `POST/PATCH/DELETE /admin/voters/:voterId/notes[/:noteId]` | Admin voter-note CRUD (the create goes through `createVoterNote`, §B). |
| `PATCH /admin/voters/:voterId/surveys/:responseId` | Edit `answers`/`note`; `answers` go through `normalizeAndFilterAnswers(template, …, { dropHidden: false })` — answers a later condition would hide are kept (recorded history), unknown keys and **statement** rows are dropped (a missing template stores them as sent); sets `editedBy/At`; then `recomputeSurveyStatus`. |
| `DELETE /admin/voters/:voterId/surveys/:responseId` | Delete a response; then `recomputeSurveyStatus`. Never touches archived (preserved) siblings. |
| `POST /admin/voters/:voterId/surveys/:archiveId/restore` | **Lossless swap**: archive the displaced current response (`via:'restore'`), promote the preserved one verbatim, consume the archive row (re-restore = 404); resurrects (+1 `surveyCount`) if the current response was deleted meanwhile; then `recomputeSurveyStatus`. See [SURVEYS.md](SURVEYS.md) §F. |
| `DELETE /admin/voters/:voterId/surveys/archive/:archiveId` | Erase a preserved (overwritten) response outright. No counters move — archives were never counted. |

**Campaign-scoped** (`/admin/campaigns/:campaignId/voters`,
[routes/admin/campaignVoters.js](../server/src/routes/admin/campaignVoters.js)) — guarded by
`requireAuth, orgContext, requireCampaignManager` (super / org admin / a lead granted **this**
campaign — anyone else is 403 `FORBIDDEN_ROLE` from the middleware) and then `loadCampaign` (org
ownership + `NOT_DELETING`, the `voted.js` helper). The org router above is **untouched** — still
`requireOrgRole('admin')` router-wide with no per-route carve-outs; this router is the lead read
surface. Mounted in [routes/index.js](../server/src/routes/index.js) with the other campaign-nested
routers, i.e. **after `accessLog`**, and its paths classify as `voters` in `RESOURCE_LABELS`
([services/access/supportAccess.js](../server/src/services/access/supportAccess.js)) rather than
`other`; the same `router.param('voterId') → addAuditSubjects(res, 'voter', id)` hook as the org
router tags every single-record read for the staff-under-grant audit.

| Method · path | Purpose |
|---|---|
| `GET /admin/campaigns/:campaignId/voters` | This campaign's directory — `listVoters` with `campaignId = req.campaign._id` (any `?campaignId` ignored). Same query params, same `{voters, total, limit, skip}` shape and row fields as the org route, minus the dedupe-only `campaigns[]`. A timeout answers the same 503 `DIRECTORY_TIMEOUT`. |
| `GET /admin/campaigns/:campaignId/voters/:voterId` | Profile — `buildVoterProfile` with `scopeCampaignId: isOrgAdmin(req) ? null : req.campaign._id`. A voter in the org but **not in this campaign** answers **404 `{ error: 'Voter not in this campaign', code: 'VOTER_NOT_IN_CAMPAIGN' }` for EVERY role** (admins included — concealment: a client-lead cannot probe other campaigns' ids; and deliberately not `FORBIDDEN_ROLE`, which means only "your role is too low"); an unknown id is 404 `Voter not found`. No `staff-access` twin — that card's route stays on the org router, admin-only. |
| `POST /admin/campaigns/:campaignId/voters/:voterId/notes` | Add a note — `createVoterNote`, after the same in-this-campaign check (404 `VOTER_NOT_IN_CAMPAIGN`). The only write on this router: every other profile mutation (identity PATCH, DNC, survey edit/delete/restore, walk-up delete, note delete) stays on the org router, admin-only, and the web admin's campaign-mode profile calls those org routes. |

**Mobile** (`/mobile/voters`, [routes/mobile/voters.js](../server/src/routes/mobile/voters.js)) —
`requireAuth, orgContext, requireOrgMember`; **active-campaign-scoped, read + add-note only**.
A **manager** (super / org admin / a lead granted the campaign — `managesCampaign`, no roster row
needed) gets campaign scope; a canvasser is restricted to households in their **assigned books on
the active pass**. Since 2026-10-01 the manager-scope search filter is `{ organizationId,
campaignId }` on `Voter` — it used to be a `$in` of **every household id in the campaign**
(measured: 150,000 ids, 2.9 MB, 0.4–0.9 s per search vs 2.6 ms through `Voter.campaignId`, which
exists since the per-campaign-rows change); canvassers keep their book-scoped `householdId $in`.

| Method · path | Purpose |
|---|---|
| `GET /mobile/voters?campaignId=&search=` | Campaign-scoped search (≤50). Rows carry `dnc`. Manager scope = the campaign; canvasser scope = their books. |
| `GET /mobile/voters/:voterId?campaignId=` | **Management-only** profile (a canvasser is 403 `FORBIDDEN_ROLE`). For a non-org-admin the entry voter must belong to the resolved campaign — otherwise **403 `{ error: 'Voter not in this campaign', code: 'VOTER_NOT_IN_CAMPAIGN' }`** (the status stays 403 because the shipped app inspects 403 codes; the web twin is a 404) — and `buildVoterProfile` runs with `scopeCampaignId = campaign._id`, so a **lead's profile is this campaign's answers and notes only** with `otherCampaigns: []`; an org admin's keeps the cross-campaign union. |
| `POST /mobile/voters/:voterId/notes` | Add a note (`{campaignId, body}`) via `createVoterNote`. A manager's note on a voter outside the resolved campaign is refused with the same 403 `VOTER_NOT_IN_CAMPAIGN`; a canvasser's is still bounded by their books. |
| `POST /mobile/households/:householdId/voters` | **Add a walk-up voter** (lives in [routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js) — it's a door write). Body: client-minted `voterId` (24-hex, becomes the `_id`), `firstName`/`lastName` (nameSchema), optional `phone` (strict `phoneSchema`, stored canonical) / `email` (`voterEmailSchema`, lowercased), `location` (**GPS required** — LOCATION_REQUIRED backstop like every door write). Guards, in order: household 404 → `assertHouseholdAccess` → campaign 404/`assertCampaignWritable` (archived 409) → survey-type 400 → `doorAddPolicy: 'leads'` + fresh + not-a-manager → 403 `ADD_VOTER_RESTRICTED` (**offline replays bypass**, the disabledOutcomes rule). **Idempotent on the client id**: replay → 200 with the existing row (queue drains, nothing duplicates); same id at another door/org → 409 `VOTER_ID_CONFLICT`. Writes the Voter (`manual:` svid, `doorAdded` stamp, `personId: null`), runs `recomputeFullyDnc` (its updatedAt bump ships the door's roster to teammates via `/changes`) + `recomputeHouseholdActive`, then answers **201 `{voter, household}` in the per-round wire** (`toWireVoter` through the shared `MOBILE_VOTER_PROJECTION` + `stampPerRoundSurvey` + `toWireHousehold`) — phone/email never in the response. NOT a knock: no CanvassActivity, no stats, no billing. Pinned by [doorAddVoter.int.test.js](../server/test/doorAddVoter.int.test.js). |

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
- **Scoping:** the org directory is org-wide (admins only); the campaign tab is one campaign (admins
  and granted leads — `requireCampaignManager`); mobile is the active campaign and (for canvassers)
  the assigned books. A **lead's profile is campaign-scoped on both web and mobile**
  (`scopeCampaignId`); an org admin's never is.
- **Sibling rows (multi-campaign orgs):** the same person imported into 2 campaigns has one Voter
  row per campaign. Person-level history — surveys, VoterNotes, field notes, staff-access answers —
  is **unioned across siblings** in `buildVoterProfile` (each survey is labeled with its
  campaignId, and the profile carries an additive `otherCampaigns` array) — **unless
  `scopeCampaignId` is set**, when the unions collapse to the opened row and `otherCampaigns` is
  `[]`; door-level facts
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
- **Walk-up (door-added) voters:**
  - The `manual:<id>` svid means a door-added row **joins no sibling set** — no profile union, no
    DNC fan-out to other rows, one directory row. That is correct: nothing ties them to any other
    row yet. If the real person later arrives in a voter-file import, that import creates a
    **second row under the real svid — no auto-merge**; the remedy is deleting the door-added
    duplicate (see [IMPORTS.md](IMPORTS.md)).
  - `personId` stays **null** (legal everywhere — "pre-backfill voters write straight"). A keyless
    `resolvePerson` would raise a merge candidate per add into the deferred queue; a synthetic
    svidKey would pollute Person's real-key space.
  - The **offline pair** is ordering-safe by construction: the phone mints the voter's `_id`, the
    create is idempotent on it, and the FIFO queue replays create-before-survey — so the queued
    survey's path references an id that survives any number of replays.
  - **The policy reaches phones on the map poll (since 2026-10-02).** `doorAddPolicy` and the
    per-user `canAddVoters` ride both phone wires, built by the one `doorConfigFor` in
    [routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js): the bootstrap's campaign
    block, and `/mobile/changes`, where the phone sends its `doorConfigStamp` (URL-encoded) on the
    map's 30-second poll and gets a `doorConfig` block back only when the stamp no longer matches —
    folded into the cached campaign, no refetch. A canvasser's phone that hasn't picked up a switch
    to `'leads'` still hits `ADD_VOTER_RESTRICTED` on a fresh add; offline replays still bypass.
    Detail in [CANVASSER_APP.md](CANVASSER_APP.md).
  - Adding a voter is **billing- and door-count-neutral** (billing = distinct household×pass over
    CanvassActivity; doors = Household docs) and voter-unit surfaces (surveyedVoters, tags,
    coverage) absorb the row naturally. Demographic filters skip them (null party/age/districts).
  - After an admin **delete**, phones keep a phantom row until their next full bootstrap (the
    30s delta is merge-plus-append, never remove) — unless it was the door's only voter, in which
    case the deactivated door drops off phones via the delta.

## E. Frontend mapping

**Web** ([client/src](../client/src)):
| File | Renders |
|---|---|
| [pages/VotersPage.jsx](../client/src/pages/VotersPage.jsx) | Directory: filters + server-paginated table. **Two modes, one component**, chosen by `useParams().campaignId`. **Org mode** (`/voters`, the `ORG_NAV` item, inside the `orgAdmin` RoleGate in [App.jsx](../client/src/App.jsx)): `/admin/voters`, campaign select, Campaign column, the DNC-list and do-not-knock links, row → `/voters/:id`, plus an **Open in campaign →** link beside the select once a campaign is chosen. **Campaign mode** (`/campaigns/:campaignId/voters` — the `voters` item in `CAMPAIGN_NAV` ([navItems.js](../client/src/components/navItems.js)), Field group after Map, routed in the campaign block **outside** the gate so leads reach it): header = the campaign name (`useCurrentCampaign` + `CampaignGate` loading/missing states), no campaign select / column / DNC links, api base `/admin/campaigns/<cid>/voters`, the query key carries the campaign id, row → `/campaigns/<cid>/voters/:id`, and an admin-only **Org-wide directory →** link. The 503 `DIRECTORY_TIMEOUT` band + `shouldRetryDirectory` serve both modes; [lib/votersDirectoryRender.smoke.test.js](../client/src/lib/votersDirectoryRender.smoke.test.js) pins the query key + row shape. |
| [pages/VoterDetailPage.jsx](../client/src/pages/VoterDetailPage.jsx) | Profile: editable identity/contact, household + members, survey responses (edit-in-place by question type, shows edited-by/at; a winning response renders its `replacedEarlier` note, and preserved responses from `overwrittenSurveys[]` render as muted read-only cards with **Restore this response…**), admin notes CRUD + read-only field notes, activity (each row labeled by `actionLabel` from [lib/statusColors.js](../client/src/lib/statusColors.js) — the canonical `ACTION_LABELS`, e.g. "Surveyed", "Not home", "Not a target voter"; every knock outcome has an entry, so no row prints a raw slug), and the admin-only `StaffAccessCard`. **Campaign mode** (`/campaigns/:campaignId/voters/:voterId`): data from `/admin/campaigns/<cid>/voters/<id>`, back link to the campaign list (or Notes when `state.from === 'notes'`), "Also in" sibling links and household-member links campaign-relative. An **admin** keeps every control (the writes still call the org `/admin/voters` routes). A **lead** (`isOrgAdmin` false) is read-only: no identity Edit, no DNC flag/clear (the DNC section with reason / who / when IS shown), no survey Edit/Delete/Restore, no walk-up Delete, no note Delete, no `StaffAccessCard`; they can add a note (POST to the campaign route) and mark/lift household do-not-knock. |
| [pages/NotesPage.jsx](../client/src/pages/NotesPage.jsx) `NoteCard` · [components/ResponseDetailDrawer.jsx](../client/src/components/ResponseDetailDrawer.jsx) | Both link a voter to the **campaign** profile `/campaigns/<cid>/voters/<id>` for every role (the campaign id is in scope on both), so a lead's tap-through lands on a page they can open. |

**Mobile** ([mobile/app/(app)/voters](../mobile/app/(app)/voters)):
| File | Renders |
|---|---|
| [voters/index.jsx](../mobile/app/(app)/voters/index.jsx) | Campaign-scoped search list; row → profile. Entry points: the "Voter search" row on the mobile admin **More** tab and tapped-voter links on the admin **Notes** screen (the old canvasser-facing "Voters" link in the books header was removed). |
| [voters/[id].jsx](../mobile/app/(app)/voters/[id].jsx) | Read-only profile (details, household, voted, surveys, notes) + add-note. **Management-only**: `GET /mobile/voters/:voterId` requires lead (per-campaign grant, entry voter must belong to the granted campaign — else 403 `VOTER_NOT_IN_CAMPAIGN`) / admin / super — a plain canvasser gets 403 `FORBIDDEN_ROLE`. **A lead's profile is campaign-scoped** (`scopeCampaignId`): this campaign's survey answers and notes only, `otherCampaigns` empty — no app change was needed, the server narrows the payload. The profile carries cross-round survey answers, raw DOB, phone and email; the door screen deliberately presents each round fresh, and none of that belongs in a canvasser's hands (see [PASSES_AND_TURF.md](PASSES_AND_TURF.md) → the round-fresh presentation). The search *list* stays canvasser-reachable (book-scoped, identity + status booleans only, no answers). |

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
