# COUNSEL BRIEF v2 — post-remediation, verified against the fixed tree

> **Read this v2 section first. It supersedes the v1 verdict below.** The v1 brief (which follows,
> retained for its detailed per-question analysis) audited the code *before* nine fixes landed. This v2
> section records what is true *after* those fixes, each verified by an independent adversarial re-audit
> against the code — not the comments. Where an answer below is unchanged from v1, the v1 detail still
> stands; where it changed, this section governs.

## Verdict (v2)

Nine fixes landed. **Eight are code-closed and independently re-verified; one (Mapbox) cannot be closed
in code and is a disclosure obligation instead.** Tests: 179 integration + 25 unit, green.

**The load-bearing sentence is now TRUE, with one carve-out:** *"Doorline staff cannot read a customer's
voter data without a time-limited support grant that names a reason, and every such access is recorded in
an audit log."* Every bypass v1 found is closed: the identity-console triage lists are now grant-gated and
logged (F1), the audit logger fails closed across `/admin` + `/mobile` (F2), the `leadCrew` self-mint is
blocked (F3). **The carve-out to state honestly:** the audit *write* is best-effort — if the audit store
itself is down, a staff read still completes and simply isn't recorded (it is not blocked). So: *"every
such access is recorded"* is true in normal operation; it is not a hard guarantee under an audit-store
outage. Prefer *"...is designed to be recorded in an audit log"* if you want to be unimpeachable.

## Fix status (v2)

| Fix | Status | The honest policy sentence it now supports |
|---|---|---|
| **F1** identity console | ✅ **closed** (re-verified) | Opening/editing/merging any voter identity record — and the review queues — requires a per-org grant and is logged. |
| **F2** fail-closed audit | ✅ **closed** | Every staff read of `/admin`/`/mobile` voter data under a grant is logged unless it is a named metadata route; a new route logs by default. |
| **F3** vendor self-mint | ✅ **closed** (re-verified) | A support operator cannot create accounts or grant roles in a customer org; only a member-admin can. |
| **F4** merge org-scope | ✅ **closed** | Identity records are never merged across organizations. |
| **F5** dormancy shield | ✅ **closed** | An active/paying account is never auto-deleted for inactivity — only a canceled/suspended one is. |
| **F6** deletion completeness | ✅ **closed** (retry-safe) | Deleting an organization removes its identity records and their merge-history PII, even on a retried deletion. |
| **F7** GeocodeCache TTL | ✅ **closed in code** | Cached addresses (coordinate-only, no name) expire after ~18 months of disuse. **Contingent on running `migrate:build-indexes` + `migrate:geocode-lastused` in prod.** |
| **F8** Mapbox telemetry | ⚠️ **DISCLOSURE, not code** | **Do NOT claim "no third-party analytics."** Mapbox receives viewer IP + viewport (and fires telemetry) on any page with a map. Disclose Mapbox as a mapping subprocessor. |

## Deploy note (v2)

This remediation is a **separate, not-yet-deployed** release from the WS0–WS3 deploy already in prod.
Server + web deploy together as before. New/changed migrations to run **after** deploy:
`migrate:build-indexes --apply` (builds the GeocodeCache TTL index + the new indexes) and
`migrate:geocode-lastused --apply` (activates the TTL on existing rows). No destructive/irreversible
migration this time. New operator tool: `request:org-deletion <slug> --apply`.

## Regression check (v2)

The re-audit found one HIGH regression in an earlier draft of these fixes — a multi-org password-reset
block that would have locked out multi-org users (no self-serve reset exists) and cited a non-existent
"Forgot Password." **It was reverted.** The re-audit confirms no remaining regression: member-admins pass
every new guard; the guards bite only vendors (grant-holders). *(Separately, the dev-only
`migratePersons.js` backfill tool calls `resolvePerson` without an org and is inoperative under the
prior deploy's org-scoping — a broken maintenance script, not a runtime path. Flagged, not fixed here.)*

## Remaining honest gaps (v2) — what the policy still cannot promise

These survive the remediation and are the list to take to counsel:

1. **Voter-facing rights: none.** The ~75,760 members of the public in the database (name, home address,
   DOB, party, and — via surveys — political opinions, which are GDPR Art. 9 special-category data) have
   **no account and no mechanism** to see, correct, delete, or opt out of their record. Every such
   request is a manual, untooled admin process. **This is the single largest gap and is untouched by any
   of the nine fixes.**
2. **Deletion is TTL/timer-based, not instant, and never warned.** There is **no email or SMS capability
   at all**, so no customer is warned before a wind-down or dormancy deletion. Write *"we aim to delete
   within…"*, never *"is deleted after…"*.
3. **Deletion is not total.** Cached addresses age out (≤18 months, coordinate-only); `AccessLog` /
   `SupportAccessGrant` / deletion-receipt rows are retained by design (they are the proof the deletion
   happened); **Atlas backups retain deleted data for their retention window** (daily 7d / weekly 4w /
   monthly 12m + the on-demand snapshot + continuous-oplog PITR — this exists because backups were just
   enabled, and it interacts with every deletion promise). The operator's preflight `mongodump` on a
   laptop is outside all of this.
4. **The deletion end-state is pseudonymous, not anonymous.** After the 180-day identity purge, the GPS
   trail, timestamps, notes and survey submissions remain linked to a stable `userId`, and the tombstoned
   `User` row persists. Do not say "anonymized"; say "de-identified / pseudonymized."
5. **Passwords are per-user, not per-org (item 14).** One admin resetting a multi-org member's password
   affects that person's login everywhere; mitigated (not eliminated) by forced-change-on-next-login,
   which makes misuse visible rather than silent. Architectural; needs per-org credentials or email to
   fully close.
6. **The audit write is best-effort.** See the carve-out above.
7. **Legacy `/r/` report links** created before the password/expiry change remain open and non-expiring
   until an operator revokes them (now at least `noindex` + robots-disallowed).
8. **The currently-published `PrivacyPolicyPage.jsx` still contains statements this brief shows are false**
   (notably "no third-party analytics/tracking" and the aggregate-only report description). It was left
   **untouched by instruction** — correcting it is the policy-rewrite pass, not this code remediation.

---

# COUNSEL BRIEF v1 — Doorline (pre-remediation; retained for detail)

**Prepared for:** counsel drafting a Privacy Policy and Terms of Service
**Basis:** the source tree at `/Users/omarzumaya/Desktop/canvass-app`, branch `sharedVoters`, as shipped. Read-only inspection. No code executed, no production database queried, no network traffic observed.
**Standard applied:** I state only what the code does. Where I inferred, I say so. Where I could not confirm, I say "COULD NOT DETERMINE" rather than round up. **Code comments are not evidence** — several comments in this codebase assert controls that the code does not implement, and I flag each one, because a comment is exactly the sort of thing that ends up in a privacy policy.

**Read this first.** The single most dangerous sentence you could write is: *"Doorline personnel access customer data only under a time-limited, logged support grant, and every access is recorded."* It is the sentence this remediation release appears designed to enable. **It is false in four independent ways.** See E13. Do not write it in any form until engineering closes `/super-admin/persons`.

---

# A — ACCOUNT DELETION (an individual user of the product: admin, team lead, or canvasser)

## A1. What actually happens when a user deletes their account?

**VERIFIED.**

Deletion is reachable from exactly two code paths and no others (`deleteAccount()` has two call sites repo-wide):

1. **In-app, mobile only, password re-authenticated.** `DELETE /auth/account` (`server/src/routes/auth.js:235`) requires the caller's current password (schema `auth.js:37-39`; bcrypt-verified via `server/src/models/User.js:62-64`; 401 on mismatch). The only UI entry point is mobile Profile → Delete account (`mobile/app/(app)/profile.jsx:316` → `mobile/components/DeleteAccountSheet.jsx:80`). **Note:** the HTTP route itself is gated only by `requireAuth`, so the *interface* is mobile-only, not the *endpoint*.
2. **Operator CLI**, for people who have uninstalled the app and email in: `npm run delete:account <email> --apply` (`server/src/utils/deleteAccountByEmail.js:86`). It calls the identical service. **It performs no identity verification in code** — it takes an email and a flag. "VERIFY THE REQUEST FIRST" (`deleteAccountByEmail.js:24`) is a comment instructing a human, not an enforced control.

The web console has **no** in-product deletion. `client/src/pages/DeleteAccountPage.jsx` is a static instructions page (public route, `client/src/App.jsx:95`) with zero API calls.

**The deletion itself (`server/src/services/users/deleteAccount.js:175-239`), in order:**

| Step | What it does | Line |
|---|---|---|
| 1 | Writes a **new record containing the user's identity** — `DeletedUserRecord` with firstName, lastName, email, phone, userId, organizationIds[], deletedAt, retentionUntil | `:190-204` |
| 2 | `releaseAssignedWork()` — hard-deletes, across **all orgs and all campaigns**, every `TurfAssignment`, `EffortMember`, `CampaignAssignment`, `CampaignManager` row **where the deleted user is the assignee**; nulls `Membership.coordinatorId` on anyone they supervised | `:212`, `:268`, `:274-286` |
| 3 | `Membership.updateMany({userId}, {$set:{isActive:false}})` — memberships are **retained**, only deactivated | `:217` |
| 4 | One `User.updateOne $set` overwriting exactly 11 fields | `:219-236` |

**The 11 scrubbed fields:** `firstName → 'Deleted'`, `lastName → 'user'`, `email → deleted+<userId>@deleted.doorline.invalid`, `phone → null`, `passwordHash → a fresh random unusable bcrypt hash` (not null — the field is `required`), `isActive → false`, `deletedAt → now`, `mustChangePassword → false`, `tempPasswordSetAt → null`, `passwordResetToken → null`, `passwordResetExpiresAt → null`.

**The User row is never deleted.** It is tombstoned in place. Fields explicitly NOT touched and therefore persisting indefinitely: `_id`, `createdAt`, `updatedAt`, **`lastLoginAt`**, `isSuperAdmin`, `platformRole`, `deletionLocked`.

**Deletion is NOT unconditionally available.** Four blockers refuse it (`deleteAccount.js:62-145`), computed across every org where the user holds an **active** membership (`:104` — inactive memberships are not scanned), and re-checked inside the write path (`:176-183`, throws `BLOCKED`; API returns 409 at `auth.js:245`):

- `DELETION_LOCKED` (`:78`) — an operator-set flag on `User.deletionLocked` (`models/User.js:50`), settable on **any** account by email via `npm run lock:account` (`server/src/utils/lockAccountDeletion.js:48-63`), with no demo/role/scope restriction in code, and **no in-app way for the user to clear it**.
- `LAST_SUPER_ADMIN` (`:97`)
- `LAST_ADMIN` (`:116`) — per org
- `LAST_BILLING_ADMIN` (`:136`) — per org

The operator CLI has **no override** ("Deliberately no `--force`", `deleteAccountByEmail.js:66-72`).

> **Do NOT write:** *"You may delete your account at any time from the app, or email us and we will delete it."*
> **Write:** *"You may delete your account from the mobile app. Deletion is not available while your account is the only administrator, the only billing administrator, or the only platform administrator of an organization; you must first transfer that role. A small number of demonstration accounts are locked against deletion."*
>
> As written, the first sentence is **false** for sole admins, sole billing admins, sole super-admins, and any `deletionLocked` account — including via the emailed-request path the public `/delete-account` page promises to honour.

> **Do NOT write:** *"Deleting your account removes all record of your assignments and your supervision of others."*
> **Write:** *"Assignments you held — walk-list books, effort rosters, campaign rosters and campaign-management grants — are permanently deleted across every organization and campaign. Records showing that you assigned work to someone else, and records of field work performed by people you supervised, are retained as part of the organization's operational records and remain linked to your de-identified account identifier."*
>
> Reason: the `deleteMany` filters key **only** on `userId` (the assignee). The **assigner-side foreign keys are never touched**: `TurfAssignment.assignedBy` (`models/TurfAssignment.js:28`), `EffortMember.addedBy` (`:27`), `CampaignAssignment.assignedBy` (`:23`), `CampaignManager.grantedBy` (`:28`), `Membership.addedBy` (`:25`). For an admin or lead — the roles that do the assigning — those rows are the bulk of their footprint. And the supervision link is **frozen** onto every knock and survey taken by their reports: `CanvassActivity.coordinatorId` (`models/CanvassActivity.js:69`), `SurveyResponse.coordinatorId` (`models/SurveyResponse.js:68`). The schema comment at `CanvassActivity.js:63` states the freeze is designed to survive "deletion."

## A2. How long do you keep a deleted user's name, email and phone — and what erases them?

**PARTIAL.** The window is real. The erasure is **scheduled, not guaranteed**, and the record is **anonymized, not deleted**.

- The snapshot is stamped `retentionUntil = deletion time + DELETED_IDENTITY_RETENTION_DAYS` — **default 180 days, environment-configurable** (`deleteAccount.js:25`, `:190`). The 180-day figure is disclosed to the user in the deletion sheet (`server/src/routes/auth.js:219`).
- **`retentionUntil` is inert data.** Nothing fires at that timestamp. Erasure happens only when a daily BullMQ cron job runs on the worker dyno: `RETENTION_CRON`, default `'17 3 * * *'` (`server/src/services/retention/scheduler.js:16`), registered at `server/src/worker.js:46` and consumed at `:57`. The Procfile declares a `worker` process.
- **The purge blanks four fields; it does not delete the row.** `DeletedUserRecord.updateMany({retentionUntil: {$lte: now}, purgedAt: null}, {$set: {firstName:'', lastName:'', email:'', phone:null, purgedAt}})` (`server/src/services/retention/purgeDeletedIdentities.js:29`, `:34-37`). Surviving after the purge: `userId`, `organizationIds[]`, `deletedAt`, `retentionUntil`, `purgedAt`, `createdAt`, `updatedAt` (`server/src/models/DeletedUserRecord.js:22-48`).
- **No TTL index exists anywhere in the codebase.** I grepped `expireAfterSeconds` / `expires:` across all of `server/src`: **zero hits.** There is no database-level expiry on any collection.

**CAVEAT I could not close:** I verified the code and the Procfile. I **could not determine from code** that the worker dyno is scaled up in production. Repo memory records a prior incident in which deploying the wrong branch scaled the worker to 0. The codebase's own health text contemplates the job having **"NEVER run"** and says, in terms, *"we are promising a retention limit we are not enforcing"* (`purgeDeletedIdentities.js:85-89`). A health check exists (`retentionHealth`, `:67-91`, red after 48h) but it is a dashboard reading, not an enforcement mechanism.

> **Do NOT write:** *"We delete this information after 180 days."*
> **Write:** *"We retain this information for up to 180 days after your deletion request, after which the name, email address and telephone number on the deletion record are erased on our next scheduled retention run. A record of the deletion — an internal identifier, the organizations you belonged to, and the date — is retained."*

**Retention can also end EARLY, and by an unrelated event.** `deleteOrganization` pulls the org from `organizationIds` and then runs `DeletedUserRecord.deleteMany({organizationIds: {$size: 0}})` (`server/src/services/platform/deleteOrganization.js:94-98`). That `deleteMany` is **not scoped to the org being deleted** — it sweeps *every* zero-org record in the database. A user who had no active membership at deletion time (a platform user; someone removed from their org first) gets `organizationIds: []` (`deleteAccount.js:104`, `:186`, `:199`) and is destroyed as collateral by the next unrelated organization deletion.

## A3. After the retention window lapses, is the remaining data anonymous?

**VERIFIED: NO. It is pseudonymous. This is the legally load-bearing point in Section A.**

After the purge, **all field records persist in full and remain linked to the deleted user's identifier.**

- `CanvassActivity.userId` — `ref: User`, **`required`** (`server/src/models/CanvassActivity.js:28`)
- `CanvassActivity.location {lat, lng, accuracy}` — **`required`** (`:39`)
- `CanvassActivity.timestamp` — **`required`** (`:42`); `actionType`, free-text `note` (`:37`), `distanceFromHouseMeters` (`:40`), `coordinatorId` (`:69`)
- `SurveyResponse.userId` (required), with its own required `location` and `submittedAt` and the answer payload (`models/SurveyResponse.js:44`, `:52`, `:55`, `:49`)
- `FlagReview.reviewedBy` (required); `HouseholdLocationChange.userId` (required); `VoterNote.authorId`
- The tombstoned `User` document itself still exists, carrying `_id`, `createdAt`, `lastLoginAt`, `deletedAt` — and an email that **embeds the user id**: `deleted+<userId>@deleted.doorline.invalid`

Nothing in the deletion path or the purge path ever nulls, removes, or re-keys `CanvassActivity.userId`. `deleteAccount.js:170-173` states the omission is deliberate. `purgeDeletedIdentities.js:34-37` writes to `DeletedUserRecord` and nothing else.

**What the purge destroys is only the stored mapping from that identifier back to a human name/email.** A deleted canvasser's complete GPS trail, per-door timestamps, free-text notes and survey submissions remain permanently attached to a stable identifier.

**Two code comments assert the opposite and must not reach the policy:** `deleteAccount.js:299-300` and `server/src/services/reports/canvasserIdentity.js:57-58` describe the end state as *"permanently anonymous."* Under a GDPR Recital 26 reading that characterization is **inaccurate**, and the user-facing copy at `auth.js:221` repeats it.

**One correction to a tempting technical defence:** the retention is a **business choice**, not a technical necessity. Mongoose `required` validates the *referencing* document on save; it does not create a foreign-key constraint and cannot prevent removal of a `User` row. `deleteOrganization.js` hard-deletes every one of these same `required`-userId collections in bulk with no error. The code's own rationale is commercial — removing them "would silently rewrite campaign counts and invoices" (`deleteAccount.js:170-173`).

> **Do NOT write:** *"Your field records are permanently anonymized"* or *"cannot be removed for technical reasons."*
> **Write:** *"The doors you knocked and the surveys you recorded remain the organization's records and are retained indefinitely, linked to an internal identifier for your account. We retain them to preserve the integrity of campaign counts and billing and to allow field work to be attributed. After the retention period we no longer hold the name, email address or telephone number that connects that identifier to you, but the identifier and the records remain."*

## A4. What records about a deleted user persist, who can see them, and where do they go?

**PARTIAL.**

**Actively displayed back to the organization during the retention window (VERIFIED).** The deleted person's **real first name, last name and email** are re-surfaced from `DeletedUserRecord` and shown to admins **and team leads** on three per-canvasser report surfaces, via the shared hydrator `hydrateCanvassers` (`server/src/services/reports/canvasserIdentity.js:59-75`):

- the canvasser leaderboard (`server/src/routes/admin/reports.js:859`)
- the canvasser timeline (`reports.js:1747`)
- **the canvasser CSV export**, whose columns include `Email` (`reports.js:2153`, headers `:2158-2163`)

Router gate: `requireOrgRole('admin', 'lead')` (`reports.js:37`) — team leads see it too.
**Phone is NOT re-surfaced** in reports (`canvasserIdentity.js:72` reads the live `User` row, which deletion nulls) — though it *is* stored in `DeletedUserRecord`.
Restoration is **org-scoped and membership-scoped**: only orgs where the person's membership was `isActive` at deletion time are in the snapshot (`deleteAccount.js:104`, `:305`).

**Not every surface restores it.** At least six identity-rendering paths bypass the hydrator and show the tombstone even during the window — including, ironically, the GPS/quality audit that `DeletedUserRecord`'s own model comment names as its reason for existing (`server/src/services/audit/flagDetection.js:72`; also `reports.js:1474`, `:1903`, `:2010`, `:2350`, `:3507`).

**Exportable.** An org admin **or a team lead** can download that restored name and email in a CSV file that then lives outside the application entirely (`GET /admin/reports/canvassers.csv`, `reports.js:2069`). Once downloaded, it is beyond the reach of any purge. *(The phone column is always blank for a deleted user — the CSV requests `phone` but the hydrator never reads the snapshot's phone field.)*

**Records with no retention limit at all (VERIFIED):**

- **`AccessLog`** — contains no data about deleted canvassers or customer users. Its `actorUserId` is always Doorline platform staff. It records method, the **route template** (deliberately not the filled path, so no voter ids land in it), a resource class, organizationId, grantId and a timestamp (`server/src/models/AccessLog.js:15-48`). **It is append-only. There is no purge, no TTL, no retention job for it anywhere.** It is also **not** in `ORG_SCOPED` (`deleteOrganization.js:44-51`), so `AccessLog` and `SupportAccessGrant` rows **survive the hard deletion of the customer organization they refer to.**
- **`RetentionRun`** — one row per purge run: job name, startedAt, finishedAt, ok, purged count, scanned count, error string (`models/RetentionRun.js:20-32`). No user identity. Retained indefinitely. *Note the `error` field is unbounded free text captured from a thrown exception (`purgeDeletedIdentities.js:49`), so an identifier appearing there cannot be categorically ruled out.*

**Backups — see "THINGS YOU DID NOT ASK ABOUT," item 4.** This is a material residual-copy problem and it is not in Atlas.

---

# B — ORGANIZATION DELETION AND RETENTION

## B5. When a customer organization is deleted, what is actually deleted — and what survives?

**VERIFIED, with two material exceptions.**

`deleteOrganization()` hard-deletes rows from **30 org-scoped collections** via `deleteMany({organizationId})` (`server/src/services/platform/deleteOrganization.js:44-51`, sweep at `:102-105`). The list includes `Voter`, `Household`, `CanvassActivity`, `SurveyResponse`, `VoterNote`, `FlagReview`, `HouseholdLocationChange`, `TurfAssignment`, `ImportJob`, `Turf`, `Pass`, `Effort`, `ClientReport`, `ClientReportMapPoint`, `ReportShareLink`, `Membership`, `Subscription`, `SubscriptionEvent`, `SavedSearch`, `SurveyTemplate`, `Tag`, `VotedVoter`. **Persons are deleted unconditionally** (`:118-131`). The **original uploaded CSV/XLSX** is deleted from GridFS **before** the ImportJob rows that name it (`:84-85`). Then the Organization itself (`:133`).

**Contrary to what a lawyer might assume: there is no invoice retention.** `Membership`, `Subscription`, `SubscriptionEvent` and `ReportShareLink` are all in `ORG_SCOPED` and are destroyed. **There is no `Invoice` collection anywhere in the codebase** — billing statements are computed on the fly from `Campaign` + `CanvassActivity` (`server/src/services/billing/statement.js:35`, `:50`), both of which are deleted. `models/Subscription.js:3-5` confirms invoices are sent out-of-band.

> **Do NOT write:** *"We retain billing and tax records for [N] years."* on the strength of this application. Nothing in this codebase preserves them. If the business retains them, that happens outside this system.

### EXCEPTION 1 — Household street addresses survive organization deletion, permanently. **VERIFIED.**

`GeocodeCache` is a **global, un-org-scoped, cross-customer** collection that **contains addresses**.

- It has **no `organizationId` field** (`server/src/models/GeocodeCache.js:18-37`). The schema comment says it is *"intentionally org/campaign-agnostic"* (`:12-14`).
- Its `cacheKey` is a **normalized full street address** — `looseAddressKey` = `addressLine1 | addressLine2 | city | state | zip5`, uppercased and punctuation-stripped, joined with `|` (`server/src/utils/normalizeAddress.js:27-38`). **It is not a hash.** It also stores `matchedAddress` (the geocoder's standardized address string, `:28`) and the coordinates (`:35`).
- **It is not in `ORG_SCOPED`, and no code anywhere in this repository ever deletes a GeocodeCache document.** I grepped all of `server/src`: the only references are the model, `worker.js:37` (`syncIndexes`), a `$unset` migration, and reads/upserts in `geocodeService.js` (`:102`, `:146`, `:262`). There is no `deleteMany`, no `deleteOne`, no TTL.

**Materially: after a customer is fully deleted — by wind-down, by dormancy, or by an explicit deletion request — the normalized street addresses from their uploaded voter file remain in Doorline's database indefinitely, with no organization attribution and no retention clock.** They cannot even be *located* afterward, because nothing records which customer supplied them.

What the cache does **not** contain: any name, voter ID, party, or canvass result. It is address→coordinate only. But a bare residential address is personal data under GDPR/CCPA on most readings.

> **Do NOT write:** *"When your organization is deleted, we delete all of your data,"* or *"we delete household and address data on account deletion."* Both are false while `GeocodeCache` exists as written.

### EXCEPTION 2 — Identity snapshots can be orphaned. **VERIFIED.**

`PersonMergeCandidate`, `PersonEditProposal` (by personId) and `PersonMergeLog` are deleted **only inside a loop over `personIds` collected from that org's Voter rows** (`deleteOrganization.js:74-77`, `:119-127`). The belt-and-braces `Person.deleteMany({organizationId})` at `:130` cascades **nothing**. `PersonMergeLog` and `PersonMergeCandidate` carry **no organizationId** of their own, so nothing else can reach them.

`PersonMergeLog` stores `survivorSnapshot` and `victimSnapshot` — a **verbatim JSON dump of both complete Person documents**: name, phone, cellPhone, dateOfBirth, party, gender, registration status, voter-ID keys (`server/src/services/person/mergePersons.js:11-14`, `:110-119`). A merge *tombstones* the victim and moves its voters to the survivor (`mergePersons.js:143`, `:156`), so in a chained merge the earlier log references two voter-unlinked Persons and **survives the org deletion, orphaned, holding full pre-merge identity PII.**

### Other survivors of organization deletion (VERIFIED):

| Survives | Contains | Why it survives |
|---|---|---|
| **`User` accounts** | name, email, phone, bcrypt hash, `lastLoginAt` | Deliberate: *"global identities are kept even when this was their only org"* (`deleteOrganization.js:59-62`). Only `Membership` rows are removed. |
| **`AccessLog`** | staff actor id, org id, route template | Not in `ORG_SCOPED`. No voter PII. |
| **`SupportAccessGrant`** | staff actor id, org id, **required free-text `reason` (500 chars)** | Not in `ORG_SCOPED`. The free text can name the customer or its people. |
| **`GeocodeCache`** | street addresses + coordinates | See Exception 1. |
| **`DeletedUserRecord`** (multi-org users) | name, email, phone | The org is `$pull`ed from the array; the row is only destroyed when **no** org remains. A deleted user who also belonged to another org keeps their name/email/phone in our database. |
| **`RetentionRun`** | job receipts, no org id | Not swept. |
| **`OrgDeletionRequest`** | (see B6 — in practice, empty) | Not swept. |

**None of these has any retention limit.** No TTL, no purge job.

**The cascade runs in no transaction** (`Organization.deleteOne` is last, `:133`), so a mid-run failure leaves the customer partially deleted.

**Raw upload deletion is best-effort.** `rawImportStore.js:33-39` swallows every GridFS delete error (`.catch(() => {})`). The `ImportJob` rows keyed to those files are then destroyed, so a failed blob delete leaves the complete uploaded voter file orphaned with no key to find it and no retry. The deletion receipt reports `jobIds.length`, not files actually deleted (`deleteOrganization.js:87`).

## B6. What automatic retention timers exist? What triggers deletion?

**PARTIAL — one of the three "triggers" is not wired up at all.**

Two scheduled BullMQ repeatable jobs, both registered on the worker dyno (`server/src/worker.js:46`, `:57`; `server/src/services/retention/scheduler.js:24-31`):

| Job | Cron (default) | What it does |
|---|---|---|
| `purge-deleted-identities` | `'17 3 * * *'` (`scheduler.js:16`) | Blanks four identity fields on `DeletedUserRecord` (A2) |
| `retention-triggers` | `'41 4 * * *'` (`scheduler.js:20`) | Runs the three org triggers below |

**Timezone: COULD NOT DETERMINE.** The cron patterns are passed as `repeat: { pattern }` with **no `tz` option** (`scheduler.js:40`), so BullMQ evaluates them in the worker process's **local** timezone. "03:17 UTC / 04:41 UTC" is true only if the dyno's TZ is UTC (Heroku's default). The "UTC" in the source comment is a comment, not behaviour.

### Trigger 1 — WIND-DOWN. **VERIFIED and live.**
Any `Subscription` with `status: 'canceled'` whose `statusChangedAt` is older than `RETENTION_WIND_DOWN_DAYS` (**default 60**) is passed to the irreversible `deleteOrganization()` cascade (`server/src/services/retention/triggers.js:23`, `:48-70`).
- The `'internal'` exemption **does not protect anything on this path**. `Subscription.organizationId` is unique, so `isExempt()` (`:36-39`) re-reads the same document the query already matched with `status: 'canceled'` — it can never simultaneously be `'internal'`. The check is inert here.
- `statusChangedAt` is rewritten on **any** status transition (`server/src/routes/superAdmin/billing.js:145-147`), so canceled → suspended → canceled restarts the 60-day clock from zero.

### Trigger 2 — DORMANCY. **VERIFIED, and it is the most dangerous item in this section.**

`purgeDormantOrgs` (`triggers.js:78-102`) scans **every** organization and hard-deletes those with no `CanvassActivity` newer than the cutoff.

1. **It does not check whether the customer is paying.** The only exemption is `Subscription.status === 'internal'` — Doorline's own demo orgs (`:36-39`, `:84`). An organization with an **`active`, fully-paid subscription** is fully eligible for deletion. `Organization` has no exempt/lock field.
2. **The clock is canvassing activity ONLY.** `CanvassActivity.findOne({organizationId}).sort({timestamp:-1})` is the only activity query in the function (`:85-87`). **A login, a voter-file import, a turf cut, a report view, a survey edit, or a subscription payment does NOT reset the clock.** An org that has never canvassed is measured from `Organization.createdAt` (`:90`).
3. **The window is 720 days, not 24 months.** `DORMANCY_MONTHS * 30 * DAY` (`:79`) = 720 days ≈ 23.7 calendar months. A policy saying "24 months" over-promises by ~11 days **in the direction of deleting earlier than stated.**
4. **NO WARNING IS SENT.** The file comment says dormancy happens *"after a warning"* (`triggers.js:16`). **There is no warning mechanism anywhere.** Due orgs are identified and deleted in the same pass, with no notice, no grace flag, no pre-deletion state. **The server has no email or SMS capability at all** — `server/package.json` declares no mailer dependency (no nodemailer, sendgrid, postmark, ses, resend, mailgun, twilio).

> **Do NOT write:** *"We retain your data for as long as your account is active."* The dormancy trigger **contradicts this**: a current, paying customer is deleted after 720 days without a recorded knock.
> **Do NOT write:** *"We will notify you before deleting a dormant account,"* or *"after notice."* Nothing in the application sends anything.
> **Do NOT write:** *"no door-knocking activity for 24 months."* The correct phrase is *"no canvassing activity recorded for approximately 24 months."* (And note: `POST /admin/turfs/restrict-bulk` writes `CanvassActivity` rows from the **web admin console** with no door knocked — `server/src/routes/admin/turfs.js:695`, insert at `:779` — and those rows reset the dormancy clock, because the trigger filters on `organizationId` alone.)

### Trigger 3 — DELETE-ON-REQUEST. **VERIFIED: THE EXECUTOR EXISTS; THE INTAKE DOES NOT.**

`executeDueDeletionRequests()` (`triggers.js:111-138`) finds `OrgDeletionRequest` rows with `status: 'scheduled'` and `scheduledFor <= now` and purges them. **But nothing in production code ever creates an `OrgDeletionRequest`.** I grepped the entire repository:

```
server/src/models/OrgDeletionRequest.js      (the model)
server/src/services/retention/triggers.js    (the consumer only — find/updateOne, never create)
server/test/retentionTriggers.int.test.js    (the ONLY .create() calls)
docs/DEPLOY_RUNBOOK.md:321                   (an index note)
```

**No route. No service. No CLI. No admin UI. No cancel path.** The constant `DELETE_REQUEST_SLA_DAYS` (`triggers.js:25`) is **read by nothing in production** — nothing computes `scheduledFor`. Setting `RETENTION_DELETE_SLA_DAYS` in the environment changes nothing. In production this collection is empty; a row could only appear by direct database manipulation.

The only human-triggerable org deletion is the break-glass `DELETE /super-admin/organizations/:orgId` (`server/src/routes/superAdmin/organizations.js:181-196`), which requires `requireBreakGlass` + typed slug and executes **immediately** — no SLA, no request record, no cancellation window.

> **Do NOT write:** *"A customer organization may request deletion of its data and we will complete it within 30 days,"* or anything implying a cancellable request window. **The code does not back it.**
> If the business intends to honour such a promise, it is a **manual, human process today**, and the policy must say so — or engineering must build the intake.

**Two more facts about the receipts, relevant if you promise a deadline:**
- A **failed** deletion request produces a **green** `RetentionRun` receipt. `executeDueDeletionRequests` catches per-org failures, marks the request `status: 'failed'`, and **returns normally** (`triggers.js:121-136`), so `runRetentionTriggers` stamps `ok: true` (`:164-167`). The due-query filters `status: 'scheduled'` (`:113`), so a `'failed'` request is **never picked up again by any code path**. It is permanently dropped behind a successful-looking receipt and a green health banner (`purgeDeletedIdentities.js:68`; `routes/superAdmin/access.js:149-159`).
- `purgeWoundDownOrgs` has **no per-org error isolation** (`triggers.js:64-68`) and the three triggers run sequentially in one function (`:157-159`), so a single throwing organization aborts the whole nightly sweep.

## B7. During the 60-day wind-down, can the customer access or export their own data?

**VERIFIED: NO. The account is not read-only — it is fully blocked, reads included.**

A `canceled` subscription returns **HTTP 402 `{code: 'subscription-inactive'}` on EVERY request** to `/admin` and `/mobile`, **including GETs**. The check sits **above** the write-method test:

```js
if (ent.effective === 'canceled') return res.status(402)...   // entitlement.js:45-51
if (!WRITE_METHODS.has(req.method)) return next();            // entitlement.js:52  ← never reached
```
(`server/src/middleware/entitlement.js:45-52`; gate mounted at `server/src/routes/index.js:65`; `services/billing/entitlement.js:38-39`)

**Every export endpoint lives under `/admin`.** Public share links are blocked too (`routes/public/share.js:43` → `shareLinksBlocked`, `entitlement.js:52-55`). The customer can still **log in** (the `/auth` router is mounted before the gate, `routes/index.js:50`, and login runs no subscription check) — they reach a logged-in shell with no accessible data on the web.

> **Do NOT write:** *"You may export your data during the wind-down period."* **That is a false promise as the code stands.** The code comment at `triggers.js:44` calls the grace period "the customer's window to export" — it is aspirational and the middleware contradicts it.
> **You MAY write:** *"Contact us and we will provide an export during this period"* — **but only if the business intends to honour it operationally.** The code permits it: super-admins bypass the entitlement gate entirely (`entitlement.js:37`) and, with an active support grant, can reach every `/admin` export endpoint for a canceled org. There is no automated or customer-facing mechanism.

**MOBILE IS DIFFERENT AND YOU MUST NOT MISS THIS.** On mobile the 402 is **indistinguishable from being offline**: `mobile/lib/api.js:76-79` turns any non-OK response into a plain Error, and `mobile/app/(app)/map.jsx:298-303` / `books.jsx:94-98` catch **any** bootstrap error and fall back to the voter file already cached on the device. A canvasser whose phone had previously synced **continues to see voter names, addresses, party, gender, age and prior dispositions**. The cache is cleared only on explicit sign-out or an org/campaign switch (`mobile/lib/authState.js:41-51`) — **not** by the 402, and **not** by the server-side purge. **Voter personal data persists on canvasser devices during wind-down and after the server-side deletion.**

**The other suspension states behave differently and must not be conflated:**
- **`suspended` / expired trial** — reads pass; writes 402. **But it is not truly read-only:** a `/mobile` write whose `body.timestamp` predates `sub.statusChangedAt` is **accepted** (`entitlement.js:55-64`), and that timestamp is client-supplied (`routes/mobile/canvass.js:79`). **A suspended organization still ingests new personal data** — voter dispositions, GPS coordinates, survey answers — flushed from mobile offline queues. Public share links are also blocked in this state.
- **`past_due`** — full read AND write, banner only (`services/billing/entitlement.js:32-35`).

## B8. What data-portability / export mechanisms exist?

**VERIFIED.** There is **no full-account export**. A repo-wide grep for `exportOrg|fullExport|dataExport|exportAll` returns nothing.

**Exactly three server-side CSV endpoints exist, all under `/admin`:**

| Endpoint | Contents | Gate |
|---|---|---|
| `GET /admin/campaigns/:id/walklists/:id/export.csv` (`server/src/routes/admin/walklists.js:254`) | **Voter ID, First Name, Last Name, Party, Age (derived from DOB), Phone, Precinct, Address, City, State, ZIP** — one row per voter (`headers :275`, projections `:266`, `:270`) | admin **or lead** (`walklists.js:19`) |
| `GET /admin/reports/canvassers.csv` (`reports.js:2069`) | Per-canvasser **First name, Last name, Email, Phone, Status** + aggregate counts. **Restores deleted users' names and emails** (A4). | admin or lead (`reports.js:37`) |
| `GET /admin/reports/canvassers/:userId/export.csv` (`reports.js:3185`) | **Timestamp, Action, Address, City, State, Zip, Voter name, Party, Latitude, Longitude, GPS Accuracy, Distance from house, Offline flag, free-text Note** (`headers :3208-3212`) | admin or lead |

**The first one is effectively a bulk export of the entire campaign voter file, and this is a two-click product feature, not an edge case.** A walk list can be saved with an **empty filter** — `filter` is optional on `POST /admin/campaigns/:id/walklists` (`walklists.js:74-92`), and an empty filter resolves to `baseSet` = **every active geocoded household in the campaign and every voter in them** (`server/src/services/walklist/resolveWalkList.js:48-53`, `:131-132`). The web UI enables Save on a name alone (`client/src/pages/WalkListsPage.jsx:416`, `:27-47`) and puts an "Export CSV" button on every saved list (`:534-537`). **No row cap. No pagination. No size guard.**

**Also exportable, driven by survey answers:** walk-list filters include `surveyResponse` exists/not-exists, per-question `answerFilters`, and cross-question `answerTagFilters` (`resolveWalkList.js:89-128`). So "every voter who answered X" or "every voter tagged Supporter" can be resolved to a named, addressed, phone-bearing CSV.

**Client-side (browser-generated) downloads not counted above:** a jsPDF client-report PDF (`client/src/lib/reportPdf.js:33`), unmatched-voter-ID CSVs (`WalkListsPage.jsx:227-231`, `EarlyVotingPage.jsx:84-88`), and a billing-statement CSV (`client/src/components/OrgBillingPanel.jsx:99-118` — **platform-staff only**, rendered solely from the super-admin Organizations page).

**Not exportable by any route:** SurveyResponse documents themselves, `VoterNote` bodies, tags, turf/book definitions, flag reviews, import history. **The original uploaded voter file cannot be re-downloaded** — `loadRawImport()` is called only by the background import worker (`services/import/importProcessor.js:56`) and is exposed by no route.

---

# C — LOCATION

## C9. How does the app collect location? Background? Continuous? Stored offline?

### (a) Background collection — **VERIFIED: DENIED. The app cannot collect location in the background.**

- iOS declares **only** `NSLocationWhenInUseUsageDescription` (`mobile/app.json:15`) and **no** `UIBackgroundModes`.
- The `expo-location` plugin is explicitly configured with `locationAlwaysAndWhenInUsePermission: false` and `locationAlwaysPermission: false` (`mobile/app.json:37-39`) — this **suppresses** the "Always" strings Expo would otherwise inject.
- Android declares **only** `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` (`mobile/app.json:27-28`). `ACCESS_BACKGROUND_LOCATION` is **absent**.
- A repo-wide grep of `mobile/` for `watchPositionAsync | startLocationUpdatesAsync | TaskManager | defineTask | ACCESS_BACKGROUND_LOCATION | requestBackgroundPermissionsAsync` returns **zero matches**. No geofencing.

**This is a genuinely safe statement and you should make it.** *Caveat, honestly stated:* verified from source config, not from a built binary's merged `AndroidManifest.xml` / `Info.plist`. An Expo config plugin from another package could in principle add a permission at prebuild; I did not inspect a built artifact.

### (b) Continuous collection while the app is open — **VERIFIED: YES, in device memory.**

Two of your own findings conflict here and I am telling you which is right.

- Location is read **once on map-screen mount** (`mobile/app/(app)/map.jsx:88`, `Location.getCurrentPositionAsync`).
- **While a map screen is mounted, the Mapbox SDK's own location engine streams position continuously** into React state: `<Mapbox.UserLocation>` with an `onUpdate` callback that fires repeatedly (`map.jsx:832-841`, stored at `:219`); `followUserLocation` at `map.jsx:824` and `books.jsx:352`; `<Mapbox.UserLocation visible />` at `books.jsx:357`. Admin/lead screens have pucks too (`admin/map.jsx:808`, `admin/book/[turfId].jsx:375`) — location capture is **not canvasser-only**.
- **INFERRED, NOT VERIFIED:** the canvasser pucks (`map.jsx:832`, `books.jsx:357`) have **no focus gate**, whereas the admin pucks do (`visible={isFocused}`, with comments saying the gate exists so "GPS stops while another screen covers this tab"). These are Stack screens, so the map stays *mounted* beneath pushed screens. The code's own reasoning implies the un-gated pucks keep the location engine running while the user is on a non-map screen. **I could not confirm from code whether the native SDK pauses its engine for a covered MapView. Do not assert either way.**

### (c) Transmission — **VERIFIED: at action time, AND on a pin correction.**

- No location ping, heartbeat, presence, or live-tracking endpoint exists on the server. GPS reaches the server **only** in user-initiated request bodies: the five door-action endpoints (`server/src/routes/mobile/canvass.js:246`, `:264`, `:282`, `:300`, `:322`), the survey submit (`:358`), and the pin-correction endpoint (`:207`).
- **`optimisticSubmit` calls `getCurrentLocation()` unconditionally and merges the result into EVERY request body** (`mobile/lib/recordAction.js:173-184`). So a pure **drag** pin correction — where the user positioned the marker by hand and never asked to use their location — **still takes a fresh GPS fix and ships it to the server.** The server's zod schema for that route has no `location` key (`canvass.js:198-205`), so it is discarded on arrival — **but it is transmitted**, which is what a privacy policy speaks to.
- **GPS is MANDATORY, not optional.** `location` is a required, non-nullable field (`canvass.js:70-74`, `:78`, `:353`) and `CanvassActivity.location` is `required: true` (`models/CanvassActivity.js:39`). If permission is denied the client sends `location: null` and the server rejects it with a 400. **The knock cannot be recorded without a coordinate.**

> **Do NOT write:** *"The app only sends your location when you record a door."*
> **Write:** *"The app reads your device's location (a) once when a map screen opens, (b) continuously while a map screen is open, to draw your position on the map, and (c) when a field action is recorded or a door's map pin is corrected. Location is transmitted to us and stored when you record a door action or correct a pin. The app never reads your location while it is running in the background."*

### (d) On-device retention — **VERIFIED: UNBOUNDED, and there are TWO stores, not one.**

**Store 1 — the offline queue (`mobile/lib/offlineQueue.js`).** A single AsyncStorage key `canvass.offlineQueue` (`:4`), unencrypted plaintext JSON. It holds failed submissions: door actions, **pin corrections**, and **full survey submissions** (answers, free-text "Other" values, the free-text note, the voter id in the path, and the GPS stamp — `mobile/app/(app)/voter/[id]/survey.jsx:257-282` → `recordAction.js:180-184` → `offlineQueue.js:154`).

- **No expiry, no max age, no size cap.** Nothing ever drops an item for being old.
- An item leaves in exactly two ways: the POST succeeds (`:81`), or the server returns a **4xx** and it is **silently deleted, never delivered** (`:88-92`).
- On a **network error or a 5xx**, `doFlush` **breaks out of the loop**, leaving the item at the head of the queue for a later attempt (`:83-87`, `:94-96`). A persistently-failing item blocks every item behind it.
- **It SURVIVES LOGOUT.** `signOut()` (`mobile/lib/authState.js:41-51`) clears the token, cached user, active campaign, bootstrap and selected books. **`canvass.offlineQueue` is not among them, and nothing anywhere clears it.** Un-flushed knocks — each carrying `{lat, lng, accuracy}`, the note, and household/voter ids — remain on the handset after the canvasser signs out, indefinitely.

> **Do NOT write:** *"We hold your location on your device only until it syncs."* The code sets no upper bound. **No maximum retention period for on-device location data can be truthfully stated.**

**Store 2 — see "THINGS YOU DID NOT ASK ABOUT," item 1.** The bootstrap cache is a bigger disclosure than the queue and nobody asked about it.

## C10. What precision is stored, for how long, and what is it used for?

**Precision — VERIFIED: RAW, FULL-PRECISION, NEVER COARSENED.**
`CanvassActivity.location` is `{lat: Number (required), lng: Number (required), accuracy: Number}` (`models/CanvassActivity.js:3-10`, `:39`). The device values pass straight through (`mobile/lib/location.js:10-16`), the zod schema accepts any `z.number()` (`canvass.js:70-74`), and the write assigns `location: data.location` verbatim (`canvass.js:168`; `:434`/`:489` for surveys). **No rounding, truncation, quantisation, jitter or grid-snapping is applied at write time or read time.** Surveys persist the coordinate **twice** (a `CanvassActivity` row and a `SurveyResponse` row).

`distanceFromHouseMeters` is stored **in addition** to the raw coordinate, as `Math.round(haversineMeters(...))` (`canvass.js:83-86`). It does not replace or coarsen the raw lat/lng. It is null when the household has no pin.

*Two exceptions, so you do not write an over-broad sentence:*
- **Not every activity row is a device reading.** Admin bulk-restrict writes `CanvassActivity` rows whose `location` is a **copy of the household's own geocoded pin**, with `accuracy: null` and `distanceFromHouseMeters: 0` (`server/src/routes/admin/turfs.js:748`, `:758` — *"the house's own pin"*, inserted at `:779`). **Do NOT write** *"each activity record contains the GPS location of the canvasser's device"* — for these rows it would falsely imply someone stood at that door.
- The device coordinate is not necessarily a fresh fix. `mobile/lib/location.js:29-33` reuses a cached OS fix up to **15 seconds** old, and `:47` falls back to `getLastKnownPositionAsync()` with **no age or accuracy bound**.

**Server-side retention — VERIFIED: NO age-based expiry of location data exists anywhere.**
The retention subsystem never deletes, ages out, or coarsens GPS. `purgeDeletedIdentities` writes only to `DeletedUserRecord`. **There is no TTL index on any coordinate-bearing collection** (no `expireAfterSeconds` anywhere in `server/src`). For an active customer, canvasser GPS is **retained indefinitely**.

Coordinates are removed only by: (i) hard deletion of the whole organization (which cascades over `CanvassActivity`/`SurveyResponse`/`Household`); (ii) a canvasser overwriting their own prior action at the same door in the same round (`routes/mobile/canvass.js:139-144`, `:470-475` — replace-in-place, the earlier fix is destroyed); (iii) an admin discarding a round with "clear knocks" (`admin/turfs.js:342-344`); (iv) an admin undoing a bulk restrict (`admin/turfs.js:812`). **None of these is automatic or time-based.**
**Note:** `GeocodeCache` coordinates (address→point) are **never** deleted, including by organization deletion (B5, Exception 1).

**Purpose — VERIFIED, and it is broader than fraud detection.** Confirmed consumers of a canvasser's stored GPS:

1. **GPS quality / canvassing-fraud audit** — `far`, `weak_gps`, `rapid`, `one_spot` flags computed **live** from the ledger (`server/src/services/audit/flagDetection.js:1-60`). Only the reviewer's **decision** is persisted (`FlagReview`).
2. **A canvasser BREADCRUMB / PATH MAP.** `GET /admin/reports/canvassers/:userId/path` (`reports.js:2995-3047`) returns a **time-ordered array of raw `{lat, lng, accuracy, timestamp, actionType, household address}` points, up to 5,000 per request**, rendered as a map of that person's movements (`mobile/app/(app)/admin/canvasser/[id]/map.jsx:110`; `.../day/[date].jsx:95`).
3. **A raw-coordinate CSV export** — `Latitude`, `Longitude`, `Accuracy (m)` columns per action, alongside address, voter name, party and note (`reports.js:3185-3234`).
4. **A per-canvasser quality report** — average distance, far-door counts, distance histogram (`reports.js:3050+`).
5. **An activity feed** returning the full location object per action (`reports.js:2689`, `:2733`; `admin/activities.js:51-52`).
6. **A distance-walked metric** shown to the canvasser themselves (`routes/mobile/me.js:100-106`, `:381-389`).

Access gate on all of these: `requireOrgRole('admin', 'lead')` (`reports.js:37`) — org admins **and campaign-scoped team leads**.

> **Do NOT write:** *"We use location only to verify that a knock happened at the door."* That understates it. **Write:** *"A canvasser's recorded knock coordinates can be displayed as a chronological map of their movements during a shift and exported as a file containing raw coordinates."*

---

# D — PUBLISHED / SHARED REPORTS

## D11. What does a published report link expose, and how is it secured?

**VERIFIED — and this is where the currently-published privacy policy is already false.**

### What a published map point contains

For **each individual household that was reached**, `ClientReportMapPoint` stores and serves:
- exact geographic coordinates (`lng`, `lat`) — **copied verbatim from the Household record, with no jitter, rounding or aggregation anywhere in the path**
- **`addressLine1`** — the **full street line including the house number**
- `city`, `state`
- the household's canvass status
- **the operator-whitelisted survey answers given at that door**

(`server/src/models/ClientReportMapPoint.js:31-41`; built at `server/src/services/reports/computeReport.js:201-213`; shaped for the browser at `services/reports/clientReportView.js:67-77`; served **unauthenticated** at `server/src/routes/public/share.js:166-173`; rendered as address-then-answer in a click-through detail panel at `client/src/components/ClientReportMap.jsx:233-252`.)

The model's own comment calls `addressLine1` a *"coarse address"* (`ClientReportMapPoint.js:33`). **That is not an accurate description of its precision.** What it excludes is the unit/apartment line (`addressLine2`) and the ZIP.

**Unknocked households are omitted** (`computeReport.js:200`), so a point's mere presence discloses that the household was canvassed.

**The codebase says this plainly.** `models/ReportShareLink.js:29-34`: *"every map point is a household's exact street address and coordinates plus that household's survey answers ('412 Elm St → Opposed'). A name is a public voter-file lookup away."*

### What is genuinely excluded (VERIFIED, and you may say so)
No voter name, no canvasser name or user id, no timestamps, no party, no phone, no date of birth. None of these fields exist on the schema, none are selected by the build query, none are emitted. The public map endpoint returns `canvassers: []` (`share.js:169`).

**BUT — one qualification you must not drop.** `answers[].answer` is a Mongoose `Mixed` field (`ClientReportMapPoint.js:13`) and is a **live free-text channel**. The remediation whitelist rejects only questions whose **type** is `'text'` (`routes/admin/clientReports.js:78-83`, `:460-474`). A **single-choice or multiple-choice** question may enable an "Other: ___" write-in (`models/SurveyTemplate.js:52`), whose canvasser-typed text is substituted into the answer snapshot (`mobile/app/(app)/voter/[id]/survey.jsx:276`), stored verbatim (`services/surveys/normalizeAnswers.js:45`), passes the type guard, is frozen onto the point (`computeReport.js:184-187`), and is emitted verbatim to the public map. **Free text a canvasser typed can appear pinned to a street address on an unauthenticated page.** No migration scrubs already-published points.

> **Do NOT write** (and this is the sentence **currently published** at `client/src/pages/PrivacyPolicyPage.jsx:106-109`): *"Published reports present only aggregate campaign statistics and a map of door statuses."*
> **Write:** *"A published report includes a map in which each household reached is shown at its exact street address and coordinates, together with that household's door status and the survey answers the campaign has chosen to display. Voter names and canvasser identities are not included."*

### Security of the link

| Control | Status |
|---|---|
| **Token entropy** | **VERIFIED STRONG.** 24 bytes from Node's CSPRNG, base64url → 32 chars = **192 bits** (`routes/admin/clientReports.js:151-153`). Not brute-forceable. *(Exception: the demo-org seeder uses `SEED_DEMO_SHARE_TOKEN` verbatim if set — `utils/seedDemoOrg.js:525` — in which case entropy is whatever an operator chose.)* |
| **Password on NEW links** | **VERIFIED.** Every link created through the admin API gets a bcrypt-hashed password; if the operator supplies none, a 12-char random one is generated and returned once (`clientReports.js:180-184`, `:231`, `:240`, `:247`). |
| **Expiry on NEW links** | **VERIFIED.** `expiresAt = now + SHARE_LINK_DEFAULT_DAYS` (default **90**, `clientReports.js:173`, `:241`). Expired links return **410** before any report data (`share.js:35-40`). Expiry cannot be extended or cleared via the API. |
| **LEGACY links** | **VERIFIED OPEN.** Links created **before this release** have `passwordHash: null` and `expiresAt: null` and **remain fully live**. `share.js:57` waves through any link with a null password hash; `share.js:35` treats a null `expiresAt` as unexpired. **No migration remediates them** — I listed all 24 files in `server/src/migrations/` and grepped for `ShareLink`/`passwordHash`: **zero hits.** The code comments at `share.js:33` and `models/ReportShareLink.js:35` refer to "the migration" **as if it exists. It does not.** |
| **Search-engine indexing** | **VERIFIED: NO PROTECTION.** No `noindex` meta tag, no `X-Robots-Tag` header, no noindex directive anywhere in the client or server (grep: zero hits). `client/public/robots.txt` is `User-agent: * / Allow: / / Disallow: /api` — **`/r/` is not disallowed.** *Mitigating: the URL is unguessable, and the page is client-rendered with its data fetched from `/api/share/...`, which robots.txt does disallow — so a compliant crawler like Googlebot would likely index the URL and shell but be blocked from the report content. **robots.txt is advisory only.** It does not bind scrapers, archivers, or link-preview/unfurl bots, none of which are prevented from retrieving the full report JSON from an open legacy link.* |
| **Revocation** | **PARTIAL.** Deactivate / delete / rotate work on the next request (`share.js:28`). A **bulk** revoke exists but targets **only** the legacy/open subset and is a **dry run unless `confirm: true`** (`clientReports.js:261-286`). It is **not automatic**. It also skips the per-campaign authorization check every other route in the file performs, so a team lead can revoke legacy links across campaigns they do not manage. |
| **Password change ≠ revocation** | **VERIFIED.** The unlock JWT carries only `{shareId, campaignId}` with a 24h TTL (`services/auth/tokens.js:22-30`) and is never re-checked against the password (`share.js:63-68`). An already-unlocked viewer retains access for up to 24 hours after a password change. *(Link **revocation**, by contrast, does take effect immediately, because `loadShare` re-queries `isActive` on every request.)* |
| **Password can be REMOVED from any link, today** | **VERIFIED.** `shareUpdateSchema` accepts `password: null` (`clientReports.js:197`), and `:310-312` sets `passwordHash` back to `null`. Passwordless links are **not** a closed legacy set. |
| **Metadata is never gated** | **VERIFIED.** `GET /share/:token` (campaign name, organization name, link label) has **no** `requireShareAccess` (`share.js:84`). |

> **Do NOT write:** *"Report links are password-protected and expire."* **False** as a statement about links as a class.
> **Write:** *"Report links created since [date] are protected by a password and expire after 90 days by default. Links created before that date may remain accessible without a password and do not expire until an administrator revokes them."*
> **COULD NOT DETERMINE:** how many open legacy links exist in production. That requires a database query. **Ask engineering before this sentence ships.**

**One thing an unguessable token is not:** it is a **capability**, not access control. It survives forwarding, it does not expire on a legacy link, and there is no rate limit or logging preventing its reuse by anyone who obtains it. The only rate limit on this surface throttles failed **password** attempts, not token access (`share.js:106-114`).

---

# E — PLATFORM (DOORLINE STAFF) ACCESS TO CUSTOMER DATA

## E12. Is platform-staff access to customer data gated and logged?

**PARTIAL. Gated and logged on `/admin/*` and `/mobile/*` only. That qualifier must accompany every sentence you write about this.**

### What is real (VERIFIED)

`orgContext` is the **sole** assigner of `req.activeOrg` (grep for `req.activeOrg =` returns hits only in that file). A super-admin who is **not** a member of the target organization gets **403 `SUPPORT_ACCESS_REQUIRED`** unless `activeGrant()` returns an unrevoked, unexpired grant (`server/src/middleware/orgContext.js:79-94`; `services/access/supportAccess.js:16-23`). Membership is checked first (`:58-67`).

A grant:
- lasts **4 hours by default, capped at 24** — both **environment-overridable** (`SUPPORT_GRANT_HOURS`, `SUPPORT_GRANT_MAX_HOURS`; `supportAccess.js:12-13`, `:26`). The cap is genuinely hard for one grant: `expiresAt` is written in exactly one place and there is no extension route.
- requires a typed free-text **reason of ≥10 characters** (`routes/superAdmin/access.js:24`; required on the model, `models/SupportAccessGrant.js:37`)
- is **idempotent** — an existing live grant is reused, not stacked (`supportAccess.js:29-30`)
- is revocable, effective on the next request (no server-side grant cache)
- carries a `kind` (`support | incident | migration | audit | other`) — **but `kind` is OPTIONAL, defaults to `'support'`, and the staff console never sends it** (`access.js:25`; `supportAccess.js:25`; `client/src/components/SupportAccessGate.jsx:91`). In practice every grant is `'support'`.

**A customer's own admins and members are neither grant-gated nor logged, and that is correct.** `orgContext` finds an active Membership and returns `next()` before it ever considers super-admin status, never setting `req.supportGrant`; `accessLog` then short-circuits (`orgContext.js:58-67`; `accessLog.js:40`). **No AccessLog row is ever written for a customer reading their own organization's data.**

### Three things you must NOT imply

**1. The grant is SELF-ISSUED.** `POST /super-admin/access/grants` is gated by `requireSuperAdmin` only — **not** `requireBreakGlass` (`routes/superAdmin/access.js:19`, `:31`). `createGrant` sets `actorUserId: req.user._id` (`supportAccess.js:25-39`): **the staff member grants themselves access, to any organization, instantly.** There is **no approver, no second-person sign-off, no customer approval, and no customer notification.** I found no customer-facing surface for grants or the access log anywhere (`SupportAccessPage.jsx` is routed under `/super-admin`; a grep of `server/src/content/help/` for "support access" / "Doorline staff" returns **zero articles**).

> **Do NOT write:** *"with your authorization," "at your request," "with notice to you,"* or anything implying customer consent or an independent authorization gate. **The grant is an attribution control, not an approval control.**

**2. The 24-hour cap bounds ONE grant, not cumulative access.** No cooldown, no cumulative limit. A staffer whose grant expires can immediately create another.
> **Do NOT write:** *"Staff access never exceeds 24 hours."* **Write:** *"Each grant expires within at most 24 hours."*

**3. The audit log cannot answer the question a data subject will actually ask.** `AccessLog` records the **route template** and a **resource class** — deliberately **no voter, household or person id** (`middleware/accessLog.js:44-58`; `models/AccessLog.js:40-44`). Doorline **cannot** truthfully offer *"we can tell you whether your record was accessed."* It can only say *"staff entered your organization."*
> The staff-facing 403 string at `orgContext.js:85` says *"every record you open is logged."* **That is not what the log records.**

## E13. Where are the holes?

**THIS IS THE MOST IMPORTANT ANSWER IN THE BRIEF. VERIFIED.**

### HOLE 1 — `/super-admin/persons`: a cross-organization voter-identity console with NO grant and NO audit. Reads **and writes**.

I traced the mount chain myself.

- **The router is gated by `requireAuth, requireSuperAdmin` only.** `server/src/routes/superAdmin/persons.js:15`. **`orgContext` is never imported or mounted** — so **no grant is ever required.** (Grep for `orgContext` across `server/src/routes/superAdmin/`: **zero hits.**)
- **It is outside the audit.** `accessLog` is mounted **only** on `['/admin','/mobile']` (`server/src/routes/index.js:72`). `/super-admin/persons` is mounted at `routes/index.js:77`. `req.supportGrant` is assigned in exactly one place — `orgContext.js:92` — so on any `/super-admin` route it is **permanently undefined**, and `accessLog.js:40` would drop the row even if it were mounted.
- **`requireSuperAdmin` checks only `isSuperAdmin`** (`middleware/auth.js:28-32`). **Any** Doorline staff account — including `platformRole: 'support'`, the supposedly least-privileged tier — passes.

**What it returns.** `GET /super-admin/persons/:personId` (`persons.js:219`) → `buildPersonOversight` → `serializePerson` (`services/person/personOversight.js:28-55`): **firstName, lastName, fullName, phone, phoneType, cellPhone, party, gender, dateOfBirth, registrationStatus, uid keys, state voter IDs** — plus, per organization, **full home addresses**: addressLine1, addressLine2, city, state, zipCode, county (`personOversight.js:96-105`, `:133-140`).

**`GET /super-admin/persons`** (`persons.js:31-93`) is a **regex-searchable, paginated, cross-organization directory**. Its filter is `{ mergedInto: null }` — **no organization scope at all** (`:37`). Free-text name search across every Person on the platform.

**It is live in the product UI**: `/super-admin/people` and `/super-admin/people/:personId` (`client/src/App.jsx:205-206`; `SuperAdminPeoplePage.jsx:37`; `PersonDetailPage.jsx:129`, which renders phone, party, gender and date of birth).

**AND IT IS A WRITE HOLE, NOT JUST A READ HOLE.** On the same ungated, unaudited router (I confirmed every route declaration):

| Route | Line | Gate |
|---|---|---|
| `GET /candidates` (merge candidates with voter-ID samples) | `:96` | superAdmin only |
| `GET /edit-proposals` (proposed names, DOBs, phones) | `:135` | superAdmin only |
| `POST /edit-proposals/:id/approve` | `:164` | superAdmin only |
| `POST /edit-proposals/:id/reject` | `:202` | superAdmin only |
| `GET /:personId` (full identity + addresses) | `:219` | superAdmin only |
| **`PATCH /:personId`** (edit name/DOB/phone) | `:230` | **`requireBreakGlass` ✅** — the *only* route on this router that is |
| `PATCH /:personId/owner` | `:255` | superAdmin only |
| `PATCH /:personId/lock` | `:275` | superAdmin only |
| **`POST /:personId/merge`** | `:289` | superAdmin only |
| **`POST /:personId/split`** | `:304` | superAdmin only |

**Platform staff can read, merge, split, re-own and lock a customer's canonical voter identity records with no grant and no audit row.**

**⚠️ THE CODE COMMENT AT `services/person/personOversight.js:71-73` ASSERTS THE OPPOSITE:** *"reaching this route now requires the caller to hold a SupportAccessGrant; every read is written to AccessLog."* **That statement is FALSE against the code as shipped.** Do not let it be cited as evidence of a control, and do not let it become a privacy-policy sentence.

*Two mitigating facts, both real and both worth stating:* (1) the **canvassing** side of the person view is genuinely aggregate-only — survey/activity/note figures are `$group`/`$count`, and the code never reads `SurveyResponse.answers`, `CanvassActivity.note` or `VoterNote.body` (`personOversight.js:113-126`); staff see **that** a person was surveyed, not what they said. (2) The UI list renders only city/state (`PersonDetailPage.jsx:329`) — **but the JSON response contains the full street address** and is trivially visible in a browser network tab.

### HOLE 2 — Voter content read under a valid grant that produces NO audit row. **VERIFIED.**

`voterContentResource()` prefix-matches the path against a **hand-maintained list of ten strings** (`services/access/supportAccess.js:54-73`). I cross-referenced that list against the real mount table (`routes/index.js`):

**Three prefixes are DEAD — they can never match:**
- `'/admin/turfs'` (`supportAccess.js:62`) — real mount is `/admin/campaigns/:campaignId/turfs` (`routes/index.js:102`)
- `'/admin/walklists'` (`:63`) — real mount is `/admin/campaigns/:campaignId/walklists` (`routes/index.js:95`)
- `'/admin/notes'` (`:59`) — **no such router exists**

**And these voter-content routes are not in the list at all:**
- `/admin/imports` (`routes/index.js:85`) — the raw uploaded voter file surface
- `/admin/campaigns/:campaignId/households` (`:94`)
- `/admin/campaigns/:campaignId/voted` (`:96`) — returns state voter IDs

**Concrete consequence:** `GET /admin/campaigns/:id/walklists/:id/export.csv` streams a CSV of **voter first/last name, party, age, phone, precinct and street address** (`routes/admin/walklists.js:254-292`). `voterContentResource()` returns `null` for it, so `accessLog.js:28` returns `next()` **without ever registering the finish listener**. **A staff member operating under a valid grant can export a customer's entire voter file and leave zero audit rows.** Staff *do* need a grant to reach these routes (`orgContext` runs), so this is a gap in the **audit trail**, not in access control — but it is fatal to any "every voter record our staff opens is logged" sentence.

### HOLE 3 — A grant can be converted into permanent, unlogged access. **INFERRED FROM CODE PATHS, not executed.**

`requireOrgRole()` returns `next()` **unconditionally for any `isSuperAdmin` caller, before any role check** (`middleware/auth.js:58`). So a super-admin holding a grant passes the admin gate on `/admin/memberships` and can **create a Membership — including for themselves** (`routes/admin/memberships.js:24` is the only gate). Once a Membership exists, `orgContext`'s membership-first branch takes over, `req.supportGrant` is never set again, and `accessLog` short-circuits **forever**. `/admin/memberships` is also absent from `VOTER_CONTENT_ROUTES`, so the membership-creation request itself writes no audit row.

I did **not** execute this and did **not** fully trace the `POST /admin/memberships` body schema to confirm a staffer can name themselves. **Treat as a control weakness for engineering review, not a proven exploit.** The first step (creating the grant) *is* recorded in `SupportAccessGrant`, so the escalation is not invisible — but the subsequent reads are.

### HOLE 4 — The Bull Board job console is outside everything. **VERIFIED.**

`app.use('/admin/queues', requireBullBoardAuth, createBullBoardRouter())` — mounted at the **app root**, outside `/api` (`server/src/app.js:77`). It therefore never traverses `routes/index.js`, where `orgContext` and `accessLog` live. `queues/bullBoard.js` calls it *"a cross-tenant job console (all orgs' jobs)."* **No grant, no audit.**

I looked for voter PII and did **not** find any rendered: job payloads are ids (`{importJobId}`), and turf jobs carry `{campaignId, passId, mode, params, generatedBy}`. **But:**
- `params` is an **unvalidated pass-through of `req.body.params`** (`routes/admin/turfs.js:170`, `:211`) and in practice carries the admin's **hand-drawn map polygons** and **voter targeting criteria** (party, gender, age range, precinct/district/city/zip, survey-answer ids and their human-readable labels — `services/walklist/resolveWalkList.js:12-35`; `services/turf/generateTurf.js:74`). These are personal-data selection criteria, not "opaque ids."
- BullMQ persists a failed job's `failedReason` and stacktrace for **30 days** (`queues/index.js:22`). `importProcessor.js:287` rethrows **every** error, and `csvImporter.js:373`/`:413` `bulkWrite` against unique indexes on `{campaignId, normalizedAddress}` (`models/Household.js:90`) and `{organizationId, stateVoterId}` (`models/Voter.js:74`) with **no duplicate-key guard**. A MongoDB `E11000` message **embeds the offending key value** — a street address or a state voter ID. **REACHABLE MECHANISM, NOT AN OBSERVED LEAK** — I did not reproduce it.

> **Do NOT write:** *"Bull Board / our job console contains no voter content."* Say *"no voter records are enqueued"* if you must say anything.

---

# F — MULTI-TENANCY

## F14. Can one customer's data reach another customer's? What is shared across organizations?

**PARTIAL. No customer can read another customer's voter data. But five things cross the tenant boundary, and one of them is the platform staff console.**

### What is correctly isolated (VERIFIED — I traced it)

`orgContext` requires an **active Membership** in the org named by `X-Org-Id` on every request, else 403 (`orgContext.js:58-67`, `:101-103`). Every content-bearing admin router **and the query itself** scopes to `activeOrgId`: reports `baseFilter` always ANDs `organizationId` (`reports.js:123-136`, so a foreign `?campaignId` returns zero rows); voters (`admin/voters.js:47`, `:196`, `:256`, `:291`, `:309`); campaign-nested routers each re-verify campaign ownership against the active org before touching sub-resources (`turfs.js:33-47`, `efforts.js:26-46`, `walklists.js:27-42`, `passes.js:24-39`, `voted.js:20-35`, `campaignHouseholds.js:33-38`, and six more). Mobile 404s a household from another org (`mobile/canvass.js:55-68`). All seven `/super-admin` routers require `requireSuperAdmin`.

**I did NOT exhaustively audit every one of ~40 admin sub-routers.** I found no missing-filter bug in the routes I read. I cannot certify absence.

### EXCEPTION 1 — The `/super-admin/persons` cross-org identity console. **VERIFIED. See E13, Hole 1.**
This is **platform-staff** cross-org visibility, **not** customer-to-customer. No customer can reach another customer's data this way. But it is the single most important exception in this brief, and it means **no sentence of the form "your data is only ever visible to your organization and to Doorline staff acting under a logged, time-limited grant" is true.**

### EXCEPTION 2 — `GeocodeCache` is a global, cross-customer address cache. **VERIFIED.**
No `organizationId`. If org A geocodes an address and org B later imports the same address, **B hits A's cache entry** — the lookup is `{provider: 'geocodio', cacheKey: {$in: [...]}}` with **no org term** (`services/import/geocode/geocodeService.js:146-149`; upsert keyed on `cacheKey + provider` only, `:90-98`). Never deleted (B5).

**It is weakly observable to a customer, as a count.** `ImportJob` stores `geocodedNew` and `geocodedCached` (`models/ImportJob.js:36-37`) and the org-scoped import routes return the whole job document (`routes/admin/imports.js:348`, `:359-368`), so a customer admin sees how many addresses in their import were **already present in the global cache** — including entries put there by other customers (`geocodeService.js:165`). It is a **count, never a list**, and it is confounded by the org's own prior imports. **My assessment that this could in principle be turned into a one-bit "has any Doorline customer ever geocoded this exact address?" oracle (import a single address, compare the two counters) is INFERENCE from the code path, not an observed exploit — I did not test it.** Low severity. But it is why I would not describe the cache as "purely internal and invisible to customers."

### EXCEPTION 3 — The `User` account is a global, platform-wide record. **VERIFIED.**
One human has **one** `User` row (name, email, phone, password hash) with a **globally unique email** (`models/User.js:4-60`), and holds a separate `Membership` per organization (`models/Membership.js:41`). A user can be an active member of multiple customer organizations simultaneously.

**What such a user can SEE is correctly gated** — one org at a time, only orgs they are a member of. No union view, no cross-org query surface for them.

**But two things cross the boundary:**

- **The global email namespace is an account-existence oracle, and lets one org attach another org's user.** When org A's admin adds a member whose email already exists **anywhere** on the platform, the API returns **409 `EMAIL_EXISTS_USE_LINK`** (`services/memberships/createMember.js:50-51`, `:61-66`). With `linkExisting: true`, org A creates a Membership on that existing global account — **with no consent gate of any kind** (`:53-60`, `:83-94`). Org A's Users page then displays that person's firstName, lastName, email, phone, `isActive`, `createdAt`, **`lastLoginAt`** (a *global* last-login, reflecting activity in any org) and **`isMultiOrg`** (`routes/admin/memberships.js:137-148`). Notification is **after the fact only** (`Membership.acknowledgedAt`). The same flow is reachable by a **team lead** (`routes/admin/leadCrew.js:23`, `:91-97`).
  **And it is a takeover path.** Once the Membership exists, org A's admin can **reset that user's password** — `PATCH /admin/memberships/:userId/password` is gated **only** on "a Membership for this user exists in my active org" (`memberships.js:385-420`), which org A just minted. That password logs in, and the login response returns `memberships` **for every org the user belongs to** (`routes/auth.js:110-111`). `mustChangePassword` does not block `/auth`, so `POST /auth/change-password` clears the flag and yields a full cross-org session. **INFERRED FROM CODE PATHS, not executed.** It is destructive and detectable (it burns the victim's real password), but it is not prevented. **Escalate to engineering.**
- **`isMultiOrg` is disclosed to customers.** An org admin is told, for each of their own members, a boolean indicating that person **also belongs to at least one other organization on the platform** — computed from an **unscoped** aggregate over all Memberships (`memberships.js:109-114`, `:145`). Only a boolean; never the name, id or count of the other orgs. Minor, but it is a genuine cross-tenant inference **shown to customers**.

### EXCEPTION 4 — Cross-org Person merge is possible via staff tooling. **VERIFIED.**
The `Person` layer **is** now org-scoped: `organizationId` is required and indexed (`models/Person.js:61-66`), both dedup uniqueness indexes are org-prefixed (`:109-116`), the import resolver hard-throws without an orgId, and the identity fan-out is org-filtered (`services/person/propagateIdentity.js:106`).

**But `mergePersons.js` contains ZERO references to `organizationId`.** I grepped the file: **zero.** It loads survivor and victim by `_id` only and never compares their organizations. `Voter.find({personId: victim._id})` at `mergePersons.js:83` has no org filter; `Voter.updateMany(... {$set: {personId: survivor._id}})` at `:143` re-points **org B's voter rows onto a Person whose `organizationId` is org A**, and `:124-139` copies org B's state voter IDs onto org A's Person document. `POST /super-admin/persons/:personId/merge` (`persons.js:289`) takes an arbitrary `victimId` from the request body and is gated by `requireSuperAdmin` only — **not** `requireBreakGlass`. The UI provides a free-text "paste the other person's ID" box (`client/src/pages/PersonDetailPage.jsx:403-417`).

> **Do NOT write:** *"Each customer's voter identity records are fully siloed and can never be shared between organizations."*
> **Write:** *"Each canonical voter identity record belongs to exactly one customer organization. A customer's imports and edits cannot create, match, or modify identity records belonging to another customer. Doorline platform staff retain administrative identity tooling (merge/split) that operates across organizations."*

**One further caveat on the org-prefixed indexes:** production has `autoIndex` **off**, so these indexes are created **by a migration only** (`models/Person.js:108`), and the **old global unique indexes must be dropped** or they will reject the per-org copies. **COULD NOT DETERMINE** whether the production database actually has the new indexes and lacks the old ones. Ask engineering.

### EXCEPTION 5 — One genuine customer-to-customer leak (metadata only). **VERIFIED.**
`GET /admin/campaigns/:campaignId/turfs/jobs/:jobId` (`routes/admin/turfs.js:221-236`) calls `getQueue(QUEUE_NAMES.TURF).getJob(req.params.jobId)` **with no organizationId or campaign check**, against a **single platform-wide queue** shared by every organization. An org admin/lead satisfies the campaign gate with **their own** campaignId, then supplies **any** jobId and receives **another org's** turf-generation job: status, progress, `returnvalue` (`{bookCount}` / `{added, bookCount, bookIds[]}`) and `failedReason`. **Job ids are enumerable sequential integers** (`turfs.js:207` calls `add()` with no `jobId` option). Jobs persist 7 days (completed) / 30 days (failed).

**Honest severity bounds:** this exposes **derived operational metadata** — book counts, doors-added counts, Turf ObjectIds, generic error strings. It does **not** expose voter identity, addresses, survey answers, canvass records, or reports. `job.data` (which holds the campaignId/orgId) is **not** returned, so the leaked rows are **unattributed** — the caller cannot tell which customer a job belongs to. The leaked `bookIds` are not dereferenceable cross-org. **Engineering should fix it; it does not by itself falsify a tenant-isolation statement about personal data.**

---

# G — THIRD PARTIES

## G15. Which third parties receive data?

**PARTIAL.** Verified from code. **Regions and log-drain configuration are not in the repository and must be read off the provider consoles.**

| # | Party | What it receives | Confidence |
|---|---|---|---|
| 1 | **MongoDB Atlas** | The entire production database: voter/Person records (names, DOB, phone, party), household addresses and coordinates, canvasser GPS-stamped knock activity, survey answers, free-text notes, user accounts and bcrypt password hashes, AccessLog, SupportAccessGrant. Plus, **transiently**, the raw uploaded voter file (GridFS). | VERIFIED |
| 2 | **Heroku** | Hosts both the web dyno and the worker dyno — **all data in transit and in process memory.** Plus an **HTTP access log for every request** (see below). | VERIFIED |
| 3 | **GEOCODIO** (`api.geocod.io`) | **VOTERS' FULL HOME STREET ADDRESSES.** | VERIFIED — **MUST BE DISCLOSED AS A SUBPROCESSOR** |
| 4 | **Mapbox** | Map tiles + a public token from web **and** mobile. **Web additionally sends usage telemetry with a persistent identifier.** | VERIFIED (asymmetric — see below) |
| 5 | **Heroku Key-Value Store (Redis)** | BullMQ job payloads: ids, plus turf **targeting criteria and drawn polygons**; failed-job error strings retained 30 days. | PARTIAL |
| 6 | **Expo / EAS** | OTA update checks (device IP + update metadata). EAS Build receives the app **source code**. | VERIFIED |
| 7 | **Apple / Google** | App distribution and review. Plus **platform location services** (see below). | PARTIAL |

### GEOCODIO — the loud one. **VERIFIED.**
The server builds a single-line address string — `addressLine1, city, STATE ZIP5` (e.g. `123 Elm St, Des Moines, IA 50310`) — and **POSTs batches of up to 1,000 of them** to `https://api.geocod.io/v2/geocode` with the API key in the query string (`services/import/geocode/geocodeService.js:64-70`, `:196-200`; `geocodioProvider.js:13-40`).

**Scope limits that are true and favourable, all verified:**
- **Only the address is sent.** No voter name, no voter ID, no party/age/gender. **The unit/apartment number is deliberately omitted** (`geocodeService.js:64-69`).
- **Only households MISSING coordinates are sent** (`:45-47`, `:127-135`). Addresses that arrive from the customer's file with coordinates, or that hit the local cache, are never transmitted.
- The whole path is gated behind `GEOCODE_ENABLED === 'true'` **plus** a `GEOCODIO_API_KEY` (`services/import/importProcessor.js:129`).

**COULD NOT DETERMINE:** whether `GEOCODE_ENABLED` is `true` in production — it is an environment variable, not in the repo. A persistent `GeocodeCache` collection, a geocoding-cost model, and an owner-facing cost page all indicate it is in real use. **Treat as live and disclose.**

### MAPBOX — telemetry is DISABLED on mobile but NOT on web. **VERIFIED.**
- **Mobile:** `Mapbox.setAccessToken(...).then(() => Mapbox.setTelemetryEnabled(false))` at a single enforced chokepoint (`mobile/lib/mapbox.js:48-49`). The file's own comment states the SDK ships anonymous usage **and location** data by default and that this is off on purpose (`:11-25`). *Caveat the code itself concedes:* even with telemetry off, Mapbox still receives a session-counting `appUserTurnstile` ping (`:25`). *"Telemetry off" is not "no network calls."* The disable is also **asynchronous** (chained off the token promise) and failures are swallowed — I **could not determine** whether the SDK emits anything in the startup window before the flag lands.
- **Web: there is NO telemetry-disabling code at all.** I grepped all of `client/src` for `telemetry | setTelemetry | events.mapbox`: **zero hits.** The app only does `mapboxgl.accessToken = token` (`client/src/pages/MapPage.jsx:329`; `TurfsPage.jsx:1033`; `components/ClientReportMap.jsx:88`). The installed dependency is `mapbox-gl` 3.x, whose bundled telemetry client POSTs to `https://events.mapbox.com/events/v2` (`map.load`, `appUserTurnstile`) and persists an **anonymous UUID in the browser's `localStorage`** under `mapbox.eventData`. Mapbox GL JS exposes **no supported opt-out**, and the SDK marks the block *"REMOVAL OR MODIFICATION OF THE PRECEDING CODE VIOLATES THE MAPBOX TERMS OF SERVICE."*
- **It fires for unauthenticated members of the public**: the public share-report page renders the same Mapbox map (`client/src/pages/PublicReportDetailPage.jsx:63-65` → `ClientReportMap.jsx`). **Recipients of a shared client report — non-users — get a Mapbox tracking identifier written to their browser.**

> **Do NOT write:** *"We do not use advertising cookies, third-party analytics, or tracking technologies on our sites or in our apps."*
> **This is the sentence currently published** (`client/src/pages/PrivacyPolicyPage.jsx:98-99`), and the mobile code's own comment says telemetry is disabled **specifically to keep that sentence true** (`mobile/lib/mapbox.js:13-14`). **It is supported for mobile. It is NOT supported for the web console or for the public report pages.** It is also the sentence with the sharpest cookie/tracking-technology disclosure consequences.
> *(INFERRED, NOT PROVEN FROM THIS REPO: that the library therefore transmits its default events. I verified the endpoint and the localStorage key are present in the shipped bundle and that no disabling code exists. I did not observe network traffic.)*

### HEROKU'S ACCESS LOG — this is a data flow, and it is not on anyone's subprocessor list. **VERIFIED.**
`app.use(morgan(isProd ? 'combined' : 'dev'))` (`server/src/app.js:52`), mounted app-wide with no `skip`, **before** everything. `app.set('trust proxy', 1)` (`:30`) makes `:remote-addr` resolve to the **real client IP**. The `combined` format logs `":method :url HTTP/:http-version"`, and morgan's `:url` token is **`req.originalUrl` — which INCLUDES THE QUERY STRING.**

**Therefore Heroku's log stream receives, in cleartext:**
- **Voter names and street addresses**, whenever anyone uses a search box: `/admin/voters?search=John%20Smith` (`routes/admin/voters.js:71` — regex-matched against `fullName`, `stateVoterId`, `addressLine1`, `city`, `zipCode`), `/mobile/voters?search=` (`routes/mobile/voters.js:89-100`), `/super-admin/persons?q=` (`routes/superAdmin/persons.js:35`), household address search (`reports.js:2797`).
- **Free-text search over what canvassers wrote about voters** — `/admin/reports/notes?q=` (`reports.js:3415`).
- **Every public report capability token**, because it is a **path segment**: `/api/share/:token` (`routes/public/share.js:27`). **The token is a credential, and it is written to a log.**
- The client IP and user-agent of every request, including the continuous foreground polling from canvassers' phones.

> **Do NOT write:** *"Hosting-provider logs contain only IP addresses and technical metadata."*
> **COULD NOT DETERMINE:** Heroku's log retention, and whether a **log drain** forwards these to a further third party. No drain, log add-on, or error-tracker is configured anywhere in the repo — **but drains are attached via the Heroku dashboard/CLI and would not appear in code.** **This must be confirmed from the Heroku dashboard before the subprocessor list is final.**

### APPLE / GOOGLE — more than distribution. **PARTIAL.**
`mobile/eas.json:34-45` configures EAS Submit to App Store Connect and the Google Play `internal` track. **Doorline embeds no Apple or Google analytics, crash-reporting, advertising, push (no FCM/APNs), or payment SDK** — verified across all four `package.json` files.

**But two things are not "distribution only":**
1. **On Android, every location fix the app takes is served by Google Play Services' Fused Location Provider.** `expo-location` links `com.google.android.gms:play-services-location` and calls `LocationServices.getFusedLocationProviderClient`. On iOS the equivalent is Apple's CoreLocation. **Our code does not transmit canvassing data to Apple or Google, but we cannot assert from this codebase that these platform location SDKs send nothing to their vendors.**
2. **Apple and Google app reviewers are issued working logins to a demo organization in production** (`server/src/utils/seedDemoOrg.js:152-170`). That org's voter identities are **synthetic** (`:210`), so no customer data is exposed.

> **Safe language:** *"We do not integrate Apple or Google analytics, advertising, or tracking SDKs, and we do not transmit customer or voter data to Apple or Google. Our Android app obtains device location via Google Play Services' location APIs and our iOS app via Apple's location services; data those platform services may collect is governed by Apple's and Google's own privacy policies."*
> **See also "THINGS YOU DID NOT ASK ABOUT," item 2 — device backup. This is the Apple/Google issue that actually matters.**

### NOT PRESENT — verified negatives you may rely on
- **NO PAYMENT PROCESSOR. Stripe is NOT integrated and receives NO data.** There is no `stripe` package in any of the four `package.json` files. `models/Subscription.js:44-47` contains dormant placeholder fields (`source` enum permitting `'stripe'`, a null `stripeCustomerId`) with comments describing Stripe as a **future** phase. Billing is manual/internal. **Do NOT disclose Stripe as a subprocessor.** If the business collects payment out-of-band, that is outside this codebase.
- **NO email provider, NO SMS provider, NO crash-reporting, NO error-tracking, NO product analytics SDK.** Swept all four `package.json` files for Sentry, Bugsnag, Datadog, New Relic, LogRocket, Nodemailer, SMTP, SendGrid, Mailgun, Postmark, Resend, Twilio, AWS SES/S3, Segment, Amplitude, Mixpanel, PostHog, Firebase, GA, GTM: **zero.** The web page has no third-party script tags and self-hosts its fonts. **Consequence: there is no automated password-reset email — recovery is admin-issued temporary passwords only, and there is no mechanism to warn anyone of anything.**
- **OpenStreetMap / Overpass** appears in a **one-time developer script** that builds a committed demo fixture (`server/src/utils/demoData/fetchDemoAddresses.js`). It sends a hard-coded bounding box, no personal data, and nothing in the production request path imports it. **Does not need disclosure as a subprocessor.**

---

# H — EVERYTHING ELSE A PRIVACY POLICY MUST ADDRESS

## H16. What is in this system that the preceding questions did not reach?

### (a) SPECIAL-CATEGORY DATA — Article 9. Two independent sources. **VERIFIED.**

**1. Party affiliation is stored about every voter in the file, and routinely displayed.** `Voter.party` (`models/Voter.js:43`) and `Person.party` (`models/Person.js:78`) are persisted from the customer's uploaded voter file. **Party is pushed to canvassers' phones for every voter in their book** (`routes/mobile/bootstrap.js:267`) and rendered on door surfaces as part of a "Party · Age · Gender" line. **Unlike date of birth, party is NOT stripped from the phone payload.** It is held about the overwhelming majority of voters who were never knocked and never interacted with anyone.

**2. Survey answers are stored linked to a NAMED, IDENTIFIED voter** — i.e. political opinions attached to an identified natural person. `SurveyResponse.voterId` is a **required** reference to the `Voter` row, which carries full name, home address, DOB and phone (`models/SurveyResponse.js:42`). Each response stores `answers[]` (chosen option ids + snapshot answer text + free-text `otherText`), a free-text `note`, the submitting canvasser's `userId`, and the **GPS coordinates where it was taken** (`:49`, `:50`, `:52`).

The **documented, intended and shipped purpose** is support/persuasion identification: the client-report headline is *"Support · Undecided · Opposed"* (`docs/CLIENT_PORTAL.md:42`); survey logic is documented around *"they're a supporter"* (`docs/SURVEYS.md:93`); answer tags carry the example *"Supporter"* (`docs/SURVEYS.md:117`).

*Precision:* the **schema** does not mandate political questions — question text is customer-authored free text. What is verified is that (i) the linkage to an identified individual is **structural and required**, and (ii) the shipped, documented use is support ID. **Treat as Art. 9 special-category data.** And note it is exposed **pinned to street addresses on unauthenticated public links** (D11).

### (b) DATE OF BIRTH. **VERIFIED, with a real protection you should credit.**
Raw `dateOfBirth` is stored (`Voter.js:45`, `Person.js:80`) and returned in full to the **web console** for org admins.

**The mobile bootstrap deliberately strips it and sends only a derived integer age** (`routes/mobile/bootstrap.js:22-38`), on the stated reasoning that *"a DOB is the most identity-theft-useful field in a voter file"* and must not sit in a volunteer's offline cache. **I verified this protection is intact: DOB is not in the offline file.**

**But the protection is route-scoped, not role-scoped.** `GET /mobile/voters/:voterId` returns raw `dateOfBirth` **plus `phone` and `cellPhone`** (`services/voters/voterProfile.js:141-146`; `routes/mobile/voters.js:151`), and **that route has no role gate** — the `isAdminOrSuper` check only *widens* scope. In the shipped app the only screen calling it is inside the **admin tab** (`mobile/app/(app)/voters/[id].jsx`, reachable only from `admin/more.jsx:131` and `admin/notes.jsx:184`, behind a role redirect at `admin/_layout.jsx:102-103`), so **no canvasser-facing screen requests it**. But a canvasser's own credentials calling that endpoint directly, for a voter inside their assigned books, **would receive raw DOB and phone.** That is an authorization gap, not a product data flow.

> **Do NOT write:** *"Dates of birth are never sent to canvasser devices"* (the API path is not blocked) **and do NOT write** *"canvassers' phones receive dates of birth"* (no canvasser screen requests them). **Write:** *"Dates of birth are stored and are visible to administrators and team leads. They are deliberately excluded from the offline data downloaded to a canvasser's device, which carries only a derived age."*

### (c) THE CANVASSER IS AN EMPLOYEE UNDER GPS MONITORING, AND IS TOLD ALMOST NOTHING. **PARTIAL.**
The fraud/quality audit makes **four machine-generated assertions about named workers** — `far`, `rapid`, `one_spot`, `weak_gps` — computed live from the GPS trail (`services/audit/flagDetection.js:18-19`, `:157-260`). The flags are not stored; what **is** stored is `FlagReview` — a human reviewer's decision with `status: 'reviewed' | 'dismissed' | 'confirmed'`, a free-text note, `reviewedBy`, `reviewedAt`, and `reasonsAtReview`. **A `confirmed` FlagReview is a stored, adverse, human-affirmed allegation about an identified worker, retained indefinitely and surviving that worker's account deletion** (`deleteAccount.js:170-173`).

**Disclosure to the canvasser:**
- **What they ARE told, in-app:** the OS permission string — *"Doorline needs your location to log when you knock on a door, so admins can verify field activity"* (`mobile/app.json:15`). And a canvasser-visible Help Center FAQ (`audience: all`, so it reaches them — `server/src/content/help/faq/delete-my-account.md:4`, `:25-28`) states: *"Canvassing records include the location where each door was logged, and an organization has to be able to check that work against a real person."*
- **What they are NOT told, anywhere in-app:** that the GPS trail is **algorithmically analyzed for canvassing-fraud flags**, that an adverse reviewer decision about them is **persisted**, or that their movements can be **replayed as a map and exported as a raw-coordinate CSV**. The Help Center articles explaining the audit are tagged `audience: lead` (`content/help/guides/audit.md:4`; `pages/page-audit.md:4`), and the role→audience map gives a canvasser only `['all','canvasser']` (`services/help/loadHelp.js:19-24`). **They cannot see them.**
- **There is no notification, no contest path, and no appeal path in the code.** There cannot be — the server has no notification capability of any kind.
- **A lead or admin who knocks doors is flagged too**, sees their own flags (the reports router admits `lead`), and — because `POST /flags/review` has **no self-review guard** (`reports.js:3340`) — **can dismiss a flag on their own knock.**

This is an **employee-monitoring / worker-privacy** exposure, not just a consumer-privacy one, and it needs its own treatment in the ToS and in whatever notice canvassers receive at onboarding.

### (d) VOTERS HAVE NO RIGHTS MECHANISM AT ALL. **VERIFIED.**
There is **no voter account, no voter role** (Membership roles are `['admin','lead','canvasser']` only — `models/Membership.js:21`), and **no voter-facing route**. A grep across server, client and mobile for do-not-contact / opt-out / unsubscribe / DSAR / data-subject / right-to-erasure returns **no implementation**. There is no `DELETE /admin/voters/:voterId` and no delete route on the Person router.

**What DOES exist:** an org admin can **correct** a voter's identity fields (`routes/admin/voters.js:186`), **delete a voter's survey response** (`:371`), and **delete a voter note** (`:303`). And a household can be marked `'restricted'` and excluded from future books via an admin `excludeRestricted` toggle (`models/Household.js:47-52`; `services/turf/generateTurf.js:49`, `:205`) — **door-level, admin-controlled, not voter-initiated,** and framed in the help copy as "couldn't physically reach the door," not as suppression.

The currently-published policy states *"Voters do not interact with the Services directly."* The only channel for a voter to exercise any right is a contact email on the policy page. **Every DSAR from a voter is a manual process with no tooling behind it, and there is no way to mark a person do-not-contact.**

### (e) WHETHER A PERSON VOTED IS STORED — but NOT how. **VERIFIED.**
`VotedVoter` records, per campaign per voter: `stateVoterId`, `voterId`, `householdId`, `votedAt`, `uploadId` (`models/VotedVoter.js:9-16`). It drives door suppression (`Household.fullyVoted`) and is surfaced **per voter** to canvassers on mobile.

**Two corrections to an obvious misreading:**
- **`voteMethod` is a DEAD field.** It is declared (`VotedVoter.js:14`) but **never assigned by any write path** — the import route, the sticky re-apply service, and the seeder all `$setOnInsert` a field set that omits it, and the CSV parser reads **only a single voter-ID column** and discards every other column of the customer's file. **Do NOT write that Doorline stores how a person voted.** It stores **participation**, not method and not ballot content.
- **`votedAt` is the INGEST timestamp, not the date the person voted** (`routes/admin/voted.js:132` — `new Date()`).

`VotedPendingId` separately persists raw `stateVoterId`s from the customer's voted file that matched **no voter in the org's universe** — i.e. voting-participation identifiers for individuals not otherwise in the customer's data at all.

### (f) SESSIONS — the published policy is RIGHT and one of your team's own findings was WRONG. **VERIFIED.**
`requireAuth` **loads the user from MongoDB on every single request** and 401s on `!user.isActive || user.deletedAt` (`middleware/auth.js:13-20` — the comment says it outright: *"refusing here IS the revocation"*). `orgContext` re-queries `Membership.isActive` on every `/admin` and `/mobile` request (`:58-62`). The JWT payload carries only `{sub, email, isSuperAdmin}` and **no authorization decision reads it.**

**Therefore: deactivation, deletion, role change, demotion and removal-from-org ALL take effect on the next request.** The published sentence *"the ability for administrators to disable access promptly"* **is true. Keep it.**

**What actually fails to revoke is narrower and specific:**
- **Logout is a server-side no-op** (`routes/auth.js:193-195`). No denylist, no token version, no session store.
- **A password change does not invalidate existing tokens.** `change-password` writes only `{passwordHash, mustChangePassword:false, tempPasswordSetAt:null}` (`auth.js:141-145`); nothing compares a token to the hash. **A stolen or forwarded bearer token keeps working for up to 30 days after the victim resets their password** (`JWT_EXPIRES_IN`, default `'30d'`, `services/auth/tokens.js:6`).

> **Do NOT write** anything implying that logging out, or changing your password, terminates existing sessions. **Neither does.**

---

# THINGS YOU DID NOT ASK ABOUT BUT MUST DISCLOSE

### 1. The largest at-rest store of voter PII in the whole system is an unencrypted file on a volunteer's phone. **VERIFIED.**

`mobile/lib/cache.js:13` writes `canvass.bootstrap.json` into `FileSystem.documentDirectory`. `cache.js:85-86` serializes the entire bootstrap payload to it as **plaintext JSON** (`writeAsStringAsync(BOOTSTRAP_TMP, JSON.stringify(snapshot))` then an atomic rename).

**What is in that file** (I read the server projections):
- **Every household in the canvasser's book**: `addressLine1`, `addressLine2`, `city`, `state`, `zipCode`, **exact `location` coordinates**, door `status`, `lastActionAt` (`routes/mobile/bootstrap.js:231-244`)
- **Every voter in those homes**: `fullName`, `firstName`, `lastName`, **`party`**, `gender`, `surveyStatus`, and a derived **`age`** (`bootstrap.js:260-270`)
- **NOT** included: date of birth (stripped, `bootstrap.js:36-39`), phone.

On a 16,000-door turf this is a **multi-megabyte file of named residents at mapped addresses on a temporary field worker's device.**

**It IS cleared on sign-out** (`mobile/lib/authState.js:41-50` calls `clearBootstrap()`) — credit that. **But nothing else clears it, there is no expiry, and it persists indefinitely as long as the user stays logged in and the app stays installed.**

### 2. Nothing opts these files out of iCloud / Google device backup. **VERIFIED ABSENCE; CONSEQUENCE INFERRED.**

I grepped `mobile/` (source and `app.json`) for `ExcludedFromBackup`, `NSURLIsExcludedFromBackupKey`, `allowBackup`: **zero hits.** `mobile/app.json` sets no `android.allowBackup: false`.

`FileSystem.documentDirectory` is inside the app's iOS `Documents/` folder, **which is included in iCloud/iTunes backups by default**; Android Auto Backup is **on by default**. **INFERRED, NOT VERIFIED (I did not inspect a device backup):** `canvass.bootstrap.json` — voter names, street addresses, coordinates, party — and the plaintext offline queue are copied into the canvasser's **personal iCloud or Google account backup.**

**This is the Apple/Google data flow that actually matters, and G15's "distribution only" line is exactly the sentence that would produce a false statement about it.** **Escalate to engineering, and until it is fixed, do not represent that the app takes steps to keep voter data off third-party cloud backups.**

### 3. `ImportJob` permanently retains voter PII in import history. **VERIFIED.**
Never mentioned in any inventory. `ImportJob` rows are retained forever (no TTL anywhere) and carry:
- **`diff`** (`models/ImportJob.js:86`) — samples of **moved voters** as `{stateVoterId, name, fromAddress, toAddress}` (`services/import/computeImportDiff.js:129-137`, `:200-219`). **A voter's name plus their previous and new home address, permanently, in import history.**
- **`errors[]`** (`ImportJob.js:61`) — `rowIndex`, `code`, `reason`, **`stateVoterId`** (`csvImporter.js:152-158`)
- **`geocodeCheck.sample`** — sample **addresses**

Also permanently retained and never inventoried: `Voter.identityBackup` (a Mixed snapshot of pre-propagation identity fields), `Person.fieldProvenance` (per-field `prevValue` — **superseded identity values: an old phone, an old name, an old party, so corrections do not erase the prior value**), `PersonEditProposal.canonicalSnapshot`, `TurfSnapshot.clearedKnocks` (verbatim copies of `CanvassActivity` + `SurveyResponse`).

### 4. Backups. There is a full-PII copy of the production database on an operator's personal laptop, and nothing deletes it. **VERIFIED.**

- **`docs/DEPLOY_RUNBOOK.md:74`** instructs: `mongodump --uri="<MONGODB_URI>" --archive=$HOME/doorline-preflight.archive.gz --gzip` — **a full dump of production to the operator's home directory.**
- **`docs/DEPLOY_RUNBOOK.md:87-95` records that this was actually run against production on 2026-07-13** (75,760 Persons).
- `verify-backup.sh:49-57` restores it into a throwaway mongod to prove it works; `scripts/census.mjs:31-41` enumerates the collections it must contain: **people, voters, households, canvassactivities, surveyresponses, users, memberships, campaigns, organizations** — the full PII corpus.
- **NOTHING in the repository ever deletes that archive.** No cleanup step in the runbook; no code reference. The retention subsystem has no awareness of it. **A purged identity persists in that offline archive indefinitely, with no code-level expiry and no custody control.**

- **Atlas Cloud Backup:** the runbook **instructs** turning it ON as part of this release (`DEPLOY_RUNBOOK.md:163-165`) and taking a verified snapshot (`:196-200`), and states *"The Atlas snapshot (1d) is your only rollback"* (`:455`). **Nothing in the repo records that those steps were actually performed** — only step 0c (the mongodump) has a recorded result. **Production backup state is inferred from a runbook, not verified. Read it off the Atlas console.**
- The prior cluster tier was Atlas Free (M0), which per the runbook *"is physically incapable of being backed up"* (`:63-69`). **So Atlas snapshot coverage begins only at this release. Data deleted before it was never in an Atlas snapshot** — it may be in the laptop dump.
- **COULD NOT DETERMINE:** the Atlas snapshot **retention period**. No such value appears anywhere in the repo. Get it from the console.

**Every deletion mechanism in this codebase — the org cascade, the campaign cascade, account deletion, the retention purges — operates exclusively against the live MongoDB collections. No code path scrubs, expires, filters, or even references a backup or snapshot. The published privacy policy does not mention backups at all** (grep of `PrivacyPolicyPage.jsx` for "backup|snapshot": zero hits).

> **Do NOT write:** *"Residual copies of deleted data persist in backups only until they rotate out on our provider's schedule."* **That is false while the laptop archive exists.** Either the policy covers operator-held dumps, or the company destroys that archive.

### 5. Deleting a campaign leaves orphans. **VERIFIED.**
A campaign can only be hard-deleted if it has no canvassing history — **but that gate is a live-row existence check, not a latch.** `campaignHasCanvassed()` (`routes/admin/campaigns.js:54-58`) tests `CanvassActivity.exists()`. `POST /admin/turfs/discard` with `clearKnocks` **hard-deletes those very rows** (`routes/admin/turfs.js:343-344`) and is a **checkbox in the web console** (`client/src/pages/TurfsPage.jsx:425`). **Clearing every non-archived pass re-opens the hard-delete gate on a campaign that WAS canvassed.**

The campaign cascade removes 20 collections + the Voter rows housed in that campaign's households + the raw spreadsheets. **It does NOT remove:** `VoterNote` (keyed by voterId, no campaignId — **free-text notes about voters survive as orphans after the voter rows are gone**), `Person` (org-scoped — canonical identity rows with name, DOB, phone, party, gender simply left behind), `FlagReview`, `PersonMergeLog`/`Candidate`/`EditProposal`, and `GeocodeCache`.

### 6. Two smaller items.
- **`middleware/error.js:7-10` returns `err.message` to the caller on any 500 in production** — which surfaces raw Mongo errors. A duplicate-key error quotes the offending value (e.g. an email address, a street address, a state voter ID).
- **`app.js:41-44`: CORS reflects ANY Origin when `CLIENT_ORIGIN` is unset** (`origin: process.env.CLIENT_ORIGIN ? ... : true`). Helmet's CSP is **disabled** (`app.js:34-38`). **COULD NOT DETERMINE** the production value of `CLIENT_ORIGIN`.

---

# THE HONEST GAPS

**This is the list you take to the lawyer. These are the places where the product does not yet do what a policy would want to promise.**

### FIX BEFORE THE POLICY SHIPS — a policy sentence would be false today

1. **`/super-admin/persons` is an ungated, unaudited, cross-organization voter-identity console with read AND write.** Any `support`-tier staff account can search every Person on the platform by name, read name/DOB/phone/cell/party/gender/registration/state-voter-ID/**home addresses** across every customer, and **merge, split, re-own and lock** those records. No grant. No audit row. The code comment at `personOversight.js:71-73` claims the exact opposite. **Until this is closed, no sentence of the form "staff access to your data is time-boxed, reason-logged and audited" is true.** (E13)
2. **The support grant is self-issued, with no approval and no notice to the customer.** (E12)
3. **The audit log does not cover the routes that actually export voter data.** Three of its ten prefixes are dead strings that can never match; the walk-list CSV export — voter names, ages, phones, addresses — leaves **zero** audit rows. (E13, Hole 2)
4. **`GeocodeCache` retains every customer's street addresses forever, including after the customer is deleted, with no org attribution.** *"When you leave, we delete your data"* is false while this exists. (B5)
5. **There is no intake for a customer deletion request.** The 30-day SLA executor exists; nothing anywhere creates the request it consumes. **The promise is unbackable today.** (B6)
6. **The published policy already says two things the code contradicts:** *"published reports present only aggregate campaign statistics and a map of door statuses"* (they pin per-address political survey answers — D11) and *"we do not use ... third-party analytics or tracking technologies on our sites"* (Mapbox GL JS telemetry ships unmuted on the web console **and on the public report pages** — G15).
7. **The dormancy purge deletes paying customers.** A current, `active`, fully-paid organization that has recorded no canvassing for ~720 days is hard-deleted, unannounced. It contradicts *"we retain your data for as long as your account is active,"* which is the currently-published sentence (`PrivacyPolicyPage.jsx:166-168`). (B6)

### FIX SOON — real exposure, not yet a false statement

8. **No opt-out from platform device backup.** Voter names, addresses and coordinates likely ride into canvassers' personal iCloud/Google backups. (Disclosures, item 2)
9. **Voter names, addresses and public report tokens are written to the Heroku access log in cleartext,** and it is unknown whether a log drain forwards them onward. (G15)
10. **Legacy report share links are open, unauthenticated and non-expiring.** The remediation left them live on purpose. The code comments refer to "the migration" that sunsets them — **the migration does not exist.** Nobody knows how many are out there. (D11)
11. **Legacy links have no `noindex`.** robots.txt does not disallow `/r/`. (D11)
12. **On-device retention is unbounded.** The offline queue has no TTL, no cap, and **survives logout**, holding GPS coordinates, survey answers and free-text notes. (C9)
13. **A grant-holding staff member can mint themselves a Membership and become permanently ungated and unlogged.** (E13, Hole 3 — inferred, needs engineering review)
14. **A customer admin can link another org's user account into their org and reset that person's password**, obtaining a cross-org session. (F14 — inferred, needs engineering review)
15. **Cross-org Person merge is possible from the staff console** — `mergePersons.js` has zero `organizationId` references. It can also cause org B's deletion to destroy org A's Person records. (F14)
16. **Dormancy deletion sends no warning.** The code comment says "after a warning." **The server has no email or SMS capability at all.**

### YOU CANNOT PROMISE THESE, BECAUSE NOTHING ENFORCES THEM

17. **There is no TTL index anywhere in the entire codebase.** No collection expires on its own. Every retention promise depends on a **cron job running on a worker dyno** — and repo history records a prior incident where the worker was scaled to 0 by a bad deploy. The code's own health text contemplates the purge having **"NEVER run"** and says *"we are promising a retention limit we are not enforcing."* **Write "we aim to purge within ~180 days," not "is deleted after 180 days."** (A2)
18. **A failed customer deletion request produces a green success receipt and is never retried.** (B6)
19. **Doorline cannot answer "was MY record accessed?"** — `AccessLog` stores a route template and a resource class, never a record id. **Do not offer record-level access transparency.** (E12)
20. **After the 180-day purge, the field data is PSEUDONYMOUS, not anonymous.** The GPS trail, timestamps, notes and survey submissions remain permanently linked to a stable identifier, and the tombstoned `User` row still exists carrying that identifier and `lastLoginAt`. **Two code comments call this "permanently anonymous." They are wrong, and one of them is already user-facing copy.** (A3)
21. **`User` accounts have no retention limit at all.** A volunteer who canvassed for one weekend in 2024 still has a live row — name, email, phone, bcrypt hash, `lastLoginAt` — indefinitely, unless they personally delete their account **from the mobile app** (there is no web deletion, and the operator CLI cannot delete a sole admin, sole billing admin, sole super-admin, or a `deletionLocked` account). (A1, B5)
22. **Voters — the actual data subjects, who never consented to anything — have no account, no access, no correction, no deletion, no opt-out, and no do-not-contact mechanism.** Every request from a voter is a manual process with no tooling behind it. **This is the largest structural gap in the product from a privacy-law standpoint, and no sentence you write can paper over it.** (H16(d))