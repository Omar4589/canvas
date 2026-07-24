# Voter identity (canonical People) — **per organization**

> ## ⚠️ This document described a CROSS-ORG shared identity graph. That is gone.
>
> **What changed (July 2026).** A `Person` used to be **global**: one record per real human, shared
> by every customer org that had imported them. `propagateIdentity` then fanned an identity edit into
> **every** org's Voter rows — so a *customer's own admin* correcting a phone number rewrote that
> field in a **different customer's database**. A CSV import did the same.
>
> **Why it had to go.** That made Doorline the arbiter of a canonical identity *across its customers*
> — deciding the true value, merging records between them, propagating one customer's edit to another
> without either one's instruction. That is **controller** behaviour. Our entire legal posture, and
> the privacy policy's *"it is not shared with other customer organizations"*, depends on being a
> **processor**: each customer's data siloed, touched only on that customer's instruction.
>
> **What it is now.** `Person` carries a required `organizationId`. Dedup still happens — **inside one
> org**, where the same human legitimately appears twice under two state voter IDs — and the fan-out
> cannot leave the org it started in. Two orgs holding the same voter hold **two separate Persons**.
>
> **Nothing was ever actually leaked.** The audit run before the change
> (`npm run audit:cross-org-identity`) found **zero** Persons shared across orgs and **zero**
> contaminated rows. The path existed and was one admin edit away from being used; it was never used.
>
> **Gone with it:** the ownership state machine (`identityOwnerOrgId`, `ownerProvisional`), cross-org
> edit proposals, the *"identity managed by {other org}"* banner, and the import preview's cross-org
> "existing people" count. Inside a single org there is no other owner to arbitrate with.
>
> Locked by `test/orgIsolation.int.test.js` — **Org A edits a voter's phone; Org B's row must be
> unchanged.** Sections below still describe the old cross-org model in places; treat this box as
> authoritative until they are rewritten.

One record per **real human within one organization** — so the same voter appearing twice in an org's
file (a cross-state mover, a re-keyed row) is recognized as one person. Each org's identity records,
and all of its canvassing, are its own.

- **Part 1 — For everyone** is plain language: what a "Person" is, what's shared vs private,
  and what the super-admin can do.
- **Part 2 — Technical reference** is for developers (and Claude): the models, matching keys,
  propagation chokepoint, the ownership state machine, merge/split, the super-admin API, and
  the privacy guarantee.

Related: [IMPORTS.md](IMPORTS.md) (where Persons get linked during an upload),
[USERS.md](USERS.md) (cross-org user identity), [VOTERS.md](VOTERS.md).

---

# Part 1 — For everyone

## What a "Person" is

Every `Voter` row belongs to **one campaign of one organization** (the same human in two orgs is
two-plus Voter rows; the same human in two *campaigns* of one org is also two rows — "siblings",
tied by their state Voter ID). A **Person** is the canonical record that **links** those rows —
one Person per real human per org. All of an org's sibling rows for a person carry the **same**
`personId`, which is exactly why identity propagation reaches every campaign's copy: the fan-out
writes by `{personId, organizationId}` (§C Propagation), so correcting a phone once corrects it
in every campaign.

Think of it as: the Voter row is *one campaign's copy*; the Person is *the org's shared truth*
about who that human is.

## What's shared, and what stays private

- **Shared (on the Person):** identity only — name, phone, party, gender, date of birth,
  registration status. There is **exactly one** canonical value for each, and edits to it
  propagate to every org that has that voter.
- **Private (never on the Person):** everything about canvassing — survey answers, field
  notes, knock history, voted lists, survey status. That stays scoped to your org's Voter and
  is **never** visible to another org. **Districting (precinct/CD/SD/HD) is also per-org** —
  it's address-derived, set by each org's own import, never shared.

## How an import links people

Every upload links its voters to canonical People automatically. The **import preview** tells
you the forecast up front: *"links to N existing people · adds K new people."* For a
single-org customer the first import is "all new"; once a second org imports the same voters,
those show up as "existing people matched" — that's the dedup working.

## Who can edit shared identity (ownership)

- A person imported by **only one org** is **provisionally owned** by that org — its imports
  and admin edits update the canonical identity freely (single-org customers never see any of
  this).
- The moment a **second org** imports the same person, ownership **collapses** — now no single
  org silently owns the shared record. A non-owner's edit/import doesn't overwrite the
  canonical value; it **files a review proposal** for the super-admin and keeps the change on
  the org's own copy.
- The voter detail page shows a **"managed by {org}"** notice when another org owns the
  identity, so an admin knows their edit will go to review.

## Field locks

A super-admin can **lock** a specific identity field (e.g. a hand-verified phone). A locked
field is **pinned** — imports and owner edits skip it, so it can't be overwritten until the
super-admin unlocks it.

## What the super-admin can do

The **People** directory (Platform nav → People) is the cross-org view:

- **Search** one organization's canonical directory by name, vendor ID, or state voter ID; filter
  to records that **need review**.
- A **Person page** shows the canonical identity, its identity keys, and a **per-org activity
  summary** — counts and dates only (how many surveys, last activity, voted) with **no survey
  answers or notes** ever exposed across orgs.
- **Edit** the canonical identity (propagates everywhere), **assign/clear the owner**, **lock
  fields**, and **merge** two records that are the same human (or **split** a merge back apart —
  it's reversible). Merging starts from a **search picker** — find the other record by name /
  vendor uid / state voter ID; tombstones never surface as candidates — with a collapsed
  merge-by-record-ID fallback for power users.
- **Edit proposals are retired from the UI.** Post-per-org, the importing organization owns its
  own Person, so the code path that filed proposals is unreachable in practice; the review block
  was removed rather than kept as a queue for a mechanism that can't fire (the model, writer and
  approve/reject routes remain server-side, inert). The related dormant bug — an owner-less
  Person silently shunting the org's OWN admin edit into that invisible queue — was fixed: an org
  editing its own Person always applies canonically now.

---

# Part 2 — Technical reference

Person layer: [models/Person.js](../server/src/models/Person.js),
[services/person/](../server/src/services/person/),
[routes/superAdmin/persons.js](../server/src/routes/superAdmin/persons.js),
client [PersonDetailPage.jsx](../client/src/pages/PersonDetailPage.jsx) +
[SuperAdminPeoplePage.jsx](../client/src/pages/SuperAdminPeoplePage.jsx).

> **Rollout gate:** the whole layer lives on the **`sharedVoters`** branch and is **always-on**
> once deployed — there is no runtime flag; the branch separation *is* the gate. Run
> `npm --prefix server run migrate:persons -- --apply` (backfill) **before** the index-building
> deploy.

## A. Data model

**`Person`** — one doc per human, **shared identity only**. Never carries `organizationId`,
`surveyStatus`, or any canvassing/districting field.

- **Identity keys live in two arrays** (not one): `uidKeys: [{ uidSource, uid, source, at }]`
  and `svidKeys: [{ registeredState, stateVoterId, source, at }]`. Two arrays — not a single
  mixed one — because a partial-unique multikey index over a mixed array would index an
  svid-only entry as `uid:null` and collide across docs. `source ∈ {import, backfill, merge,
  manual}`. Cross-state movers / re-keys **append** a key, so other orgs' links never strand.
- **Identity fields** (the only propagated set): `firstName, lastName, fullName, phone,
  phoneType, cellPhone, party, gender, dateOfBirth, registrationStatus`.
- **Governance:** `identityOwnerOrgId` (null = super-admin-only), `ownerProvisional`,
  `fieldProvenance` (Mixed: field → `{source, orgId, userId, at, prevValue}`), `lockedFields`,
  `matchConfidence`, `identityVersion` (optimistic concurrency), `mergedInto` (non-null =
  tombstone).
- **Indexes** (partial-unique multikey on `{uidKeys.uidSource, uidKeys.uid}` and
  `{svidKeys.registeredState, svidKeys.stateVoterId}`, plus `{lastName, firstName}` and
  `{mergedInto}`) are built **only by the migration after dedup** — `autoIndex` is **off** in
  production ([config/db.js](../server/src/config/db.js)).

**`Voter` additions** (cache nothing removed): `personId` (ref, indexed), `uidSource`,
`locallyEditedFields` (per-org divergence guard), `identityBackup` (pre-propagation snapshot
for rollback). The `{organizationId, stateVoterId}` unique index stays — Person↔Voter is
**1:many even within one org**, so every consumer counts *distinct orgs*, never Voters.

**Supporting models:** `PersonMergeCandidate` (`{personIdA, personIdB?, reason, sample*,
status}`, unique on `{personIdA, personIdB, reason}`), `PersonEditProposal`
(`{personId, orgId, source, fields, canonicalSnapshot, baseIdentityVersion, status}` —
drift-checked at approval), `PersonMergeLog` (full pre-merge snapshots of both persons +
`movedVoterIds` + per-field `fieldDecisions` → split is value-reversible).

## B. Matching & dedup — [resolvePerson.js](../server/src/services/person/resolvePerson.js)

> **⚠️ TOOLING TRAP — use `grep -a` in this directory.** `resolvePerson.js` and `mergePersons.js`
> contain NUL bytes (deliberate separators in composite map keys, e.g.
> `` `u:${k.uidSource}\0${k.uid}` ``). macOS/BSD `grep` classifies the files as binary and **skips
> them silently — no match, no warning**. A plain `grep -r` audit of this layer will wrongly
> conclude the matching engine doesn't exist (this happened, and produced a false "candidates are
> never generated" audit conclusion). `grep -a` treats them as text.

**What actually raises merge candidates in practice:** only `uid_svid_conflict` — and only when an
import maps a `uid` column **and** names a `uidSource` on the import screen. The `keyless` /
`state_missing` branches are **unreachable on the live import path**: the CSV validator
([csvImporter.js](../server/src/services/import/csvImporter.js)) hard-requires State Voter ID and
State on every row and drops failures before reconciliation runs, so `hasSvid` is always true. A
first clean import raises nothing even with uids; conflicts arise on **re-imports where the
vendor's uid↔svid pairing shifted between files**. This deployment has never used `uidSource`, so
the candidate collection is empty — which is why there is no dedicated review-queue page (the
per-person Merge review block + `GET /candidates`, now org-scoped and paged, cover the day that
changes). Candidates carry `organizationId`, stamped at raise time and backfilled by
`migrate:candidate-orgs`.

`resolvePerson(rawKeys, identity, opts) → { person, matched }` and the batched
`resolvePersonsBatch(rows, opts) → Map<rowKey, personId>`. Keys are normalized through
[normalizePersonKeys.js](../server/src/services/person/normalizePersonKeys.js) on **every**
lookup (Mongoose setters don't fire on query filters).

1. `(uidSource, uid)` present → match (`matchConfidence: 'exact_uid'`).
2. else `(registeredState, stateVoterId)` → match (`'fallback_svid'`).
3. matched a tombstone → follow `mergedInto` to the survivor (`followMerged`, loop-guarded to
   25 hops).
4. no usable key → keyless Person + a `PersonMergeCandidate`; **never** cross-links keyless rows.
5. **Key promotion:** a matched row carrying a *new* key `$push`es it onto the Person (deduped
   in JS; an E11000 means the key belongs to a different person → raise a `uid_svid_conflict`
   candidate rather than merge).
6. **uid namespacing is mandatory:** match on `(uidSource, uid)`, never bare `uid` — otherwise
   two vendors' colliding `id=1001` would merge two different humans.
7. **State derivation:** `registeredState ??= Household.state` before keying — a stateless svid
   becomes a small `state_missing` candidate, not a key (bare svids collide across states).

## C. Propagation — [propagateIdentity.js](../server/src/services/person/propagateIdentity.js)

The **single chokepoint** that writes a Person's identity and fans it to every org's Voter
cache. `propagateIdentity(personId, identity, { orgId, source, userId, session })`:

1. **Optimistic concurrency** on `identityVersion` (`findOneAndUpdate` gated on the version,
   `$inc` on success, 3 retries on drift), writing dotted `fieldProvenance.<field>`.
2. **Allowlist `$set`** of the 10 identity fields only (`fullName` is one of the 10, re-derived
   from the name parts when absent) — never a match key,
   `personId`, `surveyStatus`, `householdId`, or a district field.
3. **Per-Voter fan-out** across all orgs, honoring each Voter's `locallyEditedFields` (a
   door-confirmed phone survives an owner import) and snapshotting `identityBackup` once before
   the first overwrite. **End-to-end since 2026-07-17:** `applyImport`'s direct upsert honors the
   shield too (it used to run after this fan-out and blindly clobber the very fields the fan-out
   preserved — the sentence above was true of the fan-out but false of the whole pipeline). The
   import strips shielded identity fields from its `$set` by default; the admin can opt in to
   `overwriteHandEdits` per import, which writes the file's values AND disarms exactly those
   fields.
4. **Field locks:** when `source` is **not** `super_admin`/`merge` (i.e. an import or a
   non-super-admin owner edit), fields in the Person's `lockedFields` are stripped before both
   the canonical write and the fan-out — a locked name component also pins the derived
   `fullName`. Super-admin canonical edits and merges are authoritative and bypass the lock.

Districting is deliberately **never** propagated — `recomputeCutAttributesForCampaign` matches
households across orgs within a campaign, so propagating a district edit would silently re-cut
another org's turf.

## D. Import reconciliation — [reconcileIdentityFromImport.js](../server/src/services/person/reconcileIdentityFromImport.js)

Runs as a step in [importProcessor.js](../server/src/services/import/importProcessor.js) **after**
geocoding, **before** `applyImport` — it stamps `personId` (+ `uidSource`) onto each
`validRows[i].voter` so the upsert carries them. The **ownership state machine** per resolved
Person:

- **sole-org** (Person linked to no other org) → claim provisional ownership →
  `propagateIdentity` (the import identity becomes canonical).
- **already this org's** → owner → propagate.
- **a 2nd org linking to a provisional-owner Person** → ownership **collapses to null**; this
  import is now a non-owner.
- **non-owner** → raise a `PersonEditProposal` for diverging fields (never clobbers canonical);
  the voter keeps its own import values as the org's cached view.

The **admin edit path** ([admin/voters.js](../server/src/routes/admin/voters.js) `PATCH
/:voterId`) mirrors this: owner/super-admin → propagate; non-owner → proposal + apply to this
org's cache + flag `locallyEditedFields`. **Since 2026-07-17, the owner path ARMS the shield
too**: every hand edit `$addToSet`s the identity fields whose values actually changed (diffed via
`identityEq` — the form submits every field, so only real changes arm) instead of `$pull`ing them
as it used to. That is what makes a door-confirmed correction durable: canonical still updates via
`propagateIdentity`, but the org's Voter cache keeps the hand value through subsequent imports
(the sanctioned divergence `locallyEditedFields` was always documented to provide). The import
preview surfaces any **hand-edit conflicts** (file value ≠ armed value: totals, per-field counts,
capped samples) so the admin decides keep (default) or overwrite per import; choosing overwrite
`$pull`s the affected flags so future files update those fields normally. Districts stay
org-local. Mobile reach: `/mobile/changes` emits voters whose **own `updatedAt` moved** (unioned
with changed-household voters — the propagation fan-out's `bulkWrite` bumps each sibling Voter's
`updatedAt`) and projects the identity-cache fields, so a propagated identity edit reaches an
already-bootstrapped app **within ~30s via the delta poll**, not only on a full re-bootstrap
([PASSES_AND_TURF.md](PASSES_AND_TURF.md) §G; `phone` is outside the delta projection — a
phone-only edit reaches phones on the live profile fetch or a full re-bootstrap).

## E. Super-admin API — [routes/superAdmin/persons.js](../server/src/routes/superAdmin/persons.js)

Router-gated by `requireAuth, requireSuperAdmin` (no org scope). Literal routes are registered
**before** `/:personId` so they aren't shadowed.

| Endpoint | Purpose |
|---|---|
| `GET /super-admin/persons` | Directory: search (name/uid/svid), `needsReview` filter, paginated; per-row org/voter counts + flags. |
| `GET /super-admin/persons/:personId` | Full oversight view (privacy-safe — see §F). |
| `PATCH /:personId` | Canonical identity edit → `propagateIdentity` (`source: super_admin`). |
| `PATCH /:personId/owner` | Assign/clear owner — **link-guarded** (400 unless the org has a linked Voter). |
| `PATCH /:personId/lock` | Set `lockedFields` (validated against the identity allowlist). |
| `POST /:personId/merge` | Merge `victimId` into this person with explicit `fieldDecisions`. |
| `POST /:personId/split` | Reverse a prior merge by `mergeLogId`. |
| `GET /candidates`, `POST /candidates/:id/dismiss` | Merge-candidate review queue. |
| `GET /edit-proposals`, `POST /edit-proposals/:id/approve\|reject` | Identity-proposal review (drift- & lock-checked, atomically claimed). |

Proposal **approval** rechecks field-level drift against `canonicalSnapshot` (supersedes if the
canonical moved), refuses if a proposed field is **locked**, then atomically claims
`pending → approved` (so concurrent approve/reject can't double-apply) and propagates.

## F. Privacy — [personOversight.js](../server/src/services/person/personOversight.js)

Privacy holds **structurally**, not by convention. `buildPersonOversight` derives the touching
orgs from `Voter.distinct('organizationId', { personId })` (Person carries no org), then for
each org builds its summary with **aggregation `$group`/`$count` + an explicit address
allow-list** — it **never** reads `SurveyResponse.answers`/`note`, `CanvassActivity.note`, or
`VoterNote.body` into memory. The per-org payload is counts / dates / status-tallies / voted
booleans / addresses only. (An adversarial review confirmed no leak path exists.)

## G. Merge / split — [mergePersons.js](../server/src/services/person/mergePersons.js)

No DB transactions (this repo configures no replica set), so both operations are
**carefully-ordered idempotent writes** with the `PersonMergeLog` written **first** for
reversibility, plus **pre-flight key-conflict checks** (a key held by a third live person would
E11000 the partial-unique index — detected and refused before any mutation).

- **Merge** (`victimId` → `survivorId`): log snapshot → clear victim keys → graft unique keys
  onto survivor → re-point victim's voters (`personId`) → apply chosen identity via
  `propagateIdentity(source: 'merge')` → tombstone victim (`mergedInto`) → resolve every open
  candidate touching the victim. Canvassing history is keyed on `voterId` (never touched), so
  it's preserved automatically.
- **Split** (reverse by `mergeLogId`): guarded to only reverse a merge that **currently stands**
  (`victim.mergedInto === survivor._id` — blocks double-split and superseded merges) →
  restore both persons' pre-merge keys + identity from the snapshots → move the recorded voters
  **plus any voter imported onto the survivor since via a grafted key** back to the victim →
  re-fan both identities.

**Known limitations** (acceptable for a deliberate, rare super-admin action): a sub-second
window during a merge where a moved key is momentarily on neither doc (a concurrent import on
that exact key could create a transient duplicate the unique index then catches); split restores
from the merge-time snapshot, so identity edits made to the survivor *after* the merge are
reverted by a split; and a candidate the merge resolved is not auto-reopened on split.

## H. Migration & rollback — [migratePersons.js](../server/src/migrations/migratePersons.js)

`migrate:persons` (dry-run default, `--apply`-gated): derive state from Household →
`resolvePerson` find-or-create → **most-recent-wins** field seeding → owner stays null →
disagreements/keyless → candidates → `bulkWrite` sets `voter.personId` → `syncIndexes()` on
**all four** Person\* collections. `GeocodeCache` indexes are built at **worker boot**
([worker.js](../server/src/worker.js)). Rollback is value-level: `Voter.identityBackup`,
`fieldProvenance.prevValue`, and `PersonMergeLog` make a bad propagation/merge reversible
without a DB restore.

## I. Verification

Throwaway-DB integration tests cover: import reconciliation + the ownership state machine
(13/13), the propagation lock/backup shield (8/8 + 9/9), merge/split round-trip + privacy
aggregation (22/22), and the headline two-orgs-one-person end-to-end flow (8/8) — one canonical
Person, ownership collapse, divergence-as-proposal, two-org oversight with no leak.
