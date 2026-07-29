# STATUS v3 — post-policy-rewrite, re-verified 2026-07-16

> **Read this v3 section first. It supersedes the v2 verdict below the same way v2 superseded v1.**
> Since v2 was written: the **policy rewrite shipped** (the published legal pages are now committed
> static HTML and every false published sentence v2 flagged is gone), a **second remediation wave**
> closed the remaining "fix before the policy ships" items, and an 8-agent adversarial re-audit on
> 2026-07-16 re-verified this document's claims against the tree. v1/v2 text below is retained as the
> detailed record; wherever a **[v3 …]** stamp appears, the stamped text is history, not current truth.
> Unstamped v1/v2 detail was re-checked and still stands.

## Verdict (v3)

The published Privacy Policy, ToS, and DPA are now the static pages `client/public/privacy.html`,
`terms.html`, `delete-account.html` (served by explicit routes in `server/src/app.js` ahead of the SPA;
`PrivacyPolicyPage.jsx` / `TermsPage.jsx` no longer exist). Their claims were drafted against this
document and re-verify cleanly against the code, with the deploy contingencies listed below. The v2
load-bearing sentence — grant-gated, reason-logged, time-boxed staff access — is now **true as
published**: the policy states the grant requirement absolutely (the code backs it) and hedges the
audit half as *"designed to be recorded"* (correct — the write is best-effort).

## What changed since v2 (each code-verified 2026-07-16)

1. **`/super-admin/persons` is closed** (was E13 Hole 1, the #1 gap). `requireBreakGlass` router-wide
   (`persons.js:27`) — the `support` staff tier cannot reach it at all; every one of the 12 routes
   requires a live **per-org** `SupportAccessGrant` (`requirePersonOrgGrant`) and writes an AccessLog
   row (`logPersonAccess`); the directory hard-requires `?organizationId` and scopes every query to the
   granted org. The once-false comment in `personOversight.js` was rewritten and is now accurate.
2. **Cross-org merge is refused** (was F14 Exc 4): `mergePersons.js:88-92` 409s when survivor and
   victim orgs differ; `keysHeldElsewhere` is org-scoped; merge/split are break-glass + grant + logged.
3. **The audit is fail-closed** (was E13 Hole 2): `voterContentResource()` is gone; `accessLog` decides
   at response-finish for **every** `/admin`+`/mobile` request and logs by default — the only skips are
   a 3-entry `AUDIT_EXEMPT` metadata allowlist; unrecognized routes log as `'other'`. The walk-list CSV
   export now writes a row. Guard test: `test/accessLogCoverage.int.test.js`.
4. **Vendor self-mint is blocked** (was E13 Hole 3): any non-GET to `/admin/memberships` from a
   grant-holder 403s `VENDOR_READ_ONLY` (`memberships.js:33-43`); `leadCrew` writes carry
   `denyVendorPrivilegeWrite`.
5. **Wind-down is a real export window** (was B7): `canceled` is now read-only — GETs, exports
   included, pass; writes 402. Customer-self-serve. Share links still die (410).
6. **Dormancy shield** (was B6 Trigger 2): `DORMANCY_PROTECTED_STATUSES` = {active, trial, past_due,
   internal} (`triggers.js:92`) — only canceled/suspended orgs are eligible, a missing Subscription
   protects, and the default window is now **30 months** (`RETENTION_DORMANCY_MONTHS`), matching the
   policy. Still no warning capability (unchanged — no mailer exists). *[v4 2026-07-17: superseded —
   a mailer now exists (Resend, `services/mail/`) and the sweep WARNS before both wind-down and
   dormancy purges, which are gated on delivery-verified markers. See the v4 watchlist entry.]*
7. **Deletion-request intake exists** (was B6 Trigger 3): operator CLI `request:org-deletion` and a
   super-admin API (`POST/GET /super-admin/access/deletion-requests`, `POST …/:id/cancel`), 30-day SLA.
   Failed executions stay `scheduled` and retry (≤5 attempts, `RETENTION_DELETE_MAX_ATTEMPTS`), then go
   loudly red on the health surface — never a green receipt.
8. **GeocodeCache expires** (was B5 Exc 1): the codebase's one TTL index — `lastUsedAt`, 540 days
   (`GeocodeCache.js:53-55`) + `migrate:geocode-lastused` backfill. **Inert until
   `migrate:build-indexes --apply` runs in prod** (autoIndex is off) *(operator-attested run
   2026-07-16 — see gap 9)*.
9. **Public-map write-ins are closed** (was the D11 free-text qualification): `publicPointAnswer`
   (`computeReport.js:151-176`) rebuilds public answers from option ids against canonical labels —
   `'__other__'` emits the literal word `'Other'`, unmatched legacy text collapses to `'Other'`, text
   questions never reach the map — and `migrate:scrub-map-points` back-scrubs already-published points.
10. **Share links**: `robots.txt` now has `Disallow: /r/` and the `/r/` pages inject
    `<meta name="robots" content="noindex, nofollow">` (client-JS only — no `X-Robots-Tag` header, so
    robots.txt is the load-bearing control). A password **can no longer be removed** from a link
    (`SHARE_PASSWORD_REQUIRED` — replace or rotate). An operator bulk **revoke-legacy** switch exists
    (deliberately not automatic). Legacy links otherwise remain live — see gaps.
11. **Device storage**: the bootstrap moved to `FileSystem.cacheDirectory` (excluded from iCloud and
    Android backup; a startup migration removes the old Documents copy; sign-out clears every copy),
    and `android.allowBackup: false` landed in `app.json`. **allowBackup is native-build-contingent**
    (no effect via OTA), and on iOS, AsyncStorage — including the offline queue — is still backed up.
12. **Org-deletion completeness is retry-safe** (was B5 Exc 2): identity satellites are deleted before
    each Person, `personIds` derive from both Voter and Person rows, `PersonEditProposal` now carries a
    required `orgId`, and an exhaustive-sweep test covers every org-scoped collection. Pre-fix orphaned
    `PersonMergeLog` rows have no back-clean migration (see gaps).

## New policy sentences to keep true (the v3 watchlist)

The rewrite added hard, checkable claims. Any change touching these paths must re-verify them here:

- *"cannot open … without an individual, time-limited support-access grant"* — stated **absolutely**;
  true only while `requirePersonOrgGrant` + the `orgContext` vendor branch stay mounted. (The audit
  half is correctly hedged *"designed to be recorded."*)
- Geocodio: *"we send only the street address — never anyone's name."*
- Write-ins: *"only as the word 'Other,' never the typed text"* — `publicPointAnswer` + the scrub
  migration (run it in prod).
- *"an organization with an active subscription is never deleted for inactivity"* —
  `DORMANCY_PROTECTED_STATUSES`.
- The 60-day read-only export window — the `canceled` branch of `middleware/entitlement.js`.
- Backups *"up to 12 months"* — an **Atlas console setting, not code**; verify against the console.
- Geocode cache *"expire automatically after 18 months of disuse"* — the TTL index, inert until built.
- The 180-day name retention on deletion records — still cron-kept on the worker dyno.
- *(2026-07-17)* Do-not-contact enforcement: *"a flagged voter is excluded from walk-list exports
  and new surveys, and a fully-flagged door drops from every campaign type."* True only while the
  `KNOCKABLE_DOOR_FILTER` spread covers every knockable-door site, the export's live-state join
  stays in `walklists.js` export.csv, and the `DO_NOT_CONTACT` backstop stays mounted in
  `routes/mobile/canvass.js`. **The policy now names it** (privacy.html "Canvassing activity" —
  contact preferences: recorded with the reason, used to "exclude that person from the
  organization's future canvassing lists and exports") — that published sentence anchors here.
- *(v4 2026-07-17)* **Warnings-before-deletion is now a CHECKABLE claim.** Any future policy/DPA
  sentence of the form *"we notify you before scheduled deletion"* anchors here: true only while
  (a) `purgeWoundDownOrgs`/`purgeDormantOrgs` keep their never-delete-unwarned gates (marker +
  `deleteNotBefore`), (b) the markers are stamped ONLY on `sendMail(...).sent === true` or
  genuinely-zero recipients (`deliverWarning`), (c) the billing status chokepoint keeps clearing
  BOTH marker pairs, (d) activity-after-warning keeps voiding the dormancy marker, and *(e) 2026-07-18)*
  the console REFUSES to strip an org's LAST billing admin — so the genuinely-zero-recipients branch
  in (b) can only fire for an org **born** without admins, never one a console action emptied, keeping
  the never-delete-unwarned guarantee unvoidable. That last one closes the gap between (b) and
  reality: `services/mail/recipients.js` `billingNotifyEmails` draws warnings only from active
  `billingAccess` admins (else the billing contact of record), so an org left with zero would "warn"
  nobody yet still purge. `isLastBillingAdmin`/`strandsBilling` in `routes/admin/memberships.js`
  refuse all three console doors (PATCH strip / `deactivate` / DELETE) with `409 LAST_BILLING_ADMIN`,
  a post-write recount backstops the two-admin strip race, and `deleteAccount`'s pre-existing block
  covers account deletion — no super-admin bypass on any of them. Guard tests:
  `test/retentionWarnings.int.test.js` and `test/billingAccess.int.test.js` (the LAST_BILLING_ADMIN
  suite — every door refused on the last one, allowed once a second exists, ordinary members never
  blocked). Related checkables: reset tokens are stored
  sha256-hashed and single-use (`test/mailFlow.int.test.js`); **emails never contain passwords**
  (asserted over the outbox in `test/mailTriggers.int.test.js`); the silent campaignRoster
  auto-add never emails. *(2026-07-18: an internal **EmailLog** now records every send attempt —
  METADATA ONLY (kind, recipient addresses, subject, outcome, org/user ids + an org-name
  snapshot), never the body. New retention class: ordinary rows TTL out after
  `EMAIL_LOG_RETENTION_DAYS` (365); the two deletion-WARNING kinds are kept indefinitely as the
  evidence for this very watchlist entry, and deliberately survive the warned org's deletion.
  Super-admin-only surface (`/super-admin/emails`). Internal operational/security log — no
  published-policy sentence names it, and none becomes false by it; if a data-inventory is ever
  published, list it there.)* Mail is DORMANT until `RESEND_API_KEY` + `MAIL_FROM` are set — setting
  them is the DPA §6 subprocessor go-live and requires the DPA/policy edits + customer notice
  FIRST. *(Disclosure text landed 2026-07-17 — DPA §6 list + privacy.html service-providers
  paragraph + Last-updated bump, in the SAME commit as the mail code, so one deploy flips the
  published pages and the capability together; the env vars were pre-set in Heroku and are inert
  until that deploy. Customer §6 notice = owner, before deploying.)*

- *(v4 2026-07-20)* **New internal collection: `CoordinatorChange`.** Team attribution changed so
  that the **current** coordinator owns all of a canvasser's history — assigning or changing someone's
  coordinator now re-stamps `CanvassActivity.coordinatorId` / `SurveyResponse.coordinatorId` across
  that org. Because a by-team number can therefore move without a door being knocked, each change is
  recorded in `server/src/models/CoordinatorChange.js`.
  **What it holds:** `organizationId`, the subject's `userId`, `fromCoordinatorId` / `toCoordinatorId`,
  the acting `byUserId`, a `source` enum, the two row counts, and a `restampError` string. That is a
  **staff-to-staff org-chart association plus an actor id** — no voter data, no free text about any
  person, no contact details. It is a new **audit log**, which is a named trigger, hence this entry.
  **Who can read it:** nothing exposes it over the API today — it is written by the service layer and
  read from the console/DB. If a surface is ever added, it belongs behind org-admin auth and must be
  listed here.
  **Retention/deletion:** no TTL; deleted with the org — `CoordinatorChange` is in `ORG_SCOPED`
  (`services/platform/deleteOrganization.js`), which `test/orgDelete.int.test.js` proves exhaustive by
  seeding a stub row in every listed model. It is **not** campaign-scoped (it has no `campaignId`;
  coordinator is a per-org relationship).
  **Assessment: NO published-policy change.** Nothing leaves the tenant, no subprocessor receives it,
  no new category of personal data is collected about a *voter*, and it dies with the org. If a
  data-inventory is ever published, list it alongside `EmailLog` and `AccessLog` as an internal
  operational log. The claim to keep true if a policy sentence ever names staff audit trails:
  *deleted with the organization, no TTL, staff-only.*
  *[v4 2026-07-21: **CORRECTED — a crew is now PER-CAMPAIGN, and this collection IS campaign-scoped.**
  Two statements above are now false and stand as history. (a) *"re-stamps … across that org"* — the
  re-stamp is campaign-scoped. `restampFilter` (`services/memberships/restampCoordinator.js`) now
  **requires** a `campaignId` and throws without one (exercised: it raises `restampCoordinator:
  campaignId is required`), because an omitted scope silently meaning "everything" was the bug it was
  written to fix. The rule reads *the current coordinator owns all of that canvasser's history **in this
  campaign*** — changing a crew in one campaign moves zero ledger rows in another. (b) *"it has no
  `campaignId`; coordinator is a per-org relationship"* — it has one, and a coordinator is now a
  per-campaign relationship. `CoordinatorChange.campaignId` is nullable (`default: null`) and indexed
  `{campaignId, createdAt}`; **a null means "written under the old org-wide model"**, never "all
  campaigns". Add `campaignId` to the field list above — nothing else in that list changed. The crew
  itself moved off `Membership.coordinatorId` (unique `{userId, organizationId}` — one slot, so two
  leads reorganizing two campaigns overwrote each other) onto `CampaignAssignment.coordinatorId`
  (unique `{campaignId, userId}`), seeded by `migrate:campaign-coordinators`, which writes **zero**
  ledger rows.
  **This is a record-accuracy correction, not a privacy-affecting change.** No new personal data is
  collected — a `campaignId` is an internal reference to the tenant's own campaign, not data about a
  person. No new recipient, no subprocessor, no export, no new access path: re-grepped, still nothing
  reads `CoordinatorChange` over the API (the model, the two writing services, the migration/repair
  scripts and tests are its only references). No retention change either — it is still in `ORG_SCOPED`
  (`deleteOrganization.js`), still has no TTL, and `test/orgDelete.int.test.js` still proves the sweep
  exhaustive over that list. **The Assessment above stands unchanged.**
  **One wrinkle the new field introduces, stated rather than left to be found:** `CoordinatorChange` is
  *not* in `deleteCampaign.js`'s `CAMPAIGN_SCOPED` list, so deleting a campaign leaves its rows behind
  naming a campaign that no longer exists. No promise breaks — they stay org-scoped and staff-only, die
  with the org, and that cascade only ever runs on a never-walked campaign — but this is the row class
  to name if a customer-facing *"deleting a campaign removes…"* sentence is ever written.]*
- *(v4 2026-07-22)* **New field: `User.lastSeenAt`.** The All Users console's "Last active" column was
  derived from `CanvassActivity` — the last *door knocked* — so every admin, lead and staff account who
  never canvasses rendered the literal word "Never" beside "Last login: Just now". `requireAuth` now
  stamps a real last-activity timestamp. It is a **new behavioral signal about an identified staff or
  canvasser user**, which is a named trigger, hence this entry.
  **What it holds:** one `Date` per `User` — the approximate instant of that account's most recent
  authenticated API request, throttled to one write per ~15 minutes per user per process
  (`server/src/middleware/lastSeen.js`). No route, no IP, no user-agent, no device id, no location:
  the *when* only, never the *what* or the *where*. It is strictly coarser than data already held —
  every `CanvassActivity` row carries a precise timestamp *and* GPS.
  **Who can read it:** SUPER ADMINS ONLY, enforced by **omission at every layer**, deliberately. It is
  emitted by `GET /super-admin/users` (`routes/superAdmin/users.js`) and
  `services/platform/userOversight.js` and **nowhere else**. It is explicitly not in
  `User.toSafeJSON()` (which feeds `/auth/me`, login and mobile bootstrap) and not on
  `GET /admin/memberships`. That second omission is load-bearing: it is why the E-section finding
  that a customer admin who links an existing global account can see that person's `lastLoginAt`
  **does not widen** — a linked org still cannot see when that person was last online. The cost of
  the decision, recorded so it is not re-litigated: the org Users page's mislabeled "Recently active"
  sort could not be repointed at real activity and was renamed **"Recently signed in"** on both
  clients instead. Had this field reached org admins it **would** have needed new published-policy
  text — the Privacy Policy's admin-visibility sentence is scoped to *"activity at a door"*, and
  nothing tells a canvasser their employer can see when they last opened the app (see the open
  finding in *THINGS YOU DID NOT ASK ABOUT* (c)).
  **Retention/deletion:** no TTL. **Scrubbed on account deletion** — `services/users/deleteAccount.js`
  now nulls **both** `lastSeenAt` and `lastLoginAt` in the tombstone `$set`. That is a **change to
  previously documented behavior**: `lastLoginAt` used to survive, so see the v4 stamps in section A
  (the scrub-count table row, the scrubbed-field list, the not-touched list, and the A3 pseudonymity
  paragraph) and in *THE HONEST GAPS*. Asserted by `test/accountDeletion.int.test.js`. It survives an
  *org* deletion like the rest of the `User` row. `requireAuth` refuses a `deletedAt` user **before**
  the stamp runs, so a tombstone cannot be re-stamped by the deleted holder's still-valid 30-day token.
  **Assessment: NO published-policy change.** No new category of data about a *voter*; nothing leaves
  the tenant; no subprocessor receives it; no export, report or share link carries it. The Privacy
  Policy's *"information collected automatically"* paragraph already describes "the date and time of
  your request" as operational data, and the super-admin-only scope is what keeps this inside that
  purpose. On deletion this change **strictly reduces** what the tombstone retains. If a data
  inventory is ever published, list it alongside `EmailLog` and `AccessLog` as an internal operational
  signal. The claim to keep true: *a staff-visible last-activity timestamp, never exposed to the
  account's own organization, removed on account deletion.*
- *(v4 2026-07-24)* **Voter rows are now PER-CAMPAIGN** (unique `{campaignId, stateVoterId}`,
  was `{organizationId, stateVoterId}`) — the release that lets one org run two campaigns with
  overlapping voter files without the second import silently re-housing the first campaign's
  voters. Named triggers hit: **retention/deletion** (what a campaign delete removes changed) and,
  in the honest-audit sense, **what we hold** (the same person's identity fields can now exist as
  2+ sibling rows inside one org). Code-verified 2026-07-24; guard test
  `test/overlappingCampaigns.int.test.js` (10 cases) + `test/migrateVoterCampaigns.int.test.js`.
  **Duplication, not new collection:** a sibling row holds the same fields the org already held
  for that person, in the same tenant, sourced from that org's own uploads. No new data category,
  no new audience (org admins already saw the person org-wide), no new recipient or subprocessor,
  no new export. The org-wide promises stay org-wide by construction: `doNotContact` writers now
  write by `{organizationId, stateVoterId}` so every sibling flips together, and imports SEED the
  flag onto a new campaign's copy of an already-flagged person (`$setOnInsert`, original
  attribution kept, upload-undo still reverts seeded copies). `surveyStatus` became per-campaign —
  that is a *narrowing* of cross-campaign visibility, not a widening.
  **Campaign deletion (never-walked campaigns only, as before):** now removes exactly that
  campaign's voter rows; a person shared with a sibling campaign survives there. Two org-level
  facts are handled explicitly rather than lost: (1) a flagged person losing their LAST row is
  parked as a **`DncPendingId`** carrying the flag's original attribution — `uploadId` (nullable
  now; null = admin-set) **and the admin's free-text `reason`** — so a later import re-flags them.
  That is personal data (a stateVoterId + a sentence about a person) deliberately outliving the
  row it described, purpose-limited to honoring the person's own opt-out; it dies on graduation,
  on its upload's undo, or with the org. (2) org-level `VoterNote`s re-point to a surviving
  sibling row and are deleted with the person's last row — closing a pre-existing orphan (they
  used to survive a campaign delete keyed to a dead voterId).
  **Gap CLOSED, found during this work:** `DncPendingId` and `DncUpload` were **missing from
  `deleteOrganization.js`'s `ORG_SCOPED` sweep** — org deletion left behind DNC upload records
  and pending stateVoterIds (personal identifiers) indefinitely. Both models are now in the list,
  and `test/orgDelete.int.test.js`'s exhaustive-sweep proof covers them.
  **Ops note:** the release ships with `migrate:voter-campaigns` (backfill + unique-index swap;
  imports refuse to run until it has), then `migrate:build-indexes --apply` — see OPERATIONS.md.
  Platform marketing counters (`votersProcessed`) switched from rows to **distinct people** so
  the duplication cannot inflate published numbers.
  **Assessment: NO published-policy change.** The Privacy Policy describes voter data as
  customer-supplied and org-scoped; per-campaign rows change internal structure, not what is
  collected, who sees it, how long it is kept, or who it is shared with. The B5 org-deletion
  narrative is *more* true than before (two survivor classes eliminated). Claims to keep true:
  *deleting a campaign removes only that campaign's copies; "do not contact" survives any
  campaign delete; org deletion sweeps DNC uploads and pendings with everything else.*

## Remaining honest gaps (v3) — supersedes the v2 list

1. **Voter-facing rights: PARTIALLY closed (2026-07-17).** An **admin-operated do-not-contact
   mechanism now exists**: `Voter.doNotContact` (org-wide, reasoned, audited via VoterNote),
   `Household.fullyDnc` door suppression through the shared `KNOCKABLE_DOOR_FILTER`, exclusion
   from walk-list voter sets and CSV exports (live-checked at export, so pre-flag frozen lists
   comply), a canvasser-facing badge + disabled survey, a server `DO_NOT_CONTACT` 403 backstop,
   and a bulk-list upload with per-upload undo (`routes/admin/dnc.js`). What remains open — and
   still the largest gap: the mechanism is **admin-operated, not voter-initiated**. A voter still
   has no account, no access/correction/deletion route; a DSAR is still a manual process that an
   admin tools through the console. The flag is per-org (dies with the org's data — a
   platform-sticky DNC would be a new cross-org retention promise; deliberately out).
2. **Grants are self-issued.** No approver; `break_glass` can list all live grants (visibility, not
   approval). The policy carefully does not claim otherwise — keep it that way. *[v4 2026-07-17:
   narrowed — customers are now NOTIFIED automatically on every new grant (see E12 stamp). The
   no-approver half stands; do not write "approved."]*
3. **The audit log is request-level.** No record ids; *"was MY record accessed?"* is unanswerable. The
   staff-facing strings ("every record you open is logged") still overstate granularity.
   *[v4 2026-07-19: **NARROWED — record-level for what matters.** AccessLog rows now carry
   `subjects` (voter/person/household/user ids) for SINGLE-RECORD opens/writes and for EXPORTS
   (the exact id set written to the file, capped with an honest truncation marker). Captured via
   `router.param` hooks (voters/households/mobile/reports) + the walk-list export + the person
   console's direct calls; queryable via `GET /super-admin/access/log?subjectId=` and — customer-
   facing — `GET /admin/voters/:voterId/staff-access`, a panel on the voter profile answering
   "was this record accessed by Doorline?" with date/staff-first-name/reason/export-flag.
   Honest scope, stated everywhere: LIST/BROWSE stays request-level (a directory page listing
   200 names is one browse, not 200 record accesses), and rows before 2026-07-19 are request-
   level history. Guard tests: `test/accessLogCoverage.int.test.js` (record-level section).]*
   *[v4 2026-07-22: **GAP CLOSED — the turf-cutting door drill.** The hook list above
   (voters/households/mobile/reports) missed one: `routes/admin/turfs.js` served
   `GET /admin/campaigns/:campaignId/turfs/household/:householdId` — a single-record open
   returning a door's address plus its members' names and party — with **no `router.param`
   hook**, so a staff read under a grant logged the request but not WHICH door. Surfaced while
   building the cut-map status redesign; the same hook the households router uses is now
   registered there. Covered by a new case in `test/accessLogCoverage.int.test.js`
   ("the turf-cutting door drill carries the household as its subject"). This makes an existing
   exposure auditable — it is **not** a new exposure and needs no Privacy Policy / ToS / DPA
   edit. The same page's round detail (status, who knocked it, when, survey answers) is served
   by the already-hooked `/admin/households/:householdId/{activity,surveys}`, reached by the
   same roles (org admin + a lead who manages that campaign) that already reach the page — no
   route widened, no role granted anything new.]*
4. **The cross-org password-reset path is unprevented by decision** (v1 F14 Exc 3): an admin of any org
   a user belongs to can reset that user's global password. Mitigation: the reset issues a visible
   forced-change temp password. Rationale recorded at `memberships.js:423-432` (admin reset is the only
   recovery mechanism; email changes are multi-org-locked, passwords are not). Closing it needs per-org
   credentials or self-serve email reset.
5. **Legacy share links stay live until an operator runs the revoke-legacy switch** — but
   **operator-attested 2026-07-16: no legacy links exist in production** (every live link post-dates
   the hardening), so this gap is currently empty; it matters again only if that attestation ages
   (the dry-run `revoke-legacy` call is the one-query way to re-verify). Residual warts that remain
   in code: the "the migration" comments in `share.js` / `ReportShareLink.js` still name a migration
   that does not exist (the switch is the real control); the bulk revoke skips per-campaign
   `manages()`, so a lead can revoke legacy links on campaigns they do not manage; and the unlock-JWT
   is never re-checked after a password change (≤24h residual access).
6. **The offline queue**: no TTL, no cap, survives sign-out, and 4xx-failed items are still silently
   dropped (account deletion now flushes the queue first, closing the billable-knock loss). On iOS it
   rides device backups.
7. **The nightly purge loops have no per-org error isolation** — one throwing org halts that night's
   wind-down, dormancy, and deletion-request sweeps (the run receipt is at least honestly red now).
8. **Retention crons carry no `tz`** — 03:17/04:41 are UTC only because Heroku dynos default to UTC.
9. **Deploy status — operator-attested 2026-07-16: the release is deployed, the migrations have been
   run** (`migrate:persons-org-scope`, `migrate:build-indexes`, `migrate:geocode-lastused`,
   `migrate:scrub-map-points`), **and the rewritten policy/ToS pages are live.** One residual:
   `android.allowBackup: false` sits in `mobile/app.json:21` on this branch but is **native config** —
   it exists only in binaries built after it landed (it changes the EAS fingerprint;
   `eas fingerprint:compare` answers which installed builds carry it). A bare `buildIndexes` dry run
   remains the one-command way to re-verify prod indexes at any time.
10. **GridFS raw-upload deletes are still swallowed** (`rawImportStore.js` `.catch(() => {})`) and are
    now unrecoverable on a retried org deletion (the jobIds that locate them are destroyed in the same
    cascade); `deleteOrganization` still runs in no transaction. Pre-fix orphaned `PersonMergeLog`
    snapshots have no back-clean.
11. **The Help Center has zero articles on staff/support access** — end users cannot read in-product
    what the policy now promises. (A transparency gap, not a false sentence.)

---

# COUNSEL BRIEF v2 — post-remediation, verified against the fixed tree

> **[v3 — 2026-07-16]** v2 is itself now partially historical. Its gap list: **8 is resolved** (the
> policy rewrite shipped; `PrivacyPolicyPage.jsx` no longer exists), **7 is narrowed** (noindex +
> robots landed; links still live until the operator revoke), and **2's dormancy risk is shielded**
> (paying orgs are no longer eligible) though the no-warning fact stands. Where v2 and v3 differ, v3
> governs.

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
an audit log."*

*[v4 2026-07-29: **still true, and one new staff capability to disclose.** `POST /super-admin/users/:userId/resend-invite`
lets any super admin re-send a set-password invite into an org they are not a member of — the recovery path for a
provisioned client whose 72h temp password lapsed. It reads no voter data and exposes nothing: it emails the address
already on the account a link to set **their own** password, so staff never learn a credential and cannot sign in as
them. It is recorded in `EmailLog` (kind, recipient, organizationId, userId, timestamp), visible at super-admin →
Emails. It is **not** a weakening of `VENDOR_READ_ONLY`: that guard still blocks every write through the customer-facing
`/admin` router, including the sibling action — setting a temporary password — which is deliberately NOT offered to
staff, because there the operator chooses the secret and could then impersonate the customer's user.]* Every bypass v1 found is closed: the identity-console triage lists are now grant-gated and
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
every new guard; the guards bite only vendors (grant-holders). *[v4 2026-07-17: self-serve reset now
EXISTS (`POST /auth/forgot-password` + `/auth/reset-password`, email-tokened, sha256-stored,
single-use); the multi-org admin-reset guard remains out by owner decision — the historical
reasoning above no longer blocks it, see `memberships.js` comment.]* *(Separately, the dev-only
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
   within…"*, never *"is deleted after…"*. *[v4 2026-07-17: the "never warned" half is superseded —
   wind-down and dormancy purges now REQUIRE a delivery-verified warning email
   (`warnWindDownOrgs`/`warnDormantOrgs` + the never-delete-unwarned purge gates,
   `services/retention/triggers.js`; guard test `test/retentionWarnings.int.test.js`). The
   "aim to delete, not is deleted" advisory stands — timing is still cron-kept.]*
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
   fully close. *[v4 2026-07-17: email now exists and self-serve reset shipped; the admin-reset
   guard stays out by owner decision (a locked-out user can now rescue themselves, so the
   trade-off changed but the owner kept admin resets unrestricted). Item 14 remains
   open-by-decision.]*
6. **The audit write is best-effort.** See the carve-out above.
7. **Legacy `/r/` report links** created before the password/expiry change remain open and non-expiring
   until an operator revokes them (now at least `noindex` + robots-disallowed).
8. **The currently-published `PrivacyPolicyPage.jsx` still contains statements this brief shows are false**
   (notably "no third-party analytics/tracking" and the aggregate-only report description). It was left
   **untouched by instruction** — correcting it is the policy-rewrite pass, not this code remediation.
   *[v3: the rewrite pass happened — the page was deleted and replaced by `client/public/privacy.html`,
   whose sentences re-verify against the code. Resolved.]*

---

# COUNSEL BRIEF v1 — Doorline (pre-remediation; retained for detail)

**Prepared for:** counsel drafting a Privacy Policy and Terms of Service
**Basis:** the source tree at `/Users/omarzumaya/Desktop/canvass-app`, branch `sharedVoters`, as shipped. Read-only inspection. No code executed, no production database queried, no network traffic observed.
**Standard applied:** I state only what the code does. Where I inferred, I say so. Where I could not confirm, I say "COULD NOT DETERMINE" rather than round up. **Code comments are not evidence** — several comments in this codebase assert controls that the code does not implement, and I flag each one, because a comment is exactly the sort of thing that ends up in a privacy policy.

**Read this first.** The single most dangerous sentence you could write is: *"Doorline personnel access customer data only under a time-limited, logged support grant, and every access is recorded."* It is the sentence this remediation release appears designed to enable. **It is false in four independent ways.** See E13. Do not write it in any form until engineering closes `/super-admin/persons`.

> **[v3 — 2026-07-16: engineering closed it.]** `/super-admin/persons` is break-glass + per-org-grant
> gated and every route writes an AccessLog row; the audit is fail-closed; the self-mint is blocked
> (see the E13 stamps below). The published policy now states the grant requirement absolutely and
> hedges the logging as *"designed to be recorded"* — the correct form, since the audit write remains
> best-effort and request-level (E12's granularity caveat still applies).

---

# A — ACCOUNT DELETION (an individual user of the product: admin, team lead, or canvasser)

## A1. What actually happens when a user deletes their account?

**VERIFIED.**

Deletion is reachable from exactly two code paths and no others (`deleteAccount()` has two call sites repo-wide):

*[v4 2026-07-29: **SUPERSEDED — there are now THREE.** A break-glass super-admin can delete an account from the web console: `DELETE /super-admin/users/:userId` (`routes/superAdmin/users.js`), which calls the identical `deleteAccount()` service with `reason: 'super_admin'`. It requires the target's email typed back (`confirmEmail`, the analogue of the org-delete `confirmSlug`, and the same string the CLI takes), enforces **every** existing blocker with no force flag, and is preceded by a `GET /:userId/deletion-check` preflight. Support-tier staff are refused (`BREAK_GLASS_REQUIRED`). Unlike the two paths below, this one is **attributable**: `DeletedUserRecord` now carries `reason` and `deletedBy`, which the 180-day purge deliberately does not scrub because they describe the ACTOR, not the subject.]*

1. **In-app, mobile only, password re-authenticated.** `DELETE /auth/account` (`server/src/routes/auth.js:235`) requires the caller's current password (schema `auth.js:37-39`; bcrypt-verified via `server/src/models/User.js:62-64`; 401 on mismatch). The only UI entry point is mobile Profile → Delete account (`mobile/app/(app)/profile.jsx:316` → `mobile/components/DeleteAccountSheet.jsx:80`). **Note:** the HTTP route itself is gated only by `requireAuth`, so the *interface* is mobile-only, not the *endpoint*.
2. **Operator CLI**, for people who have uninstalled the app and email in: `npm run delete:account <email> --apply` (`server/src/utils/deleteAccountByEmail.js:86`). It calls the identical service. **It performs no identity verification in code** — it takes an email and a flag. "VERIFY THE REQUEST FIRST" (`deleteAccountByEmail.js:24`) is a comment instructing a human, not an enforced control.

The web console has **no** in-product deletion. `client/src/pages/DeleteAccountPage.jsx` is a static instructions page (public route, `client/src/App.jsx:95`) with zero API calls. *[v4 2026-07-29: **FALSE as of the console delete.** The public `/delete-account` page is still static instructions — that sentence holds — but `SuperAdminUserDetailPage.jsx` now carries a break-glass danger panel that calls the endpoint above. There is still **no self-service deletion on web**: a user cannot delete their own account there, only staff can delete someone else's.]*

**The deletion itself (`server/src/services/users/deleteAccount.js:175-239`), in order:**

| Step | What it does | Line |
|---|---|---|
| 1 | Writes a **new record containing the user's identity** — `DeletedUserRecord` with firstName, lastName, email, phone, userId, organizationIds[], deletedAt, retentionUntil | `:190-204` |
| 2 | `releaseAssignedWork()` — hard-deletes, across **all orgs and all campaigns**, every `TurfAssignment`, `EffortMember`, `CampaignAssignment`, `CampaignManager` row **where the deleted user is the assignee**; nulls `Membership.coordinatorId` on anyone they supervised | `:212`, `:268`, `:274-286` *[v4 2026-07-21: line drift only — now `:285-290`]* |
| 3 | `Membership.updateMany({userId}, {$set:{isActive:false}})` — memberships are **retained**, only deactivated | `:217` |
| 4 | One `User.updateOne $set` overwriting exactly 11 fields *[v4 2026-07-22: now **13** — `lastLoginAt` and `lastSeenAt` joined the scrub]* | `:219-236` *[v4 2026-07-22: line drift — the block is `:224-248`]* |

**The 11 scrubbed fields:** `firstName → 'Deleted'`, `lastName → 'user'`, `email → deleted+<userId>@deleted.doorline.invalid`, `phone → null`, `passwordHash → a fresh random unusable bcrypt hash` (not null — the field is `required`), `isActive → false`, `deletedAt → now`, `mustChangePassword → false`, `tempPasswordSetAt → null`, `passwordResetToken → null`, `passwordResetExpiresAt → null`. *[v4 2026-07-22: **13 fields.** Add `lastLoginAt → null` and `lastSeenAt → null` — a tombstone no longer carries either activity clock.]*

**The User row is never deleted.** It is tombstoned in place. Fields explicitly NOT touched and therefore persisting indefinitely: `_id`, `createdAt`, `updatedAt`, **`lastLoginAt`**, `isSuperAdmin`, `platformRole`, `deletionLocked`. *[v4 2026-07-22: **CORRECTED — `lastLoginAt` is now SCRUBBED.** The sentence above stands as history. The not-touched set is now `_id`, `createdAt`, `updatedAt`, `isSuperAdmin`, `platformRole`, `deletionLocked`. The new `User.lastSeenAt` is scrubbed alongside it and never joins that list. Rationale: the tombstone exists so the org's field records stay attributable to a stable id — a rolling "when were they last online" adds nothing to that and only a re-identification hint about someone who asked to be forgotten. Asserted by `test/accountDeletion.int.test.js`.]*

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
>
> *[v4 2026-07-21: **the supervision half is now WIDER than this describes, because the coordinator reset went inert.** A crew moved off `Membership.coordinatorId` onto `CampaignAssignment.coordinatorId` (per campaign), and knock time reads **only** the latter (`routes/mobile/canvass.js` `coordinatorForWrite`, which applies no active/not-deleted check). `releaseAssignedWork` still nulls only the `Membership` field — nothing anywhere clears `CampaignAssignment.coordinatorId` when a coordinator departs (grepped every `coordinatorId: null` write in `server/src`: the departure reset at `deleteAccount.js:287` targets `Membership` only). So after deletion the departed coordinator is **still the crew of record** on every campaign roster row naming them, and each NEW knock their former reports record freezes the deleted user's id onto a fresh ledger row — the retained supervision link keeps GROWING rather than stopping at deletion. The `Write:` text above survives this ("records of field work performed by people you supervised are retained"), so **no published sentence becomes false** and no new data is collected — but `deleteAccount.js:284`'s stated intent, *"a coordinator who leaves the ORG must not keep supervising anybody"*, is no longer enforced by the code beneath it. **Escalate to engineering** as a correctness bug, not a disclosure one.]*

## A2. How long do you keep a deleted user's name, email and phone — and what erases them?

**PARTIAL.** The window is real. The erasure is **scheduled, not guaranteed**, and the record is **anonymized, not deleted**.

- The snapshot is stamped `retentionUntil = deletion time + DELETED_IDENTITY_RETENTION_DAYS` — **default 180 days, environment-configurable** (`deleteAccount.js:25`, `:190`). The 180-day figure is disclosed to the user in the deletion sheet (`server/src/routes/auth.js:219`).
- **`retentionUntil` is inert data.** Nothing fires at that timestamp. Erasure happens only when a daily BullMQ cron job runs on the worker dyno: `RETENTION_CRON`, default `'17 3 * * *'` (`server/src/services/retention/scheduler.js:16`), registered at `server/src/worker.js:46` and consumed at `:57`. The Procfile declares a `worker` process.
- **The purge blanks four fields; it does not delete the row.** `DeletedUserRecord.updateMany({retentionUntil: {$lte: now}, purgedAt: null}, {$set: {firstName:'', lastName:'', email:'', phone:null, purgedAt}})` (`server/src/services/retention/purgeDeletedIdentities.js:29`, `:34-37`). Surviving after the purge: `userId`, `organizationIds[]`, `deletedAt`, `retentionUntil`, `purgedAt`, `createdAt`, `updatedAt` (`server/src/models/DeletedUserRecord.js:22-48`). *[v4 2026-07-29: **two fields added to that survivor list** — `reason` (`'self' | 'operator' | 'super_admin'`) and `deletedBy` (the acting staff user, null for a self-deletion). They are deliberately NOT scrubbed by the purge: they describe **who ordered the deletion**, not the person deleted, so a staff-initiated destruction stays answerable after the subject's name is gone. Retaining "an operator did this on this date" is the opposite of a privacy problem — the alternative was an irreversible deletion of a customer's account with nothing whatsoever on record. Note this makes the adjacent `reason` claim real: it was a parameter of `deleteAccount()` that was destructured and then never referenced, so both callers passed a value into a void.]*
- **No TTL index exists anywhere in the codebase.** I grepped `expireAfterSeconds` / `expires:` across all of `server/src`: **zero hits.** There is no database-level expiry on any collection. *[v3: one TTL index now exists — GeocodeCache's 18-month disuse expiry (F7). Still none on any identity or ledger collection; this section's conclusion stands for `DeletedUserRecord`.]*

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
- The tombstoned `User` document itself still exists, carrying `_id`, `createdAt`, `lastLoginAt`, `deletedAt` — and an email that **embeds the user id**: `deleted+<userId>@deleted.doorline.invalid` *[v4 2026-07-22: `lastLoginAt` is no longer among them, nor is the new `lastSeenAt` — both are scrubbed. **The pseudonymity finding is unchanged and never depended on that field**: the tombstone still carries `_id`, `createdAt` and `deletedAt` plus an id-embedding email, and every field record still points at that id. Removing an activity clock removes a re-identification hint, not the identifier.]*

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

**Exportable.** An org admin **or a team lead** can download that restored name and email in a CSV file that then lives outside the application entirely (`GET /admin/reports/canvassers.csv`, `reports.js:2267`). Once downloaded, it is beyond the reach of any purge. *(The phone column is always blank for a deleted user — the CSV requests `phone` but the hydrator never reads the snapshot's phone field.)*

**Records with no retention limit at all (VERIFIED):**

- **`AccessLog`** — contains no data about deleted canvassers or customer users. Its `actorUserId` is always Doorline platform staff. It records method, the **route template** (deliberately not the filled path, so no voter ids land in it), a resource class, organizationId, grantId and a timestamp (`server/src/models/AccessLog.js:15-48`). **It is append-only. There is no purge, no TTL, no retention job for it anywhere.** It is also **not** in `ORG_SCOPED` (`deleteOrganization.js:44-51`), so `AccessLog` and `SupportAccessGrant` rows **survive the hard deletion of the customer organization they refer to.** *[v3.1 2026-07-17: still true, and now deliberate-and-visible rather than accidental — the console shows the log's total row count and oldest entry (`GET /log-facets`), and the per-request `rows`/`bytes` magnitude now surfaces in the UI.]*

  > **[v3.1 2026-07-17 — RESOLVED AS A DELIBERATE, OWNER-AFFIRMED DECISION: access logs are kept
  > forever. This is no longer an open gap.]** The owner considered a retention window and rejected
  > it as policy-contradicting: `privacy.html` states access records *"are retained"* and names them
  > as *"the evidence that our controls operated"* — an explicit carve-out that survives customer
  > deletion — and `DPA.md` §Security commits not to *"materially decrease the overall protection."*
  > Deleting audit rows would arguably breach both. Capacity was checked and is a non-issue: the log
  > grows one row per staff request under a support grant (bounded by support burden, never tenant
  > traffic); a "collection is getting big" justification would be untrue. The model carries a
  > matching do-not-add-a-TTL comment. Revisiting this requires an owner decision AND owner edits to
  > `privacy.html` (two sentences) and `DPA.md` §9 — never a code-only change.
- **`RetentionRun`** — one row per purge run: job name, startedAt, finishedAt, ok, purged count, scanned count, error string (`models/RetentionRun.js:20-32`). No user identity. Retained indefinitely. *Note the `error` field is unbounded free text captured from a thrown exception (`purgeDeletedIdentities.js:49`), so an identifier appearing there cannot be categorically ruled out.*

**Backups — see "THINGS YOU DID NOT ASK ABOUT," item 4.** This is a material residual-copy problem and it is not in Atlas.

---

# B — ORGANIZATION DELETION AND RETENTION

## B5. When a customer organization is deleted, what is actually deleted — and what survives?

**VERIFIED, with two material exceptions.**

`deleteOrganization()` hard-deletes rows from **31 org-scoped collections** via `deleteMany({organizationId})` (`server/src/services/platform/deleteOrganization.js:45-52`, sweep at `:102-105`). The list includes `Voter`, `Household`, `CanvassActivity`, `SurveyResponse`, `VoterNote`, `FlagReview`, `HouseholdLocationChange`, `TurfAssignment`, `ImportJob`, `Turf`, `Pass`, `Effort`, `ClientReport`, `ClientReportMapPoint`, `ReportShareLink`, `Membership`, `Statement`, `Subscription`, `SubscriptionEvent`, `SavedSearch`, `SurveyTemplate`, `Tag`, `VotedVoter`. **Persons are deleted unconditionally** (`:118-131`). The **original uploaded CSV/XLSX** is deleted from GridFS **before** the ImportJob rows that name it (`:84-85`). Then the Organization itself (`:133`).

**Contrary to what a lawyer might assume: there is no invoice retention.** `Membership`, `Subscription`, `SubscriptionEvent`, `Statement` and `ReportShareLink` are all in `ORG_SCOPED` and are destroyed.

> **[v4 update — Jul 2026.] The earlier claim that "there is no `Invoice` collection anywhere in the codebase" is no longer literally true, but the conclusion is unchanged.** A `Statement` model now exists (`server/src/models/Statement.js`): a frozen copy of a month's billing figures, written only when an account manager explicitly issues one, so that renegotiating a rate or reactivating a campaign can't silently rewrite what was already invoiced. Two things keep this section accurate:
>
> - **It holds no personal data.** Campaign names, door/knock counts, dates and dollar amounts — no voter, household, or contact information of any kind (`models/Statement.js` field list).
> - **It is deleted with the organization**, by owner decision, exactly like `Subscription` and `SubscriptionEvent`. Asserted in `server/test/statement.int.test.js` ("deleting an organization takes its statements with it") and swept by `orgDelete.int.test.js`, which iterates `ORG_SCOPED`.
>
> **No Privacy Policy, ToS, or DPA text changes as a result** — nothing new is collected, retained longer, shared, or exposed. Un-issued months are still computed on the fly from `Campaign` + `CanvassActivity`, both of which are deleted. `models/Subscription.js:3-5` still confirms invoices are sent out-of-band.
>
> **Watchlist:** if statements are ever made to *survive* organization deletion — a legitimate thing a business might want for tax or dispute purposes — that **is** a retention change and requires editing the Privacy Policy's retention section and `docs/DPA.md` **before** it ships.

> **Do NOT write:** *"We retain billing and tax records for [N] years."* on the strength of this application. Nothing in this codebase preserves them. If the business retains them, that happens outside this system.

### EXCEPTION 1 — Household street addresses survive organization deletion, permanently. **VERIFIED.**

> **[v3: fixed in code, contingent in prod.]** A `lastUsedAt` TTL (540 days) now expires disused
> entries, with `migrate:geocode-lastused` backfilling old rows — inert until
> `migrate:build-indexes --apply` runs in production. The no-org-attribution point below still stands
> for entries while they live, and the policy now discloses the cache (18-month expiry) instead of
> promising total deletion.

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
| **`User` accounts** | name, email, phone, bcrypt hash, `lastLoginAt` *[v4 2026-07-22: add `lastSeenAt` — a `User` surviving an **org** deletion now also carries a rolling last-activity clock. **Account** deletion scrubs both clocks; org deletion scrubs neither, by design.]* | Deliberate: *"global identities are kept even when this was their only org"* (`deleteOrganization.js:59-62`). Only `Membership` rows are removed. |
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

> **[v3: shielded.]** `DORMANCY_PROTECTED_STATUSES` = {active, trial, past_due, internal}
> (`triggers.js:92`) — only canceled/suspended orgs are dormancy-eligible, and an org with **no**
> Subscription record is protected, not deleted. The default window is now **30 months**
> (`RETENTION_DORMANCY_MONTHS`). **Points 1 and 3 below are superseded** (the shield; and the window
> math — note the same imprecision survives: 30 × 30-day months = **900 days ≈ 29.6 calendar
> months**, so keep the policy's "approximately"). Point 2 (canvassing-only clock) remains true.
> Point 4 is **superseded (v4 2026-07-17)**: a warning email now precedes dormancy deletion and the
> purge is GATED on its verified delivery (`dormancyWarnedAt`/`dormancyDeleteNotBefore` markers;
> activity after the warning voids it — exactly what the email promises).

`purgeDormantOrgs` (`triggers.js:78-102`) scans **every** organization and hard-deletes those with no `CanvassActivity` newer than the cutoff.

1. **It does not check whether the customer is paying.** The only exemption is `Subscription.status === 'internal'` — Doorline's own demo orgs (`:36-39`, `:84`). An organization with an **`active`, fully-paid subscription** is fully eligible for deletion. `Organization` has no exempt/lock field.
2. **The clock is canvassing activity ONLY.** `CanvassActivity.findOne({organizationId}).sort({timestamp:-1})` is the only activity query in the function (`:85-87`). **A login, a voter-file import, a turf cut, a report view, a survey edit, or a subscription payment does NOT reset the clock.** An org that has never canvassed is measured from `Organization.createdAt` (`:90`).
3. **The window is 720 days, not 24 months.** `DORMANCY_MONTHS * 30 * DAY` (`:79`) = 720 days ≈ 23.7 calendar months. A policy saying "24 months" over-promises by ~11 days **in the direction of deleting earlier than stated.**
4. **NO WARNING IS SENT.** The file comment says dormancy happens *"after a warning"* (`triggers.js:16`). **There is no warning mechanism anywhere.** Due orgs are identified and deleted in the same pass, with no notice, no grace flag, no pre-deletion state. **The server has no email or SMS capability at all** — `server/package.json` declares no mailer dependency (no nodemailer, sendgrid, postmark, ses, resend, mailgun, twilio). *[v4 2026-07-17: superseded. `services/mail/` sends via the Resend REST API (global fetch — still no mailer npm dependency, so the package.json sweep stays literally true while its conclusion flips). `warnDormantOrgs` emails ~`RETENTION_WARN_LEAD_DAYS` ahead; the purge refuses any org without a delivery-verified `dormancyWarnedAt` marker and before its persisted `dormancyDeleteNotBefore`.]*

> **Do NOT write:** *"We retain your data for as long as your account is active."* The dormancy trigger **contradicts this**: a current, paying customer is deleted after 720 days without a recorded knock. *[v3: superseded — the shield makes this sentence TRUE for active-subscription orgs, and the policy now says exactly that (an active-subscription organization "is never deleted for inactivity"). The two advisories below still stand: no notice capability exists, and say "approximately" on the window.]*
> **Do NOT write:** *"We will notify you before deleting a dormant account,"* or *"after notice."* Nothing in the application sends anything. *[v4 2026-07-17: FLIPPED — once mail is live (RESEND_API_KEY + MAIL_FROM set, DPA §6 notice done) this sentence becomes safe to write, and stronger: the code cannot dormancy- or wind-down-delete an unwarned org at all. Until the vars are set, warnings are attempted-and-logged only, and no purge fires — the fail state is "data kept too long," never "deleted unwarned."]*
> **Do NOT write:** *"no door-knocking activity for 24 months."* The correct phrase is *"no canvassing activity recorded for approximately 24 months."* (And note: `POST /admin/turfs/restrict-bulk` writes `CanvassActivity` rows from the **web admin console** with no door knocked — `server/src/routes/admin/turfs.js:695`, insert at `:779` — and those rows reset the dormancy clock, because the trigger filters on `organizationId` alone.)

### Trigger 3 — DELETE-ON-REQUEST. **VERIFIED: THE EXECUTOR EXISTS; THE INTAKE DOES NOT.**

> **[v3: the intake exists.]** Operator CLI `request:org-deletion` (dry-run by default) and a
> super-admin API (`POST/GET /super-admin/access/deletion-requests` + a `/cancel` route), both through
> a shared producer with a 30-day SLA and one-open-request-per-org dedup. The policy's *"we aim to
> complete verified deletion requests within 30 days"* is now backable.
>
> **[v3.1 2026-07-17: the intake has an operator UI.]** The Support access page now lists deletion
> requests (paged, status-filterable, with **overdue** flagged per row when a `scheduled` request is
> past its own `scheduledFor`), files one (org + requester email + note), and cancels a scheduled one
> — no more endpoints-only. The Control Room's ops-health strip surfaces the scheduled count and a
> "need a human" count (stuck + failed) at a glance. No policy sentence changes: this is the same
> subsystem gaining a surface.

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

**Two more facts about the receipts, relevant if you promise a deadline:** *[v3: the first is fixed —
per-request try/catch keeps a failed request `scheduled` for retry (≤5 attempts,
`RETENTION_DELETE_MAX_ATTEMPTS`), then flips it to a terminal `failed` that turns the health surface
red; never a green receipt. The second (no per-org isolation in the two org-purge loops) is still
true.]*
- A **failed** deletion request produces a **green** `RetentionRun` receipt. `executeDueDeletionRequests` catches per-org failures, marks the request `status: 'failed'`, and **returns normally** (`triggers.js:121-136`), so `runRetentionTriggers` stamps `ok: true` (`:164-167`). The due-query filters `status: 'scheduled'` (`:113`), so a `'failed'` request is **never picked up again by any code path**. It is permanently dropped behind a successful-looking receipt and a green health banner (`purgeDeletedIdentities.js:68`; `routes/superAdmin/access.js:149-159`).
- `purgeWoundDownOrgs` has **no per-org error isolation** (`triggers.js:64-68`) and the three triggers run sequentially in one function (`:157-159`), so a single throwing organization aborts the whole nightly sweep.

## B7. During the 60-day wind-down, can the customer access or export their own data?

> **[v3: fixed — YES, self-serve.]** `canceled` is now genuinely read-only: `middleware/entitlement.js`
> passes every non-write method before any status check maps to a 402, so GETs — the export endpoints
> included — succeed during wind-down, and the 402 on writes carries the message *"Your data is
> read-only and available to export during the wind-down period."* Share links still die (410), and
> the mobile offline-queue grace accepts only submissions stamped before `statusChangedAt`. The
> MOBILE-CACHE paragraph below (voter data persisting on canvasser devices) still stands.

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

**Exactly five server-side CSV endpoints exist, all under `/admin`:**

| Endpoint | Contents | Gate |
|---|---|---|
| `GET /admin/campaigns/:id/walklists/:id/export.csv` (`server/src/routes/admin/walklists.js:254`) | **Voter ID, First Name, Last Name, Party, Age (derived from DOB), Phone, Precinct, Address, City, State, ZIP** — one row per voter (`headers :275`, projections `:266`, `:270`) | admin **or lead** (`walklists.js:19`) |
| `GET /admin/reports/canvassers.csv` (`reports.js:2267`) | Per-canvasser **First name, Last name, Email, Phone, Status** + aggregate counts. **Restores deleted users' names and emails** (A4). | admin or lead (`reports.js:37`) |
| `GET /admin/reports/canvassers/:userId/export.csv` (`reports.js:3383`) | **Timestamp, Action, Address, City, State, Zip, Voter name, Party, Latitude, Longitude, GPS Accuracy, Distance from house, Offline flag, free-text Note** (`headers :3406-3410`) | admin or lead |
| `GET /admin/reports/voters-by-answer.csv` (`reports.js:1303`) | The survey **answer drill-in** export ("everyone who answered X", optionally one canvasser's entries, or a tag): per response — **Submitted timestamp (ISO + campaign-tz date/time), Voter name, Party, Address, City, State, Zip, Canvasser first/last name, the drilled Question/Answer snapshots, the response's free-text Note, offline flag, response id** (`headers :1353-1358`). Capped at **50,000 rows** (`EXPORT_CAP`, `:1309`); no pagination. | admin or lead (`reports.js:37`); a lead additionally **must pass a `campaignId` they manage** (the reports-router scope middleware, `reports.js:47-60`) — the same gate as the JSON drill it mirrors (`buildVotersByAnswerFilter` is shared, `:1214`) |
| `GET /admin/reports/knocks-by-pass.csv` (`reports.js:2643`) | The per-round billing breakdown — **aggregate counts only**: walk-list name, round number/name/status/dates, knocks, survey doors, lit knocks, refused, rates, "new homes reached", plus a TOTAL row. **No voter PII in either layout.** With `?groupBy=canvasser`: per-canvasser rows add **First name, Last name, Email, Status** beside the counts — the same canvasser-identity class `canvassers.csv` above already exports, resolved by the same hydrator (for a **deleted** user that means the snapshot-restored **name only**; the hydrator blanks a deleted user's email — `canvasserIdentity.js:72`). | admin or lead (`reports.js:37`); `campaignId` is **required for everyone** (400 without it, `buildKnocksByPass` `reports.js:2460`), and a lead's must be one they manage (the reports-router scope middleware, `reports.js:47-60`) |

**The fifth (knocks-by-pass.csv) is aggregate counts, not records — no policy text change.** Its default layout carries no personal data at all (walk-list/round names and tallies); the `groupBy=canvasser` layout re-exposes canvasser name/email/status to **exactly the audience** that already downloads them from `canvassers.csv` (same admin-or-lead gate, plus the stricter always-required `campaignId`). No voter fields appear in any layout, no new party receives data, and no new category of data leaves the system, **so no Privacy Policy / ToS / DPA text change is required for it.** Staff (grant-based) access is covered by the fail-closed central access log (E13 — no exemption for this route).

**The fourth (voters-by-answer.csv) is a same-audience exposure, not a new recipient class.** It downloads exactly what the same caller could already page through on `GET /admin/reports/voters-by-answer` (same filter builder, same role + lead-campaign gate) — voter identity/address, canvasser identity, the chosen answer, and the door note were all already readable by that audience in-app, and the walk-list CSV above already put voter name/party/address in a file for the same roles. No new party receives data and no new category of data leaves the system, **so no Privacy Policy / ToS / DPA text change is required for it.** Staff (grant-based) access to it is covered by the fail-closed central access log (E13 — the finish-listener middleware logs unless explicitly exempted; this route has no exemption).

**The first one is effectively a bulk export of the entire campaign voter file, and this is a two-click product feature, not an edge case.** A walk list can be saved with an **empty filter** — `filter` is optional on `POST /admin/campaigns/:id/walklists` (`walklists.js:74-92`), and an empty filter resolves to `baseSet` = **every active geocoded household in the campaign and every voter in them** (`server/src/services/walklist/resolveWalkList.js:48-53`, `:131-132`). The web UI enables Save on a name alone (`client/src/pages/WalkListsPage.jsx:416`, `:27-47`) and puts an "Export CSV" button on every saved list (`:534-537`). **No row cap. No pagination. No size guard.**

**Also exportable, driven by survey answers:** walk-list filters include `surveyResponse` exists/not-exists, per-question `answerFilters`, and cross-question `answerTagFilters` (`resolveWalkList.js:89-128`). So "every voter who answered X" or "every voter tagged Supporter" can be resolved to a named, addressed, phone-bearing CSV.

**Client-side (browser-generated) downloads not counted above:** a jsPDF client-report PDF (`client/src/lib/reportPdf.js:33`), unmatched-voter-ID CSVs (`WalkListsPage.jsx:227-231`, `EarlyVotingPage.jsx:84-88`), and a billing-statement CSV (`client/src/components/OrgBillingPanel.jsx` → `downloadCsv()` — **platform-staff only**, rendered solely from the super-admin Organizations page; campaign-level counts and dollars, no personal data).

**Not exportable by any route:** full `SurveyResponse` documents (the voters-by-answer CSV carries only the **drilled** question's snapshot answer(s) — or the tag's matching entries — plus the response's door note, never the response's whole answer set), `VoterNote` bodies, tags, turf/book definitions, flag reviews, import history. **The original uploaded voter file cannot be re-downloaded** — `loadRawImport()` is called only by the background import worker (`services/import/importProcessor.js:56`) and is exposed by no route.

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
3. **A raw-coordinate CSV export** — `Latitude`, `Longitude`, `Accuracy (m)` columns per action, alongside address, voter name, party and note (`reports.js:3383-3432`).
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

> **[v3: this channel is closed.]** `publicPointAnswer` (`computeReport.js:151-176`) rebuilds every
> public answer from option ids against the template's canonical labels — `'__other__'` emits the
> literal word `'Other'`, unmatched legacy snapshot text collapses to `'Other'`, text questions never
> reach the map — and `migrate:scrub-map-points` back-scrubs already-published points (run it in
> prod). This is what makes the policy's *"only as the word 'Other,' never the typed text"* sentence
> true.

**BUT — one qualification you must not drop.** `answers[].answer` is a Mongoose `Mixed` field (`ClientReportMapPoint.js:13`) and is a **live free-text channel**. The remediation whitelist rejects only questions whose **type** is `'text'` (`routes/admin/clientReports.js:78-83`, `:460-474`). A **single-choice or multiple-choice** question may enable an "Other: ___" write-in (`models/SurveyTemplate.js:52`), whose canvasser-typed text is substituted into the answer snapshot (`mobile/app/(app)/voter/[id]/survey.jsx:276`), stored verbatim (`services/surveys/normalizeAnswers.js:45`), passes the type guard, is frozen onto the point (`computeReport.js:184-187`), and is emitted verbatim to the public map. **Free text a canvasser typed can appear pinned to a street address on an unauthenticated page.** No migration scrubs already-published points.

> **Do NOT write** (and this is the sentence **currently published** at `client/src/pages/PrivacyPolicyPage.jsx:106-109` *[v3: that page no longer exists — the live `client/public/privacy.html` now uses the address-level description recommended below; resolved]*): *"Published reports present only aggregate campaign statistics and a map of door statuses."*
> **Write:** *"A published report includes a map in which each household reached is shown at its exact street address and coordinates, together with that household's door status and the survey answers the campaign has chosen to display. Voter names and canvasser identities are not included."*

### Security of the link

| Control | Status |
|---|---|
| **Token entropy** | **VERIFIED STRONG.** 24 bytes from Node's CSPRNG, base64url → 32 chars = **192 bits** (`routes/admin/clientReports.js:151-153`). Not brute-forceable. *(Exception: the demo-org seeder uses `SEED_DEMO_SHARE_TOKEN` verbatim if set — `utils/seedDemoOrg.js:525` — in which case entropy is whatever an operator chose.)* |
| **Password on NEW links** | **VERIFIED.** Every link created through the admin API gets a bcrypt-hashed password; if the operator supplies none, a 12-char random one is generated and returned once (`clientReports.js:180-184`, `:231`, `:240`, `:247`). |
| **Expiry on NEW links** | **VERIFIED.** `expiresAt = now + SHARE_LINK_DEFAULT_DAYS` (default **90**, `clientReports.js:173`, `:241`). Expired links return **410** before any report data (`share.js:35-40`). Expiry cannot be extended or cleared via the API. |
| **LEGACY links** | **VERIFIED OPEN.** Links created **before this release** have `passwordHash: null` and `expiresAt: null` and **remain fully live**. `share.js:57` waves through any link with a null password hash; `share.js:35` treats a null `expiresAt` as unexpired. **No migration remediates them** — I listed all 24 files in `server/src/migrations/` and grepped for `ShareLink`/`passwordHash`: **zero hits.** The code comments at `share.js:33` and `models/ReportShareLink.js:35` refer to "the migration" **as if it exists. It does not.** *[v3: still no migration, and the phantom comments are still in the code — but an operator bulk kill switch now exists (`POST /admin/client-reports/shares/revoke-legacy`, dry-run unless `confirm:true`, deliberately not automatic), and the policy now discloses the pre-July-15 links honestly. Legacy links stay live until an operator flips it.]* |
| **Search-engine indexing** | **VERIFIED: NO PROTECTION.** *[v3: protection added — `robots.txt:7` now has `Disallow: /r/`, and `PublicReportLayout.jsx` injects `<meta name="robots" content="noindex, nofollow">` on every `/r/` page. Precision: the noindex is client-JS-injected only (no `X-Robots-Tag` header, no server-rendered meta), so robots.txt is the load-bearing control against non-JS crawlers.]* No `noindex` meta tag, no `X-Robots-Tag` header, no noindex directive anywhere in the client or server (grep: zero hits). `client/public/robots.txt` is `User-agent: * / Allow: / / Disallow: /api` — **`/r/` is not disallowed.** *Mitigating: the URL is unguessable, and the page is client-rendered with its data fetched from `/api/share/...`, which robots.txt does disallow — so a compliant crawler like Googlebot would likely index the URL and shell but be blocked from the report content. **robots.txt is advisory only.** It does not bind scrapers, archivers, or link-preview/unfurl bots, none of which are prevented from retrieving the full report JSON from an open legacy link.* |
| **Revocation** | **PARTIAL.** Deactivate / delete / rotate work on the next request (`share.js:28`). A **bulk** revoke exists but targets **only** the legacy/open subset and is a **dry run unless `confirm: true`** (`clientReports.js:261-286`). It is **not automatic**. It also skips the per-campaign authorization check every other route in the file performs, so a team lead can revoke legacy links across campaigns they do not manage. |
| **Password change ≠ revocation** | **VERIFIED.** The unlock JWT carries only `{shareId, campaignId}` with a 24h TTL (`services/auth/tokens.js:22-30`) and is never re-checked against the password (`share.js:63-68`). An already-unlocked viewer retains access for up to 24 hours after a password change. *(Link **revocation**, by contrast, does take effect immediately, because `loadShare` re-queries `isActive` on every request.)* |
| **Password can be REMOVED from any link, today** | **VERIFIED.** `shareUpdateSchema` accepts `password: null` (`clientReports.js:197`), and `:310-312` sets `passwordHash` back to `null`. Passwordless links are **not** a closed legacy set. *[v3: fixed — a falsy password now 400s with `SHARE_PASSWORD_REQUIRED` ("replace it, or rotate the link"); removal is unsupported, which is what lets the policy say new links are password-protected as a class.]* |
| **Metadata is never gated** | **VERIFIED.** `GET /share/:token` (campaign name, organization name, link label) has **no** `requireShareAccess` (`share.js:84`). |

> **Do NOT write:** *"Report links are password-protected and expire."* **False** as a statement about links as a class.
> **Write:** *"Report links created since [date] are protected by a password and expire after 90 days by default. Links created before that date may remain accessible without a password and do not expire until an administrator revokes them."*
> **COULD NOT DETERMINE:** how many open legacy links exist in production. That requires a database query. **Ask engineering before this sentence ships.**

**One thing an unguessable token is not:** it is a **capability**, not access control. It survives forwarding, it does not expire on a legacy link, and there is no rate limit or logging preventing its reuse by anyone who obtains it. The only rate limit on this surface throttles failed **password** attempts, not token access (`share.js:106-114`).

---

# E — PLATFORM (DOORLINE STAFF) ACCESS TO CUSTOMER DATA

## E12. Is platform-staff access to customer data gated and logged?

**PARTIAL. Gated and logged on `/admin/*` and `/mobile/*` only, and — [v3.2 2026-07-18] — only for
CUSTOMER organizations.** Doorline's own `isInternal` orgs are a deliberate exemption: staff enter
them ungated and unlogged (they hold no customer PII — only Doorline's own synthetic/demo data; see
the v3.2 stamp under "What is real"). **Both qualifiers must accompany every sentence you write about
this.**

### What is real (VERIFIED)

`orgContext` is the **sole** assigner of `req.activeOrg` (grep for `req.activeOrg =` returns hits only in that file). A super-admin who is **not** a member of the target organization gets **403 `SUPPORT_ACCESS_REQUIRED`** unless `activeGrant()` returns an unrevoked, unexpired grant (`server/src/middleware/orgContext.js:96-111` *[v3.2 2026-07-18: was :79-94 — the internal-org branch insertion shifted it; :79-94 now holds the carve-out itself]*; `services/access/supportAccess.js:16-23`). Membership is checked first (`:61-70`).

A grant:
- lasts **4 hours by default, capped at 24** — both **environment-overridable** (`SUPPORT_GRANT_HOURS`, `SUPPORT_GRANT_MAX_HOURS`; `supportAccess.js:12-13`, `:26`). The cap is genuinely hard for one grant: `expiresAt` is written in exactly one place and there is no extension route.
- requires a typed free-text **reason of ≥10 characters** (`routes/superAdmin/access.js:24`; required on the model, `models/SupportAccessGrant.js:37`)
- is **idempotent** — an existing live grant is reused, not stacked (`supportAccess.js:29-30`)
- is revocable, effective on the next request (no server-side grant cache)
- carries a `kind` (`support | incident | migration | audit | other`) — **but `kind` is OPTIONAL, defaults to `'support'`, and the staff console never sends it** (`access.js:25`; `supportAccess.js:25`; `client/src/components/SupportAccessGate.jsx:91`). In practice every grant is `'support'`. *[v4 2026-07-19: **STALE — the second half of this is now false.** The grant form was extracted from `SupportAccessGate.jsx` into `client/src/components/StartSupportSessionForm.jsx`, and it DOES send `kind`: a real `<select>` at `:91-92` over all five values, posted at `:41`. The cited `SupportAccessGate.jsx:91` now points at a closing brace. `kind` remains optional server-side and still defaults to `'support'`, so nothing about the gate changed — but "every grant is `'support'`" can no longer be assumed when reading the log. **The mobile sheet sends `kind` too** (`mobile/components/SupportAccessGate.jsx`), from the same five values.]*

*[v4 2026-07-19: **the grant path now has a SECOND CLIENT — no boundary change.** Mobile previously
had no handling for `SUPPORT_ACCESS_REQUIRED` at all: the 403 was untagged, so tapping a customer org
from the mobile Orgs tab entered a console where every query failed with no recovery. Mobile can now
start a session from the phone (`mobile/components/SupportAccessGate.jsx` → the same
`POST /super-admin/access/grants`), with a field set deliberately identical to the web form — same
five `kind` values, same 1/4/8/24 hours, same **≥10-character reason**, enforced client-side on both
and by `access.js:24` regardless. **Nothing about the gate, the cap, the reason requirement, the
idempotency, or the AccessLog moved**: this is one more caller of an already-verified endpoint, not a
new path into customer data. The only new surface is presentational — the mobile Orgs tab labels
which orgs need a session, computed from membership + `isInternal` + the caller's OWN live grants
(`GET /super-admin/access/grants` unscoped; `?all=1` is deliberately NOT used, since for a
`break_glass` operator it returns colleagues' grants). Verified end-to-end against a live server:
403 → grant → entry → `AccessLog` row written.]*

**A customer's own admins and members are neither grant-gated nor logged, and that is correct.** `orgContext` finds an active Membership and returns `next()` before it ever considers super-admin status, never setting `req.supportGrant`; `accessLog` then short-circuits (`orgContext.js:61-70`; `accessLog.js:40`). **No AccessLog row is ever written for a customer reading their own organization's data.**

> **[v3.2 2026-07-18 — the `isInternal` carve-out, BY DESIGN. Staff enter Doorline-owned internal orgs
> ungated and unlogged.]** There is a THIRD ungated-and-unlogged case beside "member of the org": a
> super-admin entering a Doorline-owned **internal** organization (`Organization.isInternal`).
> `orgContext` grants free entry in a branch **after** the membership check and **before** the vendor
> grant branch — `req.activeOrg` set, **no `req.supportGrant`** — so the vendor write-blocks
> (`VENDOR_READ_ONLY`) and `accessLog` stay silent exactly as they do for a real member
> (`orgContext.js:80-84`; it also sets `req.internalOrgAccess = true` for observability only — nothing
> gates on it). This is safe because an internal org holds **only Doorline's own synthetic/demo data —
> no customer PII** — and it is fenced so it can never widen to cover a customer org:
> - **Born-immutable flag.** `isInternal` is `immutable: true` and absent from every update schema
>   (`models/Organization.js:18`) — no `findByIdAndUpdate` and no PATCH body can set it on an
>   existing org. The only paths that set it are (a) org **creation** (the break-glass API below)
>   and (b) **three** sanctioned, operator-run raw-collection writes, all CLI-only — not reachable
>   from any HTTP route: `utils/seedDemoOrg.js` (hard-locked to the demo slug),
>   `migrations/migrateInternalOrgs.js` (demo slug by default; `--slugs` accepts arbitrary orgs),
>   and `migrations/migrateBilling.js:63-66` (its pre-existing `--internal` slugs). **The two
>   migrations can therefore target ANY existing org** — the boundary claim is "no *API* path",
>   not "no path at all": an operator with server shell access is outside this control, and these
>   scripts are that operator's tools. Their runs print what they touch and are idempotent.
> - **Break-glass-only creation.** `POST /super-admin/organizations {internal:true}` 403s
>   `BREAK_GLASS_REQUIRED` for the `support` tier — i.e. any non-`break_glass` staff; those are the
>   only two platform tiers (`organizations.js:322-328`; `models/User.js:28-31`); an
>   internal org is born with no trial (`INTERNAL_NO_TRIAL`) and a `Subscription` born `'internal'`.
>   The slug is locked against rename (`INTERNAL_SLUG_LOCKED`, `organizations.js:435-444`).
> - **Billing locked to `'internal'` both ways** (see the (b) stamp below), which is what keeps it out
>   of both retention sweeps.
>
> **There is no API path that moves a customer (PII-bearing) org into the exempt class.** The carve-out
> enlarges the "not a vendor" set from {real member} to {real member, internal-org staff}; it does not
> touch the customer-org gate, which still requires a live grant and still logs every voter-content
> read. Every "gated and logged" sentence in this section is about **customer** organizations. The
> published policy already scopes its promise this way — `privacy.html` "How Doorline personnel access
> customer data" says staff cannot open *"a customer organization's"* data without a grant — so this
> exemption makes **no** published sentence false and needs no policy edit.

> **[v3.2 2026-07-18 — a silent-comp / retention-exemption hole that is now CLOSED.]** Before the flag
> existed, `'internal'` was just another value in the billing-status enum, and
> `POST /super-admin/organizations/:orgId/billing/status` is gated by `requireSuperAdmin` only. So
> **any** super-admin (including the `support` tier) could set **any customer org** to `'internal'` —
> permanently free AND silently exempt from BOTH retention sweeps (`triggers.js` `isExempt` +
> `DORMANCY_PROTECTED_STATUSES` ⊇ `internal`, line 39-44 above), leaving nothing but a
> `SubscriptionEvent` row behind. That is now closed by two-way coupling to the born-immutable flag
> (`billing.js:157-168`): `to:'internal'` on an **un-flagged** org 403s `INTERNAL_FLAG_REQUIRED`, and an
> **already-flagged** org can never leave `'internal'` (403 `INTERNAL_LOCKED`). The flag checks run
> BEFORE the same-status short-circuit, so `to:'internal'` can still HEAL a flagged org whose sub
> drifted, but it can never CREATE the exemption on a customer org; `loadOrgSub` likewise backfills a
> missing sub as `'internal'` only for a flagged org. **Net: the free-forever + retention-exempt state
> that `'internal'` confers is now reachable only through break-glass org creation, never through a
> billing edit on an existing customer org.**

### Three things you must NOT imply

**1. The grant is SELF-ISSUED.** `POST /super-admin/access/grants` is gated by `requireSuperAdmin` only — **not** `requireBreakGlass` (`routes/superAdmin/access.js:19`, `:31`). `createGrant` sets `actorUserId: req.user._id` (`supportAccess.js:25-39`): **the staff member grants themselves access, to any organization, instantly.** There is **no approver, no second-person sign-off, no customer approval, and no customer notification.** I found no customer-facing surface for grants or the access log anywhere (`SupportAccessPage.jsx` is routed under `/super-admin`; a grep of `server/src/content/help/` for "support access" / "Doorline staff" returns **zero articles**). *[v4 2026-07-17: the NOTIFICATION half narrows — every newly-created grant now emails the org's notify list with the staff first name, reason and expiry (`access.js` + `supportGrantNotice`); reusing a live grant re-sends nothing. Self-issuance and no-approver are unchanged — notice, not consent. Recipients updated 2026-07-18 by owner decision: BILLING identities only (billingAccess admins, else the billing contact of record) — never all admins; an org with no billing identity gets no notice (loudly logged). The same billing-only rule now governs the wind-down/dormancy deletion warnings (`services/mail/recipients.js` billingNotifyEmails).]*

> **Do NOT write:** *"with your authorization," "at your request," "with notice to you,"* or anything implying customer consent or an independent authorization gate. **The grant is an attribution control, not an approval control.**

**2. The 24-hour cap bounds ONE grant, not cumulative access.** No cooldown, no cumulative limit. A staffer whose grant expires can immediately create another.
> **Do NOT write:** *"Staff access never exceeds 24 hours."* **Write:** *"Each grant expires within at most 24 hours."*

**3. The audit log cannot answer the question a data subject will actually ask.** `AccessLog` records the **route template** and a **resource class** — deliberately **no voter, household or person id** (`middleware/accessLog.js:44-58`; `models/AccessLog.js:40-44`). Doorline **cannot** truthfully offer *"we can tell you whether your record was accessed."* It can only say *"staff entered your organization."*
> The staff-facing 403 string at `orgContext.js:85` says *"every record you open is logged."* **That is not what the log records.**

## E13. Where are the holes?

**THIS IS THE MOST IMPORTANT ANSWER IN THE BRIEF. VERIFIED.**

### HOLE 1 — `/super-admin/persons`: a cross-organization voter-identity console with NO grant and NO audit. Reads **and writes**.

> **[v3: CLOSED — re-verified 2026-07-16.]** The router is `requireAuth, requireBreakGlass`
> (`persons.js:27` — the `support` tier gets 403 `BREAK_GLASS_REQUIRED` and cannot reach it at all);
> all 12 routes require a live **per-org** grant (`requirePersonOrgGrant`) and write an AccessLog row
> (`logPersonAccess`); the directory hard-requires `?organizationId` and scopes every query — free-text
> search runs only inside the granted org. The once-false `personOversight.js` comment was rewritten
> and is now accurate (it names the route as the control, not itself). Two honest caveats survive:
> the per-route logging pattern means a **future** route added without a `logPersonAccess` call would
> be silently unlogged (unlike `/admin`'s fail-closed middleware), and the log write remains
> best-effort. The table and prose below are retained as the pre-fix record.

I traced the mount chain myself.

- **The router is gated by `requireAuth, requireSuperAdmin` only.** `server/src/routes/superAdmin/persons.js:15`. **`orgContext` is never imported or mounted** — so **no grant is ever required.** (Grep for `orgContext` across `server/src/routes/superAdmin/`: **zero hits.**)
- **It is outside the audit.** `accessLog` is mounted **only** on `['/admin','/mobile']` (`server/src/routes/index.js:72`). `/super-admin/persons` is mounted at `routes/index.js:77`. `req.supportGrant` is assigned in exactly one place — `orgContext.js:92` — so on any `/super-admin` route it is **permanently undefined**, and `accessLog.js:40` would drop the row even if it were mounted.
- **`requireSuperAdmin` checks only `isSuperAdmin`** (`middleware/auth.js:28-32`). **Any** Doorline staff account — including `platformRole: 'support'`, the supposedly least-privileged tier — passes.

**What it returns.** `GET /super-admin/persons/:personId` (`persons.js:219`) → `buildPersonOversight` → `serializePerson` (`services/person/personOversight.js:28-55`): **firstName, lastName, fullName, phone, phoneType, cellPhone, party, gender, dateOfBirth, registrationStatus, uid keys, state voter IDs** — plus, per organization, **full home addresses**: addressLine1, addressLine2, city, state, zipCode, county (`personOversight.js:96-105`, `:133-140`).

> **[v3.1 2026-07-17: the payload was data-minimized to what the UI renders.]** Per-org addresses now
> ship **city/state only** (street, zip, county trimmed); the per-org `voterIds` (stateVoterId) list
> was removed; and the merge log is an explicit shape (action/ids/count/date) instead of a spread —
> the full pre-merge identity snapshots (`survivorSnapshot`/`victimSnapshot`) stay server-side for
> split-reversal. The person's own `svidKeys` remain (the UI renders them as key chips). Verified in
> `personOversight.js` (the trim is commented at the source, with a warning not to resurrect the
> blanket dump).

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

*Two mitigating facts, both real and both worth stating:* (1) the **canvassing** side of the person view is genuinely aggregate-only — survey/activity/note figures are `$group`/`$count`, and the code never reads `SurveyResponse.answers`, `CanvassActivity.note` or `VoterNote.body` (`personOversight.js:113-126`); staff see **that** a person was surveyed, not what they said. (2) The UI list renders only city/state (`PersonDetailPage.jsx:329`) — **but the JSON response contains the full street address** and is trivially visible in a browser network tab. *[v3.1 2026-07-17: (2) is fixed — the response now carries city/state only; see the trim stamp above.]*

### HOLE 2 — Voter content read under a valid grant that produces NO audit row. **VERIFIED.**

> **[v3: CLOSED.]** `voterContentResource()` no longer exists — the matcher was inverted to
> fail-closed: `accessLog` registers a finish-listener on **every** `/admin`+`/mobile` request and logs
> by default; the only skips are a 3-entry `AUDIT_EXEMPT` metadata allowlist, and an unrecognized
> route logs as `'other'` ("the failure we cannot tolerate is an unlogged read, not a mislabeled
> one"). The walk-list CSV export below now writes an AccessLog row — traced end-to-end. Guard test:
> `test/accessLogCoverage.int.test.js`. Rows remain per-request, never per-record (E12).

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

> **[v3: CLOSED.]** `memberships.js:33-43` rejects any non-GET from a `supportGrant` holder with 403
> `VENDOR_READ_ONLY` (the `requireOrgRole` super-admin passthrough itself is unchanged — the block is
> downstream); `leadCrew`'s two write routes carry `denyVendorPrivilegeWrite`. Adversarial variants
> (member super-admin, no `X-Org-Id`, no grant) each fail on `ALREADY_MEMBER`, `ensureOrgScoped`, or
> `SUPPORT_ACCESS_REQUIRED` respectively.

`requireOrgRole()` returns `next()` **unconditionally for any `isSuperAdmin` caller, before any role check** (`middleware/auth.js:58`). So a super-admin holding a grant passes the admin gate on `/admin/memberships` and can **create a Membership — including for themselves** (`routes/admin/memberships.js:24` is the only gate). Once a Membership exists, `orgContext`'s membership-first branch takes over, `req.supportGrant` is never set again, and `accessLog` short-circuits **forever**. `/admin/memberships` is also absent from `VOTER_CONTENT_ROUTES`, so the membership-creation request itself writes no audit row.

I did **not** execute this and did **not** fully trace the `POST /admin/memberships` body schema to confirm a staffer can name themselves. **Treat as a control weakness for engineering review, not a proven exploit.** The first step (creating the grant) *is* recorded in `SupportAccessGrant`, so the escalation is not invisible — but the subsequent reads are.

### HOLE 4 — The Bull Board job console is outside everything. **VERIFIED.**

`app.use('/admin/queues', requireBullBoardAuth, createBullBoardRouter())` — mounted at the **app root**, outside `/api` (`server/src/app.js:97` *[v3: line drifted from :77 as app.js grew; the finding itself was re-verified 2026-07-16 and still stands — no grant, no audit]*). It therefore never traverses `routes/index.js`, where `orgContext` and `accessLog` live. `queues/bullBoard.js` calls it *"a cross-tenant job console (all orgs' jobs)."* **No grant, no audit.**

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
  **And it is a takeover path.** *[v3: reviewed and left unprevented by decision — admin reset is the
  product's only password-recovery mechanism, so blocking it would strand multi-org users entirely;
  the reset now issues a visible forced-change temp password (misuse locks the victim out loudly, not
  silently), email changes are multi-org-locked (`MULTI_ORG_EMAIL_LOCKED`) while passwords are not,
  and the rationale is recorded at `memberships.js:423-432`, which cites this document. Closing it
  properly needs per-org credentials or self-serve email reset.]* Once the Membership exists, org A's admin can **reset that user's password** — `PATCH /admin/memberships/:userId/password` is gated **only** on "a Membership for this user exists in my active org" (`memberships.js:385-420`), which org A just minted. That password logs in, and the login response returns `memberships` **for every org the user belongs to** (`routes/auth.js:110-111`). `mustChangePassword` does not block `/auth`, so `POST /auth/change-password` clears the flag and yields a full cross-org session. **INFERRED FROM CODE PATHS, not executed.** It is destructive and detectable (it burns the victim's real password), but it is not prevented. **Escalate to engineering.** *[v4 2026-07-18: narrowed — the victim can now recover WITHOUT any admin via the emailed self-serve reset, and completing it REVOKES the attacker's minted session (`SESSION_REVOKED`); the attack itself (open by owner decision, item 14) is unchanged.]*
- **`isMultiOrg` is disclosed to customers.** An org admin is told, for each of their own members, a boolean indicating that person **also belongs to at least one other organization on the platform** — computed from an **unscoped** aggregate over all Memberships (`memberships.js:109-114`, `:145`). Only a boolean; never the name, id or count of the other orgs. Minor, but it is a genuine cross-tenant inference **shown to customers**.

### EXCEPTION 4 — Cross-org Person merge is possible via staff tooling. **VERIFIED.**

> **[v3: CLOSED.]** `mergePersons.js:88-92` refuses with a 409 when survivor and victim belong to
> different organizations; `keysHeldElsewhere` is org-scoped; the merge/split routes are break-glass +
> per-org-grant gated and AccessLog'd. The free-text victim-id box is still in the UI — the control is
> server-side. The index caveat below is also resolved in code: `migratePersonsOrgScope.js` drops the
> two legacy global indexes as its first apply step and its runbook mandates `migrate:build-indexes`
> after; whether it has RUN in prod still requires a live-DB check.
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

> **[v3: resolved in the rewrite.]** The blanket sentence is gone — `privacy.html` now has a dedicated
> Maps paragraph disclosing that Mapbox receives the viewer's IP and viewport on any page with a map,
> and the residual negative claim is narrowed to advertising cookies / third-party **advertising**
> trackers (code-supported: no analytics/ad SDK exists in any package.json). The web client also gained
> `client/src/lib/mapboxInit.js`, which nulls the GL-JS event endpoints as best-effort harm reduction —
> its own comment says it does NOT reliably stop the beacons on v3 and must not be cited as a mute.
>
> **Do NOT write:** *"We do not use advertising cookies, third-party analytics, or tracking technologies on our sites or in our apps."*
> **This is the sentence currently published** (`client/src/pages/PrivacyPolicyPage.jsx:98-99` *[v3: page since deleted]*), and the mobile code's own comment says telemetry is disabled **specifically to keep that sentence true** (`mobile/lib/mapbox.js:13-14`). **It is supported for mobile. It is NOT supported for the web console or for the public report pages.** It is also the sentence with the sharpest cookie/tracking-technology disclosure consequences.
> *(INFERRED, NOT PROVEN FROM THIS REPO: that the library therefore transmits its default events. I verified the endpoint and the localStorage key are present in the shipped bundle and that no disabling code exists. I did not observe network traffic.)*

### HEROKU'S ACCESS LOG — this is a data flow, and it is not on anyone's subprocessor list. **VERIFIED.**
`app.use(morgan(isProd ? 'combined' : 'dev'))` (`server/src/app.js:72` *[v3: was :52 — line drift only]*), mounted app-wide with no `skip`, **before** everything. `app.set('trust proxy', 1)` (`:50`) makes `:remote-addr` resolve to the **real client IP**. The `combined` format logs `":method :url HTTP/:http-version"`, and morgan's `:url` token is **`req.originalUrl` — which INCLUDES THE QUERY STRING.**

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
- **NO email provider, NO SMS provider, NO crash-reporting, NO error-tracking, NO product analytics SDK.** Swept all four `package.json` files for Sentry, Bugsnag, Datadog, New Relic, LogRocket, Nodemailer, SMTP, SendGrid, Mailgun, Postmark, Resend, Twilio, AWS SES/S3, Segment, Amplitude, Mixpanel, PostHog, Firebase, GA, GTM: **zero.** The web page has no third-party script tags and self-hosts its fonts. **Consequence: there is no automated password-reset email — recovery is admin-issued temporary passwords only, and there is no mechanism to warn anyone of anything.** *[v4 2026-07-17: **THE EMAIL HALF OF THIS NEGATIVE FLIPS.** Transactional email via **Resend** now exists — `services/mail/mailer.js` POSTs to `api.resend.com` with global fetch, so the package.json sweep still finds zero mailer dependencies, but the CONCLUSION is void: self-serve password reset, invite/set-password links, org/campaign-add notices, support-grant notices, and pre-deletion warnings all send once `RESEND_API_KEY` + `MAIL_FROM` are set (dormant until then — the DPA §6 go-live switch). Emails carry the recipient's name + address to Resend: **Resend is a subprocessor and must appear in DPA §6 and the privacy policy's service-providers paragraph BEFORE the vars are set.** Emails never contain passwords. SMS/analytics/crash negatives all stand.]*
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
There is **no voter account, no voter role** (Membership roles are `['admin','lead','canvasser']` only — `models/Membership.js:21`), and **no voter-facing route**. A grep across server, client and mobile for do-not-contact / opt-out / unsubscribe / DSAR / data-subject / right-to-erasure returns **no implementation**. There is no `DELETE /admin/voters/:voterId` and no delete route on the Person router. *[v3 update 2026-07-17: the grep result is now stale in one respect — an admin-operated **do-not-contact** mechanism exists (`Voter.doNotContact`, `routes/admin/dnc.js`, enforcement layers per docs/VOTERS.md §D). The voter-INITIATED absence stands: no account, no self-serve route, DSARs still manual.]*

**What DOES exist:** an org admin can **correct** a voter's identity fields (`routes/admin/voters.js:186`), **delete a voter's survey response** (`:371`), and **delete a voter note** (`:303`). And a household can be marked `'restricted'` and excluded from future books via an admin `excludeRestricted` toggle (`models/Household.js:47-52`; `services/turf/generateTurf.js:49`, `:205`) — **door-level, admin-controlled, not voter-initiated,** and framed in the help copy as "couldn't physically reach the door," not as suppression.

The currently-published policy states *"Voters do not interact with the Services directly."* *[v3: the policy is now `client/public/privacy.html`; the no-rights-mechanism finding is unchanged — it is v3 gap 1, still the largest gap.]* The only channel for a voter to exercise any right is a contact email on the policy page. **Every DSAR from a voter is a manual process with no tooling behind it, and there is no way to mark a person do-not-contact.**

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
- **A password change does not invalidate existing tokens.** `change-password` writes only `{passwordHash, mustChangePassword:false, tempPasswordSetAt:null}` (`auth.js:141-145`); nothing compares a token to the hash. **A stolen or forwarded bearer token keeps working for up to 30 days after the victim resets their password** (`JWT_EXPIRES_IN`, default `'30d'`, `services/auth/tokens.js:6`). *[v4 2026-07-18: **FLIPPED.** A SELF-SET password change (emailed reset or `/auth/change-password`) now stamps `User.passwordChangedAt`, and `requireAuth` 401s (`SESSION_REVOKED`) any token whose `iat` predates it — every pre-change session dies on its next request; the changing device continues via a fresh token in the change-password response. An ADMIN temp reset deliberately does not stamp (the `mustChangePassword` gate already suspends live sessions recoverably; the stamp lands when the user completes the forced change). Null stamp grandfathers pre-feature sessions. The mobile offline queue HOLDS queued knocks on 401/`PASSWORD_CHANGE_REQUIRED` instead of dropping them, and the queue survives sign-out — billable field work survives a mid-shift reset. Guard test: `test/sessionInvalidation.int.test.js`.]*

> **Do NOT write** anything implying that logging out, or changing your password, terminates existing sessions. **Neither does.** *[v4 2026-07-18: half-flipped — a password CHANGE now does terminate other sessions, and the policy may say so. LOGOUT remains a server-side no-op; still do not claim logout ends the session.]*

---

# THINGS YOU DID NOT ASK ABOUT BUT MUST DISCLOSE

### 1. The largest at-rest store of voter PII in the whole system is an unencrypted file on a volunteer's phone. **VERIFIED.**

> **[v3: materially improved.]** The bootstrap now lives at `FileSystem.cacheDirectory` (excluded from
> iCloud and Android auto-backup; `cache.js` carries a "do NOT move it back to documentDirectory —
> the privacy policy's device-storage disclosure depends on this" comment), a startup migration moves
> or deletes the legacy Documents copy, and sign-out clears **every** copy (cache file, tmp staging
> file, legacy Documents file — "sign-out must leave voter data in NO location"). OTA-shipped: a device
> that hasn't launched the new bundle still holds its old Documents copy. The file's contents and its
> plaintext, indefinite-while-signed-in nature are unchanged.

`mobile/lib/cache.js:13` writes `canvass.bootstrap.json` into `FileSystem.documentDirectory`. `cache.js:85-86` serializes the entire bootstrap payload to it as **plaintext JSON** (`writeAsStringAsync(BOOTSTRAP_TMP, JSON.stringify(snapshot))` then an atomic rename).

**What is in that file** (I read the server projections):
- **Every household in the canvasser's book**: `addressLine1`, `addressLine2`, `city`, `state`, `zipCode`, **exact `location` coordinates**, door `status`, `lastActionAt` (`routes/mobile/bootstrap.js:231-244`)
- **Every voter in those homes**: `fullName`, `firstName`, `lastName`, **`party`**, `gender`, `surveyStatus`, and a derived **`age`** (`bootstrap.js:260-270`)
- **NOT** included: date of birth (stripped, `bootstrap.js:36-39`), phone.

On a 16,000-door turf this is a **multi-megabyte file of named residents at mapped addresses on a temporary field worker's device.**

**It IS cleared on sign-out** (`mobile/lib/authState.js:41-50` calls `clearBootstrap()`) — credit that. **But nothing else clears it, there is no expiry, and it persists indefinitely as long as the user stays logged in and the app stays installed.**

### 2. Nothing opts these files out of iCloud / Google device backup. **VERIFIED ABSENCE; CONSEQUENCE INFERRED.**

> **[v3: largely closed.]** `mobile/app.json:21` now sets `android.allowBackup: false` (excludes the
> whole Android app from Google auto-backup — **native-build-contingent**: it takes effect only in a
> binary built after the change, never via OTA), and the bootstrap's `cacheDirectory` location keeps it
> out of iOS backups by platform default. **Residual, keep it in the record:** on iOS, AsyncStorage —
> including `canvass.offlineQueue` with its GPS-stamped queued knocks and survey payloads — still rides
> device backups. "Excluded from backup" is fully true on Android, bootstrap-file-true on iOS.

I grepped `mobile/` (source and `app.json`) for `ExcludedFromBackup`, `NSURLIsExcludedFromBackupKey`, `allowBackup`: **zero hits.** `mobile/app.json` sets no `android.allowBackup: false`.

`FileSystem.documentDirectory` is inside the app's iOS `Documents/` folder, **which is included in iCloud/iTunes backups by default**; Android Auto Backup is **on by default**. **INFERRED, NOT VERIFIED (I did not inspect a device backup):** `canvass.bootstrap.json` — voter names, street addresses, coordinates, party — and the plaintext offline queue are copied into the canvasser's **personal iCloud or Google account backup.**

**This is the Apple/Google data flow that actually matters, and G15's "distribution only" line is exactly the sentence that would produce a false statement about it.** **Escalate to engineering, and until it is fixed, do not represent that the app takes steps to keep voter data off third-party cloud backups.**

### 3. `ImportJob` permanently retains voter PII in import history. **VERIFIED.**
Never mentioned in any inventory. `ImportJob` rows are retained forever (no TTL anywhere) and carry:
- **`diff`** (`models/ImportJob.js:86`) — samples of **moved voters** as `{stateVoterId, name, fromAddress, toAddress}` (`services/import/computeImportDiff.js:129-137`, `:200-219`). **A voter's name plus their previous and new home address, permanently, in import history.** *[v3 2026-07-17: the persisted diff now also carries `handEditConflicts.sample` — capped (100) kept-value/file-value pairs for hand-edited identity fields (can include a phone or DOB). Same class as the moved-voter samples: org-scoped, both values already held by the org (its own edit + its own upload), same ImportJob lifecycle and org-delete cascade. No new audience, no new third party.]*
- **`errors[]`** (`ImportJob.js:61`) — `rowIndex`, `code`, `reason`, **`stateVoterId`** (`csvImporter.js:152-158`)
- **`geocodeCheck.sample`** — sample **addresses**

Also permanently retained and never inventoried: `Voter.identityBackup` (a Mixed snapshot of pre-propagation identity fields), `Person.fieldProvenance` (per-field `prevValue` — **superseded identity values: an old phone, an old name, an old party, so corrections do not erase the prior value**), `PersonEditProposal.canonicalSnapshot`, `TurfSnapshot.clearedKnocks` (verbatim copies of `CanvassActivity` + `SurveyResponse`).

### 4. Backups. There is a full-PII copy of the production database on an operator's personal laptop, and nothing deletes it. **VERIFIED.**

> **RESOLVED 2026-07-15 — do not re-open from this text.** The 2026-07-13 preflight archive was
> destroyed after the M10 Atlas snapshot was verified restorable (operator-attested), and
> `DEPLOY_RUNBOOK.md` now carries a custody rule: any future local dump requires a
> FileVault-encrypted destination, a named owner, and a destruction date (≤14 days). The
> DO-NOT-WRITE warning below therefore no longer applies to the current policy drafts, whose
> backup sentence is written against the M10 rotation (longest tier 12 months, Atlas-console
> confirmed). The original finding is retained below as history.

- **`docs/DEPLOY_RUNBOOK.md:74`** instructs: `mongodump --uri="<MONGODB_URI>" --archive=$HOME/doorline-preflight.archive.gz --gzip` — **a full dump of production to the operator's home directory.**
- **`docs/DEPLOY_RUNBOOK.md:87-95` records that this was actually run against production on 2026-07-13** (75,760 Persons).
- `verify-backup.sh:49-57` restores it into a throwaway mongod to prove it works; `scripts/census.mjs:31-41` enumerates the collections it must contain: **people, voters, households, canvassactivities, surveyresponses, users, memberships, campaigns, organizations** — the full PII corpus.
- **NOTHING in the repository ever deletes that archive.** No cleanup step in the runbook; no code reference. The retention subsystem has no awareness of it. **A purged identity persists in that offline archive indefinitely, with no code-level expiry and no custody control.**

- **Atlas Cloud Backup:** the runbook **instructs** turning it ON as part of this release (`DEPLOY_RUNBOOK.md:163-165`) and taking a verified snapshot (`:196-200`), and states *"The Atlas snapshot (1d) is your only rollback"* (`:455`). **Nothing in the repo records that those steps were actually performed** — only step 0c (the mongodump) has a recorded result. **Production backup state is inferred from a runbook, not verified. Read it off the Atlas console.**
- The prior cluster tier was Atlas Free (M0), which per the runbook *"is physically incapable of being backed up"* (`:63-69`). **So Atlas snapshot coverage begins only at this release. Data deleted before it was never in an Atlas snapshot** — it may be in the laptop dump.
- **COULD NOT DETERMINE:** the Atlas snapshot **retention period**. No such value appears anywhere in the repo. Get it from the console.

**Every deletion mechanism in this codebase — the org cascade, the campaign cascade, account deletion, the retention purges — operates exclusively against the live MongoDB collections. No code path scrubs, expires, filters, or even references a backup or snapshot. The published privacy policy does not mention backups at all** (grep of `PrivacyPolicyPage.jsx` for "backup|snapshot": zero hits). *[v3: the rewritten `privacy.html` now discloses backups — residual copies "may persist in our encrypted database backups for up to 12 months" — and that 12-month figure is an Atlas console setting, not code; keep it verified against the console.]*

> **Do NOT write:** *"Residual copies of deleted data persist in backups only until they rotate out on our provider's schedule."* **That is false while the laptop archive exists.** Either the policy covers operator-held dumps, or the company destroys that archive.

### 5. Deleting a campaign leaves orphans. **VERIFIED.**
A campaign can only be hard-deleted if it has no canvassing history — **but that gate is a live-row existence check, not a latch.** `campaignHasCanvassed()` (`routes/admin/campaigns.js:54-58`) tests `CanvassActivity.exists()`. `POST /admin/turfs/discard` with `clearKnocks` **hard-deletes those very rows** (`routes/admin/turfs.js:343-344`) and is a **checkbox in the web console** (`client/src/pages/TurfsPage.jsx:425`). **Clearing every non-archived pass re-opens the hard-delete gate on a campaign that WAS canvassed.**

The campaign cascade removes 20 collections + the Voter rows housed in that campaign's households + the raw spreadsheets. **It does NOT remove:** `VoterNote` (keyed by voterId, no campaignId — **free-text notes about voters survive as orphans after the voter rows are gone**), `Person` (org-scoped — canonical identity rows with name, DOB, phone, party, gender simply left behind), `FlagReview`, `PersonMergeLog`/`Candidate`/`EditProposal`, and `GeocodeCache`.

### 6. Two smaller items.
- **`middleware/error.js:7-10` returns `err.message` to the caller on any 500 in production** — which surfaces raw Mongo errors. A duplicate-key error quotes the offending value (e.g. an email address, a street address, a state voter ID).
- **`app.js:60-65`: CORS reflects ANY Origin when `CLIENT_ORIGIN` is unset** (`origin: process.env.CLIENT_ORIGIN ? ... : true`). Helmet's CSP is **disabled** (`app.js:52-59`). *[v3: line numbers updated for app.js growth; both findings re-verified and unchanged.]* **COULD NOT DETERMINE** the production value of `CLIENT_ORIGIN`.

---

# THE HONEST GAPS

> **[v3 — 2026-07-16: this list is superseded by "Remaining honest gaps (v3)" at the top of this
> document.]** Per-item status against today's tree: **1** closed (break-glass + grant + logged) ·
> **2** narrowed *(v4: customer notice now automatic; still self-issued)* · **3** closed (fail-closed audit) · **4** closed in code
> (GeocodeCache TTL; migrations pending) · **5** closed (intake + cancel exist) · **6** resolved
> (policy rewritten as static pages) · **7** closed (dormancy shield) · **8** largely closed
> (`allowBackup:false` + cacheDirectory; iOS AsyncStorage residual) · **9** open (Heroku log flows;
> drain state unknown) · **10** open-by-decision (operator revoke switch exists, not automatic) ·
> **11** closed (robots + noindex) · **12** open (queue survives logout, no TTL) · **13** closed
> (`VENDOR_READ_ONLY`) · **14** open by decision (documented at `memberships.js:423-432`) · **15**
> closed (cross-org merge 409s) · **16** closed *(v4: delivery-gated warnings)* · **17** narrowed (one TTL
> now exists — GeocodeCache; every other retention promise is still cron-kept) · **18** closed
> (retries + red health) · **19** narrowed *(v4: record-level subjects for single-record opens + exports; browse stays request-level)* · **20** open (pseudonymous end
> state; policy language now honest) · **21** open (no User-row retention limit).

**This is the list you take to the lawyer. These are the places where the product does not yet do what a policy would want to promise.**

### FIX BEFORE THE POLICY SHIPS — a policy sentence would be false today

1. **`/super-admin/persons` is an ungated, unaudited, cross-organization voter-identity console with read AND write.** Any `support`-tier staff account can search every Person on the platform by name, read name/DOB/phone/cell/party/gender/registration/state-voter-ID/**home addresses** across every customer, and **merge, split, re-own and lock** those records. No grant. No audit row. The code comment at `personOversight.js:71-73` claims the exact opposite. **Until this is closed, no sentence of the form "staff access to your data is time-boxed, reason-logged and audited" is true.** (E13)
2. **The support grant is self-issued, with no approval and no notice to the customer.** (E12)
   *[v4 2026-07-17: the notice half is closed — automatic customer email on every new grant. The
   approval half stands.]*
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
16. **Dormancy deletion sends no warning.** The code comment says "after a warning." **The server has no email or SMS capability at all.** *[v4 2026-07-17: CLOSED — the comment is finally true. Warning emails precede both dormancy and wind-down deletion, and the purges are hard-gated on delivery-verified markers (`test/retentionWarnings.int.test.js`).]*

### YOU CANNOT PROMISE THESE, BECAUSE NOTHING ENFORCES THEM

17. **There is no TTL index anywhere in the entire codebase.** No collection expires on its own. Every retention promise depends on a **cron job running on a worker dyno** — and repo history records a prior incident where the worker was scaled to 0 by a bad deploy. The code's own health text contemplates the purge having **"NEVER run"** and says *"we are promising a retention limit we are not enforcing."* **Write "we aim to purge within ~180 days," not "is deleted after 180 days."** (A2)
18. **A failed customer deletion request produces a green success receipt and is never retried.** (B6)
19. **Doorline cannot answer "was MY record accessed?"** — `AccessLog` stores a route template and a resource class, never a record id. **Do not offer record-level access transparency.** (E12) *[v4 2026-07-19: NARROWED — single-record opens and exports now carry subject ids, and org admins can read a per-voter staff-access panel. The advisory flips to: you MAY offer record-level transparency for staff access, scoped exactly as the v3-gap-3 stamp states (browse stays request-level; pre-2026-07-19 rows are request-level history).]*
20. **After the 180-day purge, the field data is PSEUDONYMOUS, not anonymous.** The GPS trail, timestamps, notes and survey submissions remain permanently linked to a stable identifier, and the tombstoned `User` row still exists carrying that identifier and `lastLoginAt`. **Two code comments call this "permanently anonymous." They are wrong, and one of them is already user-facing copy.** (A3) *[v4 2026-07-22: **NARROWED, not closed** — the tombstone no longer carries `lastLoginAt` (scrubbed, as is the new `lastSeenAt`). The finding rests on `_id`/`createdAt`/`deletedAt` and the id-embedding tombstone email, all of which remain.]*
21. **`User` accounts have no retention limit at all.** A volunteer who canvassed for one weekend in 2024 still has a live row — name, email, phone, bcrypt hash, `lastLoginAt` *[v4 2026-07-22: and now `lastSeenAt`. The gap is otherwise unchanged — a **live** row keeps both clocks; only account deletion scrubs them.]* — indefinitely, unless they personally delete their account **from the mobile app** (there is no web deletion, and the operator CLI cannot delete a sole admin, sole billing admin, sole super-admin, or a `deletionLocked` account). (A1, B5) *[v4 2026-07-29: the parenthetical is now half-wrong — staff CAN delete an account from the web console (break-glass, typed-email confirmation, every blocker intact). **The gap itself is unchanged**: there is still no retention limit and still no SELF-service web deletion, and a staff-initiated delete is not a retention policy.]*
22. **Voters — the actual data subjects, who never consented to anything — have no account, no access, no correction, no deletion, no opt-out, and no do-not-contact mechanism.** Every request from a voter is a manual process with no tooling behind it. **This is the largest structural gap in the product from a privacy-law standpoint, and no sentence you write can paper over it.** (H16(d)) *[v3 2026-07-17: narrowed — do-not-contact is now admin-tooled (see v3 gap 1); the voter-initiated half of this finding is unchanged.]*