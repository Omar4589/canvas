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
   `denyVendorPrivilegeWrite`. *[v4 2026-07-29, stamped 2026-08-07: superseded by owner decision —
   the blanket `VENDOR_READ_ONLY` rule was REMOVED and `denyVendorPrivilegeWrite` no longer exists.
   A support grant now permits membership/crew writes, every one recorded by `accessLog`; the
   surviving refusal is per-**target**: `refuseVendorStaffTarget`
   (`services/memberships/vendorGuards.js`) 403s any membership write targeting a Doorline staff
   account (`STAFF_SELF_MINT`) on `/admin/memberships` and all four `leadCrew` writes. Pinned by
   `supportAccess.int.test.js` and `perCampaignCrews.int.test.js`. Never re-add the blanket.]*
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
   *[v4 2026-08-08: the BREAKDOWN-table twin changed mechanism, not exposure. `'__other__'` became a
   first-class ADMIN reporting bucket (`mergeOptionRows` seeds it), so `computeSurveyBreakdowns` can
   no longer identify a write-in by "id is null" — it now folds `id == null || id === '__other__'`
   into the single public `Other` row explicitly. Net promise unchanged and re-verified: exactly one
   row reads 'Other', counts are preserved, no typed string reaches a client. `publicPointAnswer`
   itself is untouched. Pinned by a new exactly-one-`Other` assertion in `reportSecurity.int.test.js`
   — the prior assertion read a `Map` keyed on the label, which silently last-wins and could not have
   caught a duplicate. **No published legal text changes.**]*
10. **Share links**: `robots.txt` now has `Disallow: /r/` and the `/r/` pages inject
    `<meta name="robots" content="noindex, nofollow">` (client-JS only — no `X-Robots-Tag` header, so
    robots.txt is the load-bearing control). A password **can no longer be removed** from a link
    (`SHARE_PASSWORD_REQUIRED` — replace or rotate). An operator bulk **revoke-legacy** switch exists
    (deliberately not automatic). Legacy links otherwise remain live — see gaps. *[2026-08-07:
    revoke-legacy now carries a per-route `requireOrgRole('admin')` — before this, any team lead
    could enumerate and bulk-revoke the org's legacy-open links, including on campaigns they held no
    grant for. Pinned in `reportSecurity.int.test.js`.]* *[v6 2026-10-24, the client reports upgrade
    (item 38): robots.txt is no longer the control and no longer disallows `/r/` — a crawler kept out by
    robots.txt never fetches the page, so it never sees a noindex, and can still list a forwarded link's
    bare URL. Every `/r/` HTML response now carries `X-Robots-Tag: noindex, nofollow` (the SPA fallback in
    `app.js`, the only place that HTML is served; pinned in `staticPages.int.test.js`), and so does every
    `/api/share` response, beside `Cache-Control: no-store`. The client-side meta stays. The revoke-legacy
    switch now also bumps each swept link's credential version.]*
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
- The 60-day read-only export window — the `canceled` branch of `middleware/entitlement.js`,
  **plus the export-creation carve-outs** (`POST /admin/exports` and its count-only
  `/estimate` preview are the two writes a read-only org may perform — see the v4 2026-08-01
  Export Center entry below).
  *[v6 2026-10-24: and, since item 37, the four writes that END access — delete an account, remove a
  member, and both Deactivates. Nothing that turns access back on rides through.]*
- Backups *"up to 12 months"* — an **Atlas console setting, not code**; verify against the console.
- Geocode cache *"expire automatically after 18 months of disuse"* — the TTL index, inert until built.
- The 180-day name retention on deletion records — still cron-kept on the worker dyno.
- *(v4 2026-08-08)* **Do-not-knock: a NEW category of personal data, with a NEW retention shape.**
  Address-level suppression shipped ([DO_NOT_KNOCK.md](DO_NOT_KNOCK.md)). Three things a policy
  sentence anchors on, all of them new:
  1. **What we collect.** `DoNotKnockAddress.reason` is **required free text attached to a specific
     residential address**, and in practice will describe the people living there ("man at this
     house threatened a canvasser"). That is a free-text note about identifiable individuals, held
     against their home address, and it is written by staff, not the data subject. The nearest
     existing analogue is `Voter.doNotContact.reason`, which the policy already covers under
     "Canvassing activity — contact preferences"; **this one is broader, because the subject is a
     household rather than a named registrant, and can therefore describe people who are not in the
     voter file at all.**
  2. **Retention.** The record is **permanent by design and deliberately survives campaign
     deletion** — that survival is the feature's core requirement, not an oversight (a request must
     outlive the campaign it was made in, or "never come back" quietly expires). It is swept by
     **org** deletion only (`ORG_SCOPED`, verified by `doNotKnock.int.test.js` case 12). No TTL,
     like everything else here. **Any published sentence implying campaign deletion removes the
     personal data collected during that campaign is now narrower than the truth** and must be
     checked against this.
  3. **What we expose.** A new admin surface (`GET /admin/do-not-knock`, web page *Voters →
     Do-not-knock addresses*) lists addresses + reasons + author. It is **org-admin-only** — team
     leads can set and lift per-door but cannot read the org-wide register (they would see campaigns
     they don't manage). It is **not** in the Export Center; if it is ever added there, that is a
     separate export-exposure review.

  **Not a subprocessor event** — no new third party receives anything, so **DPA §6 is not
  triggered** and nothing is gated on customer notice. **Owner decision still required:** whether
  privacy.html's "Canvassing activity" paragraph and the retention section need to name
  address-level suppression records as data that outlives a campaign. Until that is decided, do not
  claim campaign deletion is complete erasure of campaign-era personal data.
- *(2026-07-17)* Do-not-contact enforcement: *"a flagged voter is excluded from walk-list exports
  and new surveys, and a fully-flagged door drops from every campaign type."* True only while the
  `KNOCKABLE_DOOR_FILTER` spread covers every knockable-door site, the export's live-state join
  stays in `walklists.js` export.csv **and in `services/export/exportScope.js` (the Export
  Center's single DNC injection point — see the v4 2026-08-01 entry below)**, and the
  `DO_NOT_CONTACT` backstop stays mounted in
  `routes/mobile/canvass.js`. **The policy now names it** (privacy.html "Canvassing activity" —
  contact preferences: recorded with the reason, used to "exclude that person from the
  organization's future canvassing lists and exports") — that published sentence anchors here.
  *[v6 2026-09-24: **the single-injection-point framing was NOT sufficient, and a shipped file proved
  it.** `services/export/exportScope.js` governs the roster QUERY and the identity COLUMNS; it has
  nothing to say about a free-text cell. A field survey writes one note to BOTH ledgers
  (`routes/mobile/canvass.js:797` and `:875`), so on a door-unit export — where the DNC rule keeps
  the row and blanks the person — a flagged voter's own survey note rode their `survey_submitted` row
  in `activity-log.csv` beside their full street address, name blanked. The published sentence was
  therefore not kept for that cell. Closed at `services/export/exportBuilders.js:637`; full account
  in item 23 of "What changed". **The rule to carry forward: on a door-unit row, do-not-contact
  enforcement is per-CELL, not per-row — any new free-text column on a door-unit export has to be
  classified as identity or not before it ships.**]*
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
  *[v6 2026-10-24: a deleted account's OWN EmailLog rows (userId = the account: invites, resets,
  added-to notices) now lose the address and any bounce text — by account, never by address (item 37).
  Warning and support-notice rows carry no userId and keep their recipients, as evidence.]*
  *[v6 2026-10-24 — item 39: a new kind, `pacePauseAlert` (automatic pause): one row per recipient, each
  with `meta.userId` when the recipient has an account, so it is scrubbed by account at deletion like the
  personal sends; the billing-contact fallback carries no account and keeps its address for the 365 days,
  as the billing notices do. Its subject is the same neutral sentence every time and names no one, so
  nothing about the paused person reaches the log or the super-admin Emails page.]*

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
  to name if a customer-facing *"deleting a campaign removes…"* sentence is ever written.
  *[v5 2026-08-05: **wrinkle CLOSED** — `CoordinatorChange` is now in `CAMPAIGN_SCOPED`
  (`deleteCampaign.js`), so a campaign delete removes its `campaignId`-bearing rows; null-campaignId
  (old-model) rows survive by the filter's construction and still die with the org. See the
  2026-08-05 background-deletion entry in the v5 list.]*]*
  *[v5 2026-08-14: **THE SURFACE THIS ENTRY RESERVED NOW EXISTS — and it is NOT org-admin-only.**
  Twice above this entry says *"nothing exposes it over the API today… if a surface is ever added,
  it belongs behind org-admin auth and must be listed here."* Listing it: **GET
  `/admin/campaigns/:campaignId/history`** (`routes/admin/campaigns.js`) reads `CoordinatorChange`
  rows for one campaign and renders them in the web `CampaignHistoryDrawer` and the mobile
  `admin/history.jsx` screen (added 2026-08-14; **same endpoint, same `canManageCampaign` gate, no
  new access path** — a second renderer of an already-listed surface, not a second surface). The gate is
  **`canManageCampaign`, which admits a TEAM LEAD for a campaign they manage** — deliberately wider
  than the "org-admin auth" this entry anticipated, so the deviation is stated rather than slipped
  in. **Why it is still correct:** the rows disclose a staff-to-staff org-chart association
  (who moved teams, from whom, to whom, by whom) plus two row counts — and a lead already sees
  every one of those facts about their own campaign through the crew roster, the coordinator picker
  and the per-team door breakdown (`/admin/reports/team-breakdown`, same `canManageCampaign` gate).
  Nothing here is newly legible to a lead; it is the same facts with a timestamp. Only
  `campaignId`-bearing rows are read — legacy null-campaignId rows are excluded by the query, so
  the old org-wide moves gained no reader at all. **Still no voter data, no free text about any
  person, no export, no subprocessor, no retention change.** Actor names resolve through
  `hydrateCanvassers`, so a deleted account renders as its scrubbed tombstone ("Deleted user")
  rather than resurrecting a name the deletion removed. **The Assessment above stands unchanged: no
  published-policy sentence moves.** Pinned by `test/campaignHistory.int.test.js` (the lead-403 on
  an unmanaged campaign, and the legacy-row exclusion).]*
- *(v5 2026-08-14)* **New internal collection: `CampaignChange`.** A team lead can now set a
  campaign's **door goal** — a contract number — so campaign configuration edits are recorded:
  `server/src/models/CampaignChange.js`, one row per field per edit.
  **What it holds:** `organizationId`, `campaignId`, the `field` key, `fromValue`/`toValue`, the
  acting `byUserId`, and a `source` enum. The values are campaign *configuration* — a door count, a
  civil date, a boolean policy, a campaign name — **not data about any person**. The only personal
  reference is the actor id, exactly as `CoordinatorChange` carries one. It is a new **audit log**,
  a named trigger, hence this entry.
  **Which fields:** an explicit `AUDITED_FIELDS` allowlist — `doorGoal`, `goalDate`, `electionDay`,
  `earlyVotingStart`, `earlyVotingEnd`, `datesNote`, `billRestrictedDoors`, `isActive`, `name`,
  `type`, `state`. `datesNote` is the one free-text field in that list; it is operator-authored
  campaign metadata (polling hours, a clerk's-office address), the same exposure class as the
  campaign title, and it is already visible to canvassers on the campaign picker.
  **Who can read it:** GET `/admin/campaigns/:campaignId/history`, gated by `canManageCampaign` —
  org admins for any campaign, a lead for campaigns they manage. Never reaches a canvasser, never
  reaches a public share link, never enters an export.
  **Retention/deletion:** no TTL. In **both** `CAMPAIGN_SCOPED` (`deleteCampaign.js`) and
  `ORG_SCOPED` (`deleteOrganization.js`) from the day it shipped — deliberately not repeating the
  v4 wrinkle where `CoordinatorChange` outlived the campaigns its rows named.
  `test/orgDelete.int.test.js` proves the org sweep exhaustive; `test/campaignHistory.int.test.js`
  proves the campaign cascade removes it.
  **Assessment: NO published-policy change.** Nothing leaves the tenant, no subprocessor receives
  it, no new category of personal data about a *voter* is collected, and it dies with the campaign
  and with the org. Same shelf as `CoordinatorChange`, `EmailLog` and `AccessLog` if a data
  inventory is ever published: *deleted with the campaign and the organization, no TTL,
  console-only.*
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
  clients instead. *[v6 2026-10-10: renamed again — the sort to **"Recent password login"** and the
  column to **"Last password login"** — because a used sign-in is now extended without a typed password
  (gap 29), so the date can honestly read months old for a daily user.]* Had this field reached org
  admins it **would** have needed new published-policy
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
  *[v6 2026-10-10: tokens are now extended while used, up to 90 days from the typed password (gap 29);
  the deleted-account refusal still runs before the stamp, so this holds.]*
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

- *(v4 2026-07-29)* **⚠️ NEW DATA-SUBJECT CLASS: prospects. Needs an owner decision on the published
  Privacy Policy.** The marketing site's "Request a demo" CTA was a `mailto:` and is now a real form
  (`POST /api/demo-request`, `server/src/routes/public/demoRequest.js`). It collects a **name, work
  email, organization, and optional free-text message, volunteered by a member of the public** — a
  person who is not a user, not a voter, and not a customer.
  **This is the part to look at, not the mechanics:** `client/public/privacy.html` enumerates exactly
  three collection categories, and its account paragraph reads *"When an administrator creates an
  account for you…"* — i.e. it currently describes a product in which personal data is **never**
  self-submitted by a stranger. That sentence is not false yet (a demo request is not an account),
  but the policy has no category this data belongs to. **Owner decision: whether to add a sentence
  covering information volunteered through the website.** The static legal pages are edited
  deliberately by the owner, never as a side effect of code — so this entry records the gap rather
  than closing it.
  What keeps the exposure minimal, and both are load-bearing invariants, not incidental:
  **(a) Nothing is stored.** There is no `Lead`/`DemoRequest` model and there must not be one without
  a fresh review. The submission becomes an email and nothing else; the only persistent trace is the
  metadata-only `EmailLog` row, whose `to` is *our own* address (`DEMO_REQUEST_TO`), so it holds no
  prospect PII. The subject is deliberately `Demo request — {organization}` with the name and address
  confined to the unlogged body — subjects are copied verbatim into `EmailLog` and shown on
  `/super-admin/emails` for 365 days.
  **(b) No new subprocessor.** Mail goes via Resend, already disclosed in `DPA.md` §6. Bot defence is
  a **honeypot + a time-to-submit floor**, chosen specifically because a hosted captcha (Turnstile /
  hCaptcha / reCAPTCHA) would receive end-user IP and browser signals and therefore be a new
  subprocessor — a **DPA §6 customer-notice event, not a code decision**. If anyone later reaches for
  a captcha, that gate applies.
  Guard test: `server/test/demoRequest.test.js` (subject carries no prospect identifier; bot
  rejections send nothing). Reference: `docs/MARKETING_SITE.md`.
  **Assessment: NO published-policy sentence becomes FALSE. One published-policy sentence becomes
  INCOMPLETE — flagged above for the owner.**

- *(v4 2026-07-29)* **Recorded as a NEGATIVE, plus the trap that would turn it positive: the mobile
  Users list is now campaign-PARTITIONED, and that is NOT privacy-affecting.** Picking a campaign on
  `mobile/app/(app)/admin/users.jsx` used to annotate and re-sort one flat list of every org member;
  it now renders two sections — **"On this campaign (N)"** first, then **"Not on this campaign (N)"**
  collapsed behind a reveal with the bulk-assign action inside it. Written down because "the users
  list changed" is exactly the sentence that sends the next reviewer to the privacy checklist, and
  the answer should not have to be re-derived.
  **Why it clears every trigger.** No new field. No route change and **no new query parameter** — the
  screen still calls the parameterless `GET /admin/memberships` plus
  `GET /admin/campaigns/:id/assignments`, and the roster it partitions on was already on the client
  from the second of those; the change is one pass over an array. Response bytes identical, recipient
  the same already-authenticated console user, no export, no third party. The visible set is
  **partitioned, not filtered**: every row a viewer could see before is still reachable, one tap away.
  And the server-side lead scope is untouched — `GET /admin/memberships` still runs
  `if (!isOrgAdmin(req)) { … leadVisibleUserIds … }` (`routes/admin/memberships.js:182-185`), so a
  team lead's visible set is byte-identical and merely regrouped. **This narrows or holds; it never
  widens** — the only direction that needs no review.
  **TRAP 1 — do NOT move the partition to the server as `?campaignId=`. That WOULD be
  privacy-affecting.** A query parameter that changes which *people* a route returns is a new access
  path and belongs in this document. If it is ever added it must **INTERSECT** with the lead filter,
  never replace it: `leadVisibleUserIds` narrows first, the campaign scope narrows what survives.
  Replacing it hands a lead every member of any campaign id they can name — a real widening, and
  precisely the shape of the "scope the query instead of filtering the result" refactor that reads as
  tidier than what is there.
  **TRAP 2 — `GET /admin/campaigns/:id/crew` is not a crew list and must never back a user list.**
  Despite the name and the campaign-nested mount, the handler returns **every active membership in
  the organization** (`routes/admin/leadCrew.js:80` — `Membership.find({ organizationId, isActive:
  true })`), annotated with each person's coordinator *on that campaign*; the per-campaign fact it
  adds is the coordinator, not the membership. Its purpose is to populate a picker of people you
  *could* add. `requireCampaignManager` (`:45`) does still gate which campaign a lead may ask about,
  so this is not a hole — but the answer it gives for that campaign is the whole org's active roster,
  strictly wider than `leadVisibleUserIds`. Sourcing a roster from it would both show every org
  member as if rostered and, for a lead, skip the visibility filter that exists on the list route.
  **Assessment: NO published-policy change, and no claim in this document moves.**
  > **(v4 stamp 2026-08-08) TRAP 2 is now history — the leak it described was the picker itself, and
  > it is closed.** The trap said sourcing a *roster* from `GET /admin/campaigns/:id/crew` would skip the
  > lead visibility filter. What the review missed is that the web campaign Team page **was already
  > doing exactly that**, deliberately: `CampaignTeamPage.jsx` routed leads to `/crew` *because* they
  > cannot reach `/admin/memberships`, so a lead's add-picker returned every active member of the
  > organization — name, email, org role, `isSuperAdmin` — while their own Users list was correctly
  > narrowed to `leadVisibleUserIds`. A team lead may be the client's own campaign manager, so that was
  > one customer's staff list shown to another. `GET /` now returns **this campaign's roster** (rows
  > narrowed, fields unchanged) plus a name-and-role-only `coordinators` array. **TRAP 1 is HONORED, not
  > amended:** no `?campaignId=` was added to `/admin/memberships` and its lead filter is untouched —
  > `/crew` narrowed on its own query, so the two routes stay independent.
  > **This narrows.** No new field, no new retention rule, no new subprocessor, no published-policy
  > sentence affected. See the EXCEPTION 3 stamp below for the add-flow half of the same change.

- *(v4 2026-08-01)* **New surface: the Export Center** (`ExportJob` + the `exportArtifacts`
  GridFS bucket + `/api/admin/exports` + a worker queue). Customers can now queue background
  CSV/ZIP exports — canvassing activity, doors-by-round, survey results (wide + long), a
  RECONSTRUCTION of their voter file (optionally under the vendor's own headers from
  `ImportJob.fieldMapping`), saved-search subsets, voter notes (admin-only; previously
  exportable by NO route, §B8), and an admin-only full-backup ZIP — then download the
  artifact from the campaign's Exports page (web) or the mobile admin Exports screen until
  it expires. A new collection holding a *file of customer data at rest* is a named trigger,
  hence this entry. Docs: [EXPORTS.md](EXPORTS.md).
  **What it holds.** `ExportJob`: org/campaign ids, the export type + frozen filter params,
  requesting user, status/progress, row/byte counts, `excludedDncCount`/`orphanedRows`
  (honesty counters), capped subject-voter ids for audit tagging, and a pointer to one CSV or
  ZIP artifact in the `exportArtifacts` GridFS bucket — **in the SAME MongoDB Atlas
  deployment. No new subprocessor; DPA §6 unchanged, no customer notice event.** The
  artifact contains voter/canvasser data the same tenant already reads in-app.
  **Who can read it.** Org admins; team leads only for campaigns they manage
  (`canManageCampaign`) — the same audience as the five pre-existing CSV endpoints (§B8).
  Org-wide bundles, voter-notes, and the full backup are admin-only. *[v6 2026-09-01: still true
  of those TYPES, but no longer of voter-note CONTENT — the new lead-visible `notes` type exports
  `VoterNote` bodies too. Owner ruling; see item 17(b) of "What changed".]* Staff access rides the
  fail-closed central access log: the download route classifies as `exports` (never
  audit-exempt), and because a streamed response defeats accessLog's row counter, the
  ExportJob doc itself is the durable record of rows/bytes and the download tags
  `addAuditSubjects` from the post-DNC id set the worker persisted. `isInternal` orgs write
  no AccessLog rows — by design, unchanged here.
  **Retention/deletion.** Artifacts expire after `EXPORT_TTL_DAYS` (7) via the
  `sweep-expired-exports` maintenance job (in `MAINTENANCE_JOBS`, deliberately NOT the
  pinned retention-only `REPEATABLE_JOBS`); the sweep also clears failed-job leftovers and
  orphan files. `ExportJob` is in `ORG_SCOPED` and `CAMPAIGN_SCOPED`, and both delete
  cascades purge the bucket by metadata (`deleteArtifactsForScope`) — **an export artifact
  must not outlive the org**, or the "we aim to permanently delete" sentences (privacy.html
  "After termination", DPA §9) go false for a file at rest. Pinned by
  `test/orgDelete.int.test.js` + `test/exports.int.test.js`.
  **The entitlement carve-outs.** `POST /admin/exports` — and `POST /admin/exports/estimate`,
  the count-only preview that returns numbers, never records *(correction stamped 2026-08-06;
  it shipped with the same Export Center change)* — are the TWO writes a read-only
  (suspended / expired-trial / canceled) org may perform — method-and-path exact ×2, in
  `middleware/entitlement.js` — so the published wind-down window ("may export its data
  during that period", privacy.html; terms.html §13; DPA §9) is real for the queued-export
  path, not just legacy GETs. The watchlist's 60-day line above anchors here too. Narrowness
  guard-tested (`test/billing.int.test.js`: control write and export-DELETE still 402).
  *[v6 2026-10-24: no longer the only writes — item 37 adds the four that END access (delete an account,
  remove a member, both Deactivates), method-and-path exact and anchored; Reactivate and every other
  write still 402 (`test/orgAccountDeletion.int.test.js`).]*
  **Assessment: NO published-policy sentence changes; two get TRUER.** (a) DPA §7's "including
  through the Service's export … capabilities" was an over-statement against §B8's "no
  full-account export" — the Export Center closes it. (b) The wind-down export sentences were
  kept true only by read-only GETs; the carve-out makes them fully true. (c) privacy.html's
  "exclude that person from the organization's future canvassing lists **and exports**" stays
  true the STRICT way (owner decision 2026-08-01): every builder receives the flagged-voter
  set from ONE injection point (`services/export/exportScope.js`) — voter-unit rows are
  dropped, door-unit rows keep the knock with every voter-identity column blanked and no
  marker — and a registry-driven test iterates every export type asserting the flagged
  fixture voter appears in NO artifact (`test/exportBuilders.int.test.js`). Documented
  consequence: export totals can undercount dashboards; `excludedDncCount` on every job makes
  the gap explainable.
  **Claims to keep true:** DNC exclusion in every builder, forever (the registry test is the
  tripwire); the carve-out stays scoped to export creation alone; artifacts TTL'd + purged on
  org/campaign delete; the voter-file export remains a RECONSTRUCTION (raw uploads stay
  deleted — §B8's "cannot be re-downloaded" remains TRUE, no retention change);
  `Campaign.pricePerCampaignCents` (select:false) never enters a builder projection
  (grep-guarded in the same test).

  *(v4 amendment 2026-08-02)* **Export preview + match-key columns + registry-served copy.**
  Three changes to the surface above, none of which moves a published-policy sentence:
  **(i) `POST /admin/exports/estimate`** — a pre-queue row-count preview (same auth and
  lead/campaign scoping as the create via a shared scope resolver, same validated params).
  It returns COUNTS ONLY (`rows`, `dncWithheld`, `approx`, a per-survey-file breakdown) — no
  artifact, no record-level data, no `addAuditSubjects`; it classifies as `exports` in the
  access log like its siblings (`test/accessLogCoverage.int.test.js`). **This amends the
  claim above that "the carve-out stays scoped to export creation alone": the entitlement
  carve-out is now export creation PLUS this read-only estimate** (a read wearing POST —
  method-and-path exact ×2 in `middleware/entitlement.js`; a wind-down org must be able to
  preview what it is about to export). Still no other write rides through — export DELETE
  remains 402; narrowness re-pinned in `test/billing.int.test.js`.
  *[v6 2026-10-24: amended again by item 37 — the four writes that END access also pass in a read-only
  org. Still nothing that turns access back on.]*
  **(ii) Match-key columns.** The `Voter ID` header in the activity/survey/notes CSVs is
  renamed `State voter ID`, and a `UID` column (the vendor id from the customer's own import,
  `Voter.uid`) is added beside it in those four files. Same-audience data: `uid` already
  leaves via the voter-file/filtered exports' canonical columns to the identical audience, so
  the "artifact contains voter/canvasser data the same tenant already reads in-app" sentence
  above stays true. Every new cell derives from the DNC-guarded voter object — a
  do-not-contact person's UID is blanked/dropped exactly like their name — and the
  registry-driven leak sweep now carries flagged-fixture `uid` values, so the new column is
  under the same "appears in NO artifact" guarantee (`test/exportBuilders.int.test.js`).
  Also fixed: a dangling `voterId` in the activity export now counts into `orphanedRows`
  instead of blanking silently (honesty counter, no data change).
  **(iii) `GET /admin/exports/types`** serves the registry's user-facing labels/descriptions,
  role-filtered — copy only, no customer data. The mobile Exports screen gains per-type
  filters and the estimate before queueing; nothing new is exposed there beyond (i)–(ii).
  **Assessment: NO published Privacy Policy / ToS / DPA sentence changes; no new
  subprocessor; DPA §6 untouched.**

- *(v5 2026-08-02)* **Recorded as a NEGATIVE: an admin can now delete a survey response from the
  PHONE, and that is NOT privacy-affecting.** The mobile admin app gained a **Duplicate surveys**
  screen (`mobile/app/(app)/admin/duplicate-surveys.jsx`, More → Manage), the twin of the web report,
  and an org admin can delete an extra response in place from an expanded card. Written down because
  "an admin can now erase survey answers from a phone" is exactly the sentence that sends the next
  reviewer to the checklist — and what it erases is GDPR Art. 9 material (political opinions bound to
  a named voter, §(d) above), so the answer should not have to be re-derived.
  **Why it clears every trigger.** **No server change of any kind** — both routes shipped long ago and
  are byte-identical: the report is `GET /admin/reports/duplicate-surveys`, the delete is
  `DELETE /admin/voters/:voterId/surveys/:responseId`. **No role gains anything**: `admin/voters.js` is
  `requireOrgRole('admin')` router-wide, so a team lead 403s regardless of what the app renders (the UI
  gate exists for honesty, not security, and the refusal is now pinned by `test/teamLead.int.test.js`).
  Retention semantics are unchanged — same org-scoped `findOneAndDelete`, same `bumpCampaignStats`
  (`surveyCount` only; the `survey_submitted` CanvassActivity row survives), same
  `recomputeSurveyStatus`. No new field, no new query parameter, no export, no third party, no TTL or
  cascade change. The audit trail is client-agnostic: `router.param('voterId')` calls
  `addAuditSubjects(res, 'voter', …)` and `accessLog` records at response-finish for every `/admin`
  request, so a delete from a phone logs exactly like a delete from the browser
  (`test/accessLogCoverage.int.test.js`).
  **The two things that DO change, and why they are written here rather than assumed.** (1)
  `routes/admin/voters.js` — a **PII-returning** route file — gains a second client for the first time,
  so it now appears in `npm run audit:mobile-api` and any future edit is a mobile-facing change. That
  is a fact about the review surface even though no route moved. (2) The delete **responds with a full
  rebuilt voter profile**, richer than the screen renders — the same shape as the §B finding about a
  list rendering city/state while the JSON carries the full street address. The client therefore
  **discards the body and invalidates instead of seeding it into the cache**; mobile has no react-query
  persister, so nothing of it reaches the AsyncStorage stores catalogued in §C9(d). Keep it that way.
  **Assessment: NO published Privacy Policy / ToS / DPA sentence becomes false or incomplete; no new
  subprocessor; DPA §6 untouched.**

- *(v5 2026-08-02)* **New retained data class: replaced (superseded) survey responses — POSITIVE.**
  When a second canvasser's same-round submit replaces a teammate's survey answers (and on every
  admin restore swap), the displaced response is now snapshotted whole into a new
  **`SurveyResponseArchive`** collection before the write, instead of being destroyed
  (`services/surveys/archiveOverwrite.js`; docs [SURVEYS.md](SURVEYS.md) §F). A same-canvasser
  re-submit still replaces silently — the designed self-heal, nothing archived *(2026-10-19: except
  over answers an admin desk-entered, which are now archived too — item 31)*. This is a new
  place personal data lives, so it is recorded here as a POSITIVE entry.
  **What it holds.** A full former `SurveyResponse`, verbatim: the Art. 9 answer content including
  free text and the note, the canvasser's `userId`, the GPS stamp (including `mocked` /
  `fixTimestamp`), timestamps, pass/turf/effort context, and any `editedBy`/`editedAt` admin-edit
  audit — plus server-stamped provenance (`overwrittenBy`/`overwrittenVia`/`overwrittenAt`, never
  accepted from a request body). The same CATEGORIES of data as current responses — no new field
  class — but potentially more rows per voter per round.
  **Who can read it.** Org admins, via the voter profile (`overwrittenSurveys[]` + the
  preserved-response card with its Restore), the Duplicate surveys report (the
  `sameRoundOverwritten` kind) and the response detail's archived fallback; team leads see the
  report read-only (no restore, no erase — both routes sit in `admin/voters.js`,
  `requireOrgRole('admin')` router-wide). Canvassers never see archive content — the door wire
  carries only the `surveyedByMe` boolean, no names, no answers.
  **Retention/deletion.** Kept while the org is active. Restorable — the restore is a lossless
  swap that consumes the archive row it promotes; each row is individually erasable via
  `DELETE /admin/voters/:voterId/surveys/archive/:archiveId` (overwritten Art. 9 content must
  never be undeletable). Cascades verified: org delete (`ORG_SCOPED` + the sweep test), campaign
  delete, pass clear-knocks (including the snapshot round-trip), demo rebuild. Account deletion
  mirrors `SurveyResponse`: the row is retained as part of the org's field record, with names
  de-identified by the existing purge.
  **Exports.** Structurally never read — no export builder queries the archive collection, and the
  registry-driven leak sentinel is pinned in `test/exportBuilders.int.test.js`.
  **Assessment: NO published Privacy Policy / ToS / DPA sentence becomes false** — privacy.html
  :90/:118/:122/:128 already cover retained canvassing records reviewed by org admins, and no
  published sentence promises one-response-per-voter; no new subprocessor, DPA §6 untouched.
  **Claim to keep true:** a replaced response is admin-visible, tenant-confined, structurally
  excluded from stats and exports, and dies with the organization.

- *(v5 2026-08-04)* **POSITIVE fix: the crashed-import raw-upload orphan leak is CLOSED.** Gap 10
  below and the B5 "best-effort" paragraph recorded that a failed or crashed import left the
  **complete uploaded voter file** in the `rawImports` GridFS bucket forever — no TTL, no deletion
  path, and (after an org-deletion retry) no key left to find it. Three mechanisms now close it,
  each code-verified: **(i)** the import processor classifies a missing raw file, an oversized file,
  or an unparseable one as `UnrecoverableError` and **deletes the raw upload immediately**
  (`importProcessor.js` — terminal, no retry will read it again); **(ii)** a **nightly sweep**
  (`sweepStaleImportJobs`, 05:53 UTC, `IMPORT_SWEEP_JOB` in the maintenance queue) scans the
  **bucket itself** — `rawImports.files` older than 24h, resolving each file's `ImportJob` by the
  filename convention — and deletes any whose job is terminal **or missing**, so pre-fix orphans and
  files stranded by a swallowed delete are reached without needing the destroyed jobIds; it also
  removes stray worker temp files (`tmp-*` ExcelJS spools, `import-spill-*`, `xlsx-norm-*`
  entry-order-normalized copies) older than 24h;
  **(iii)** a one-off console script (`npm run sweep:raw-imports`, root-proxied for the Heroku Run
  console) purges the accumulated backlog on demand. The same release makes a stuck import **fail
  with a message within minutes** (heartbeat + CAS expiry in `GET /admin/imports/:importId` and the
  sweep) instead of spinning in an active status forever. The per-call `.catch(() => {})` in
  `rawImportStore.deleteRawImport` remains, but a swallowed delete is now retried nightly rather
  than orphaned permanently. Retention effect: raw uploads now have a **bounded lifetime on every
  path** — deleted at job completion (unchanged), at unrecoverable failure (new), or by the sweep
  within ~24h of the job going terminal/vanishing (new).
  **Assessment: NO published Privacy Policy / ToS / DPA sentence changes — this makes the existing
  "the original file is deleted after import" practice true on the failure paths too; no new
  subprocessor; DPA §6 untouched.**

- *(v5 2026-08-04)* **NEW disclosure: transient voter-file copies on dyno ephemeral disk.** The
  import pipeline now deliberately uses **disk instead of heap** in four places, each holding voter
  PII briefly: **(i)** web-dyno uploads land via multer **`diskStorage`** in the OS temp dir (never
  in the web dyno's RSS) and are unlinked on the response `'close'` event — success, failure, or
  client abort; **(ii)** the worker's apply path spills valid rows to
  `import-spill-<jobId>.ndjson` (+ a `-linked` twin) in the OS temp dir, both removed in a
  `finally` — success OR failure; **(iii)** ExcelJS's streaming reader spools decompressed sheet XML
  to `tmp-*` files with its own cleanup callback; **(iv)** an xlsx whose zip entry order would
  corrupt the streaming parse is first rewritten to a `xlsx-norm-*.zip` copy in the OS temp dir
  (same content, reordered entries), unlinked in a `finally`. Lifetime is the **request or the
  job**; nothing is at rest past it. Failure modes are bounded: a SIGKILL can beat a `finally` or
  skip ExcelJS's cleanup, so the nightly sweep (entry above) removes all three patterns after 24h —
  and the dyno filesystem is itself ephemeral (destroyed on restart, daily on Heroku). No new
  audience, no new storage service (the OS temp dir of dynos we already run), no export.
  **Assessment: NO published Privacy Policy / ToS / DPA sentence becomes false — processing-time
  copies on our own compute, shorter-lived than the GridFS staging copy already disclosed; no new
  subprocessor; DPA §6 untouched.**

- *(v5 2026-08-04)* **Recorded as a NEGATIVE: `saxes` + `unzipper` promoted to direct
  dependencies — NOT a subprocessor event.** `server/package.json` now lists `saxes@^5.0.1` and
  `unzipper@^0.10.14` directly (the xlsx header-peek, `peekUpload.js`). Both were **already
  installed** as transitive dependencies of `exceljs` (their sole prior dependent) — the installed
  tree is unchanged. They are in-process parsing libraries: no network, no telemetry, customer data
  never leaves the dyno. Written down because "new third-party name in package.json" is exactly what
  sends the next reviewer to the DPA §6 checklist, and the answer should not have to be re-derived.
  **Assessment: no new third party processes personal data; the DPA §6 subprocessor list and the
  Privacy Policy's service-providers paragraph are correct unchanged.**

- *(v5 2026-08-04)* **Data-trim: `diff.samples.errors` is no longer produced or persisted.** The
  §C-9 finding at "ImportJob permanently retains voter PII" listed the persisted preview `diff`
  among the permanent PII carriers. One redundant slice of it is gone: `computeImportDiff` no longer
  emits a `samples.errors` array (raw per-row error objects carrying `stateVoterId`), which the
  preview path was persisting into `ImportJob.diff` while `ImportJob.errors` already held the same
  rows — the client never read the copy. The moved-voter / near-dup / hand-edit samples and
  `errors[]` itself remain exactly as recorded there; this deletes a duplicate, not the class.
  **Assessment: strictly less PII persisted; NO published Privacy Policy / ToS / DPA sentence
  affected; no new subprocessor; DPA §6 untouched.**

- *(v5 2026-08-05)* **Campaign hard-delete is now a BACKGROUND JOB, `CoordinatorChange` joined its
  cascade, and the 16MB undeletable-campaign cliff is closed.** Retention/deletion trigger class —
  examined in full. What changed: `DELETE /admin/campaigns/:id` no longer runs the cascade inside
  the web request (a 106,958-door delete blew Heroku's 30s router limit — the browser got a 503
  while the dyno finished the delete anyway, i.e. the *reported* outcome of a deletion diverged
  from the *actual* one). The route now stamps `Campaign.deletion` and enqueues on a dedicated
  `campaign-delete-queue`; the worker runs the same `deleteCampaignCascade`
  (`services/campaigns/deleteCampaignProcessor.js`). Deletion therefore **completes within minutes
  rather than within one request** — while in flight the campaign is quarantined everywhere (404s
  on every campaign-scoped route, out of every list, canvassing walled, imports/exports/turf jobs
  refused), so no *new* reads of the data occur during the window. Four privacy-relevant facts:
  **(i) New metadata, not about voters:** `deletion.requestedBy` records WHICH admin requested the
  delete (plus timestamps/status/error). Same class as `User.lastSeenAt` (v4): an identified-staff
  behavioral signal, tenant-internal, org-admin-visible via the Campaigns list only while the
  campaign still exists, and it is destroyed WITH the campaign row at cascade end (a failed delete
  retains it until Retry completes — on a row already scheduled for destruction). No published
  sentence enumerates campaign-level metadata; nothing to change.
  **(ii) `CoordinatorChange` now cascades** — the v4 wrinkle reserved exactly this: campaignId-bearing
  team-change rows no longer orphan when their campaign dies (null-campaignId rows still die with
  the org, as before). Strictly MORE deletion than recorded.
  **(iii) The 16MB cliff (retention-promise robustness):** two `distinct()` calls in the delete path
  (`deleteCampaign.js` VoterNote join, `platformStats.js` capture) returned single BSON documents
  hard-capped at 16MB — at roughly ~600k voter rows a campaign would have become **permanently
  undeletable through the product** (the cascade would throw before destroying anything). Both are
  now cursors/reversed joins; deletion works at any size. A failure mode in which we could not
  honor "delete this campaign's data" is gone.
  **(iv) Failure is now visible:** a mid-cascade crash used to be an anonymous 500; now the campaign
  reads "Delete failed" with Retry for the org admin, and failed/stuck deletions surface on the
  super-admin retention-health endpoint (`campaignDeletionHealth` in
  `routes/superAdmin/access.js /health/retention`) — a half-deleted campaign can no longer sit
  silently. The half-deleted state itself is quarantined (invisible-inert) until Retry finishes.
  No new third party, no new export, no new access path; the wire shape adds a `deletingCampaigns`
  array on `GET /admin/campaigns` carrying the same fields the list already served plus
  `deletionStatus`/`deletionError` (no voter data). Exercised end-to-end by
  `test/campaignDeleteJob.int.test.js` (13 cases incl. the CoordinatorChange sweep, DNC parking,
  and note re-pointing).
  **Assessment: NO published Privacy Policy / ToS / DPA sentence changes — no published sentence
  promises synchronous campaign deletion, and the v4 entry above explicitly reserved the
  campaign-delete sentence for this event. Flagged for owner confirmation per the repo rule. No
  new subprocessor; DPA §6 untouched.**

- *(v5 2026-08-05)* **ORGANIZATION deletion is now a background job on one queue for all four
  paths, the cascade is chunked, and three defects in it are closed — one of them a leak of
  do-not-contact identifiers.** Retention/deletion trigger class — examined in full. The four
  callers of `deleteOrganization` (break-glass route + wind-down + dormancy + delete-on-request)
  now all CAS-stamp `Organization.deletion` and enqueue on `org-delete-queue`
  (`services/platform/enqueueOrgDelete.js` → `deleteOrgProcessor.js`). Seven things a reviewer
  should know, in order of how much they matter:
  **(i) A do-not-contact leak between the two cascades is CLOSED.** `deleteCampaignCascade` *upserts*
  a `DncPendingId` row (organizationId + stateVoterId) when a flagged person loses their last voter
  row — and `DncPendingId` is in the org cascade's `ORG_SCOPED` sweep. A campaign-delete job parking
  one AFTER the org sweep had passed that collection left a real person's **state voter identifier,
  held precisely because they asked never to be contacted, surviving the deletion of the
  organization that held it.** `deleteCampaignProcessor` now refuses at claim time when its org is
  stamped (`UnrecoverableError`, no retry — the org cascade owns those rows). The same guard closes
  a second, quieter corruption: `captureOrgBeforeDelete` and `captureCampaignBeforeDelete` banking
  the same rows twice into the permanent `deleted` marketing bucket, which the nightly reconcile
  never corrects.
  **(ii) The per-org error-isolation gap is CLOSED** (see the stamped bullet in §B6): one bad org
  can no longer abort the nightly sweep and silently skip the delete-on-request stage that backs the
  30-day promise.
  **(iii) A retention-tombstone bug is FIXED.** `DeletedUserRecord.deleteMany({organizationIds:
  {$size: 0}})` was **unscoped**, so deleting org A destroyed the tombstone of any unrelated user
  who happened to hold no memberships — and that tombstone is what backs the published 180-day
  identity-retention window. Now scoped to the records this cascade actually detached.
  **(iv) Scale, which is a retention-promise property here, not a performance one.** The Person
  purge ran FOUR sequential queries per Person (~2.4M round trips at 600k people — hours) behind a
  `Voter.distinct('personId')` whose single-BSON-document 16MB cap would eventually have made a
  large org **undeletable outright**. Both are now cursor-fed chunks (4 queries per 5000). GridFS
  artifact deletion is bounded too. A failure mode in which we could not honor "delete this
  customer" is gone.
  **(v) New metadata, not about voters:** `deletion.{requestedAt, requestedBy, source, requestId,
  status, heartbeatAt, error}`. `requestedBy` names WHICH staff member ordered a break-glass delete
  (null for the crons — there is no user behind a nightly sweep; `source` carries the attribution
  that exists). Same class as `User.lastSeenAt` (v4): identified-staff, staff-visible only, and
  destroyed WITH the org at cascade end.
  **(vi) Reduced exposure during the window.** A stamped org is walled at
  `middleware/orgContext.js` — every `/admin` and `/mobile` request 404s, for members AND for
  platform staff — so nobody reads (or writes into) a half-destroyed tenant, and no `AccessLog` row
  is created naming an org that is about to stop existing. The identity console repeats the wall in
  `requirePersonOrgGrant`, the one staff surface that bypasses `orgContext` by design.
  **(vii) Failure is visible.** Stuck/failed org deletions surface on
  `GET /super-admin/access/health/retention` as `orgDeletions`, and an overdue deletion **request**
  whose org is genuinely in flight no longer reads RED (it reports `inFlight` instead) — that was a
  new false alarm the async path would otherwise have introduced.
  No new third party, no new export, no new access path. Wire change: `GET /super-admin/organizations`
  gains a `deletingOrganizations` array (same fields, plus `deletionStatus`/`Error`/`Source`; no
  customer data), and the break-glass DELETE answers `202` instead of a counts summary. Exercised by
  `test/orgDeleteJob.int.test.js` (12 cases) plus the rewritten `orgDelete` and `retentionTriggers`
  suites, whose exhaustive-sweep guarantee is preserved verbatim.
  **Assessment: NO published Privacy Policy / ToS / DPA sentence changes — verified: `privacy.html`
  says "we **aim to complete** verified deletion requests within 30 days" and DPA §9 "which Doorline
  **aims to** complete within 30 days"; neither says "immediately", and a job finishing in minutes
  sits inside both. §B6's "executes immediately" line is stamped above. Flagged for owner
  confirmation per the repo rule. No new subprocessor; DPA §6 untouched.**

- *(v5 2026-08-06)* **Recorded as a NEGATIVE: printable walk packets put voter PII on PAPER, and
  it is not a new exposure.** "What we expose" trigger class (reports / exports / share links) —
  examined in full because a new medium deserves the check even when the data is old. New surface:
  `GET /admin/campaigns/:campaignId/packets/{sources,data}` (`routes/admin/packets.js` →
  `services/packet/buildPacket.js`), rendering client-side with jsPDF into a printable PDF. Docs:
  [WALK_PACKETS.md](WALK_PACKETS.md).
  **Why it is not a new exposure — three code facts, not a judgment call.** (i) **Same audience.**
  The gate is `requireAuth, orgContext, requireCampaignManager` — byte-identical to
  `routes/admin/walklists.js:21`, and the same audience `exports.js` resolves for
  `voters-filtered`, which is `adminOnly: false`. Nobody can print who cannot already queue a full
  voter export. (ii) **Strictly narrower data.** The packet prints name · party · **derived age** ·
  address · walk-order number · prior-round status, with phone opt-in. That is a strict subset of
  `walklists.js:294`'s eleven columns, and far less than `exportBuilders.js:617-626`, which emits
  raw `dateOfBirth`, `cellPhone`, `phoneType` and household `latitude`/`longitude`. (iii) **This
  class is already ruled.** §B8's browser-generated-download category (no server record, no
  artifact, no AccessLog row for a member reading their own tenant) already contains
  `client/src/lib/reportPdf.js`; the packet is a second member of an existing list, not a new list.
  **No artifact, no new store.** The PDF is built in the admin's browser and never touches the
  server, GridFS, or a queue — there is no `ExportJob` analogue, nothing at rest, and no retention
  question. **No new subprocessor: `jspdf` was already a client dependency and no customer data
  reaches a third party. DPA §6 untouched — no customer notice event.**
  **Suppression is STRICTER than the CSV path, deliberately.** Do-not-contact is joined live and
  **per voter** at generation (`'doNotContact.flagged': { $ne: true }`), not merely via
  `Household.fullyDnc` — that flag needs EVERY resident flagged
  (`services/dnc/recomputeFullyDnc.js`), so a partially-flagged door would otherwise print the
  flagged person. `KNOCKABLE_DOOR_FILTER` is spread for the door set. **No withheld marker of any
  kind** — `exportScope.js:14` forbids it for CSVs and paper is strictly worse, because a volunteer
  standing at the door can see the gap. `dateOfBirth` never leaves the service; `packet.int.test.js`
  asserts the raw date string appears nowhere in the payload, the assertion shape
  `voterPrivacy.int.test.js:155` uses for the mobile wire. `addAuditSubjects(res, 'voter', …)` tags
  the post-suppression set, so a staff support-grant read logs exactly which records printed.
  **The one honest asymmetry, stated rather than hidden.** `privacy.html:94` makes exactly one
  revocation promise and it is scoped to the app — the cached walk list "is deleted when you sign
  out". Paper has no sign-out, no TTL and no purge. But that is the position an already-downloaded
  CSV is in today: `walklists.js:276-279` openly aims that file at a "phone bank, mail house" — it
  is EXPECTED to leave the building, and neither the org-delete cascade nor `EXPORT_TTL_DAYS`
  reaches a file on an admin's laptop. **Paper does not create the gap; it makes an existing gap
  visible.** Whether that "materially decreases the overall protection" under DPA §4 is an owner
  call, not a code question, and is flagged here rather than resolved.
  **Assessment: NO published Privacy Policy / ToS / DPA sentence changes.** Verified: `terms.html:91`
  ("The Customer retains all right, title, and interest in the voter files and other data it
  uploads") and `terms.html:106` (self-export carved out of the anti-extraction clause by name)
  frame this as the customer exporting its own data; `privacy.html:90`'s do-not-contact promise
  covers "future canvassing lists and exports" and a packet IS a canvassing list, which is why the
  live per-voter join is mandatory rather than optional. Nothing in `privacy.html`, `terms.html` or
  `docs/DPA.md` contains the words print, paper or hard copy — that is consistent with policies
  describing categories of data and recipients, never media, so **no paper sentence should be
  added.** Flagged for owner confirmation per the repo rule.
  *[amendment 2026-08-06: the studio now also renders a **Mapbox** map of book boundaries, so
  the page makes requests to `api.mapbox.com` it previously did not — viewer IP + viewport go to
  Mapbox whenever it renders. **No change to the subprocessor position:** Mapbox is already the
  disclosed mapping subprocessor for the admin console's Map and Turf Cutting pages, the map
  imports `client/src/lib/mapboxInit.js` (which mutes usage beacons and carries that ruling), and
  no VOTER data reaches it — the layers are book polygons and centroids, never door pins or
  names. DPA §6 untouched, no customer notice event. Recorded because "a page that previously
  rendered no map now does" is the kind of quiet change this log exists to catch.]*

  *[amendment 2026-08-07 — **cover map**: the packet PDF can now carry a basemap of the book with
  the walk drawn over it. Two things changed and both are deliberate.*

  ***(1) Door coordinates now leave the server** — `GET /packets/data` returns per-door `lng`/`lat`,
  but ONLY when `includeGeo=1`, which the client sets only when the cover map is switched on. The
  default payload keeps its previous shape, so the smaller disclosure stays the normal one. The
  recipient is the campaign manager who already receives the street address these were geocoded
  from, under the same `requireCampaignManager` gate — no new party, no new fact, a new
  representation of one they hold. Coordinates are still NEVER rendered as text on the paper; they
  place dots on an image.*

  ***(2) Mapbox receives a rectangle, not the route.** Mapbox's Static Images API accepts an overlay
  polyline, which is the obvious way to draw a route and would have put every household coordinate
  in a third party's request URL and access log. It is not used. The request carries a centre, a
  zoom and an image size — the same class of viewport request the console's existing map pages
  already make — and the route is projected and drawn locally in PDF vector operations. **No
  subprocessor change; DPA §6 untouched.** Recorded because "we added a map" is exactly the change
  where coordinates leak to a vendor by default if nobody writes down that they must not.]*

- *(v5 2026-08-11)* **The two survey exports gained an OPT-IN contact/demographic column block
  (`params.includeVoterDetail`).** With it ticked, `survey-results*.csv` and `survey-answers.csv`
  add **Gender, Date of birth, Phone, Phone type, Cell phone** beside the identity columns and
  **County, Latitude, Longitude, Precinct, Congressional / State senate / State house district**
  beside the address block. Requested so a customer can match survey results back to the voter
  universe it supplied and write tags into its own system. Docs: [EXPORTS.md](EXPORTS.md).
  **Why this is not a new exposure — code facts, not a judgment call.** **(i) Same audience,
  exactly.** Both survey types are `adminOnly: false`, so the gate is admin-or-lead-who-manages —
  byte-identical to the gate on `voter-file` and `voters-filtered`, which already emit **every one
  of these fields** under their `CANONICAL_FIELDS` headers (`exportBuilders.js` `buildVoterFile`),
  and to `walklists.js`'s eleven-column CSV in §B8, which already exposes Phone and a DOB-derived
  Age to the same people. Nobody can tick this box who could not already download the same fields
  about the same people one card away. **(ii) Nothing new is collected or retained.** No new field,
  no new source, no new store, same `ExportJob` + `exportArtifacts` bucket, same 7-day TTL and
  sweeper, same org/campaign delete cascade, **same MongoDB Atlas — no new subprocessor, DPA §6
  untouched, no customer notice event.** **(iii) Do-not-contact is structurally unchanged.** Every
  added cell is read off the SAME DNC-guarded voter object as the name (`detailPlan`'s
  `voterDetailCells` takes the voter the builder already suppressed), so a flagged person's phone
  and DOB are as unreachable as their name — now pinned directly: the flagged fixture voters carry
  sentinel phone/cell/DOB values, the registry-driven "appears in NO artifact" sweep asserts them,
  and a dedicated case re-asserts them with the toggle ON (`test/exportBuilders.int.test.js`).
  **(iv) It adds columns, never rows** — `rowCount` and `excludedDncCount` are asserted equal
  across both settings, so no count, estimate or reconciliation moves.
  **What IS new, stated rather than buried.** This is the first artifact that puts **raw
  `dateOfBirth` and phone on the same ROW as survey answers** — i.e. beside GDPR Art. 9
  special-category political opinion, which the "Survey answers are stored linked to a NAMED,
  IDENTIFIED voter" finding below already flags. The fields and the audience are old; the
  *combination in one file* is new. Three deliberate mitigations, all code: **off by default**
  (the packets `includeGeo=1` precedent — the smaller disclosure stays the normal one, and
  projections widen only when it is on, so an export not printing a phone does not read one);
  **frozen into `ExportJob.params`**, so the Exports history row permanently records which files
  carried it (surfaced as "contact & demographic details" in the web `scopeLabel`); and the
  **full-backup deliberately does NOT inherit it** — it composes the builders with empty params,
  because a bundle that silently upgraded itself to full PII would defeat the toggle.
  **Assessment: NO published Privacy Policy / ToS / DPA sentence changes; no new subprocessor;
  DPA §6 untouched.** Verified against the same sentences the packets entry above turns on:
  `terms.html:91` / `:106` frame this as the customer exporting its own data, and
  `privacy.html:90`'s do-not-contact promise ("future canvassing lists and exports") is honored by
  (iii). Recorded because "we added some columns" is exactly the change that quietly turns a
  narrow file into a voter file if nobody writes down which columns and why.

- *(v5 2026-08-13)* **The FbTime integration — the first per-org connection to an outside
  service, and a NEW subprocessor.** An organization's own admin may connect FbTime (the owner's
  time-tracking product) so doors-per-hour divides by measured clock hours
  ([FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md)). Connecting is the act of consent: nobody at
  Doorline can wire it up for a customer, and the admin confirms the FbTime organization's name
  before the key is stored.
  **What it holds.** Per organization: the FbTime API key **sealed with AES-256-GCM**
  (`utils/sealedSecret.js`, env master key `CREDENTIAL_SEAL_KEY` — the first encrypted-at-rest
  secret in the system; only the display prefix is ever readable); FbTime person ids, names and
  emails (`FbTimePersonLink`, for the canvasser mapping); and per-person **daily hour totals**
  (`FbTimeDailyHours`). Deliberately NOT held: GPS from clock-ins, pay rates, break detail —
  the client never requests them and the provider's partner API does not expose them to us.
  *[v5 2026-08-15: **the holdings sentence above is superseded — the cache is now
  shift-level.** `FbTimeShift` replaces `FbTimeDailyHours`: per shift, Doorline holds the
  provider's shift id, the clock-in instant, the three hour figures (each 2dp as sent), the
  open/manual-entry flags, and the zone it was clocked in. Deliberately still NOT held, by data
  minimization: clock-out times (an `isOpen` boolean carries the only fact reports need), the
  breaks array, and every break-minutes figure — so "break detail: not held" above stays true as
  written. Why the change: day totals are bucketed in exactly one timezone at pull time, and a
  campaign anchored to any other zone silently read zero measured hours; shifts are instants,
  bucketed per report, so measured hours reach a campaign in ANY zone
  ([FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md), the sync-model section). The granularity
  increase is the clock-in instant — same data subjects, same source, same read-only inbound
  direction, no new recipient, NOT a new subprocessor, no DPA §6 notice event. Assessment: the
  published Privacy Policy service-providers sentence and the DPA §6 line both said "daily
  totals", which stopped being precise — **both reworded sentences were approved by the owner
  and applied at the owner's explicit direction 2026-08-15, in the same change, before deploy**
  (privacy.html:106 now "each work shift's start time and hours worked"; DPA §6 now
  "shift-level time records, of which Doorline retains each shift's start time and its
  worked-hours figures").]*
  **What LEAVES.** Doorline sends the provider only date ranges and a timezone; canvasser
  identities are matched by email locally, from the roster FbTime already holds. No voter data,
  knock data, or survey data ever flows to FbTime — the integration is read-only inbound.
  **Who can read it.** Org admins only (`requireOrgRole('admin')` on the whole router; leads
  deliberately excluded — the connection is org-wide and the lead tier is location-scoped).
  Staff reads under a support grant hit the normal AccessLog mount. Lifecycle events
  (connect/rotate/disconnect/link/sync-fail) land in `IntegrationEvent`, append-only.
  *[v5 2026-08-14: **narrowed, and the "admins only" sentence above is now imprecise.** The
  `/admin/integrations/fbtime…` router is still admin-only in full — key, hours figure, mapping
  table and event history are unchanged and unreachable by a lead. What changed is that
  `GET /admin/memberships/:userId/stats` now returns
  `fbtime {connected, linked, personName, source}` for the single user being viewed, and that
  route is admin **or lead** via its pre-existing `leadMaySeeTarget` gate
  (`memberships.js:762`). A lead therefore learns one boolean plus an FbTime display name about
  a canvasser **already inside their scope** — never hours, never the key, never anyone else's
  link. Assessment: **no policy text change.** No new data category (the mapping identifiers
  were already disclosed in this entry), no new recipient, no new export, and no widening of
  which *customer* data leaves the system — only which of the customer's own staff may read one
  fact about their own staff. Rationale for the widening: a lead who cannot see why a
  doors-per-hour is estimated cannot act on it, which is the failure the `hoursReason` work
  exists to fix. Staff reads under a grant still hit the AccessLog mount (E13, no exemption).]*
  **Retention/deletion.** Disconnect destroys the sealed key and deletes the hours cache
  immediately (links + history are kept — the org's own labor and audit trail). All four
  collections are in the org-delete `ORG_SCOPED` sweep, verified by the sweep-exhaustiveness
  test.
  **Assessment: DPA §6 and the Privacy Policy service-providers paragraph MUST change** — FbTime
  becomes a subprocessor of workforce personal information (staff names, emails, daily hours).
  Customer notice per DPA §6 was given by the owner BEFORE this feature went live (confirmed
  first-hand 2026-08-13). *[Stamped 2026-08-13: both sentences APPROVED by the owner verbatim and
  LANDED in the same change — DPA.md §6 (appended sentence: FbTime engaged by Customer, Doorline
  sends only date ranges + timezone, receives staff names/emails/daily totals) and
  privacy.html:106 (service-providers paragraph, same substance in plain language).]* The ToS is
  unaffected. Workforce data is a new
  CATEGORY on an existing lawful surface: the same people already appear as User accounts; what is
  new is their daily hour totals held here and their identifiers flowing to/from a second system
  the customer itself operates.
  *[v6 2026-09-03: **a new FbTime field reaches an admin's screen — and is deliberately not
  held.** The Integrations mapping roster now shows each FbTime person's most recent **project
  label** (`project: {id, name}`, which rides every `/shifts` row per the provider's contract)
  beside the Doorline person's campaign assignments, so an admin can sanity-check a pairing before
  linking. **Derived per request and persisted nowhere**: `FbTimeShift` is unchanged and its
  "DELIBERATELY still NOT held" list above stays true as written; no collection, log, export or
  `IntegrationEvent` detail receives the label, pinned by `fbtimeSync.int.test.js` (no shift
  document may carry a project field) and by `fbtimeIntegration.int.test.js`. Same provider, same
  sealed key, same `timesheets:read` scope already used by sync, same read-only inbound direction —
  no new endpoint credential, no new recipient, and what LEAVES is unchanged (still only date
  ranges and a timezone). Audience unchanged: `requireOrgRole('admin')` on the whole router; leads
  still cannot reach any of it. **NOT a new subprocessor, no DPA §6 notice event** — same reasoning
  as the v5 2026-08-15 granularity stamp. **A label, never an attribution key**: hours remain
  attributed by the knock ledger (owner-ruled 2026-08-16), and `unionDayAllowed` is structurally
  unable to read this value — it is not in the cache and the resolver's projection does not select
  it.
  **Assessment: `docs/DPA.md` §6 needs NO change** — it already splits receive from retain
  ("shift-level time records, **of which Doorline retains** each shift's start time and its
  worked-hours figures"), and the retain half is unchanged. 🛑 **`client/public/privacy.html:106`
  is an OWNER DECISION and is flagged, not edited.** That sentence is a flat enumeration with no
  receive/retain split — "we send date ranges, and receive staff names, email addresses, and each
  work shift's start time and hours worked" — so a project label is a fourth received category not
  named there. Candidate wording, for the owner to accept or replace: "…start time, hours worked,
  **and the project it was worked on**…". **The visible project column is gated on that ruling; the
  rest of the redesign is not** and can ship ahead of it.
  Also in this change, and needing no policy text: `GET /admin/memberships` gained `campaignIds`
  (rostered campaigns, **scoped for a lead** to campaigns they manage — an unfiltered set would
  have widened what a lead learns about their own canvassers, which is why it is filtered),
  `user.isDeleted` (already disclosed, previously only inferable from the tombstone email), and
  `fbtime {linked, personName, source}` which is **admin-only**: the per-user lead disclosure
  stamped 2026-08-14 stays exactly as scoped, and this org-wide roll-up is not extended to leads.]*
  *[v6 2026-10-09: **door counts to FbTime — the integration SENDS something about people for the
  first time; built, NOT yet released** ([PROPOSAL_FBTIME_DOOR_COUNTS.md](PROPOSAL_FBTIME_DOOR_COUNTS.md),
  owner rulings 1-16). **What leaves**, only by `PUT /api/partner/v1/doors` (`services/fbtime/client.js`
  `putDoors`, the key in the `Authorization` header only): `{ startDate, endDate, userIds, counts:
  [{ userId, date, doors }] }`, where `userIds` are **FbTime's own person ids** (from
  `FbTimePersonLink`), `date` a local day in the campaign's zone, and `doors` that day's knocks for that
  linked canvasser — the Timeline's Doors column summed across the org's campaigns (`KNOCK_ACTIONS`,
  `NOT_BULK`; a Restricted-only day is sent as 0; notes and desk marks never count; a day with no door
  result sends nothing). An explicit clear sends the same keys with `counts: []` plus
  `restoreTyped: true` (FbTime then brings back numbers people had typed). Nothing else — no names,
  emails, voter data, addresses, survey answers, notes or locations — pinned by the body-key assertions
  in `test/fbtimeDoorCounts.test.js` and `test/fbtimeDoorPush.int.test.js`. Each send restates up to
  the last **120 days** (so the first send after a turn-on covers the 120 days before it); a clear
  reaches back to the first day ever sent (never past FbTime's 2-year limit). **Only when all hold**
  (`services/fbtime/doorPush.js` gates, re-checked before every request): the release var
  `FBTIME_DOOR_COUNTS` is on; the org's own switch is on (off by default); the stored key carries
  `doors:write`; FbTime's `/ping` advertises `doors:reported-wins`; the connection is `connected`; the org
  is not being deleted; no other Doorline organization reports to the same FbTime organization. Outside
  production a write reaches only a loopback host (`LAPTOP_GUARD`). **Who can turn it on:** the
  customer's own org admin; Doorline staff under a support grant are refused (`403
  DOORS_STAFF_FORBIDDEN`) and may only turn it off. Note for the v5 sentence "nobody at Doorline can
  wire it up": staff under a grant CAN connect FbTime itself (`requireOrgRole` admits them) — that half
  is a process rule; the door-count switch is enforced in code. **What Doorline newly holds** (all on
  `FbTimeConnection` / `IntegrationEvent`, both in the org-delete `ORG_SCOPED` sweep,
  `services/platform/deleteOrganization.js`): the key's scopes and FbTime's feature list; a ledger of the
  FbTime person ids ever listed and the earliest date sent; waiting clears (person id, and the account it
  was unlinked from); "the link was wrong" pairs (person id + account id, kept out of suggestions and
  the email auto-match); run summaries (counts only), over-limit days (person id, date, number) and
  unrecognised person ids; **kept accounts** (person id + account id + `until` + who kept it — an admin's
  ruling that one FbTime person is one human across two Doorline accounts: no new data, a mapping between
  records already held; it keeps the earlier account's pre-`until` hours its own and adds its pre-`until`
  knocks to that person's counts). **No door count is stored** — every send recomputes from
  `CanvassActivity`. New events: doors-enabled / -disabled / -failed / -recovered / -cleared /
  -clears-abandoned / -clear-requested, account-kept / -kept-removed; door-count events never hold an
  account id beside a person id (the link-type ones do, and the purge de-pairs them — below). Numbers
  already sent live in the customer's FbTime, outside Doorline's deletion (`privacy.html:122` describes
  Doorline's systems and stays true). **Lead-visible:** only `fbtime.kept` (a boolean, no dates) on the
  per-user stats route already narrowed 2026-08-14. **Names on the Integrations page** (admin-only router):
  Recent activity now names who made each change (`by`) and whom a link event is about (`subject`), and
  the roster names kept earlier accounts — all resolved at read time through `hydrateCanvassers`, never
  stored in an event, so a deleted account shows its retained snapshot name until the 180-day purge,
  exactly as the leaderboard and Timeline already do (USERS.md); never an email (the events' stored
  emails are what this build removes).
  **Account deletion — two older gaps closed in the same build** (decision 10; `privacy.html:127`
  promises the email is removed immediately): (1) deletion now nulls the FbTime link's `fbtimeEmail`
  in every org (`services/users/deleteAccount.js`) and `link-created` no longer stores `userEmail`;
  (2) the 180-day identity purge now **de-pairs** the account from FbTime in every org and connection
  status (`services/fbtime/purgePairing.js`, record by record before the `purgedAt` stamp; a failure
  leaves that record due and the run `ok:false` with `failed` — the health surface shows it, and goes red
  once 48 hours pass without a clean run): links
  deleted; kept and rejected entries removed; a waiting clear keeps the person but loses the account;
  shifts clocked before the deletion keep their `userId` (hours stay measured) with `fbtimePersonId`
  set to `'purged'`; later shifts re-resolve without the account; link-type events lose
  `detail.fbtimePersonId` (and any `userEmail`); one id-less `link-removed {reason:'identity-purge'}`
  row per org. Until the purge the link survives, so a deleted canvasser's existing counts can be
  restated for at most 119 days after their last knock. Holds while `DELETED_IDENTITY_RETENTION_DAYS` ≥
  121 (default 180). **Rows from before this deploy keep those emails and pairings until
  `npm run migrate:fbtime-deletion-gaps -- --apply` runs in production** *(operator-attested run: NOT YET
  RUN — fill in the date and the three counts from its output)*. IntegrationEvent stays append-only in
  operation with two named exceptions (that migration's email scrub; the purge's de-pairing) beside the
  existing org-deletion cascade.
  **Sentences that become false the moment a send happens** — and so gate the release var:
  `docs/DPA.md` §6 ("Doorline sends FbTime only date ranges and a timezone"), `privacy.html:106` ("we
  send date ranges, and receive …"), this entry's v5 "What LEAVES … read-only inbound", and the
  2026-09-03 stamp's "still only date ranges and a timezone" (all superseded by this stamp for any org
  with door counts on). 🛑 **DPA.md and privacy.html are OWNER DECISIONS — flagged, not edited.**
  Proposed wording: DPA §6 "… Doorline sends FbTime date ranges and a timezone and, if Customer also
  turns on door-count reporting, the number of doors each linked staff member recorded each day
  (including up to the 120 days before reporting is turned on), identified only by FbTime's own person
  identifier; and receives Customer's staff names, …"; Privacy Policy "… we send date ranges — and, if
  your administrator also turns on door-count reporting, the number of doors each linked staff member
  recorded each day, so FbTime can show doors per hour — and receive staff names, …". In the same edit:
  `privacy.html:81` "Last updated" still reads July 17, 2026 after four content edits (so `:143` is
  already untrue), and the 2026-09-03 project-label wording is still open. **Assessment:
  privacy-affecting (a new category of personal data leaving Doorline — per-canvasser daily door
  counts); NOT a new subprocessor and no DPA §6 notice event** — FbTime is already disclosed and, per
  DPA §6 as landed, engaged by the Customer; the customer's admin turning door counts on is the
  customer's instruction under **DPA §2** (owner ruling 7: no customer notice beyond the updated
  wording). This record contradicts itself on that point — v5 above calls FbTime "a NEW subprocessor";
  **DPA §6 governs.** ToS unaffected (§3, §4, `terms.html:106`).]*

- *(v6 2026-10-09)* **Door counts to FbTime — "never names, emails, voter data, addresses, survey
  answers, notes or locations"** (the Help Center's door-count articles say it). True while `PUT /doors`
  carries only `startDate`, `endDate`, `userIds` (FbTime's person ids), `counts [{ userId, date, doors }]`
  and, on explicit clears, `restoreTyped` — built in one place (`planDoorRequests` /
  `doorPush.js` `clearPhase`) and pinned by the body-key tests named in the stamp above. Any change to
  what that request carries must re-verify this line, the stamp, DPA §6 and `privacy.html:106`.

- *(v6 2026-10-10)* **Sessions — "We use local storage on your device to keep you signed in" and the
  phone's walk-list copy "is deleted when you sign out".** Both stay true with the session-expiry build
  ([PROPOSAL_SESSION_EXPIRY.md](PROPOSAL_SESSION_EXPIRY.md); [USERS.md](USERS.md) → *Sessions*): a used
  sign-in is extended up to 90 days from the typed password (30 days idle; staff 30 days flat). A
  sign-in that RUNS OUT asks for the password **in place** and is NOT a sign-out: the phone keeps its
  walk-list copy while the prompt waits — including after **Later**, with no time limit — exactly as an
  expired session always did (`bootstrapQuery.js` serves the disk copy on a 401). Every sign-out
  (manual, password changed elsewhere, account deleted) still deletes the copy, and the roster write
  guard (`mobile/lib/cache.js` `setRosterWriteGuard`, checked at write time) stops a late save writing
  it back. The prompt is **not** a privacy control (Later reveals the app, as an expired session did). A
  password change heard while the prompt is up keeps the copy too while the prompt came up, was last
  used, or switched to asking for the new password in the last 30 minutes (gap 29 (e)). Re-verify this
  line, the v6 stamp under *THINGS YOU DID NOT ASK ABOUT* §1, privacy.html's offline-copy paragraph and
  its "until a connection is available" sentence (privacy.html:94, an owner item in gap 29) on any
  change to extension, the cap, the prompt, or what a sign-out clears.
- *(v6 2026-10-24)* **Tenant isolation: privacy.html:105 ("not … visible to other customer
  organizations"), privacy.html:115 ("access controls that limit each user to the information of their
  own organization") and DPA §4 ("tenant isolation").** A per-person report drill never answers for
  someone outside the requester's organization, and, for a team lead, never for someone off the
  campaigns they manage.
  - It is checked on the report router's `:userId` param (`orgCarriesUser`, `campaignsCarryUser`), and
    pinned by `test/reportsUserScope.int.test.js` (item 35).
  - Re-verify on any new route that takes a person's id from the client. A user id is not a secret.
    `User.findById` on a client-supplied id, without asking whether this organization (or this lead)
    carries the person, is the exact shape of the leak this closed.
  - *(v7 2026-10-25)* The same shape on a campaign's team (item 41): a lead puts only themselves on the
    team, by id (`POST /admin/campaigns/:id/assignments`), by book or by walk-list crew
    (`partitionAssignable` `selfOnlyFor`), so a lead can't add an org member and read back their email and
    phone. Pinned by `test/leadUserManagement.int.test.js` test 12, `test/partitionAssignable.int.test.js`
    and `test/leadWalkthrough.int.test.js` steps 4-5. Re-verify on any new way onto a team.
    *[v7 2026-10-27, item 42: re-verified for the new ways onto a team. **Move to crew…** for several
    people never puts anyone on a team (`test/crewJobEdges.int.test.js`, its first test); for a lead, an
    id off this campaign's roster answers `{ skip: 'not-on-campaign' }` with no name or counts, the same
    for a member and a made-up id (`test/crewJob.int.test.js`, the bulk preview test). **From your organization** is `POST
    …/assignments`, where a lead still sends only their own id. The book routes' join admits only who
    `partitionAssignable` already allowed. The line above still holds.]*
  - The other direction (item 36): a customer's admin or lead can't put Doorline staff on a book, a
    crew or their team unless the staffer holds a membership there (`internalStaffIdSet`,
    `services/campaignRoster.js`), pinned by `test/staffRosterScope.int.test.js`. Re-verify on any new
    assign path and on any new "staff skip the membership check" rule: staff skip it only in an internal
    org.
- *(v6 2026-10-24)* **Account deletion by an org admin (item 37).** Five lines to keep true, each pinned in
  `test/orgAccountDeletion.int.test.js`:
  - an org admin can delete only an account with no membership in any other organization, active or switched
    off;
  - an account with billing access can't be deleted, or removed from the org, by an admin without billing access;
  - support-tier staff can delete only an account nobody used; a used one needs break-glass;
  - no deletion, Remove, demotion or Deactivate leaves an organization without a live admin, and no deletion
    leaves it without a live billing admin;
  - nothing writes to a deleted account: the eleven writers refuse or converge.
- *(v6 2026-10-24)* **Client reports (items 34 and 38).** Lines in privacy.html `:101` the code now keeps
  true, each with its owner:
  - "door statuses and, where the customer chooses, responses to selected survey questions": a map off
    serves nothing and a hidden question never reaches the map (`mapServed`, `servedMapKeys` in
    `services/reports/reportVisibility.js`; `reportSecurity.int.test.js`);
  - "never the typed text": `publicPointAnswer` on every map answer, and area cells hold only choice
    labels;
  - "exclude voter names, canvasser identities, and action timestamps": team labels refused when they
    carry a canvasser's name (`TEAM_LABEL_HAS_NAME`), civil dates only on the wire (`reportDates` in
    `clientReportView.js`);
  - "90 days by default, or a period of up to one year": `SHARE_LINK_DEFAULT_DAYS` must stay 90, and Extend
    never passes `lifetimeStart + 365 days` (`routes/admin/clientReportShares.js`);
  - "a password can never be removed": `SHARE_PASSWORD_REQUIRED`.
  Plus `:97`, which covers per-link open counts (owner ruling: no sentence of their own) and Keep me signed
  in. A change that adds a field to the client payload, a map payload or the area cells re-verifies here.
  *[v6 2026-10-24, code review round 1: re-verified for `visibility.mapVersion` (an opaque HMAC of the
  live snapshot's key, mode, area size and served questions only; item 34(d) stamp) and the map payload
  cache (the same bytes, held in web memory; item 38(j)). The lines above still hold.]*
  *[v7 2026-10-25, links to one report (item 38(m)): re-verified for the client payloads' new fields —
  the hub's `single`, and on a one-report link `reportId` (the id of the one report it opens, which the
  hub's own row already carries as `id`) and `gone`; the report's `single`; and the earlier-totals line's `before` (this
  report's own first day, a civil date). No hidden question, no other report, no instant, no new id.
  The lines above still hold; a link to all reports serves exactly what it did.]*
- *(v6 2026-10-24)* **Automatic pause (item 39).** Lines the code keeps true, each with its owner:
  - privacy.html `:94` ("We collect location only at the time an action is recorded"): the rule reads only
    the stamps of recorded actions (`services/audit/paceRule.js`); no trail, no extra capture. A design that
    samples location between doors is a policy change, not a code change.
  - `:127` and the record's own promise: `PacePause` stores no coordinate, address, email address, name or
    free text (`models/PacePause.js`; `pacePause.int.test.js` checks a stored record).
  - `:106` (Resend receives the recipient's name and email address): the alert names no one and lists no
    address (`pacePauseAlert`, `services/mail/templates.js`).
  - `:105` and the role walls: a lead never receives another campaign's household, address, result,
    campaign, distance or needed seconds (`shapeWindowVisit`, `routes/admin/pacePauses.js`).
  - `:122`: `PacePause` is in `CAMPAIGN_SCOPED`, `ORG_SCOPED` and `LATE_WRITE_MODELS`.
  A change that adds a field to `PacePause`, the email or a lead's view re-verifies here.
  *[v7 2026-10-27, item 42: the setting moved to the org Settings page (org admins; billing admins change
  it). The email's last line now names that page, and still names no one (`test/peoplePagesUnits.test.js`).
  `GET /settings` gained `chosen`, the stored recipients by name through the org-scoped `hydrateCanvassers`.
  The lines above still hold.]*
- *(v7 2026-10-25)* **What a person's profile tells a team lead (item 40).** privacy.html `:105`
  ("according to their role") and the Help Center's "Outside them you see almost nothing" hold for the
  per-person drills on `/admin/memberships` only because every one of them narrows a lead to the
  campaigns they manage (`leadCampaignScope`): totals, recent doors, the campaign list, crews (names
  only elsewhere, for the switch-off warning) and a fellow lead's grants. Owner of the line:
  `test/leadUserManagement.int.test.js` test 11. A new drill, a new field on one of these, or a new
  lead-facing screen that shows a person's work re-verifies here.
  *[v7 2026-10-27, item 42: re-verified for the person panel that replaced the web profile. On a
  campaign's Team page a lead's panel reads that campaign's doors
  (`/admin/reports/canvassers/:id/activities?campaignId=`) and numbers (`…/summary?campaignId=`), never
  `/stats` (the organization-wide section is for org admins only: `personAccess.showEverywhere` in
  `client/src/lib/personAccess.js`), and `/crews` only for the switch-off warning. The phone's member
  sheet reads the same campaign-scoped routes, and its profile labels a lead's totals **On your
  campaigns** without miles. The line above still holds.]*

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
   *[v5 2026-09-30: **mechanism changed, no published sentence changes.** The do-not-contact list
   upload now (a) requires the STATE the list is for and matches only inside that state's campaigns,
   because two states can issue the same digits and a stripped Georgia id is byte-identical to a
   genuine Nebraska one; (b) matches with leading zeros ignored (both directions) inside that state,
   so a list that went through Excel still honors the request; (c) reports — with a downloadable id
   list — any voter the file names OUTSIDE the state, and never flags or remembers them for that
   state; (d) stamps each remembered `DncPendingId` with the state, and the exact graduation job
   (`reapplyDncLists`) now honors that stamp: a Georgia parking can only ever flag a voter in a
   Georgia campaign (an unstamped parking — an admin flag preserved across a campaign delete, rows
   parked before the stamp — graduates anywhere, as before). `DncUpload` records `state`,
   `outsideState`, `idColumn`, `matchedViaZeros` (file metadata, not personal data). Net effect on
   the promise: strictly narrower — wider matching can only reach the same voter under another
   spelling, and the state scope removes a way the old org-wide exact match could flag a stranger.
   The early-voting upload and its graduation job gained the same zero-insensitive matching
   (campaign-scoped, so no cross-state question). Nothing new is collected, no new recipient; the
   Privacy Policy's voter-identification-number sentence already covers the field. Code:
   `services/import/parseVoterIdList.js`, `services/voters/voterIdLookup.js`,
   `services/dnc/reapplyDncLists.js`; tests `dncUpload.int.test.js` 14–17, `votedUpload.int.test.js`.]*
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
   *[v6 2026-08-22: **GAP CLOSED — the pin-move PATCH.** The same miss, one router over:
   `routes/admin/campaignHouseholds.js` served
   `PATCH /admin/campaigns/:campaignId/households/:householdId/location` — a single-record WRITE
   that moves a door's map pin (with `scope:'building'`, every unit at that pin) — with **no
   `router.param` hook**, so a staff pin move under a grant logged the request but not WHICH
   door. Surfaced while adding *Move pin* to the Turf Cutting page's popups (which call this
   same endpoint, through the same `updateHouseholdLocation` writer, with the same
   `HouseholdLocationChange` audit row); the same `addAuditSubjects` hook the households and
   turfs routers use is now registered there, and `test/accessLogCoverage.int.test.js` gains a
   case for it. The pin move itself is unchanged in what it collects and who may call it
   (`canManageCampaign` — org admin, or a lead who manages that campaign), and the one new
   behaviour — redrawing the affected book outlines (`Turf.boundary`/`centroid`, display-only
   geometry derived from door pins already on file) — adds no personal data and shows nobody
   anything new. This makes an existing write auditable — it is **not** a new exposure and needs
   no Privacy Policy / ToS / DPA edit. Sibling gap, recorded not closed: the mobile twin
   `POST /mobile/households/:householdId/location` rides `routes/mobile/canvass.js`, whose
   `router.param` hooks cover `voterId` only.]*
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
   is never re-checked after a password change (≤24h residual access). *[v6 2026-10-10: unchanged —
   `requireAuth` now has its own verifier (`verifySessionToken`, which ignores expiry and checks it
   after the user lookup); share unlocks keep `verifyToken` and their 24-hour expiry, pinned by
   `test/sessionLifetime.int.test.js`.]*
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
    snapshots have no back-clean. *[v5 2026-08-04: the raw-upload half is superseded — the nightly
    `sweepStaleImportJobs` (05:53 UTC) scans the `rawImports` bucket itself and deletes any file >24h
    old whose ImportJob is terminal **or missing**, so a swallowed delete is retried nightly and an
    org-deletion orphan is reachable without its jobIds; unrecoverable import failures also delete the
    upload immediately, and `npm run sweep:raw-imports` purges the pre-fix backlog on demand. See the
    v5 entry above. The no-transaction cascade and the `PersonMergeLog` back-clean remain open.]*
11. **The Help Center has zero articles on staff/support access** — end users cannot read in-product
    what the policy now promises. (A transparency gap, not a false sentence.)
12. **[v6 2026-08-17 — NEW SOURCE OF PERSONAL DATA: admin-authored survey answers.]** Until now
    every row in `SurveyResponse` — the most sensitive category this system holds, a political
    opinion attached to a named, identified voter — was *a statement a voter made to a canvasser at
    their door*. As of the Door Outcomes → Surveyed conversion
    ([SURVEYS.md §K](SURVEYS.md#k-desk-entered-responses-outcome-conversion)) some rows are
    **statements an admin typed about that voter, without the voter present.** That is a genuinely
    new *source* of personal data about an identified person, and it must be stated rather than
    absorbed.
    **What bounds it:** org-admin only (the same tier that could already rewrite any answer via
    `PATCH /admin/voters/:voterId/surveys/:responseId` — so it widens no ACCESS, only authorship);
    every created row carries a `deskEntry` stamp naming the admin and the date, surfaced on the
    voter's own record, in the response detail on both clients, and as two export columns; the run
    is audited in `CampaignChange` (`source: 'survey_conversion'`); the whole thing is revertible;
    and a **field-collected answer is never overwritten** — a voter who already answered that round
    is skipped, by rule and by unique index. In the common case the content is the canvasser's own
    report of a real conversation the app mis-recorded.
    **Action required before the next policy pass:** any published sentence of the form *"survey
    answers are recorded by canvassers at the door"* is now **false unless qualified**. Grep the
    static legal pages and §C9/§C10/§H16 here. The legal pages are the owner's to edit — flagged,
    not touched.
    **Retention half:** the reverse direction writes `SurveyResponseArchive` rows that nothing
    automatically consumes. That model's own comment argues growth is bounded *because restore
    deletes the row it promotes* — true for `submit`/`restore`, **false for a conversion nobody
    reverts**. Tenant deletion still reaches them (verified: `deleteCampaign.js`,
    `deleteOrganization.js` — so §B5 is unaffected), but the retention-timer answer in §B6 changes;
    see the stamp there.
    **Not triggered:** no new subprocessor, no new external data flow, no new export destination
    (the new columns describe data we already hold), no change to who can access customer data.
13. **[v6 2026-08-25 — NEW STORED ARTIFACT: the filter that produced a Door Outcomes run.]** The
    Door Outcomes page gained a survey-answer filter ("everyone canvasser X surveyed who answered
    Y"), and a scoped run now **freezes its selection criterion** onto the run document:
    `ReclassifyRun.selection.scope` (new; mirrors the pre-existing
    `SurveyConversionRun.selection.scope`) plus a human `scopeSummary` string that can embed a
    voter's *answer text* ("answered Opposed") and a canvasser's name, retained for the life of
    the campaign.
    **Read-side is settled and needs no policy change:** an org admin seeing which doors gave
    answer Y is an already-shipped capability at a *wider* audience (admin + lead) via
    `voters-by-answer`, its CSV, and the map answer filter — the §B8 ruling below ("same-audience
    exposure, not a new recipient class") covers this narrower org-admin-only surface a fortiori.
    What is new is only the small **stored** artifact naming the criterion.
    **Bounds verified:** org-admin-only routes; the criterion is the admin's own query, not new
    data about a voter (the answer text it may quote is already held on `SurveyResponse`); both
    run models ride the tenant-deletion cascades (verified 2026-08-25: `deleteCampaign.js` and
    `deleteOrganization.js` list `ReclassifyRun` and `SurveyConversionRun`); no new subprocessor,
    no new external flow, no new export (the summary renders in-app on the run list only, never
    in a CSV). Nothing in the published Privacy Policy / ToS / DPA changes.
14. **[v6 2026-08-26 — NEW DELETION + RETENTION BEHAVIOR: Unknock.]** The Door Outcomes page
    gained **Unknock** (`POST /admin/campaigns/:id/unknock-entries`, org admins only,
    `services/canvass/unknock.js`): an admin-initiated **hard delete of selected
    `CanvassActivity` rows** (fraud/mistake cleanup) — the first admin tool that deletes
    field-recorded rows outside the existing four paths in §C11's coordinate-removal list, which
    should now read five: *(v) an admin unknocking entries from Door Outcomes — admin-initiated,
    never automatic or time-based, and revertible.* Two retention artifacts are created in the
    same act: the deleted rows are frozen **verbatim** (GPS coordinates, timestamps, canvasser
    userId included) on `UnknockRunChunk` documents for the life of the campaign — same PII, new
    location — and the visit's survey answers move to the already-stamped
    `SurveyResponseArchive` (`via: 'unknock'`), inheriting item 12's nobody-reverts growth note.
    **Bounds verified:** no new data category (a frozen row is a copy of one we held), no new
    party, no new export (frozen rows render in-app on the run list only); both new models ride
    BOTH tenant-deletion cascades (verified 2026-08-26: `deleteCampaign.js` and
    `deleteOrganization.js` list `UnknockRun` and `UnknockRunChunk`); §C11's "none of these is
    automatic or time-based" stays true. One behavioral edge for §B5's delete-gate finding:
    unknocking every row of a campaign re-opens the hard-delete gate exactly as the
    clear-knocks checkbox already does (`campaignHasCanvassed` is a live-row check, not a
    latch) — a known posture, not a new hole. Nothing in the published Privacy Policy / ToS /
    DPA changes (the policy nowhere promises activity rows are immutable; archived-not-deleted
    answers were already stamped in v6 item 12).

15. **[v6 2026-08-28 — Pin Fixes: confirm-in-place stamps + a first-of-kind outbound maps
    link.]** Two facts, neither a policy edit. **(a)** `Household.locationConfirmedBy/At`
    (new fields) record which staff user vouched an approximate geocode and when — the same
    class as the existing `correctedBy/correctedAt` pin-correction attribution (staff metadata
    on a customer-data record, visible to the same `canManageCampaign` roles, precedent: the
    v6 2026-08-22 pin-move stamp — "not a new exposure"). Each confirm also writes a from==to
    `HouseholdLocationChange` row (`source:'confirm'`), reusing a collection already in both
    tenant-deletion cascades. Like `HouseholdLocationChange.userId`, the confirm attribution
    is **not scrubbed by account deletion** — it joins the §A3 pseudonymity list below. **(b)**
    The Pin Fixes page renders an **"Open in Google Maps"** link per door — the app's first
    outbound maps link. Reasoning recorded deliberately: the link is a user-initiated browser
    navigation (`https://www.google.com/maps/search/?api=1&query=<address>`); the voter's
    address (plus the staff user's IP) reaches Google **only on the admin's explicit per-door
    action — a click, or the page's G keyboard shortcut** *(v6 2026-08-29: the shortcut is a
    synchronous `window.open` inside the admin's own keydown — the same user-initiated,
    browser-side mechanism, still nothing prefetched or server-side)* — from the
    admin's own browser, replacing the identical manual workflow (pasting the address into
    Google). No customer data flows server-side to Google, nothing is engaged "to provide the
    Service", so it is **not** a DPA §6 subprocessor and the service-providers paragraph
    (`privacy.html`) needs no edit — Google already appears in both documents for app
    distribution and device location services. If this link is ever automated (prefetch,
    server-side geocoding via Google, embedded Google tiles), THAT change is a §6 event.
    *(v6 2026-10-05, item 28: the same confirm now also vouches for a home with no exact map spot —
    one whose coordinate was shared with other addresses — "the home really is here". Same fields,
    same `source:'confirm'` audit row, same roles; (a) now covers shared-spot pins too.)*

16. **[v6 2026-08-29 — ⚠️ WALK-UP VOTERS: a NEW COLLECTION CHANNEL and a NEW DATA CATEGORY —
    NEEDS AN OWNER DECISION on `privacy.html` BEFORE the production mobile release.]** Canvassers
    on survey campaigns can now **create a voter record at the door** ("Add a person" —
    `POST /mobile/households/:id/voters`, [VOTERS.md](VOTERS.md)): first/last name required,
    phone and **email** optional, volunteered by the person for follow-up contact. Two policy
    problems, one exposure audit:
    **(a) The collection channel has no policy category.** The Privacy Policy's "Voter and
    constituent information" paragraph states exactly one provenance: *"Our customers **upload**
    records…"* — and its Canvassing-activity paragraph covers activity attached to *"the record
    it relates to"*, i.e. an existing record. A canvasser **typing identity data into the app,
    creating the record**, is a second acquisition channel the policy does not describe (the
    same structural gap this doc recorded for the demo-request form). **(b) Email is a new
    personal-data category for voters.** `Voter.email` is the first email field on a voter or
    person record anywhere in the product; the policy's enumerated voter list (names, addresses,
    party, DOB, gender, telephone numbers, districts, voter IDs, voting-participation) does not
    include it. **Both are owner edits to `privacy.html`, made deliberately, never as a side
    effect of code — and the edit is a SHIP GATE for the production mobile OTA** (staging may
    precede it; the feature must not reach production phones while the published policy's
    provenance sentence is false). **Exposure posture, code-verified:** phone/email are
    admin-console-only — the mobile wire re-reads every voter through the shared
    `MOBILE_VOTER_PROJECTION` (bootstrap, `/changes`, and the create response), so neither field
    ever reaches a phone's offline cache, preserving the §C "strict subset" claim verbatim. *[v6
    2026-10-01: "admin-console-only" was too strong on the day it was written and is corrected here:
    both fields ride the **management-only profile routes** — `buildVoterProfile` returns
    `voter.email` beside the phones, and `GET /mobile/voters/:voterId` has served that payload to
    admins AND granted team leads since 2026-07-30 — and since 2026-10-01 also the campaign-scoped
    web profile a lead opens (item 24). What stays exactly true: neither field is in any canvasser
    wire (`MOBILE_VOTER_PROJECTION`) nor in a phone's offline cache, and email is in no export.]*
    `Voter.doorAdded.byUserId/at` is staff attribution on a customer record (same class as the
    pin-stamp items 15/v6-08-22; joins the §A3 pseudonymity list). The create tags its record
    for the staff-under-grant audit (`addAuditSubjects`), so a support-session add is visible in
    the voter's staff-access panel. **Deletion:** the new admin `DELETE /admin/voters/:voterId`
    (door-added rows only) erases the person — SurveyResponse rows, their archives, VoterNotes,
    VotedVoter rows — while `CanvassActivity` rows are kept with `voterId` nulled (the door
    visit is billing history, not personal data once unlinked; precedent: the admin
    survey-response delete). Door-added rows ride the existing campaign- and org-deletion
    cascades like any Voter row — no new retention surface, no new third party, and **no new
    export surface**: `email` is in no export's column set today (the CSV builders enumerate
    their fields; none was touched). Adding it to an export later is its own disclosure-review
    moment.

    ***[v6 2026-09-06 — GATE CLOSED. The owner made the `privacy.html` edit; the production mobile
    OTA is no longer blocked by this item.]*** The "Voter and constituent information" paragraph
    (`client/public/privacy.html`) now answers both problems above, in the owner's own words and
    applied verbatim at their instruction. **(a) Provenance:** the paragraph gained a second
    channel — *"A customer's canvassers may also add a person at the door — someone who answers but
    is not on the uploaded list — by entering their first and last name, together with a telephone
    number and email address if that person volunteers them so the campaign can follow up"* — so
    upload is no longer described as the only way a record arrives. **(b) Category:** **email
    addresses** joined the enumerated list beside telephone numbers. Nothing else in the paragraph
    moved: the purpose limitation and the access-limitation sentence stand as written, and the
    exposure posture recorded above is unchanged — email remains admin-console-only, stripped by
    `MOBILE_VOTER_PROJECTION`, so it still never reaches a phone's offline cache *[v6 2026-10-01:
    read "management-only" for "admin-console-only" — see the stamp above and item 24; the
    offline-cache half is untouched]*. The only
    editorial liberty was typographic: the apostrophe and both dashes are written as `&rsquo;` and
    `&mdash;` to match every other entity in the document. `client/dist/privacy.html` is gitignored
    build output that regenerates from this source, so there is no second copy to drift.
    **Deliberately left open as an owner judgment call, NOT an outstanding gate:** the same
    paragraph still reads *"Voters do not interact with the Services directly."* Someone
    volunteering an email to a canvasser who types it in is closer to interacting than a name
    pulled from a voter file, though they still never touch the app. The sentence is defensible as
    written; the owner may soften it in a later pass.

17. **[v6 2026-09-01 — NEW export type `notes`: a new DERIVED LINKAGE (opt-in, audited) and a
    ROLE WIDENING. No new data, no new recipient, no new subprocessor — but two of this
    document's own sentences needed amending, and they are amended below.]** The Export Center
    gains **Notes** (`services/export/exportBuilders.js` `buildNotes`), one row per note across
    the three live note stores — `CanvassActivity.note` (typed at a door), `SurveyResponse.note`
    (attached to a survey), `VoterNote.body` (written on a profile). Every one of those was
    already readable by the same audience on the Notes hub (`GET /admin/reports/notes`,
    [NOTES.md](NOTES.md)) and already left the system inside `activity-log.csv`,
    `survey-results*.csv` and `voter-notes.csv`. What is genuinely new:

    **(a) A derived linkage — opt-in, off by default, and recorded per download.** A door note
    names nobody: `CanvassActivity.householdId` is required, `voterId` defaults to `null`, and
    the door-recording path never sets it. The optional **`includeDoorVoters`** column lists the
    voters registered at that door beside the note — associating free text ("dogs in yard",
    "hostile") with named people **who were never identified at the door**. This is the exact
    inverse of the standing rule for `activity-log.csv`, whose voter columns are blank on plain
    knocks on purpose. Mitigations, all verified by
    `server/test/notesExport.int.test.js`: the column renders **only** when asked for; the choice
    is frozen into `ExportJob.params`, so the export history is a permanent record of which
    downloads carried it (the `includeVoterDetail` precedent); do-not-contact voters are excluded
    from the list by the same `DNC_FILTER` that governs `voterfile-current.csv`; and **the count
    column counts only the names printed** — a count of 3 beside two names would itself be the
    do-not-contact marker the door-unit rule in `services/export/exportScope.js` forbids. Because
    `voterfile-current.csv` already publishes that same household roster minus flagged voters, an
    omission here reveals nothing the same admin could not already download.
    **AMENDS the door-unit clause of `exportScope.js` and the "blank on purpose" sentence in
    [EXPORTS.md](EXPORTS.md)**: a door-unit row now has one opt-in, audited exception.
    *[v6 2026-10-02: a door note can now sit on a `not_target` entry ("Not a target voter", item
    25), printed with Outcome `not_target`. With `includeDoorVoters` on, that row lists the
    registered voters beside an outcome that is true of **none** of them by definition (someone not
    on the list answered), and the note may name that unlisted person (owner ruling 2026-10-02:
    acceptable) or say something about a listed voter. Same opt-in, same per-download record, same
    audience.]*

    **(b) A role widening — an owner ruling, and the reason two sentences here were false.** The
    new type is `adminOnly: false`, so a **team lead** can download it — including the `voter`
    source, i.e. `VoterNote` bodies, which the `voter-notes` type deliberately refuses them
    (`adminOnly: true`, unchanged). Those bodies include the auto-generated *"Marked
    do-not-contact: …"* notes that quote a person's stated opt-out reason. The owner ruled
    (2026-09-01) to accept this, on the grounds that a lead already **reads** all three sources on
    the Notes hub for campaigns they manage, under the same `canManageCampaign` gate the export
    inherits. Reading a 500-per-source paged screen and downloading an uncapped permanent file are
    nonetheless different exposures, so it is recorded rather than waved through.
    **AMENDS the sentence above in this document — "Org-wide bundles, voter-notes, and the full
    backup are admin-only"** — which stays true of the *type* but no longer of the *content*:
    profile-note bodies are lead-exportable through `notes`. `docs/ROLES.md` and the two help
    articles carrying the same sentence were corrected in the same change.

    **(c) Not a new collection, category, recipient, or retention surface.** No field was added to
    any model. The builder reads collections that already exist, through the same
    campaign/`canManageCampaign` scope, into the same 7-day GridFS artifact under the same
    sweeper, cascades and `addAuditSubjects` record-level audit as every other type (`subjectType:
    'voter'`; ids are added only for identities that actually reached the file, never for a
    DNC-skipped voter). The entitlement carve-out is path-based and untouched. **No Privacy
    Policy / ToS / DPA text change is required** — (a) and (b) are internal-posture amendments to
    this document, not to a published promise. The owner should nonetheless confirm they are
    content with (b) before the change ships.

18. **[v6 2026-09-01 — Canvassing activity, "One row per voter at the door" (`perVoterRows`): a
    DERIVED LINKAGE of item 17(a)'s class, at ROW grain, across the whole knock ledger — opt-in,
    audited, no new data, no new recipient, no new subprocessor. AMENDS item 17's "one opt-in,
    audited exception" — there are now two.]** The `canvass-activity` export gains an opt-in that
    repeats every activity row whose stored `voterId` is `null` — `not_home`, `wrong_address`,
    `refused`, `lit_dropped`, `no_soliciting`, `restricted` — once per voter registered at that
    door (same 34 columns, same order; the file is `activity-log-by-voter` and the download
    `…-canvass-activity-by-voter-<date>.csv`). A knock's outcome, timestamp, GPS and free-text
    note thereby become attached to named registered voters **who were never identified at the
    door** — for `refused` and `no_soliciting` the attached claim is true of at most one person
    per door, so the file is an inferential artifact, and every surface's copy says so ("the
    outcome is repeated, not attributed"). Mitigations, all verified by
    `server/test/exportBuilders.int.test.js` (the fixture gained a two-voter door, an all-flagged
    door and a voter-less door, and the registry DNC sweep now runs the type a second time with
    the option on): off by default; frozen into `ExportJob.params` and shown in the web export
    history's scope label; the roster is read through `DNC_FILTER` inside ONE shared predicate
    (`fanPlan().rosterMatch`, spread by the builder's prefetch and the estimate's `$unionWith`
    alike), so a flagged voter is structurally incapable of producing a row, blank or otherwise,
    and can never enter the record-level audit's subject set; an EMPTY kept roster emits exactly
    one blank-identity row, byte-identical to a zero-voter door's, so `fullyDnc` is undetectable
    by absence and no billable knock ever disappears from the ledger file; roster omissions do
    NOT increment `excludedDncCount` (a per-door count on a one-door export would itself be the
    marker `services/export/exportScope.js` forbids — that file now states the three rules a
    third exception must satisfy); the column set is identical either way, which structurally
    forbids a "voters at this door" count column; and the full backup passes `params: {}`, so the
    bundle is un-fanned by construction. **No new bit is published:** rows per door =
    `max(1, |the roster voterfile-current.csv already prints for that household|)`; both files
    carry `Household DB id`, both are `adminOnly: false`, both apply the same DNC clause — the
    same admin or lead can already perform this join by hand today, and the option automates it.
    Recorded honestly: `ctx.subjects` now collects every voter at every fanned door, so
    `audit.subjectsTruncated` (DEDUPE_CAP 100,000 / SUBJECT_CAP 20,000) becomes routine on large
    fanned exports — the record-level audit for the exports that name the most people is the
    likeliest to be partial. **Assessment: no Privacy Policy / ToS / DPA text edit required** —
    an internal-posture amendment like item 17. Nothing new is *collected* (the linkage exists
    only inside a generated file, for the same audience, through the same 7-day artifact,
    sweeper, cascades and access log); the export-facing published promise is the do-not-contact
    sentence, which this satisfies strictly. The owner should confirm before the production
    release.
    *[v6 2026-10-02: the voter-less action list above gains `not_target` ("Not a target voter",
    item 25). Its attached outcome (`not_target` in the Action column) is true of **none** of the
    listed voters by definition: someone not on the list answered. The attached note is free text:
    it may describe that unlisted person, possibly by name (owner ruling 2026-10-02: acceptable), or
    say something about a listed voter (item 25(a)'s example), and it is repeated onto every listed
    voter's row. Same mitigations, same file, same audience. On web and phone, the export copy that
    carries the "repeated, not attributed" caveat (the Canvassing activity description and the "One
    row per voter at the door" hint) names it only on campaigns that use the outcome, and the full
    backup's README.txt and manifest.json notes name it only when a campaign in that bundle uses it
    (owner ruling 2026-10-02, made after the build; it extends plan design call 9, so none of that
    copy shows the words to a customer who never turns it on). Call 9's own exception stands:
    `canvassers.csv` always carries a "Not a target" column, 0 when unused. [EXPORTS.md](EXPORTS.md)
    and the Help Center's exports guide name it too, worded for campaigns that use it.]*

19. **[v6 2026-09-02 — Billing month history: an EXISTING aggregate, shown over more months, to the
    same gated audience. No new data, no new recipient, no money.]** The org Billing page grew a
    12-to-24-month ledger (`GET /admin/billing/history`) and the super-admin panel a per-org month
    ledger plus a multi-month issue batch. Checked against all five triggers in `CLAUDE.md`:
    **What we collect** — nothing new. Every number is derived from `CanvassActivity` rows that
    already exist; no field was added to any model, and `Statement` continues to carry no personal
    data (campaign names, counts, dates, dollars), deleted with the org by the same cascade.
    **Retention/deletion** — untouched; no TTL, purge or backup behavior changed, and the ledger is
    computed live rather than stored, so it holds nothing to retain. **Who can access customer
    data** — unchanged: the customer route sits behind the same `requireOrgRole('admin')` +
    `Membership.billingAccess` gate as the rest of that router (pinned by a new 403 test), and the
    staff routes behind `requireSuperAdmin`. **Sharing/subprocessors** — none; no third party is
    involved and no data leaves the app. **What we expose** — this is the trigger that fires: a
    customer can now see 24 months of their own campaign/door counts where they could see one, and
    an account manager can export several months as one CSV. Both are the *same class of aggregate*
    the single-month views already showed to the *same people*, widened along the time axis only;
    no per-person data of any kind appears on either surface, at any depth. The **money boundary is
    the one thing that could have moved and did not**: `publicMonthHistory()` is the single
    projector for the customer surface and strips every `*Cents` field, which is now asserted
    twice — on the projector (`statementRange.int.test.js`) and by walking the actual HTTP
    **response body** (`billing.int.test.js`), plus a client render test asserting no `$` appears
    on the page. That keeps `docs/BILLING.md`'s published line — *"Customers never see a price in
    the app"* — true by construction rather than by care. **Assessment: no Privacy Policy / ToS /
    DPA text edit required.** Nothing new is collected, retained, shared, or made visible to anyone
    who could not already see it. Owner to confirm before the production deploy.

20. **[v6 2026-09-05 — Per-house "Directions": a USER-INITIATED HAND-OFF of one address to the
    canvasser's own maps app. Same class as item 15; no subprocessor, no policy edit.]** The mobile
    app gained a **Directions** link under a door's address on six surfaces (canvasser door screen,
    map sheet, building screen; lead/admin map sheet, overlap detail, voter profile). Tapping it
    offers named maps apps and opens one with walking directions
    (`mobile/lib/mapsLinks.js`, `mobile/components/DirectionsButton.jsx`). Checked against all five
    triggers in `CLAUDE.md`: **What we collect** — nothing. No field, no model, no request; the
    builder is pure and the app fetches nothing. **Retention/deletion** — untouched. **Who can
    access customer data** — unchanged; every surface already rendered that address to that same
    reader, and the link adds no route and no role. **Sharing/subprocessors** — the substantive
    question, and the answer is the one item 15 already recorded for the web Pin Fixes "Open in
    Google Maps" link: the address reaches Apple/Google/Waze **only on the canvasser's explicit
    per-door tap**, from their own device, under their own account with that vendor, replacing the
    identical manual workflow of typing the address into their maps app. Doorline engages nobody
    "to provide the Service" (`DPA.md` §6's test), sends nothing server-side, prefetches nothing,
    and embeds no maps SDK — every option is a plain `Linking.openURL` of an `https:` or `geo:`
    URL. **Not a DPA §6 subprocessor event; no customer notice; no `privacy.html` edit.** Two
    differences from item 15 are recorded deliberately: the actor is a **canvasser** rather than
    staff (already an authorized reader of that address under the policy's within-your-organization
    paragraph), and the recipient is **whichever maps app the canvasser or the OS picks, including
    Waze**, not Google alone. Google Play's Data-safety definition of "sharing" does include
    on-device transfer to another app, and this is exempt only through its user-initiated
    exception — **so the explicit per-door tap and the named-app choice are load-bearing**: any
    future auto-open, prefetch, or silent hand-off would leave that exemption and require a fresh
    look. **What we expose** — the address, to a maps app the canvasser chose, and nothing else:
    no voter name, no coordinate, no door status. The URL deliberately carries the **street
    address, never `location.coordinates`** (a test asserts no builder emits a coordinate), which
    is both the feature's purpose and a narrower disclosure than a pin would be. **Assessment: no
    Privacy Policy / ToS / DPA text edit required.** If the link is ever automated, or an embedded
    map or server-side geocoding replaces it, THAT is the §6 event — the same boundary item 15
    draws. Owner to confirm before the production OTA. **The unrelated gate that blocked this is
    now CLOSED:** item 16's `privacy.html` edit landed 2026-09-06 (stamped there), so a production
    mobile OTA is no longer held by it.

    *Housekeeping, folded in here rather than left to drift: the §C9(a) grep contract reads
    "`watchPositionAsync` → exactly one match". As of 2026-09-05 it matches **one call site**
    (`mobile/lib/useLocationFeed.js`) plus two comment lines that merely name the function
    (`useLocationFeed.js`, `lib/locationFeed.js`). The contract should be read as counting call
    sites, not lines; the background terms (`startLocationUpdatesAsync | TaskManager | defineTask |
    ACCESS_BACKGROUND_LOCATION | requestBackgroundPermissionsAsync`) return **zero**, re-verified
    2026-09-05, and must stay zero. Directions adds no location read of any kind.*

21. **[v6 2026-09-23 — Invoice payment records: STAFF bookkeeping on an existing staff-only record.
    No customer data, no new recipient, nothing new reaches a customer.]** The super-admin
    Organizations page became an invoicing desk and each org gained a five-tab page, and
    `Statement` gained due dates and a record of payment. Checked against all five triggers in
    `CLAUDE.md`:

    **What we collect** — four fields on `Statement`, all **staff** data about **our own invoices**,
    none of it about a canvasser, a voter or an org's members: `termsDays` and `dueAt` (dates),
    `paidAt` (a date), `paidByUserId` (a Doorline staff id, the same class as the existing
    `issuedByUserId`/`voidedByUserId`), and `paymentRef` — free text, ≤200 chars, typed by staff.
    `Subscription` gained `paymentTermsDays` (a number). Each statement line gained
    `billingStartMonth` (a 'YYYY-MM' string derived from data already on the line). **No field
    holds personal information about any data subject the DPA covers.**

    ⚠️ **`paymentRef` is the one to watch.** It is free text on a model whose header has always
    said it carries no customer personal data. That claim now holds **by discipline, not by
    construction**: the field's helper text, its help article, `docs/BILLING.md` and the model's own
    header all say *a reference number only — never a person's name, never card or bank details*,
    and the model header was updated in this change to state the boundary explicitly. A
    server-side character whitelist would make it a guarantee rather than a convention; that is the
    owner's call, and until then this line is the watchlist entry. Nothing in the app writes to the
    field except a super admin typing into it.

    **Retention / deletion** — unchanged. `Statement` is swept with the organization by the same
    cascade (`services/platform/deleteOrganization.js` imports and deletes it), so the "no invoice
    retention beyond the org" line stays true — **including for an unpaid statement**, which the
    delete confirmation now says out loud so nobody destroys the record of a balance by accident.
    No TTL, no purge, no backup change.

    **Who can access customer data** — narrower than the surfaces it sits beside, not wider. Both
    new routes (`POST …/statement/:id/paid`, `…/unpaid`) are `requireSuperAdmin`, pinned by a test
    asserting an org admin gets 403 on each; every filter is scoped by `organizationId`, so a
    statement id from one org cannot be touched through another's URL (asserted). The org page
    shows the member roster as metadata with **no support grant and no AccessLog row**, exactly as
    the page it replaced did — that boundary is unchanged, not relaxed.

    **Sharing / subprocessors** — **none.** No third party receives anything. Payment still happens
    entirely outside the app; Doorline records *that it happened*, and takes no card, bank or
    processor data. The dormant Stripe phase remains designed-not-built; wiring it would be the
    §6 event, unchanged by this work.

    **What we expose** — to the **same gated audience that already saw statements**. A super admin
    now sees paid/overdue signals across orgs; super admins could already read every statement,
    every rate and every dollar. Customers see **nothing new**: `publicUsage` and
    `publicMonthHistory` build their own objects and were not touched, and `billing.int.test.js`
    now walks the actual `GET /admin/billing` and `/admin/billing/history` response bodies asserting
    that no key matching `Cents$|paidAt|dueAt|paymentRef|termsDays|paymentState|paidByUserId`
    survives at any depth — the money boundary and the new payment boundary enforced by the same
    walk. The one new export column (Payment, on a staff CSV) is staff-only and carries no personal
    data.

    **Assessment: no Privacy Policy / ToS / DPA text edit required.** Nothing collected is personal
    information, nothing is shared, no retention changed, and the audience is unchanged. Owner to
    confirm before the production deploy, as item 19 was. `client/public/privacy.html` needs **no
    edit** for this change.

22. **[v6 2026-09-24 — NEW export type `results-by-voter` ("Results by voter"): the FIRST export
    type whose stated PURPOSE is that its rows leave the tenant, and it is LEAD-VISIBLE by a ruling
    that makes it CLIENT-VISIBLE BY DESIGN. No new field, no new retention, no new subprocessor, no
    DPA change — what is new is that data this same audience can already download in pieces now
    arrives pre-joined, in a file built to be handed on. ONE sentence is left for the owner before
    the production deploy.]** One row is one registered voter at a door with a surviving FIELD VISIT,
    union anyone surveyed in scope (the four definitions the file rests on are stated at
    `services/export/exportBuilders.js:1070`; builder `buildVoterResults` at `:1274`; registry entry
    `services/export/exportTypes.js:298`). Each row carries that person's identity (State voter ID,
    UID, first and last name, party), their door's address, **the door's outcome spelled in plain
    English** (`DOOR_STATUS_LABELS`, `utils/statusPrecedence.js:89` — the 8-value `Household.status`
    domain, resolved by `resolveStatusFromSummary` at `:74`), that door's visit count, rounds worked,
    first and last visit and who visited it last, and then **one block per (survey template, round)
    pair that actually occurred in scope**: what that person answered, the block's "Survey" cell
    reading `… (desk entered)` where an admin typed the answers rather than a canvasser. Two things
    are optional and both are off by default — the existing contact/demographic block
    (`includeVoterDetail`) and the canvasser's survey note (`includeSurveyNote`, one cell per block,
    `exportBuilders.js:1431`). Docs: [EXPORTS.md](EXPORTS.md).
    *[v6 2026-10-02: the `Household.status` domain is now **nine** values — `not_target` ("Not a
    target voter", item 25) joined it; `DOOR_STATUS_LABELS` prints it in *Address outcome* as a fact
    about the door, true of none of the people listed there (the same change moved the anchors
    above: `DOOR_STATUS_LABELS` is now `utils/statusPrecedence.js:94`, `resolveStatusFromSummary`
    `:79`).]*
    *[v6 2026-10-02 anchor refresh: the results-by-voter copy now lives in an arrow function above
    the registry, `resultsByVoterDesc` (`services/export/exportTypes.js:197-198`), which builds both
    forms the registry serves: `desc`, which never names Not a target voter, and
    `descNotTargetInUse`, which does (item 25). The three sentences quoted below ("The file to send a
    client", the three-voter house, "built to be read rather than re-imported") are in both. So this
    item's `exportTypes.js` anchors now read: the registry entry `:298` → `:318`; the copy at `:300`
    → `:198` (served at `:320-321`); `:302 + :304-307` → `:323 + :325-328`; `adminOnly` `:308` →
    `:329`; the frozen opt-ins `:333-336` → `:354-357`; Survey results' `:255-256` → `:275-276`.
    Also moved since this item was written: `routes/admin/exports.js:338` → `:342`,
    `client/src/pages/ExportsPage.jsx:194` / `:199` → `:197` / `:202`, and
    `services/access/supportAccess.js:144` → `:148`. Every other anchor in this item, besides the
    `statusPrecedence.js` pair refreshed above, was re-checked and resolves as written.]*

    **(a) The purpose is external hand-off, and that part IS new.** Every existing type is a
    re-import file, an audit file or a backup; this one's registry copy is *"The file to send a
    client"* and it is the only type that prints outcomes as prose rather than slugs, *"because this
    is the one built to be read rather than re-imported"* (`exportTypes.js:300`). Nothing in the code
    changes when a CSV is forwarded — the mechanism is the same 7-day GridFS artifact every type
    uses — but a document that records what we promise should say once, plainly, that the product now
    ships a feature whose success condition is that a file of named voters, their home addresses,
    their door's outcome and their political answers is handed to somebody outside the organization
    that collected it. **That is the owner sentence at the end of this item.**

    **(b) Lead-visible means CLIENT-visible, and the owner ruled it deliberately.** `adminOnly:
    false` (`exportTypes.js:308`), and the two opt-ins stay lead-usable. The owner ruled
    (2026-09-23), in their words: *"its okay for the lead to be able to export just like an admin.
    leads could be clients that just wont have access to the org but will have access to a campaign
    they are paying for through the org thats running the canvassing."* So the `lead` tier is not
    only the customer's own campaign staff: it is **deliberately also an external paying stakeholder
    with access to the one campaign they fund and none to the organization** — which is why "may a
    lead export this" and "is this fit to hand the customer" are the same question here. The ruling
    is restated at the registry (`exportTypes.js:302 + :304-307`) so the next reader of `adminOnly: false`
    finds the reason beside the flag. Both opt-ins are frozen into `ExportJob.params`
    (`exportTypes.js:333-336`) and printed in the web history's Scope column
    (`client/src/pages/ExportsPage.jsx:194`, `:199`), so the export history is the permanent record
    of which client files carried a date of birth and which carried canvasser prose.

    **Neither opt-in is a new lead capability — stating that is what keeps the ruling narrow.** The
    contact/demographic block is the EXISTING toggle (phone, cell, phone type, gender, **date of
    birth**, precinct and the three districts, plus the household's county and coordinates —
    `exportBuilders.js:127-130`), which `survey-results` has offered leads since the Export Center
    shipped (`exportTypes.js:255-256`, `adminOnly: false`) and which `voter-file` — also `adminOnly:
    false` — already prints for **every** voter in the campaign, date of birth included
    (`exportBuilders.js:1456`). The survey note is *more* restricted here than where a lead already
    gets it: `survey-results` carries an unconditional `Note` column (`exportBuilders.js:904`) and
    `notes` exports all three note stores to a lead by the 2026-09-01 ruling recorded in item 17(b),
    whereas here it must be asked for and is recorded per download. **What is genuinely new is the
    pre-joining**: identity, the door's outcome and the answers on one line, for people **who were
    never identified at the door**. That is item 18's derived-linkage class, except that here it is
    not an option — it is the file. Every surface says so in the same words the code does (*"Refused
    on a three-voter house means somebody there declined, not that all three did"*,
    `exportTypes.js:300`).

    **It does NOT add a third exception to the door-unit blanking rule.** This export is
    **voter-unit**: a flagged voter is dropped WHOLE by `DNC_FILTER` inside the one roster cursor
    (`exportBuilders.js:1374`), never blanked, so `services/export/exportScope.js`'s count of two
    opt-in exceptions (items 17(a) and 18) stands unamended and that file needed no edit.

    **(c) Do-not-contact: the voter-unit drop, with a counter scoped to the universe.** A flagged
    voter is absent from the file entirely — no blanked row, no placeholder, no ordinal — which is
    the strict reading of the published sentence (privacy.html "Canvassing activity": *"exclude that
    person from the organization's future canvassing lists and exports"*). `excludedDncCount` is
    deliberately **universe-scoped** rather than campaign-wide: `countVoterResultsWithheld`
    (`exportBuilders.js:1203`) counts flagged voters over the SAME door/voter universe the rows come
    from, because a flagged voter at a door nobody visited was never a row this export withheld.
    Rows and withheld count come off ONE universe resolution shared with the count-only preview
    (`services/export/exportEstimates.js:288`), so the estimate can never describe a different set
    than the file contains, and it is EXACT (`approx: false`). **The file's stated limits are what
    keep that counter honest**, and they are written down in [EXPORTS.md](EXPORTS.md): a visited door
    with no registered voters and a visited door whose whole roster is flagged both produce ZERO rows
    and are indistinguishable by design, so the row count is not "the doors you worked" —
    `doors-by-round` remains the file that accounts for every door.

    **(d) Record-level audit: a capped sample, inherited and stated knowingly.** Every voter that
    actually reaches a row is added to the job's subject set (`exportBuilders.js:1411`), which the
    worker persists and the download tags onto its AccessLog row
    (`services/export/exportProcessor.js`; `routes/admin/exports.js:338`). The collector stops at
    **DEDUPE_CAP 100,000** distinct ids (`exportProcessor.js:32`) and the stored list at
    **SUBJECT_CAP 20,000** (`services/access/supportAccess.js:144`), with `subjectsTruncated` and
    `subjectsTotal` recording the honest remainder. So for any campaign with more than 20,000 voters
    in scope — the normal case for the campaigns this file exists to report on — **the record-level
    audit row for the download that names the most people is a capped sample, not a complete list.**
    Inherited from `voter-file` and unchanged by this work (item 18 recorded the same effect for
    fanned activity exports); restated here because this is the type most likely to name everybody,
    and "we can tell you exactly whose records were in that export" must not be claimed beyond the
    cap.

    **(e) Nothing else moves — checked against all five triggers in `CLAUDE.md`.** **What we
    collect** — nothing. No field was added to any model; the only schema edit is the new key in
    `EXPORT_TYPE_KEYS` (`models/ExportJob.js:21`). Every column is read from `Voter`, `Household`,
    `CanvassActivity` and `SurveyResponse` rows that already exist, through the answer-column factory
    the existing survey exports share (`services/export/surveyColumns.js`). **Retention / deletion**
    — unchanged: the same `EXPORT_TTL_DAYS` (7) artifact under the same `sweep-expired-exports`, the
    same `ORG_SCOPED`/`CAMPAIGN_SCOPED` cascades over `ExportJob` and the GridFS bucket. **Who can
    access customer data** — the same `canManageCampaign` scope as every other campaign-scoped type;
    no route was added, `POST /admin/exports` is unchanged and its entitlement carve-out stays
    path-based; `isInternal` orgs still write no AccessLog rows. **Sharing / subprocessors — none.**
    No third party receives anything, so **DPA §6 is not triggered and there is no customer-notice
    event.** **What we expose** — a new file, to an audience that could already assemble it, and
    deliberately **not** added to the full-backup ZIP (the bundle already carries the survey files).
    No migration, no index build, no client-version bump.

    **Assessment: no published sentence becomes FALSE. One is INCOMPLETE — and it is the owner's to
    rule on BEFORE the production deploy.** `client/public/privacy.html:105` says information is
    available *"to authorized users of the customer organization you belong to, according to their
    role"* and that customer data is not visible to other customer organizations: both stay true,
    because a lead — client or not — is a member of that organization holding that role, and nothing
    here moves data between tenants. What no published text addresses is what happens to the file
    afterwards. `client/public/terms.html:106` already carves *"the Customer exporting its own data
    through features we provide"* out of the no-resell / no-redistribute rule, and `terms.html:95-96`
    puts the voter-file licence warranty on the Customer, so the AUP is not breached by an export we
    built for that purpose — but neither page says a word to the **voter** about a report of their
    address, their door's outcome and their answers being handed to a third party at the
    organization's direction.

    **[RULED 2026-09-24 — both pages edited, by the owner, on the wording they chose.]** Two things
    that this item as first written did not say sharpened the decision, and both are recorded here
    because the reasoning matters more than the edit.

    **The case was never falsity, but it was stronger than completeness.** `privacy.html:101` is the
    ONLY place the published Policy describes reporting to a customer's clients, and it describes it
    as the channel that EXCLUDES identity: *"Published reports exclude voter names, canvasser
    identities, and action timestamps."* That sentence is scoped to **published** reports and stays
    true. But a voter reading the Policy end to end concludes that client reporting is name-free, at
    exactly the moment a second client-reporting channel exists that carries their name, address,
    door outcome and political answers — and the product's own help article is titled *"Which file do
    I send my client?"* (`server/src/content/help/faq/which-file-to-send-a-client.md`, `audience:
    lead`). Misleading-by-omission risk, not a false sentence. That is what was closed, and it is why
    "say nothing, the Customer owes the notice" — defensible on `DPA.md:17` §2, `terms.html:97` and
    `privacy.html:134` — was not chosen.

    **The ToS carve-out did not carry the weight this item put on it.** The sentence above claims
    the AUP is not breached; `terms.html:106` excepted the Customer **exporting** its own data, and
    the onward hand-off is most naturally the **redistributing** the same clause prohibits. A literal
    reading of our own acceptable-use rule forbade the act the product instructs. Now closed in the
    text rather than by intent.

    **The edits, both owner-directed:**
    (1) `client/public/privacy.html` "Within your organization." — now states that an organization
    may report on its own canvassing to its own clients, including by exporting records and sending
    them on, and that the organization decides what to report and to whom and controls that
    information, this Policy covering our handling of it rather than the recipient's. Deliberately
    general: it names the channel and the responsibility, never what a report contains.
    (2) `client/public/terms.html:106` — the carve-out now reads *"…other than the Customer
    exporting its own data through features we provide and providing it to its own clients and
    service providers, for which the Customer remains responsible under Section 3"*, which attaches
    the Customer's existing §3 warranties to the forwarded file.

    **Not a DPA event, proven rather than asserted.** `DPA.md:49` §6 governs subprocessors *Doorline*
    engages; the client is engaged by the Customer and no data reaches it through us — the mechanism
    is the same 7-day artifact every export type uses, downloaded by an authenticated member. In the
    hand-off the Customer is the disclosing Controller (`DPA.md:17` §2) and Doorline is not a party.
    §6's own FbTime sentence is the in-document precedent, and this case is weaker still, because
    unlike FbTime we exchange nothing with the recipient. No subprocessor-list change, no customer
    notice, no §6 edit. Verified after the edits: `test/staticPages.int.test.js` 11/11, including its
    mojibake guard.

23. **[v6 2026-09-24 — Survey answers on the Canvassing activity export
    (`params.includeSurveyAnswers`): a file the product calls *"Every door result"* now also carries
    what named people said about politics, plus an opt-in extra row per survey. Audience unchanged,
    no new data, no new recipient, no new subprocessor. AND IT CLOSES A PRE-EXISTING LEAK: a
    do-not-contact voter's survey NOTE ships in today's production file beside their full street
    address. Defect found in this work, fixed in it, pinned.]** With the option on, a
    `survey_submitted` row gains, after its `Note` column: `Row source` (knock|survey), `Survey`,
    `Survey version`, `Survey submitted (ISO)`, `Survey taken by`, `Desk entered`, one column per
    question (unioned across the templates in scope, prefixed with the survey name when there is more
    than one), and `Response DB id` last (`services/export/exportBuilders.js:281` for the layer's
    contract, `:294` for the disclosure headers, `answerLayerPlan` at `:317`). It **also adds rows**:
    a survey knock is household-deduped, so surveying three people at one door in one round leaves
    ONE `survey_submitted` row and THREE responses; every in-scope response that no activity row in
    the file names becomes its own row — `Row source: survey`, blank `Activity DB id`, and never to
    be counted as a knock (`countUncoveredResponses` at `:373`, writer branch at `:542`). Because
    rows are added, the file and the download are renamed `activity-log-with-surveys` /
    `…-canvass-activity-with-surveys-<date>.csv` from ONE function (`activityFileNames` at `:409`),
    and the suffix tracks whether rows were actually added rather than the raw tick — so a human can
    tell from the filename that a file of knocks carries answers.
    *[v6 2026-10-02 anchor refresh: the "Not a target voter" build (item 25) and its follow-up moved
    seven of this item's anchors. In (a): `exportTypes.js:194` → `:214` (Canvassing activity's
    `adminOnly: false`), `:256` → `:276` (Survey results'), `:222` → `:242` (`includeSurveyAnswers`
    frozen into `ExportJob.params`), and `client/src/pages/ExportsPage.jsx:200` → `:203`. In (d):
    `routes/mobile/canvass.js:797` → `:837`, `:875` → `:915`, and
    `services/notes/notesQuery.js:148-166` → `:151-169`. Not moved, but one line off since this item
    was written: the corrected comment in (c) is `services/export/exportEstimates.js:62-66`, not
    `:63-67`. Every other anchor in this item was re-checked and resolves as written.]*

    **(a) The audience is unchanged; the co-location is the change.** `canvass-activity` is
    `adminOnly: false` and so is `survey-results` (`exportTypes.js:194`, `:256`), so everyone who can
    tick this box could already download the same answers, for the same scope, as a second file. The
    join is the `SurveyResponse` unique key `{voterId, passId}` and deliberately does NOT match on
    `userId` (owner ruling 2026-09-23, reasoning at `exportBuilders.js:290-293`): two canvassers who
    surveyed the same person in one round keep one activity row each while the live response is the
    later one's, so BOTH rows carry the answers of record and the `Survey taken by` / `Desk entered`
    columns say whose survey it is — blanking the superseded row would read as "no survey taken",
    which is false. The only thing the answers now sit beside that `survey-results` does not carry is
    the recording canvasser's own GPS, accuracy and distance-from-house: facts about the
    **canvasser**, already in this file, unchanged. The option is frozen into `ExportJob.params`
    (`exportTypes.js:222`) and printed in the history's Scope column
    (`client/src/pages/ExportsPage.jsx:200`), so the history records which activity files carried
    political opinions.

    **(b) The chips gate the whole layer, and a canvasser filter adds no rows.** With
    `survey_submitted` unticked there are no answer columns at all and the file is byte-identical to
    one queued without the option (`answerLayerPlan` at `:317`) — not empty columns. With a canvasser
    filter the columns stay but rows are not added (`addRows: on && !params.userId`), because that
    filter removes the covering rows and the rule would otherwise manufacture other people's surveys
    into a file about one person's work. A response whose `Voter` document is gone (an import undo) is
    KEPT with blank identity and counted in `orphanedRows` — this file's existing habit for a
    dangling knock row — which is what lets the estimate stay `approx: false`.

    **(c) DNC: a term added to `excludedDncCount`, and a stale comment corrected rather than left.**
    A flagged voter's KNOCK row keeps the row and blanks identity (the door-unit rule: the knock is
    billed work), and now also blanks their answers and their survey note (`exportBuilders.js:606-608`,
    `:637`). A flagged voter's SURVEY-source row is voter-unit and is dropped whole (`:548`), so
    `excludedDncCount` gains a term — which is why the comment in
    `services/export/exportEstimates.js:63-67` that said the number is *"IDENTICAL with the option on
    and off"* was corrected in this change: it was true of `perVoterRows` (item 18) and is not true
    of this option.

    **(d) ⚠️ THE PRE-EXISTING LEAK — a defect, in the production file today, not a hypothetical.** A
    field survey writes ONE `data.note` to BOTH ledgers: `SurveyResponse.note`
    (`routes/mobile/canvass.js:797`) and the `survey_submitted` `CanvassActivity.note` (`:875`). The
    Export Center's door-unit DNC rule blanks a flagged voter's identity columns on their activity row
    but kept the `Note` cell — correctly for every other `actionType`, where the note is about the
    DOOR, and **wrongly for `survey_submitted`, where it is the person's own survey note**: the same
    class of content that makes `voter-notes` admin-only because it *"frequently contains the opt-out
    request itself"* (`exportBuilders.js:1580-1582`). So the currently shipped `activity-log.csv`
    prints a do-not-contact person's survey note beside their full street address with their name and
    voter ids blanked — a re-identifiable free-text disclosure about exactly the person privacy.html
    promises is excluded from exports. **Verified against `HEAD`, not inferred:** the pre-change cell
    is an unconditional `a.note || ''` on a row whose identity columns are already blanked.
    **Fixed at `exportBuilders.js:637`**, on the flagged-voter branch, **option on or off**, with the
    reasoning at `:606-608` (a row that blanks the name must blank what the person said). No existing
    test covered it; `server/test/exportBuilders.int.test.js` now does.
    **Two things checked rather than assumed, both reported as found:** (i) the blank keys on
    `actionType`, so a desk-CONVERTED row is blanked too although its note is the original DOOR note
    (`services/canvass/surveyConversion.js` sets `actionType`/`voterId` on the stamp and never
    rewrites `note`) — an over-blank, in the safe direction, where the alternative would be comparing
    cell text; (ii) **`notes.csv` does not carry the same leak** — its survey source is voter-unit and
    drops a flagged voter's row whole (`exportBuilders.js:1826`), and its door source deliberately
    excludes plain `survey_submitted` rows, admitting only the desk-converted ones
    (`services/notes/notesQuery.js:148-166`), whose note is that original door note. The activity file
    was the only place this shipped.

    **(e) One negative, recorded so it is not re-derived: the remembered tick is not stored data.**
    The option is remembered per campaign, per browser/device — `client/src/lib/exportOptions.js` on
    `localStorage`; `saveExportOptions`/`loadExportOptions` in `mobile/lib/cache.js:373`, `:381` — and
    holds one boolean under a key containing the campaign id, nothing else. It is written only after a
    queue SUCCEEDS from the sheet's own path, never from the retry path, which re-posts an old job's
    frozen params through the same mutation. No personal data reaches device storage through this
    change, and the durable record of what a file contained remains `ExportJob.params`.

    **Assessment: no Privacy Policy / ToS / DPA text edit is required, and one published sentence
    stops being false.** Nothing new is collected, no new recipient, no retention change, and the
    audience is identical to `survey-results`. The do-not-contact sentence privacy.html publishes is
    **more** true after this change than before it — see the stamp on that watchlist bullet above.
    Owner to confirm before the production deploy, as items 19 and 21 were; the leak fix itself
    should not wait on that confirmation, because it corrects a live file.

24. **[v6 2026-10-01 — Campaign-scoped Voters tab + read-only campaign profile on the WEB for team
    leads: a widening of a web READ surface to an audience that already holds the identical read on
    mobile and in exports, plus a NARROWING of the mobile read. No new data, no new recipient, no new
    subprocessor, no write moved. This is a "who can access customer data" change and is said out
    loud here, as the repo invariant requires.]** What shipped: a new campaign-nested router
    `/admin/campaigns/:campaignId/voters` (`routes/admin/campaignVoters.js`; `requireAuth,
    orgContext, requireCampaignManager, loadCampaign`) with three routes — the campaign's directory,
    one profile, add-note — and a web **Voters** tab in every campaign's console nav (`CAMPAIGN_NAV`,
    Field group) with routes `/campaigns/:campaignId/voters[/:voterId]` **outside** the `orgAdmin`
    RoleGate. The org router `/admin/voters` is untouched (`requireOrgRole('admin')` router-wide, no
    carve-outs — the "no per-route carve-outs" sentence in `docs/ROLES.md` stays literally true). ONE
    list resolver, `listVoters` (`services/voters/voterDirectory.js`, extracted verbatim from the org
    handler), feeds both the org page and the campaign tab; the campaign route passes
    `req.campaign._id` as the scope and ignores any `?campaignId`. ONE profile builder,
    `buildVoterProfile(voterId, { orgId, scopeCampaignId })`: when `scopeCampaignId` is set the
    person-level unions collapse to the opened row (`personRowIds = [voter._id]`) and
    `otherCampaigns = []`, and the builder returns `null` when the voter's `campaignId` differs — a
    mismatched scope can never widen a read. The campaign route passes
    `scopeCampaignId: isOrgAdmin(req) ? null : req.campaign._id`. ONE note writer, `createVoterNote`
    (`services/voters/voterNotes.js`), shared by the org, campaign and mobile routes.

    **(a) Who gains what.** A **team lead**, on a campaign they hold a `CampaignManager` grant for,
    can now on the web: list that campaign's voters (name, state voter id, party, survey status,
    the do-not-contact boolean, the door-added marker, voted, address — the row fields the org
    directory already shows admins, minus the dedupe-only `campaigns[]` chips); open a **read-only**
    profile carrying the full identity block — **phone, cell, email, date of birth**, gender,
    registration, districts and precinct — the household and its members with their statuses,
    **this campaign's** survey answers including preserved (overwritten) responses and their template
    question text, **this campaign's** admin and field notes, the household's canvass activity, voted
    status, and the **do-not-contact flag WITH its reason, who flagged and when** (owner ruling
    2026-09-30, rulings 1 and 2: the flag is org-wide by design and the reason is shown to a lead
    exactly as to an admin; the voter's email is shown); and **add a note** — the router's only
    write. A lead cannot edit identity, flag or clear DNC, edit/delete/restore a survey response,
    delete a walk-up voter, or delete a note: none of those routes moved off the admin-only org
    router. The **"Doorline staff access" card stays hidden** from leads (ruling 3) —
    `GET /admin/voters/:id/staff-access` remains on the org router, admin-only, with no campaign twin.

    **(b) Why this is disclosure PARITY, not a new exposure.** Every field above already reaches the
    same person through shipped, code-verified channels: (i) the **mobile profile**
    `GET /mobile/voters/:voterId` has been management-only — lead-reachable with the FULL profile:
    phone, DOB, the DNC reason and `voter.email` (returned by `buildVoterProfile` since the field
    existed) — since 2026-07-30 (the stamp on the §H16(b) paragraph below; pinned by
    `test/perRoundVoterView.int.test.js`); (ii) the lead-visible **exports** — the voter-file
    reconstruction (`voterValueOf` in `services/export/exportBuilders.js` renders `dateOfBirth` and
    the phone keys) and the `includeVoterDetail` opt-in on the two survey exports
    (`VOTER_DETAIL_HEADERS`: gender, date of birth, phone, phone type, cell phone — lead-tickable on
    `results-by-voter` under the 2026-09-23 ruling, item 22) carry phone and DOB, and `notes` carries
    profile-note bodies including the auto-generated DNC-reason notes (item 17); (iii) the **Notes
    hub** already shows a lead every note source for campaigns they manage. The owner's standing
    ruling that **a team lead may be the paying CLIENT** (lead-visible = client-visible; items 17 and
    22) is the basis: the web page gives the same reader the same record in a browser instead of a
    phone or a CSV. **Email, said plainly:** it is NOT in any export's column set (re-verified:
    `services/export/` has no `email` reference) and NOT in any canvasser wire
    (`MOBILE_VOTER_PROJECTION`, `routes/mobile/bootstrap.js`), but it HAS been in the management-only
    mobile profile payload all along, so a lead could already read it; item 16's two
    "admin-console-only" sentences are stamped below rather than left standing.

    **(c) The NARROWING — on web AND mobile.** Until now a lead's mobile profile carried the person's
    **cross-campaign** history: survey answers, notes and the names of every campaign the org holds
    that person in — other clients' campaigns, when the lead is a client (the sibling-union design
    recorded in VOTERS.md §D). Ruling 4: a lead sees ONLY their own campaign's answers and notes.
    `GET /mobile/voters/:voterId` now passes `scopeCampaignId` for every non-org-admin, so the
    shipped app receives a campaign-scoped payload with `otherCampaigns: []` — **no app update
    needed**, the server narrows. The web campaign profile is born scoped the same way. An **org
    admin** opening a voter from the campaign tab still sees the person's other campaigns with links
    (ruling 5 — the org-wide union, as today). Net for a client-lead: strictly less of other clients'
    data than yesterday.

    **(d) Audit posture — same class, verified.** The new router is mounted in `routes/index.js`
    with the other campaign-nested routers, i.e. **after `accessLog`**, so every request under a
    support grant logs; `RESOURCE_LABELS` (`services/access/supportAccess.js`) gains a rule so
    `/admin/campaigns/:id/voters…` classifies as `voters` rather than `other` (an unrecognized route
    is still logged — the failure the design forbids is an unlogged read, not a mislabeled one); and
    the router carries the same `router.param('voterId') → addAuditSubjects(res, 'voter', id)` hook
    as the org router, so a single-record open under a grant lands in that voter's staff-access
    panel. Refusal codes, recorded because they are a concealment decision: a campaign the caller
    does not manage → 403 `FORBIDDEN_ROLE` (middleware; "your role is too low", and nothing else is
    ever that code); a voter in the org but **not in this campaign** → **404 `VOTER_NOT_IN_CAMPAIGN`
    for every role** on the web, so a client-lead cannot probe other campaigns' voter ids and learn
    that they exist; an unknown id → 404 `Voter not found`. Mobile keeps the **403** status for the
    same case (the shipped app inspects 403 codes) and gains `code: 'VOTER_NOT_IN_CAMPAIGN'`; it
    refuses a manager's note on an out-of-campaign voter the same way. One data-handling change,
    recorded for completeness: the mobile manager-scope search used to build a `$in` of **every
    household id in the campaign** (150,000 ids, 2.9 MB per request); it now filters
    `{ organizationId, campaignId }` — fewer ids in flight, the same rows out.

    **(e) Negatives, so nothing is re-derived.** No write moved: the identity PATCH, DNC flag/clear,
    survey edit/delete/restore, walk-up delete and note delete stay on the admin-only org router,
    and the web admin's campaign-mode profile calls those org routes. No new field, no new
    collection channel, no retention change, no new export (the campaign tab has no CSV), no new
    third party — **not a DPA §6 event**. The Help Center gains a lead-visible page guide
    (`pages/page-voters.md`), written from VOTERS.md Part 1.

    **Assessment: no Privacy Policy / ToS / DPA text edit is required.** `privacy.html` never names
    roles — its access-limitation sentence is about the customer organization's authorized users —
    and it already contemplates the organization sending records to its own clients, which is
    exactly what a client-lead reading their campaign's voters in a browser is. What changes is this
    code-verified record: a lead's web reach now matches their mobile and export reach, and their
    mobile reach is narrower than it was. **Owner to confirm before the production deploy**, as
    items 17, 19, 21, 22 and 23 were — specifically that rulings 1 and 2 (the DNC reason and the
    email shown to a lead) are as intended, since those are the two fields where "already on the
    phone" is the only prior disclosure.

25. **[v6 2026-10-02 — "Not a target voter": an OPT-IN door outcome (off on every campaign until an
    org admin turns it on). A new FACT recorded about an address, through the existing door-outcome
    row — no new field, no new collection channel, no new recipient, no new subprocessor, no
    retention change. What is new for disclosure is one more door-status VALUE in published reports
    and lead-visible exports. Said out loud here as the repo invariant requires.]** What shipped:
    `CanvassActivity.actionType` and `Household.status` gain `not_target` (label "Not a target voter",
    `utils/statusPrecedence.js` `DOOR_STATUS_LABELS`); the canvasser records it with one tap,
    `POST /mobile/households/:id/not-target` (`routes/mobile/canvass.js:635`), on SURVEY campaigns
    only, GPS-stamped like every outcome, with the same optional door note. A FRESH tap is recorded
    only where `Campaign.enabledOutcomes` lists it (`models/Campaign.js:51`, changed only by the
    org-admin, audited campaign PATCH) and Doorline has released it (the `OPT_IN_OUTCOMES` config
    var). On a survey campaign where it is not on, or not released, a fresh tap is refused
    (`OUTCOME_DISABLED`); on a lit-drop campaign the route's survey-only check refuses it first (a
    plain 400 with no code). An offline-queued tap (`wasOfflineSubmission`, set by the client — "policy, not
    security", `routes/mobile/canvass.js:333-334`) is still recorded on a survey campaign that has
    had the outcome on at some point (`everEnabledOutcomes`; `outcomeEverEnabled`,
    `services/canvass/outcomeToggles.js:55`, deliberately ignores the release). So entries can
    arrive after an org admin switches it off or Doorline withdraws it, including taps made on a
    phone that was offline when it was switched off. That residual is accepted (plan §C.3); admins
    review such entries on Door Outcomes by their **Offline** tag and in the `outcome-entries.csv`
    **Offline** column (stamped on that file's §B8 entry). Docs:
    [PROPOSAL_NOT_TARGET_OUTCOME.md](PROPOSAL_NOT_TARGET_OUTCOME.md) (§M walks the triggers),
    [METRICS.md](METRICS.md), [CANVASSER_APP.md](CANVASSER_APP.md).

    **(a) What we collect — no new field; one new fact, and the note sentence that matters.** The row
    carries exactly what every door outcome carries: the outcome, the time, the canvasser, the GPS
    reading, an optional note. The fact it records is new — *someone at this address answered who is
    not one of the listed voters and would not give their details* — and no reason picklist or new
    free-text field was added (one tap, by design). **But the existing optional door note on this
    outcome will often describe exactly that unlisted person** (e.g. "her ex answered, said Jane
    moved"), possibly by name. Per items 17(a) and 18, that note sits next to the registered voters'
    names in two lead-visible exports: Notes with "Include the voters registered at each door", and
    Canvassing activity with "One row per voter at the door". In the app it also shows on the web
    profile of every registered voter at that door: the profile's Canvass activity list is the
    household's door entries with their notes, and `KNOCK_ACTIONS` in
    `services/voters/voterProfile.js` includes `not_target` (the phone profile route returns the same
    list, unrendered). Those profiles are management-only: org admins, and team leads for campaigns
    they manage (item 24). A lead can be the client. The repo's
    do-not-knock precedent treats free text about people outside the voter file as worth recording,
    so it is recorded: **owner ruling 2026-10-02 — acceptable** (*"no, its okay for us to know names
    and stuff. espeically the client because they own the data and all."* — plan §R item 2), so no
    canvasser copy discourages it. `privacy.html:90` (*"a survey response, a door status, or a
    note"*) already covers both the status and the note.

    **(b) Retention / deletion — unchanged.** The row rides `CanvassActivity`'s existing cascades
    (campaign delete, organization delete, Unknock). `enabledOutcomes` / `everEnabledOutcomes` are
    two arrays of outcome keys on the campaign and die with it; the new `Campaign.stats` counters
    (`notTargetKnockCount`, `contactKnockCount`) are derived from the ledger and recomputable.
    Nothing new to purge.

    **(c) Who can access — unchanged.** The switch governs RECORDING, not reading: turning it on or
    off is org-admin only (a lead's PATCH is refused 403 — a lead may be the paying client, and this
    is the org's trust decision), audited in the campaign History with the actor. Every read of the
    resulting rows rides existing role gates. One new column on an existing admin-only file:
    `outcome-entries.csv` (`routes/admin/campaigns.js:1106`, gate `loadForReclassify` — org admin
    only) appends **Offline** ("Offline" or blank) from `wasOfflineSubmission`; the same flag already
    ships as "Offline submission" in the wider-audience, lead-visible canvass-activity export
    (`services/export/exportBuilders.js:455`, `:572`, `:630`), so it is no new disclosure. The
    phone's settings delivery (`/mobile/changes` `doorConfig`) returns only the requesting user's own
    campaign settings and their own `canAddVoters`, the same values the bootstrap already sends them.

    **(d) Sharing / subprocessors — none. Not a DPA §6 event.** No new third party receives anything.

    **(e) What we expose — yes, one more door-status value, in five places.** (i) Published client
    reports and their PDF: a new **"Not a target voter"** row in the Voter contact breakdown, shown
    only when the count is above zero (old frozen reports, and campaigns that never used it, render
    exactly as before; `client/src/lib/reportDerive.js:149`, which the page and the PDF share). Every
    report frozen since this change also carries, in its public payload, an aggregate
    `totals.notTargetKnocks` per window (the door-rounds with a Not a target voter entry; 0 on a
    campaign that never used it) that no page or PDF renders: `computeWindowStats` writes it
    (`services/reports/computeReport.js:188`; the breakdown's own `not_target` count, `:174`, is also
    0 when unused), and `shapeWindow` (`services/reports/clientReportView.js:8`) passes `totals`
    through whole (`:22`) to the report route (`routes/public/share.js:154`), as `shapeReportListRow`
    does into the list route's `headline` (`clientReportView.js:44-47`; `share.js:131`). A count,
    never a door, an address or a name. (ii) The unauthenticated share map:
    `ClientReportMapPoint.status` may now be `not_target`; `buildFrozenMapPoints`
    (`services/reports/computeReport.js:256`) writes the door's
    coordinates, street line, city and state, its status and the whitelisted answers — **never the
    note** (pinned by `test/reportSecurity.int.test.js`, "a Not a target voter door publishes its
    status — never the canvasser note beside it"); the share map offers a filter chip for it only on
    a report that has such a door. (iii) **Results by voter** prints "Not a target voter" in the
    *Address outcome* column beside each registered voter's name at that door — a fact about the
    door that is true of **none** of the people listed. The type's description says the Address
    columns describe the door, not the person, and, only on campaigns that use the outcome, that "Not
    a target voter" means the person who answered was not on the list (`resultsByVoterDesc`,
    `services/export/exportTypes.js:198`). It no longer adds that none of the listed voters was
    reached: Address outcome is the door's latest result across the rounds in scope, so a listed
    voter may have been reached earlier. (iv) Fanned activity rows (item 18): the voter-less row is
    repeated once per registered voter at the door. Its outcome (`not_target` in the Action column)
    is true of **none** of them by definition; its note is free text that may describe the unlisted
    person, possibly by name, or say something about a listed voter, and it rides every one of those
    rows. (v) The Notes export (item 17(a), lead-visible): a door note on this outcome prints with
    Outcome `not_target`, and with the opt-in "Include the voters registered at each door"
    (`includeDoorVoters`) the names of the registered voters at that door are on the same row — the
    same attached outcome, true of none of them, beside a note that may name the unlisted person or
    say something about a listed voter.

    **No published sentence becomes false.** `privacy.html:90` (activity "such as a survey response,
    a door status, or a note"), `:94` (location at action time; door results recorded offline are
    held on the device until delivered), `:101` (published reports present "door statuses … shown at
    the address level" and exclude voter names, canvasser identities and action timestamps — the note
    may contain a name, but no canvasser text reaches the frozen points or stats, pinned by
    `test/reportSecurity.int.test.js`, so the sentence stays true) and `:105` (an organization
    reporting on its own canvassing to its own clients, including by export) cover it as written.
    `:91` (the Add-a-person sentence about someone "not on the uploaded list") describes one channel,
    not the only one: a name a canvasser types into this outcome's optional note is a "note" under
    `:90`, so `:91` stays true. **Assessment: no Privacy Policy / ToS / DPA text edit is required.**
    Owner to confirm before the production deploy, as with items 17-24 — specifically the note ruling
    in (a), together with this reading of `:91`.

    *[v6 2026-10-03 anchor refresh: the scripted-surveys commit (5cb42b2, item 26) added imports above
    four of this item's anchors. `services/reports/computeReport.js:188` → `:189` (`notTargetKnocks`),
    `:174` → `:175` (the breakdown's `not_target` count), `:256` → `:260` (`buildFrozenMapPoints`), and
    `routes/admin/campaigns.js:1106` → `:1107` (`outcome-entries.csv`). Nothing they point at changed.]*

26. **[v6 2026-10-02 — Scripted surveys: read-aloud statements and closing blocks, "then go to"
    routing, canvasser-only notes, tappable web links and the `{{canvasser}}` placeholder.
    Customer-authored TEMPLATE content plus a user-initiated hand-off of a URL to the device browser
    — no new personal data, no new field about any person, no new recipient, no new subprocessor, no
    retention change, nothing new in exports, client reports or share links. Same class as items 15
    and 20; no policy edit. Said out loud here as the repo invariant requires.]** What shipped (built
    2026-10-02, uncommitted at time of writing): `SurveyTemplate` (`models/SurveyTemplate.js`, zod
    twin in `routes/admin/surveys.js`) gains a fourth block type, `statement` — read aloud, never
    answered — with a `role` (`statement` or `closing`) and an optional `title` (≤ 80 characters);
    any block can carry a canvasser `note` (≤ 2000, never read aloud) and up to five `links`
    (`{ label ≤ 120, url ≤ 2000 }`, `^https?://` only, so a `javascript:` or `data:` URL is a 400).
    "Then go to" routes (`goTo` on answers and blocks, `otherGoTo`) are compiled into the existing
    `visibleIf` at save (`services/surveys/routing.js`), and the template gains `flow` (`list` |
    `script`) and `presentation` (`scroll` | `steps`, one block per screen on the phone).
    `{{canvasser}}` in script text (the greeting, closings, statements, answer scripts, notes) reads
    as the signed-in canvasser's own first name on the phone (`bootstrap.user.firstName`, already on
    that phone), as the viewer's own first name in the web preview, and as a blank line on paper
    (`services/surveys/scriptText.js`, mirrored to the client and the phone). Docs:
    [PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) (§K walks the triggers; §O, "As
    built", records where the build differs from the plan), [SURVEYS.md](SURVEYS.md).
    *[v6 2026-10-03 status: committed in 5cb42b2; the server deployed 2026-10-03; the production OTA
    is pending the owner's device checks. The owner's confirmation this item asks for at its end
    (the lead-visible, lead-authorable note in (c)) was due before the production deploy and OTA. It
    was given on 2026-10-03, with the approval of
    [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md), after that day's server deploy,
    which went ahead without it on record.]*

    **(a) What we collect — nothing new about anyone.** `SurveyResponse` is unchanged. A statement or
    closing records nothing: the phone posts no row for one (`buildSubmitRows`,
    `mobile/lib/surveyRunner.js`), and `normalizeAndFilterAnswers`
    (`services/surveys/normalizeAnswers.js`) drops a statement row in both modes for every writer —
    the phone's survey POST, the admin response edit and desk conversion — the backstop for an older
    app bundle or an offline replay. Which closing a conversation reached is not recorded (plan ruling
    11). Statement text, titles, notes and links are customer-authored template content, the same
    class as the greeting, the closing and the answer scripts that already exist. They are written in
    the survey builder by the customer's org admins and team leads: only the survey routes
    (`routes/admin/surveys.js`, `requireOrgRole('admin', 'lead')`) write statement text, titles, notes
    or links. Two other writers touch template documents, and neither writes any of those fields: the
    org-admin tag-library routes (`routes/admin/tags.js`, `requireOrgRole('admin')`, through
    `services/surveys/tagOps.js`) rewrite answer tag names and the survey's tag palette only, and the
    super-admin demo rebuild (`routes/superAdmin/platform.js` → `services/platform/seedDemoOrg.js`)
    creates or resets Doorline's own demo survey in the demo org, whose blocks are plain questions.
    Nothing about a voter or a door flows into any of them. `{{canvasser}}` is filled on the device for
    display only and the filled text is never stored or sent: the only template text stored with a
    response, a question's wording and an answer's text, may not contain `{{` at all on a live
    question or answer (the save check skips a retired one, which never reaches a phone). One
    boundary, recorded so it is not crossed by accident: the Burton script's Close 3 asks "Do you know
    anyone else that would want to vote for Paul?" and stays read aloud only. Recording those names
    would be new personal data and a "what we collect" event.

    **(b) Retention / deletion — unchanged.** The new fields live on the template document and follow
    its existing lifecycle: archive, delete-when-unused, and the organization-deletion cascade
    (`services/platform/deleteOrganization.js` lists `SurveyTemplate`). No new collection, no index,
    no TTL, nothing to purge.

    **(c) Who can access — the existing readers of template text, and one point for the owner.** The
    new text reaches exactly who template text already reaches: every rostered canvasser's phone (the
    bootstrap ships whole lean templates, `routes/mobile/bootstrap.js`); org admins and team leads in
    the builder and the preview (a lead's library is scoped to surveys they authored or that are
    attached to a campaign they manage); org admins in the desk-entry payloads (answerable questions
    only, behind `loadForReclassify`; a question's note and links ride in that JSON unrendered, to a
    reader who can already open the builder); and paper (statements, closings, their titles and their
    links — a question's links ride in the packet payload but never print — and never a note:
    `toPrintableSurvey` in `services/packet/buildPacket.js` does not carry it; (e) lists what prints).
    The response editor's question snapshot (`services/voters/voterProfile.js`) keeps its field
    whitelist and answerable questions only, so a note never reaches it. **Notes are lead-visible and
    lead-authorable:** a team lead can write and read a canvasser note on a survey they authored or
    one attached to a campaign they manage, through the in-campaign builder and the campaign's Survey
    tab, and a lead may be the paying client. The Burton note is opposition research about the other
    candidate. This was put to the owner in the plan (§K).

    **[v6 2026-10-03 — recorded under (c), whose readers of template text are unchanged: by owner
    ruling, a team lead's survey list now says whether a survey on their campaigns has answers
    anywhere in the organization — a bare yes/no, never whose or how many. A "who can access
    customer data" change, said out loud here as the repo invariant requires: no new data, no new
    recipient, no subprocessor, no policy edit. Docs:
    [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md).]** This record never described a
    lead's row in `GET /admin/surveys` (`routes/admin/surveys.js`): the 2026-08-08 client-lead
    survey scoping, which the owner ruled strict, appears here only as (c)'s parenthesis on who reads
    template text. This is the first full account of it.

    **What a lead's row carries.** Whole template documents, and only for the surveys in their library:
    ones they authored (`createdBy`), or ones attached to a campaign they manage, as its main survey or
    a walk-list override, archived campaigns and walk lists included (`attachedSurveyTemplateIds`, the
    set form of `canManageSurvey`, `services/authz/campaignManagement.js`). On every row, usage
    (`usedByCampaigns`, `usedByWalkLists`) and counts (`responseCountByCampaign`, and `responseCount`,
    their sum) cover the lead's campaigns only, and the bucket of legacy responses with no campaign is
    dropped, so no other campaign's name and no other campaign's volume appears. Exactly two bare
    booleans cross that line, never names or counts. `usedElsewhere`, on every row in the library,
    authored ones included: the template is attached beyond their campaigns right now (current
    attachments only, archived campaigns and walk lists included). And `hasResponses`: for a template
    attached to a campaign they manage, **any response anywhere in the organization, legacy rows with
    no campaign included** (new); for a template in the library only because they wrote it, whether it
    has answers on their campaigns, as before. The ruling, verbatim: *"as long as its part of their
    campaigns, yes"* (owner, 2026-10-03), read as "attached to a campaign they manage, as its main
    survey or a walk-list override", an archived campaign or walk list of theirs included, as for the
    library itself; the owner confirmed that reading on 2026-10-03, as the proposal's Part 1 sets it
    out.

    **Why.** The builder locks a saved question's answer type, and the switch to Go to, from
    `hasResponses`, while the save refuses both (`409 survey-has-responses`) whenever
    `SurveyResponse.exists({ surveyTemplateId })` finds a response anywhere. Narrowed, the yes/no
    let a lead build changes that the save then refused, on a survey none of whose answers were
    counted in their campaigns (another campaign's, or legacy rows) — and, once no other campaign
    used it, with no Duplicate in reach
    ([PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) §O, "Known gap (2026-10-03)").

    **Already disclosed, except while the organization is read-only.** That 409 already gives the
    same lead the same yes/no for every survey in their library, authored ones too:
    `canManageSurvey` runs before the response check, and a refused save stores nothing. (For a
    survey in the library only because the lead wrote it, the list now says less than the save does,
    by the ruling.) The exception: while an organization is read-only (paused, trial ended,
    canceled), a lead's save is answered 402 before the survey router runs (`requireEntitlement`,
    `middleware/entitlement.js`, mounted ahead of it in `routes/index.js`), so there the list is the
    only place a lead sees it. The responses that can arrive meanwhile are few: phone submissions
    recorded before the pause (the gate's grace for them), a desk conversion an admin started before
    it and still running in the background (the conversion worker,
    `services/canvass/conversionProcessor.js`, checks no entitlement), and anything Doorline staff
    record under support access (super-admins are exempt from the gate).

    **Against item 24(d).** There, a voter outside the lead's campaign answers 404
    `VOTER_NOT_IN_CAMPAIGN` so that a client-lead cannot probe other campaigns' voter ids and learn
    that they exist. This goes the other way on purpose, and it does reveal what 24(d) would not:
    for a survey on the lead's campaigns whose answers their own campaigns don't account for, **that
    such answers exist** — another campaign's, or legacy rows with no campaign. It never names a
    campaign, a voter, a count or a time (read again and again, it could date the first such answer,
    as retrying a save already could), and it covers only surveys on the lead's own campaigns, which
    a lead can't pick at will: they can attach only a survey already in their library. Any
    organization-wide edit guard reveals the same bit by accepting or refusing a save (the 409
    above). 24(d) protects something different: whether an identified person is in another client's
    campaign, which could be tested for any id. The alternative that reveals nothing, narrowing the
    409 to the lead's campaigns, was rejected: a lead could then retype a question or redraw the
    branching under answers other campaigns collected, which breaks how those answers add up and
    changes what later visits record.

    **Copies.** *Save my changes as a copy*, new in the same change, saves through the existing
    `POST /admin/surveys`, which stamps the caller as `createdBy` exactly as Duplicate
    (`POST /admin/surveys/:surveyId/duplicate`) does. A lead who saves one becomes its author; the
    copy carries the form's notes and links, as a Duplicate carries the original's; and it stays in
    that lead's library through `createdBy` for as long as they are a lead in the organization,
    whatever happens to their campaign grants. Nothing here is new beyond Duplicate and *New
    survey*, both already open to leads; it is recorded because this change steers leads toward
    copies.

    **Assessment: no Privacy Policy / ToS / DPA text edit is required; not a DPA §6 event.** No new
    data category, field, recipient, export, report, share link, retention or deletion change.
    `privacy.html:105` (information is available "to authorized users of the customer organization
    you belong to, according to their role", and customer data is not visible to other customer
    organizations: the sentence item 22's lead-visibility assessment rests on) and the closing
    sentence of `:91` ("Access is limited to that customer's authorized users") both stay true: a
    lead, client or not, is an authorized user of that organization holding that role, and the
    yes/no is computed from that organization's responses only (the list's aggregate matches on
    `organizationId`), so nothing crosses tenants (`DPA.md` §4, tenant isolation). `:90` (canvassing
    activity, "such as a survey response", which "authorized administrators within the same
    organization may review") stays true as well: a lead is a scoped administrator of that
    organization (`services/authz/campaignManagement.js`), and a bare yes/no is less than reviewing
    the activity. A lead may be the paying client (lead-visible = client-visible, the standing
    ruling items 22 and 24 record), which is why this is recorded rather than assumed. **Owner
    confirmed 2026-10-03, before the production deploy, this stamp on its own:** it is not the
    confirmation item 26 asks for at its end, and that one does not cover it.

    **(d) Sharing / subprocessors — none. Not a DPA §6 event.** A link is a USER-INITIATED hand-off,
    the class items 15 and 20 recorded, on the two conditions those items set, both met in code. (i)
    It opens only on an explicit tap, in the device browser: the phone
    (`mobile/components/SurveyNoteAndLinks.jsx`) calls `Linking.openURL` with the URL exactly as the
    author saved it, and drops anything that is not http(s) rather than hand it to the OS; the web
    preview renders an http(s) link as an anchor that opens a new tab only on a click, with
    `rel="noopener noreferrer"`, so no Referer is sent; paper prints the address as text. (ii) Nothing
    about the voter, the door or the canvasser is appended; nothing fetches, prefetches, previews,
    embeds (no WebView) or proxies a link; and no tap is logged or sent to Doorline. The linked site
    sees what any visitor's browser sends, exactly as if the canvasser had typed the address in.
    Doorline engages nobody "to provide the Service" (`DPA.md` §6's test) and has no contract, API key
    or SDK with any linked site. One difference from items 15 and 20 is recorded deliberately, and it
    is narrower: there the URL carried a voter's street address; here the customer's author chose the
    URL and it carries nothing from Doorline's records, so a tap discloses nothing about anyone, and
    with no user data in the URL the Google Play Data-safety "sharing" question item 20 weighed does
    not arise. No QR code is drawn on the phone (owner ruling: the QR is on the printed literature),
    so no QR library or QR-image service is involved. **No customer notice; no `privacy.html` / ToS /
    DPA edit.**

    **(e) What we expose — nothing new reaches exports, client reports or share links.** Exports:
    `templateAnswerPlan` (`services/export/surveyColumns.js`) builds columns over answerable questions
    only, so a statement is never a column, and no export builder reads a block's note, links, title
    or routes. Client reports: `computeSurveyBreakdowns` (`services/reports/computeReport.js`) is
    choice-only and emits a question's key, wording, type and option counts, and `publicPointAnswer`
    returns nothing for a statement, so neither a published report nor a share-map point can carry
    statement text, a note or a link; the public share route (`routes/public/share.js`) never reads a
    template, only those frozen payloads. Pinned since 2026-10-03 by
    `server/test/surveyBlocks.int.test.js` ("a client report and its public map carry no statement,
    even from a stray stored row"): with a stray stored row under a statement's key,
    `computeSurveyBreakdowns` still gives breakdowns for the choice questions only, with no statement
    text anywhere in its output, `computeWindowStats` (the report builder's window) gives breakdowns
    for the same questions, and `publicPointAnswer` returns null for every statement. In-app results:
    `/survey-results` (`routes/admin/reports.js`) skips statements, so no results card, tag rollup or
    phone admin screen shows one. Paper is the one surface that prints the new text, and never a note.
    On the walk packet's "What to say" page, once, beside the greeting, closing and answer scripts it
    already printed: each statement's and closing's read-aloud text, its title, and its links' labels
    and addresses (a question's links don't print). And in a Go to survey every arrow — with the
    answers at each door, and after a statement or closing on the "What to say" page — names a
    statement or closing it leads to by its title, or an untitled one by a quoted excerpt of the first
    sixty or so characters of its read-aloud text.

    **No published sentence becomes false.** `privacy.html:90` (canvassing activity "such as a survey
    response, a door status, or a note" — a scripted survey records answers to its questions exactly
    as before), `:98` (no advertising cookies or third-party advertising trackers — Doorline adds
    nothing to a link and loads nothing from it), `:101` (a published report shows only the predefined
    answer choices of selected survey questions — a statement is not a question and cannot be
    selected) and `:106` (the service-providers paragraph — nobody new) all stay true. The template
    text itself reads as Customer Data under `terms.html:91` and `DPA.md` §1 (data the customer
    uploads to or generates in the Service). **Assessment: no Privacy Policy / ToS / DPA text edit is
    required.** **Reopen this item** if a link ever gains anything per-voter, per-door or
    per-canvasser (a token, an id, a tracking parameter Doorline adds), if taps are logged or counted,
    if links are fetched, prefetched, previewed or unfurled (on the device or server-side) or opened
    in an embedded WebView, if a QR is drawn by an external service, if statement or note text starts
    reaching an export, a client report or a share link, or if a statement starts recording what the
    voter says (Close 3's referral names are the likely first ask). Owner to confirm before the
    production deploy and OTA, as with items 17-25 — specifically the lead-visible, lead-authorable
    note in (c).

27. **[v6 2026-10-05 — GPS upgrades, step W1 (server and web): the web admin map draws each recorded
    stamp's accuracy as a faint circle; the map's flag and location panels label "far" from the audit's
    own verdict, which the map's pings now carry; flag entries say when the house pin is approximate;
    the server stores an unusable accuracy as unknown and refuses a non-finite coordinate; and a
    read-only operator count of stored stamps. Display and validation only. Plan:
    [PROPOSAL_GPS_UPGRADES.md](PROPOSAL_GPS_UPGRADES.md) §H, §I and §L.]** Said out loud, as the repo
    invariant requires: this touches *who can access customer data* (two admin routes return fields
    they did not before) and *what we collect* (the server now stores less). Nothing new is collected
    about anyone, nothing is kept longer, there is no new recipient or subprocessor, and no new export,
    report or share link.

    **(a) The same data to the same roles.** `GET /admin/households/map` and `GET /admin/reports/flags`
    keep their gates: org admins, team leads for the campaigns they manage (a lead may be the paying
    client), and super-admins under the existing grant rules.
    - The circles draw `location.accuracy`, which both payloads already carried to those roles. They are
      built in the browser (`client/src/lib/accuracyRing.js`) and drawn as a local map layer; Mapbox's
      servers receive only the tile requests they already did.
    - Each ping's new `far` field is the verdict `/admin/reports/flags` already shows those roles for
      the same entry, cut down by the whitelist `farVerdictForWire` (`services/audit/farKpi.js`): the
      distance, the distance left after the accuracy allowance, the accuracy, and the downgrade markers
      with the corrected-pin distance and date. Never the `replaced` snapshot, and never `correctedBy`
      (a raw staff User id no client has received): only the derived boolean `pinMovedBySelf`.
    - Each flag entry's `household` gains `coordConfidence` and `locationConfirmedAt`, which the same
      roles already receive on every `GET /admin/households/map` household row. Never `correctedBy` or
      `locationConfirmedBy` (`services/audit/flagDetection.js`; `locationGate.int.test.js` pins the
      exact key list).
    - The far labels, the "after allowing for GPS accuracy" lines and the pin line are computed in the
      browser from those fields (`client/src/lib/flags.js`). No count, report figure or filter reads them.

    **(b) The server stores less, never more.** `routes/mobile/canvass.js` stores an accuracy only when it
    is a finite number above zero; a zero, negative or non-finite one is stored as `null` (unknown), on
    `CanvassActivity` and `SurveyResponse`, in every `replaced` snapshot it writes, and on the pin
    route's `HouseholdLocationChange` row. A knock, survey or add-person request whose coordinate is not
    a finite number is refused with `400 LOCATION_REQUIRED` before any write (bug F-26: such a request
    used to delete the canvasser's earlier entry for that door). Finite coordinates off the Earth are
    still accepted; refusing them waits for the count in (c) (W1-offEarth), because a refused offline
    replay is a knock the phone silently drops. Stored rows are not rewritten. The far rule now reads a
    stored negative accuracy as no allowance instead of extra distance, so some legacy flags drop or
    clear. Flags are computed live; a review stores only its decision and the reasons it saw
    (`FlagReview`), as before.

    **(c) A read-only operator count.** `npm run audit:gps-stamps` (`migrations/auditGpsStamps.js`),
    run by the owner from the Heroku dashboard's Run console, counts odd stamps per ledger and what the
    far clamp changes. It prints counts only, never a coordinate, name or id (pinned by
    `auditGpsStamps.int.test.js`), writes nothing, and reaches no one who cannot already read the
    database.

    **No published sentence becomes false.** `privacy.html:94` ("we collect the device's location and
    reported accuracy at that moment"; "only at the time an action is recorded"; the live position is
    not transmitted) stays true: the knock still sends what it sent, and an unusable accuracy is now
    kept as unknown, which is less. `:106` (service providers) gains nobody. `:128` (recorded locations
    stay part of the organization's records) is unchanged. **Assessment: no Privacy Policy / ToS / DPA
    text edit is required.** The phone's labels, circles and pin line come with later steps (M1 or M2,
    and M2 for the phone circles); each adds its lines here. **Reopen this item** if a circle, verdict
    or pin line ever reaches a client report, an export or a share link, if `correctedBy` or
    `locationConfirmedBy` ever joins a payload, or if stored rows are ever rewritten by a backfill.
    Owner to confirm before the production deploy, as with items 17-26.

    *[v6 2026-10-05, evening — W1 deployed (commit add84ba) and the count in (c) run in production for
    the first time: no odd stamp on any ledger. 0 of 86,672 door results, 0 of 16,251 survey responses,
    0 of 51 replaced survey answers, 0 of 396 unknocked entries held for a revert and 0 of 5 GPS pin
    fixes carry a zero, negative or non-finite accuracy, a non-finite or off-Earth coordinate, or
    (0, 0); the clamp changes 0 door results. So the off-Earth refusal held back in (b) ships now
    (W1-offEarth): a knock, survey or add-person stamp whose latitude is outside ±90 or longitude outside
    ±180 gets `400 LOCATION_REQUIRED` before any write (`isValidLatLng`, `utils/stateBounds.js`, the
    predicate the pin-move service already used). Stores less, never more; no published sentence
    changes; the count above is why it can't silently drop a real phone's queued knock. This line also
    needs the owner's confirmation before its production deploy.]*

28. **[v6 2026-10-05 — Homes that share a map spot are looked up by their own address at import
    (placeholder pins, release 1). Plan: [PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md](PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md);
    the full reference, [PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md) §O.]** Said out
    loud, as the repo invariant requires: this changes *when* customer data goes to an existing
    subprocessor. Not a new subprocessor, not a new data category, not a new export, report or link:
    **no DPA §6 notice.**
    **(a) Sharing.** Addresses that arrived *with* coordinates now go to Geocodio when the file put
    them on a map spot shared with other addresses, or on a building's spot with a different address:
    automatically at import, for that file's own homes only, when `GEOCODE_ENABLED === 'true'` and a
    key is set; at most `PIN_PLACEMENT_MAX_HOMES` (25,000) per import. Fields: line 1 as the file gave
    it (any unit written there included), city, state, ZIP5 — never line 2, never a name. Recorded on
    "GEOCODIO — the loud one" (v6 2026-10-05 stamp).
    **(b) Retention.** `GeocodeCache` holds those addresses too, under the unchanged 540-day disuse TTL;
    the pass stops buying on any of three deletion signals. Recorded on EXCEPTION 1 (v6 2026-10-05).
    **(c) Who can see what.** The pass's lookup counters, ledger and cause are hidden from organizations
    (`ORG_HIDDEN_IMPORT_FIELDS`); one failure-time residual is recorded on EXCEPTION 2 (v6 2026-10-05),
    with an assessment for the owner to confirm. Organizations see only the outcome counts (`pinsPlacedExact`,
    `pinsConfirmedInPlace`, `pinsStillUnplaced`) and a generic sentence when the pass was busy or failed.
    **(d) New household fields.** `pinSuspect` (`'placeholder' | 'stray'`, a data-quality mark on the pin),
    `pinPlacement { from, to, at, kind, by, accuracyType, stackSize, releasedAt }` and `pinDistrustedKeys`:
    the coordinates the household already had, the lookup's answer, and spots refused for it — no new
    personal data. Deleted with the household (campaign and org deletion cascades; an import's undo deletes
    the doors it inserted). No route returns `pinPlacement` or `pinDistrustedKeys`; `pinSuspect` reaches the
    same `canManageCampaign` roles through the Pin Fixes list and the pin-move responses. Also new:
    `Campaign.pinPass` (a lease: a random owner token and a heartbeat, no personal data) and the ImportJob
    counters above.
    **(e) Who vouched.** Pin Fixes' confirm now also covers homes with no exact map spot (item 15 stamp).
    **(f) What reports and exports show.** A report published after a home was placed shows it at its own
    spot, and exports' Latitude/Longitude carry the placed pin — more accurate, not a new exposure (D11
    stamp).
    **No published sentence becomes false:** `privacy.html:106` ("we send only the street address — never
    anyone's name") says nothing about only addresses missing coordinates; `:122`'s 18-month disuse expiry
    is unchanged; `:85` and `terms.html:91` (processing only to provide the service) stay true.
    **Assessment: no Privacy Policy / ToS / DPA text edit is required.** **Reopen this item** if lookups
    ever run for homes outside the file being imported, send line 2 or a name, or if `pinPlacement`
    joins a payload, export or report. Owner to confirm before the production deploy, as with items 17-27.
    *(v6 2026-10-05, release 2 — the maps and phones show it. Said out loud: this touches **who sees
    what**. Canvassers' phones now receive `pinSuspect` on the doors in their books (bootstrap and every
    `/mobile/changes` door, effective only — never on a vouched home): a data-quality mark about a pin they
    already hold, with the address they already see. `/admin/households/map` and the Turf drill add
    `pinPlaced { at, inPlace, stackSize }` (the date the lookup placed the home, whether it was already on its
    spot, how many other homes shared the old spot) and `/turfs/doors` adds `pinSuspect`, to the same admin
    and lead roles that see those pins today; `/admin/households/:id/activity` adds `sameAddress { count,
    unplaced }`, a count of the door's own address's units. Still no route returns `pinPlacement` or
    `pinDistrustedKeys`. No new collection, recipient, export, report or link; no published sentence
    changes. Plan: [PROPOSAL_PLACEHOLDER_PINS_RELEASE2.md](PROPOSAL_PLACEHOLDER_PINS_RELEASE2.md).)*
    *[v6 2026-10-10 — Pin Fixes at scale ([PROPOSAL_PIN_FIXES_AT_SCALE.md](PROPOSAL_PIN_FIXES_AT_SCALE.md),
    build plan S12). Said out loud: this changes **when** addresses go to Geocodio and **what the import
    keeps**. Not a new subprocessor, not a new data category, not a new export, report or link: **no DPA §6
    notice**, and no published sentence changes (`privacy.html:106`, "we send only the street address —
    never anyone's name", stays true).
    **(a) Sharing — new lookup triggers, same fields** (line 1, city, state, ZIP5; never line 2, never a
    name; through the same `geocodeService.resolve()` and its cache): at import, a file coordinate refused as
    0,0 or outside its state (now looked up like a missing one), and that file's homes pinned **far from their
    street** (homes that HAVE coordinates, believed wrong); in Pin Fixes, **Look up by address** — an
    `ImportJob` of kind `pin_lookup`, started by a lead or admin (`canManageCampaign`), whose targets are
    flagged homes of that one campaign, earlier imports' included (capped at `PIN_FIX_LIST_CAP`, default
    10,000 per job; gated on `GEOCODE_ENABLED` plus a key); and the operator script `npm run
    pins:measure-estimates` (a seeded sample, at most 5,000, of one campaign's ordinary vendor pins — homes
    whose coordinates are believed right — to measure Geocodio's estimates). Recorded on "GEOCODIO — the
    loud one" (v6 2026-10-10 stamp).
    **(b) Retention — unchanged.** `GeocodeCache` holds these addresses under the same 540-day disuse TTL;
    the pass behind the lookup job stops buying on the same three deletion signals (EXCEPTION 1, v6
    2026-10-10 stamp). A `pin_lookup` ImportJob is deleted with its campaign and organization like every
    ImportJob.
    **(c) What the import keeps — more of the customer's own upload.** A home whose address the lookup can't
    place, with its voters, is now **kept** at a holding spot in its ZIP instead of dropped (only a home no
    spot can be derived for is still dropped). These are records the customer uploaded for the campaign,
    stored like every other door and deleted with it; no published sentence promised the drop.
    **(d) Who can see what.** `pinLookupTargets` (the job's target ids, a ledger like `pinProbedIds`) is
    hidden from organizations (`ORG_HIDDEN_IMPORT_FIELDS`); organizations see the outcome counts, now also
    `pinsPlacedApprox`, `pinsComplex`, `pinsUnlocated`, `pinsFarMarked`, and the preview counts
    `offWorldDoors`, `outsideStateDoors`, `farPinDoors`, `unlocatableDoors`. `GET /admin/imports` leaves
    lookup jobs out unless asked (`includeLookups=1`). The Pin Fixes payload adds condo complexes and
    set-aside homes — the same households, to the same `canManageCampaign` roles.
    **(e) New fields — no new personal data.** `Household.pinSuspect` gains `'far' | 'unlocated' |
    'complex'` (data-quality marks on the pin); `pinComplexKey` (a ~1.1 m key of the coordinates the
    household already has); `pinSetAside { at, by }` (`by` is a staff user id, like `correctedBy`; the
    payload sends only a boolean, so the id never leaves the server); `pinPlacement.answer` (the answer
    class); `coordSource: 'holding'` — the holding spot, a Doorline-derived point (the middle of other homes'
    coordinates in the ZIP, nudged off any door), deliberately **not** the home and labelled so on every
    surface; `CanvassActivity.knockPin` (`'estimated' | 'complex'`, a property of the pin at knock time,
    read only by the GPS audit's downgrade); `HouseholdLocationChange.scope: 'spot'`. Deleted with the
    household, campaign and organization exactly as before.]*

---

29. **[v6 2026-10-10 — Sessions are extended while used, and Sign out ends the session on the server.]**
    Built from [PROPOSAL_SESSION_EXPIRY.md](PROPOSAL_SESSION_EXPIRY.md) after three review rounds; the
    contract is in [USERS.md](USERS.md) → *Sessions*. What changed: a sign-in used at least once every
    30 days is extended (`GET /auth/me`) up to **90 days from the typed password** (`auth_ms`, carried
    through every extension); super-admin sign-ins are not extended (30 days, as before); someone with
    no memberships left stops being extended. **Sign out now ends that session server-side** when the
    request reaches the server (`POST /auth/logout` pushes its `sid` onto the new `User.endedSessionIds`,
    and `requireAuth` refuses every copy of that token); tokens minted before `sid` existed use one id
    derived from their signature, so their copies end together too. Revocation on a self-set password
    change now compares in **milliseconds**. Bull Board accepts only its own cookie ticket (HOLE 4
    stamp). Every ended session answers `401 SESSION_REVOKED` with a `reason`; server faults are 503.
    **Remaining gaps, stated honestly:** (a) a sign-out made with no signal never reaches the server,
    and one the server fails to record answers 503; either way that session runs out on its own; (b) an
    ended session could only come back after **200 later sign-outs by the same account** within its
    90-day cap (the kept list); (c) app versions that never receive the update now sign out on every
    run-out (the coded 401 reaches their July 2026 sign-out handler; before this change an expired
    session dead-ended on "Invalid token" and kept its copy), and on that old path a door save landing
    after the clear can write the walk list back — so for old apps that race behind "deleted when you
    sign out" now opens on every expiry (updated apps close it with the roster write guard); (d) the
    password-in-place screen keeps the walk-list copy on the phone with no time limit, as any expired
    session always did; (e) a device whose password screen came up, or was last used (a sign-in attempt,
    "Forgot password?", Later, Go back, the notice), less than 30 minutes before it next hears from the
    server after a password change — the person's own "Forgot password?" from it — asks for the new
    password in place and keeps its walk-list copy — but only until it has gone half an hour without
    being used since it switched to asking for the new password (`keepReauthInPlace`, from the latest of
    `raisedAt`, `activeAt` and `changeHeardAt`): the next answer after that signs it out and deletes the
    copy; so "change your password" deletes a lost phone's copy the next time it connects, or, if its
    password screen came up or was used in that half hour, at the first answer it hears after half an
    hour untouched; until it connects, an offline phone keeps working on its copy, and a phone on a door
    screen holds the sign-out until it leaves the door flow. **New data:** `User.endedSessionIds` —
    random session ids (or, for a token minted before `sid` existed, one derived from its signature)
    from the account's last 200 sign-outs; `select: false`, read only by `requireAuth`; survives
    organization deletion; cleared by account deletion; never sent to a client; covered by
    privacy.html's technical-information paragraph. **Assessment: privacy-affecting** (how long a
    signed-in device keeps access; what signing out does) — NOT a new category of voter data, no
    subprocessor, no new disclosure or export; **no published sentence becomes false** (no published
    text states a session length; "disable access promptly" stays true because membership is checked on
    every request). **DPA §4** ("shall not materially decrease the overall protection of Personal
    Information") is the owner's judgment: the build ships the plan's recommended package (90-day cap,
    staff not extended, server-side sign-out, the Bull Board tightening). **Owner to confirm (plan
    §F):** privacy.html:94 says results recorded offline are saved on the device "until a connection is
    available". After **Later**, results — including ones recorded with signal — wait on the phone until
    the password is entered. That is true in substance (an expired session always held them), but the
    sentence no longer says when they leave; candidate wording: "…are saved on your device until they
    can be delivered to our servers, and each is removed once it has been delivered." The public app
    page (`client/public/app.html`) gained an "Asked to sign in again?" section whose claims (the prompt
    is routine; Later keeps work saved on the phone until the password is entered; sign back in as
    yourself; after a password change a lost phone can't be used without the new password once it next
    connects) are true as built. The page doesn't state the limits recorded in (e): an offline phone
    keeps working on its saved houses until it connects, and one open on a door holds the sign-out until
    it leaves the door. **Closed in passing (review round 4):** signing in on the web now clears every
    cached page first, so on a shared computer a previous person's data can no longer show under the
    next person who signs in on the same tab — before, a sign-out followed by someone else's sign-in
    there showed the first person's cached pages until the new person's own fetches replaced them, and
    could keep showing them where those fetches were refused (most console query keys name neither the
    person nor the org); and a tab that holds no person (it forgot its person because someone else
    signed in elsewhere, or never had one) no longer ends that other person's session when it signs out
    (review round 5 added the second case).

30. **[v6 2026-10-15 — Error recovery, Part A (phone, JavaScript only) and its server switch. No SDK, no
    new recipient; the "no crash-reporting" negative stands.]** Built from
    [PROPOSAL_ERROR_RECOVERY.md](PROPOSAL_ERROR_RECOVERY.md) (§H is the analysis). Three platform paths
    already carried error data off the phone before this change, and are recorded here for the first
    time: (a) on iOS a fatal JavaScript error ends in `RCTFatal`, whose exception name includes the
    error's message — received by Apple from phones whose owners share analytics; (b) inside
    expo-updates' error window (launch until 10 s after the first screen; on iOS again after every
    reload), up to 1,024 characters of a fatal error — on iOS including the message — go to Expo in the
    `Expo-Fatal-Error` header of the next update check, and every update check sends a per-install
    `EAS-Client-ID`; (c) an Android crash reaches Google Play's vitals from phones that share
    diagnostics (a gray screen produced no report at all). **What Part A changes:** a fatal JavaScript
    error after launch now stays on the phone — shown in the app until dismissed, until sign-out (the
    copy is cleared then, so the next person to sign in never sees it) or until a restart, and written
    to the device log as before — so (a) and (b) now occur only for launch-time errors, native-wrapped
    errors, errors with no screen to draw on, and while the switch below is off. The next sign-in after a
    sign-out clears it too, so an error that lands on the sign-in screen doesn't carry over to the next
    person. **New data:** an
    in-memory copy of the error (name, message, stack, time) — never persisted, never sent. Its text is
    whatever the failing code put in its message; it is shown only on that phone. The details sheet asks
    the person to screenshot it and send it to their team lead or admin (Doorline support, for a team
    lead or admin) — a share the person makes through their own channels, like any screenshot; nothing
    is sent automatically. **The switch:** `MOBILE_ERROR_RECOVERY` (a server config var; `off` = the old
    behavior) rides the existing public `GET /api/build-status` answer as `errorRecovery`; the phone
    remembers only the word `off` (AsyncStorage key `canvass.errorRecovery`) — no personal data. That
    check now also repeats when the app comes back to the screen, at most once every 15 minutes: the
    same platform and build version, to Doorline's own server, already covered by `:97`. **Timing of a
    deliberate sign-out (stated honestly):** while a crash screen is up, the queue that runs a deliberate
    sign-out (a password changed elsewhere, a deleted account) is unmounted, so the sign-out — and the
    deletion of the saved houses it does — waits until the person taps Restart (which runs it first) or
    Reset, or reopens the app (the stored, ended token brings it back on the first answer). This was
    already true of the old crash screen for a screen that failed to draw; the loop takeover is a new way
    in. While an asked-for restart waits to happen, the sign-out waits for the reload too, so a reload
    can't cut it between forgetting the token and deleting the houses.
    **Assessment: not privacy-affecting** under CLAUDE.md's list — nothing new is collected off the
    phone, no recipient, nothing kept on the server, no export; it reduces two flows that exist today.
    The Expo and Apple/Google sentence in `client/public/privacy.html` (`:106`), its technical-information
    paragraph (`:97`) and DPA §6 stay
    true; no customer notice. **Part B is not built:** the Android host-failure handler, which would turn
    a native host failure into a crash that Google Play receives (exception classes and stack frames,
    never a message), is deferred to the app-store build after Election Day; its half of this entry, and
    the owner's check of Play's Data safety answers, come with it. Optional at the next policy revision:
    "…and, on phones whose owners allow it, send us crash reports."
31. **[v6 2026-10-19 — Correction safety: two RETENTION changes (desk-entered answers are kept when a
    canvasser re-surveys; an archive copy is never silently dropped) and Restore NARROWED. No new
    recipient, no new export.]** Six fixes found while planning survey answer edits
    ([PROPOSAL_SURVEY_ANSWER_EDITS.md](PROPOSAL_SURVEY_ANSWER_EDITS.md) §P: F1, F2, F4, F5, F7, F9),
    shipped ahead of that feature; pinned by
    [correctionSafety.int.test.js](../server/test/correctionSafety.int.test.js).
    **(F2) More is kept.** When a canvasser re-surveys a voter whose current answers an admin entered at
    the desk (Door Outcomes, item 12's admin-entered category), the desk answers are now archived in
    `SurveyResponseArchive` (`via: 'submit'`), exactly like a teammate's, instead of being overwritten
    with no copy. Before this, the desk stamp also stayed on the canvasser's field answers — the profile
    labelled them "Entered by ‹admin›" — and undoing that desk entry deleted them outright. Same data
    category and the same audience as every `submit` row: org admins, and the campaign's leads (who can be
    clients) on the campaign Voters profile, Duplicate Surveys and the response detail it opens (the web
    drawer, the phone's response screen — `GET /admin/reports/responses/:id`, which serves an archived
    copy by its id) — privacy.html `:105` ("according to their role") covers them; `:90` names
    administrators only. Restore and Erase stay org-admin. Kept like every `submit` row: until restored or
    erased; until a round's clear-knocks re-cut moves the round's copies into that round's `TurfSnapshot`
    (put back by Restore snapshot, or removed with the snapshot); until the door-added voter they belong to
    is deleted; or until the campaign or organization is deleted — no timer *[corrected 2026-10-19, code
    review round 1: this read "same org-admin audience" and "self-consuming"; round 2 added the response
    detail and the two other ways out]*.
    `SurveyResponse.syncedAt` now follows every receipt (when the server
    received the submission — a timestamp of a kind already held).
    **(F9) Nothing silently lost.** The archive helpers (`services/surveys/archiveOverwrite.js`) now write
    raw verbatim copies. Through Mongoose, `insertMany(…, { ordered: false })` skipped a copy the current
    schema refused, without throwing, and the caller (unknock; Surveyed → Not home) then deleted the
    original — survey answers destroyed with no record and no error. Such a row is now kept, and every
    way back (profile restore, the unknock undo, the conversion undo) puts it back unvalidated. Same data,
    kept where the record already said it was kept.
    **(F5, F1) Access narrowed, not widened.** Restore now refuses answers whose visit no longer reads
    Surveyed (`services/surveys/restoreGuard.js`): an unknocked or converted visit's answers can no
    longer be put back as a counted survey, or swapped over a real later survey, from the profile. *[2026-10-19, code review round 1: as first shipped this sentence was false — only the
    removal's OWN copy took that rule; every other copy of a struck visit's answers (an answer edit's earlier
    version, a teammate's overwrite copy) took the plain rule, which the canvasser's next survey at that
    door satisfied. Round 1's fix (a stamp on the copies) missed strikes made before it and outlived an
    undo; round 2 replaced it. As built: a strike is read from the removal RUN's own record of the visits
    it struck — `UnknockRunChunk.visitKeys`, and for a Surveyed → door-outcome conversion the new
    `ConversionStrike` rows (run, tenant, visit keys, entry ids, two times — pseudonymous bookkeeping: a
    visit key is door, round and canvasser ids, the canvasser's user id as every ledger row carries; no
    answers, no names) — and holds every kept
    copy of the visit's answers made before the strike finished, whatever its kind, while the run stands.
    An undo lifts it wherever it put the visit back, and — once it has finished — where an older entry was
    put back at the visit since, by another undo or a snapshot restore: its own entry stays off there, and
    its answers stay earlier answers the profile's Restore offers (code review round 8). It records where
    newer work held the visit (`notRestoredKeys`).
    Conversions made before `ConversionStrike` existed are read from what they left (their own copy at the
    visit, the converted entry), and `npm run migrate:removal-strikes -- --apply` records them durably
    once after the deploy, visit by visit (it also records, for an unknock undone before
    `notRestoredKeys`, the visits that undo could not put back). **Residual:** an older conversion whose converted entry was since re-recorded by
    the canvasser AND whose own copy is gone before that command runs has nothing left that says it struck
    the visit; such a copy follows the plain rule. Pinned in `answerEditRound2.int.test.js`,
    `answerEditRound3.int.test.js` and `correctionSafety.int.test.js`. Round 3: a strike still held after
    its removal was undone refuses with its own reason (`kept_after_undo` — the earlier words told the
    admin to undo a removal already undone); both undos put an answer back only where its visit's entry
    came back, and read the visits they couldn't put back from what is on file; an unknock that crashed
    after it began removing is held like a completed one and can be undone. Round 4: ...once it has
    STOPPED. The strike beats a heartbeat between every step; a pending run that beat within ten minutes
    reads Removing… with no Undo, and an Undo of it is refused — round 3 let an Undo land while a large
    unknock was still removing (it ran for minutes), and the strike then finished over the undo: struck
    answers live again, or the removal never undoable and a Restore swapping struck answers over the
    canvasser's real later survey (reproduced). Also: a copy two removals hold stays held while EITHER
    does (round 3 judged only the latest, and a later conversion's undo that stopped after flipping its
    entry back freed an earlier unknock's struck answers — reproduced); a strike that stopped part-way
    holds the copies made while it removed (its window ends at its last beat, not at its freeze); and a
    conversion undo puts answers back only under an entry still its own — never one a later conversion
    converted since (reproduced: a counted survey under a door reading Not home).]* And
    answers an admin removed (`outcome_convert`, `unknock`) no longer appear on Duplicate Surveys — a
    lead-readable report — or as "Replaced X's earlier answers": fewer rows in front of leads, not more.
    **(F4, F7)** An offline replay with the same timestamp as a delivered submission no longer re-applies
    its answers over an admin's edit; a stopped undo of a conversion has its own status. No data change.
    **§B6 correction (stale since item 14):** "only `overwrittenVia: 'outcome_convert'` accumulates" —
    `unknock` rows accumulate the same way — kept until restored or erased, or the campaign or organization
    is deleted; an unknock's undo removes the copies it puts back and keeps the rest (a slot a newer survey
    holds, or — since round 3 — a visit whose entry didn't come back). Two more ways any archive row leaves: a clear-knocks re-cut moves its round's rows into that
    round's `TurfSnapshot` (`routes/admin/turfs.js`), and deleting a voter a canvasser added at the door
    removes that voter's rows with it (`routes/admin/voters.js`). F2's copies are `submit` rows: consumed
    only if someone restores them, otherwise kept with no timer like the rest *[corrected 2026-10-19, code
    review round 1: this read "until that unknock is undone" and "stay self-consuming"; round 3 added the
    re-cut and the door-added voter]*.
    **Assessment: privacy-affecting (retention) under CLAUDE.md, and no published sentence becomes
    false.** privacy.html `:90` (canvassing activity reviewed by authorized administrators), `:118`
    (retained while the account is active) and `:122` (deletion covers canvassing records) already cover
    a kept copy of an answer we held; no sentence promises that an overwritten or desk-entered answer is
    discarded. Both cascades already reach `SurveyResponseArchive` (§B5). No new subprocessor, no new
    external flow, no new export (the archive is structurally never exported), DPA §6 untouched, no
    customer notice. The planned survey answer edits feature takes **item 32** (reserved as 31 in its
    proposal before these fixes were cut out to ship first; the owner's 2026-10-19 sign-off is on that
    item's content).
32. **[v6 2026-10-19 — Edit survey answers: RETENTION grows (every admin edit now keeps the earlier
    answers), a BATCH REWRITE of field-collected answers, and Erase on screen. No new recipient, no new
    export destination, no subprocessor.]** Built per
    [PROPOSAL_SURVEY_ANSWER_EDITS.md](PROPOSAL_SURVEY_ANSWER_EDITS.md) §Q; pinned by
    [answerEdit.int.test.js](../server/test/answerEdit.int.test.js). An org admin can now change, take
    out or clear individual answers on surveys that STAY surveyed: one voter at a time on the profile,
    or many at once from Door Outcomes → **Edit answers…** (`/admin/campaigns/:id/answer-edits`, org
    admins only, up to 50,000 surveys a run, undoable as one change).
    **Retention — the material change.** Until now the profile's Edit
    (`PATCH /admin/voters/:voterId/surveys/:responseId`) destroyed the earlier answers. Now every admin
    edit, profile or Door Outcomes, first keeps the earlier version in `SurveyResponseArchive`
    (`overwrittenVia: 'answer_edit'`), kept until it is restored or erased, or the campaign or
    organization is deleted; an Undo removes the copies it puts back and keeps the rest (a survey changed
    since keeps its copy as history; only a copy holding nothing the survey doesn't — an edit that never
    landed — is removed as redundant) *[round 2: the undo had called a copy redundant on its answers
    alone, and deleted one whose note and position a later re-survey had replaced]*; and, like every
    archive row, a clear-knocks re-cut moves it into its round's snapshot and deleting a voter added at
    the door removes it (item 31) *[round 3]*. No timer. Each kept version is a FULL copy of the survey, so it
    also copies the GPS reading, the note and the canvasser's id. Three edges to state rather than
    discover:
    (a) the copy outlives the canvasser's own later deletion of that survey — re-recording the door with
    a different result deletes their surveys with no copy (`routes/mobile/canvass.js`,
    `SurveyResponse.deleteMany({ userId, householdId, passId })`), but the admin's earlier copy stays;
    (b) copies travel inside a round's `TurfSnapshot` on a clear-knocks re-cut
    (`services/turf/snapshot.js` reads `SurveyResponseArchive` by `passId`) until that snapshot is
    deleted — on Turf Cutting, with its round (since 2026-10-20), or with the campaign — and restoring the
    snapshot brings back a version erased after it was taken;
    (c) the run records: `AnswerEditRun` stores voter names (`samples`, `undo.summary.names`) and answer
    text (`planSummary`, `scopeSummary`), as item 13 recorded for the other run models. Who changed a
    survey since an edit ("re-surveyed by ‹name›") is stored as a user id and written as words only when
    the run is read, so a deleted account reads there as on every report — the name its deletion snapshot
    keeps for the 180-day window, then "Deleted user" *[corrected 2026-10-19: the first build froze those
    names as text (round 1), and this sentence said they read "a removed user" (round 2). A run undone by
    the first build kept its words as text, names included; `npm run repair:answer-edit-words -- --apply`
    rewrites them without the name, once, after the deploy]*. A plan that takes out an old answer by its
    words (`removeTexts` — an old text no option matches) freezes those words into the run's `plan`, its
    `planSummary` and the History line; an Erase of the survey's copies doesn't reach them — they go with
    the campaign or organization, like every run record *[stated in round 3]*. **Owner decision, flagged:** `scopeSummary` (every run
    type since item 13) still freezes a canvasser's name as text ("Canvasser: Cara Canvasser"), and the
    account-deletion purge (`purgeDeletedIdentities.js`) writes only `DeletedUserRecord`, so that name
    outlives the 180-day window privacy.html `:128` describes ("we aim to remove your name"). "Aim" is
    soft, but the sentence and the record now disagree. *[closed 2026-10-20: the purge now rewrites that
    name — the line's first part, where `describeScope` always puts the filter's canvasser — to "Deleted
    user" on every run of the four types whose `selection.scope.userId` is the purged account, per record
    before its stamp, and once more each night over every record purged earlier and every account deleted
    longer ago than the window that no unpurged record holds — an organization's deletion drops a record
    once no organization is left on it, and the person's work can sit in another organization's run lines
    (found by the follow-up review) (`scrubFrozenNames.js`, called by `purgeDeletedIdentities.js`; pinned in
    `retention.int.test.js`). `describeScope` no longer falls back
    to the account's email when it has no name, so a contact detail can't be frozen there. The sentence
    and the record agree again; the name stays for the window, as the policy says.]* `AnswerEditRunChunk` holds survey, voter and round
    ids, fingerprints, the landed copy's id (`a`), and per-chunk counts (question labels, and option ids
    and labels with tallies, and up to 200 voter ids with skip reasons). A voter's own words are never a
    count's key: a written answer is counted per question, and an old answer no option matches counts as
    one *unlisted* pick *[round 2: the first build keyed an unmatched or written answer by its text, so
    clearing a written answer stored what the voter said, word for word, on the run and every chunk — sent
    with every poll of the run and kept after an Erase of the survey's copies. `repair:answer-edit-words`
    folds those rows away, once, after the deploy]*. Bookkeeping added in rounds 2 and 3:
    `answerEditFence` (run ids) on surveys, `writerToken` on copies, a chunk item's proven put-back (`u`,
    a copy id) and `countRev`, `stepping` counters and `revertClaimedAt` on runs — and from round 4
    `heartbeatAt` on unknock runs, `deletion.cascadeAt` on campaigns and `undo.legacy` on answer-edit runs —
    and from rounds 5–7 a chunk item's counted questions (`cq`, question keys), its first-build flag (`l`)
    and every copy a one-person session made of a survey (`as`, copy ids), `undo.receipts` and
    `undo.writesReceipts` on answer-edit runs, `stoppedAt`, `undoBegunAt` and `counts.responsesHanded` on
    unknock runs — and from round 8 `coEntryIds` on unknock chunks (entry ids, the class of `rows`), a
    chunk item's settled put-back flag (`us`) and `recutLock.knocks` on rounds —
    none of it personal data; `historyPending` on runs is the History line being written, the plan's own words (answer text,
    as (c) says, already stored). **Pseudonymous, not "no personal data":** the strike records' visit keys
    (door, round and canvasser ids) and an undo's stored `undo.summary.names[].detail.by` hold canvasser
    user ids, which account deletion leaves in place — they join the pseudonymity list of §A3 like every
    ledger row that carries a `userId` *[corrected in round 3: this read "none of it personal data"]*.
    Both new models ride
    BOTH tenant-deletion cascades (verified 2026-10-19: `services/campaigns/deleteCampaign.js` and
    `services/platform/deleteOrganization.js` list `AnswerEditRun` and `AnswerEditRunChunk`).
    **Source.** A bulk edit is item 12's category (statements an admin enters about a voter) at batch
    scale, and one of item 12's bounds does NOT hold for this tool: *"a field-collected answer is never
    overwritten"*. This feature exists to change field-collected answers (the case that started it: a
    canvasser's fake picks on a yard-sign question). What replaces that bound: the earlier version is
    always kept (above); every changed survey is stamped `editedBy`/`editedAt` and reads *Edited by
    ‹admin›* on the voter profile, the response detail on both clients and the web door panel (the
    phone's map door and ping sheets with its next over-the-air update); the Canvassing activity export's
    "Answers edited" column (when the export includes survey answers) prints `yes`, with no admin identity;
    each run is audited in
    `CampaignChange` (`source: 'answer_edit'`, the plan's own words and the real counts); and the change
    undoes as one. A bulk edit never marks the NOTE edited — the note keeps its own stamp
    (`noteEditedBy`/`noteEditedAt`).
    **Correction and deletion (DPA §7; §H16(d)).** Erase — the existing archive delete route
    (`DELETE /admin/voters/:voterId/surveys/archive/:archiveId`) — is now on screen on each "Earlier
    answers" card, with its warnings. The help copy says: when a voter asked for something to be
    removed, edit the answer, then Erase the earlier version. The editors' `version` covers the note,
    so a stale editor can't write back a scrubbed note (409 `RESPONSE_CHANGED`).
    **Exposure.** The kept versions are new stored copies of answers already held. As the owner confirmed
    (Q1, 2026-10-19), leads — who can be clients — see edits exactly as they see every other correction
    today: a lead's campaign-scoped profile shows the Edited line and the earlier answers like any other
    kept copy. Only org admins can edit, restore or erase (`/admin/voters` is `requireOrgRole('admin')`;
    the answer-edit routes are org-admin only). The one-person-at-a-time step, the run itemization (its
    after-undo names too), the run's own read (its samples and undo names), the run list (the same, per
    row) and a priced review (the voters its manifest names) add record-level audit subjects
    (`addAuditSubjects`) *[round 3: the after-undo branch and the run read added none; round 4: the list
    and the review added none]*. The client report builder's internal note
    gains a count of edited responses beside its desk-entered count — COUNTS only, shown to whoever
    builds the report (org admins and the campaign's leads), never on the published page
    (`shapeWindow` is a field whitelist; `answerEdit.int.test.js` pins both). Neither note had ever
    rendered: `ClientReport`'s stats schema didn't declare `provenance`, so the saved report dropped it.
    Fixed in this change, so the desk-entered note appears for the first time too — counts of stamps
    the same readers already see survey by survey. No new export destination (the column describes
    data already held), no subprocessor, no new external flow; DPA §6 untouched, no customer notice.
    **Published text checked:** privacy.html — *"When a canvasser records activity at a door…"*, *"We
    retain account and campaign information for as long as the related customer account is active, or
    as otherwise instructed…"* and *"The doors you knocked and the survey answers you recorded stay with
    the campaign"*; DPA §7 and §9; the ToS. **Assessment: privacy-affecting under CLAUDE.md (retention, a
    batch rewrite of field-collected answers, an erasure path on screen), and no published sentence
    becomes false: no Privacy Policy, ToS or DPA edit is needed.** The owner's 2026-10-19 approval
    (given as "item 21", this plan's privacy item before the numbering settled — proposal §B3) covers
    this content.
    **Code review round 1 (2026-10-19, after the push of `589c1c0`).** Five reviewers found three race
    windows in which "the earlier version is always kept" was NOT true, each closed and pinned by a test in
    `answerEdit.int.test.js`: the bulk writer deleted a copy that had landed when a re-survey or a profile
    Delete removed the edit's mark before it looked (it now trusts each write's own result); an Undo
    whose put-back missed left a stamp that Undo again read as "put back", deleting the original (the
    put-back now writes its own receipt on the survey, and a miss clears the stamp); and a phone re-survey
    could overwrite answers an Undo had just put back without keeping them (it now writes over the version
    it copied, re-reading up to five times; past that it keeps the latest version it read, then writes) *[round 2:
    this read "writes only over the version it copied", which the fifth miss doesn't]*. The corrections
    above (F2's audience, retention wording, item 32(c), the export column) came from the same review.
    **Code review round 2 (2026-10-19, on round 1's fixes).** Five reviewers again found windows in
    which the earlier version was NOT kept, each closed and pinned in `answerEditRound2.int.test.js`:
    a delivery of a chunk deleted its own copy after another delivery had adopted it and landed the edit
    through it (every copy now carries the `writerToken` of the delivery holding it; a delete names its
    own token); a delivery still running when its change was undone wrote the edit back over the
    put-back (the undo now raises `answerEditFence` on each survey before reading it, and no write of
    that run lands past it); an Erase during an undo was honoured on screen and then written back (the
    undo puts back only a copy it could stamp); and the undo's "redundant copy" rule (above). Also
    corrected from this review: item 31's F2 audience and retention and its F5 mechanism, item 32(c)'s
    deleted-account wording and its pick labels, and the re-survey sentence above.
    **Code review round 3 (2026-10-19, on rounds 1 and 2's fixes).** Five reviewers again; each finding
    closed and pinned in `answerEditRound3.int.test.js`. Where the earlier version was NOT kept, or an
    undo didn't reach it: an Erase of the change's copy between its insert and its write left an edited
    survey with its original nowhere (Erase now refuses while the change can still write); a survey
    written back from a copy after its change's undo — an unknock or conversion undo, a re-cut round's
    snapshot restore, a profile Restore — came back without the undo's fence, and a delivery still running
    wrote the edit over it (every such path now carries the fence); and the undo missed an edit on a
    survey re-created under a new id (it now reads copies by slot). **Deletion — a completeness fix:** an
    organization deleted while a Door Outcomes conversion batch was in flight kept that batch's surveys
    (reproduced: three surveys of a deleted organization left behind). Both cascades now wait (bounded)
    for every Door Outcomes writer before their first sweep and sweep once more at the end, conversions
    stop at their next batch, and every such writer sweeps after itself while its tenant's cascade is
    running (`services/platform/lateWriteSweep.js`) — so "deleting an organization removes its canvassing
    records" holds for a batch that stalls past the wait too. A deletion only requested, which the route
    undoes when its job can't be queued, sweeps nothing. **Also from this review:** the one-time strike
    backfill (`npm run migrate:removal-strikes`) records each visit missing from a conversion's records
    with its own time, and the visits an older unknock undo couldn't put back; `repair:answer-edit-words`
    maps an option's text to the option first. Corrected here: the GPS retention line, item 31's and 32's
    retention lists, the bookkeeping's pseudonymity, and the audit-subjects sentence. No new data
    collected, no new recipient, no subprocessor, no export; DPA §6 untouched, no customer notice; no
    published sentence becomes false, and the deletion sentences (`:122`, DPA §9) are now true in a case
    they weren't.
    **Code review round 4 (2026-10-19/20, on rounds 1–3's fixes).** Five reviewers; each finding closed and
    pinned in `answerEditRound4.int.test.js` (33 tests; each fix undone in turn is caught by its test).
    **Deletion — two more completeness fixes and one in the other direction:** (1) a Door Outcomes change
    CREATED while its organization was being deleted outlived the deletion — a conversion's run (its
    selection of entry ids), and a one-person answer edit's run and chunk, whose scope line names a
    canvasser (reproduced: all three create paths). Each create now checks once its run is on file and
    goes with the tenant's rows; a conversion job whose campaign is gone takes its run with it. (2) A
    relabel (Door Outcomes → Change to) that stalled past the cascade left its run (`ReclassifyRun`, with
    its scope line) and its History row: relabels now sweep after themselves too, and `ReclassifyRun`
    joins both cascades' last sweep — so "every Door Outcomes writer sweeps after itself" above now holds
    for relabels (the cascades don't WAIT for a relabel, which is one inline write; its sweep-after is
    what reaches it).
    (3) A campaign delete the worker claims and then REFUSES (canvassing started first) let a writer's
    sweep remove that campaign's Door Outcomes records, though the campaign stayed: writers now sweep a
    campaign only once its cascade has begun (`deletion.cascadeAt`, stamped after the processor's last
    refusal) — retention in the safe direction, nothing kept longer. **Restore** — item 31 above (the
    unknock's heartbeat, every holding strike, a stopped strike's window, an undo's own entries).
    **Audit:** the answer-edit run list names in the access log the voters its rows show (their sample
    and the surveys an undo left), as the single run's poll does — the Details screen reads them from the
    list — and so does a priced review, for the voters its manifest names. **The one-time console step** (`npm run migrate:removal-strikes`) now holds only the visits an
    older unknock undo couldn't put back when the undo's own count settles which they were (it over-held
    a visit the undo did put back that the canvasser re-recorded later; when the counts can't tell, it
    holds them all, the safe direction), skips a conversion's visit whose entry came back, and marks an
    unknock from before round 3 that stopped part-way as one, so Restore holds it and its Undo is offered. **Reviews** are now time-limited on the database's side too — no data change. No
    new data collected, no new recipient, no subprocessor, no export; DPA §6 untouched, no customer
    notice; no published sentence becomes false, and the deletion sentences (`:122`, DPA §9) now hold for
    a change created during the deletion and for relabels.
    **Code review round 5 (2026-10-20, on rounds 1–4's fixes).** Five reviewers; each finding closed and
    pinned in `answerEditRound5.int.test.js`. **Erasure honoured (pre-existing, both removal undos):** an
    Erase of a Removed card while that unknock's or Surveyed → Not home change's Undo was running
    succeeded — and then the undo wrote the erased answers back from what it had read (reproduced, both
    paths). That defeated item 32's "edit, then Erase" for a voter who asked to be removed. Both undos now
    claim each copy before writing it back (the same stamp the answer-edit undo has always set, which
    Erase and now Restore wait on, `409 COPY_IN_USE`) and write back only what they hold: a copy erased
    first stays erased. **Restore mid-removal (pre-existing):** while an unknock was still removing, or a
    conversion's batch or door still saving, a Restore of that visit's answers passed the guard — the
    visit's own entry read Surveyed only because the removal hadn't reached it yet — and the struck
    answers came back counted under a door the removal then cleared (reproduced). That made item 31's
    "can no longer be put back as a counted survey from the profile" false inside that window; a removal
    still writing now holds every copy of its visits outright. **The removal undos' own record:** an
    unknock's Undo now leaves alone entries a LATER unknock still standing has struck (putting them back
    undid that strike — fake knocks billed again, reproduced) and puts answers back only under the
    visit's own unconverted entry; the strike settles and logs as it goes, so one that stops part-way is
    in History. **The backfill** gives a door-by-door session's visits their own time again (round 4's
    finish-time rule had stretched them to the session's close and held a real later survey's copy —
    reproduced; never run in production), and marks an older unknock as stopped part-way only on evidence
    it removed something. **History** counts the first build's undo correctly when it died inside its
    first pass, and a survey saved twice in a one-person session as one. No new data collected, no new
    recipient, no subprocessor, no export; DPA §6 untouched, no customer notice; item 31's sentence and
    item 32's erasure path are true again in the windows that broke them.
    **Code review round 6 (2026-10-20, on rounds 1–5's fixes).** Five reviewers; each finding closed and
    pinned in `answerEditRound6.int.test.js`. **Kept copies are never deleted for answers that weren't
    written back (a round-5 regression):** an unknock Undo whose write-back failed as a whole — a dropped
    connection, a failover — read the driver's empty error list as "nothing clashed" and deleted every
    claimed copy with no survey written: the answers were gone from everywhere while the Undo reported
    success (reproduced). Had it fired, that would have made item 31's F9 ("nothing silently lost"), §B6
    and item 32's "the earlier version is always kept" false, and been an accidental loss under the DPA's
    breach clause; it never ran in production (rounds 1–5 are undeployed). Such a failure now stops the
    Undo with every copy kept (Retry undo finishes it), and a copy is deleted only once its survey is
    read back on file. The same mistake in the forward conversion (Not home → Surveyed, since `80acabe`)
    stamped entries Surveyed over desk answers never written; it throws now. **A failed strike's hold (a
    round-5 regression):** an unknock that failed in process ended its hold on the struck visits in 1970
    (its heartbeat was set to the epoch), so a teammate's earlier copy of the struck answers read
    restorable and a Restore swapped them over the canvasser's real later survey (reproduced) — item 31's
    F5 and its stopped-strike window false for any such strike. The stop moment is recorded on its own
    now (`stoppedAt`) and the hold ends there. **Removals wait for each other:** an unknock, its Undo, and
    every conversion start, door step, Pick up and Undo refuse while another removal is still writing on
    the campaign (an Undo beside a later unknock or a conversion step had put answers back under a door
    the other was clearing — reproduced); a later unknock keeps what it struck, the earlier run's copies
    there included, so two overlapping unknocks undo cleanly in either order. **Erasure:** a failed undo
    no longer leaves its copies claimed for ten minutes (Erase and Restore said an undo was writing them);
    an Erase pressed after an undo used the copy says the answers are back on the survey, to be edited
    there. **The backfill** judges older unknocks newest first and no longer reads a later conversion's
    removal, or a teammate's re-survey, as the older run's. **Reviews** stop their leftover database work
    once they have answered, and at most two different ones run at once on a server. No new data
    collected, no new recipient, no subprocessor, no export; DPA §6 untouched, no customer notice; the
    sentences the round-5 regressions made false (item 31 F5 and F9, §B6, item 32) are true again.

    **Code review round 7 (2026-10-20, on rounds 1–6's fixes).** Five reviewers; each finding closed and
    pinned in `answerEditRound7.int.test.js`. **Struck answers swapped over a real survey (in every round's
    guard, never deployed):** Restore lifted a removal's hold on a visit whenever an entry recorded before
    the removal read Surveyed there — one an unknock that stopped part-way never deleted, one a Surveyed →
    Not home step that died before its flip left, or an older entry an earlier unknock's Undo brought back
    under a later unknock of the same visit — and a Restore made the struck answers the voter's current
    survey over a teammate's real one (reproduced three ways). Item 31's F5 (an unknocked or converted
    visit's answers "can no longer be put back as a counted survey, or swapped over a real later survey,
    from the profile") was false in those cases; a hold now lifts only through the removal's own undo —
    its undo begun, and one of its own entries back at the visit (or, since round 8, that undo finished
    and an older entry put back at the visit since) — except where nothing on record names
    the removal's entries, read the old way, by an entry recorded before it began: no run on file, an
    unknock that never reached its delete, a conversion from before its records whose undo took its
    stamps off, and a first-build unknock that stopped part-way until `npm run migrate:removal-strikes
    -- --apply` marks it (that build stamped no `deletingAt`; run the step right after the deploy — until
    then such a visit's answers can still be swapped over a teammate's later survey). **Claims on kept
    copies:** round 6's sentence above, "a failed undo no longer leaves its copies claimed for ten
    minutes", was false on two paths — the claim's own read failing, and the delete of copies already
    written back failing. Every batch lets go of its claim however it ends now; only a database that
    can't take the release, or a process that dies mid-batch, leaves it to lapse in ten minutes (Erase and
    Restore say an undo is writing the copy meanwhile, and nothing is lost). **Erase on a person's other
    campaign rows:** the profile lists a person's surveys and earlier answers from every campaign of the
    organization, but each card's Edit, Delete, Restore and Erase went to the open row and answered "not
    found" for a card from another campaign — so item 32's "Erase on screen", and the way VOTERS.md gives
    to honour a removal request (edit the survey, then erase every earlier card that still holds it),
    failed for a person on more than one campaign's list. Each card names its own row
    and acts on it; who can act is unchanged (org admins of that organization, every route org-scoped),
    and the access log now names the row acted on. **An undo lost during a clear-knocks discard:** an
    unknock or conversion Undo landing between a discard's snapshot and its deletes left the visit's
    answers held as unknocked with the run reading Undone — recoverable only by hand; removals now wait
    for a re-cut (narrowed in round 8 to a lock that clears or restores knocks) and the discard waits for
    removals. **Bookkeeping:** the field lists above add `cq`, `l`,
    `as`, `undo.receipts`, `undo.writesReceipts` and `counts.responsesHanded` — ids, keys and flags, no
    personal data. No new data collected, no new recipient, no subprocessor, no export; DPA §6
    untouched, no customer notice; item 31 F5 and item 32 are true again, and round 6's claims sentence
    is true as narrowed here.

    **Code review round 8 (2026-10-20, on rounds 1–7's fixes).** Five reviewers; each finding closed and
    pinned in `answerEditRound8.int.test.js`. **Corrected above:** round 7's paragraph quoted item 31's F5
    in words F5 doesn't use, and left out the old reading for a removal with nothing on record to read its
    entries by — among them a first-build unknock that stopped part-way, until `migrate:removal-strikes`
    marks it. **A window in round 7's hold:** Restore read a Surveyed → Not home conversion's undo as begun
    at its claim, before the checks and the enqueue that can give the run back, so a Restore in that window
    (five seconds for an enqueue in a Redis outage) swapped removed answers over a teammate's real survey
    (reproduced): F5 was false there. A claim holds now; the undo begins once it has stopped part-way or
    finished. **Bookkeeping:** the field lists above add `coEntryIds`, `us` and `recutLock.knocks` — ids
    and flags, no personal data. **What is kept at a lifted visit:** where an older entry was put back at
    a struck visit since, an unknock's undo now leaves its own entry off and lifts the visit (item 31's
    lift sentence above) — so where no survey holds the slot, the struck answers stay an earlier-answers
    card Restore offers, where round 7 had written them back beside a second entry (described here only
    since round 9). Otherwise round 8 changes nothing collected, kept, shown or shared: an Undo between a
    clear-knocks discard and its restore now waits (it had left a removal's copy held, still erasable), the
    undos and reviews read fewer rows, and every count and claim fix keeps the copies item 32 describes. No
    new data collected, no new recipient, no subprocessor, no export; DPA §6 untouched, no customer notice;
    item 31 F5 is true again in the claim window.

    **Code review round 9 (2026-10-20, on rounds 1–8's fixes).** Five reviewers; each finding closed and
    pinned in `answerEditRound9.int.test.js`. **Corrected above:** round 8's lift was described nowhere —
    item 31's lift sentence and round 7's paragraph said a hold lifts only where the removal's own entry is
    back, and round 8's paragraph that nothing else in it changed what is kept. **An earlier version
    lost:** a profile Restore that swapped a teammate's card into a voter's slot while an unknock or a
    Surveyed → Not home step was removing the survey there was deleted with it — the removal read, copied
    and then deleted the slot's survey by id, and the restored answers, whose card the Restore had consumed,
    were on file nowhere (reproduced; since before `589c1c0`). Item 31's F9 ("nothing silently lost") and
    item 32's "the earlier version is always kept" were false in that race. A removal now deletes a survey
    only while it still holds the submission it read. **A cleared round's snapshot:** an Undo waits for a
    clear-knocks snapshot only while its round can still take it back — on file, not archived, knocked
    nowhere since — and the restore refuses to put old knocks over new ones, or to bring back the work of a
    change undone after the round was cleared. A snapshot that can't be restored stays on file, as item
    32(b) says, until it is deleted on Turf Cutting or with the campaign; **owner flag:** one whose round
    was deleted is shown nowhere, so only the campaign's deletion removes it (since before `589c1c0` —
    deleting a draft round leaves its snapshots). No new data collected, no new recipient, no subprocessor,
    no export; DPA §6 untouched, no customer notice; item 31 F9 and item 32 are true again in the race.
    *[the owner flag closed 2026-10-20 — next paragraph.]*

    **After round 9 (2026-10-20): the leftovers closed at the owner's call.** Two of them change what is
    kept, both by keeping less. **(1) A deleted round's snapshots go with it.** Deleting a draft round
    (`DELETE /passes/:id`) or a walk list whose rounds are all drafts now deletes the round's
    `TurfSnapshot`s too — books-only and knock-clearing alike, the cleared entries, surveys, notes and
    earlier answers in them included — after the round itself; a nightly maintenance job,
    `sweep-orphan-snapshots` (05:37, MAINTENANCE_JOBS, not the retention banner), deletes every snapshot
    whose round is gone: the ones deleted rounds left before this, and any a stopped delete leaves
    (`snapshotRetention.js`). Nothing can restore such a snapshot (the restore needs its round), and no
    Undo waits on one (`roundClearedSince` holds only while the round is on file). Item 32(b)'s "until that
    snapshot is deleted" now includes the round's deletion. **(2) The frozen canvasser name** — item 32(c),
    closed above. Otherwise nothing collected, shown, shared or exported changes: a survey conversion left
    busy with nobody working on it (two database failures in a row) is now settled after ten minutes, its
    run gaining `revertFrom` — the status and message it had when an Undo claimed it (bookkeeping, no
    personal data); an identical priced review pressed twice at once answers both presses from one
    reading, each press's access-log line written as before; a draft round that still holds door history
    can no longer be deleted (it was, leaving its entries, surveys and copies under no round — nothing was
    erased then either). No new recipient, no
    subprocessor, no export; DPA §6 untouched, no customer notice. **Policy text:** no privacy.html, Terms
    or DPA sentence becomes false — privacy.html `:128` ("we aim to remove your name") is now true of the
    run lines too; nothing published promises that a deleted round's snapshots are kept.
33. **[v6 2026-10-22 — Lifetime platform totals: while a deletion runs, the platform counters hold the
    bare id of the org or campaign being deleted, and drop it once it is gone. Nothing new collected, no
    recipient, no export, no subprocessor.]** The Control Room's lifetime totals (`PlatformStats`,
    [platformStats.js](../server/src/services/platform/platformStats.js)) bank a customer's counts into
    a kept bucket at the start of its deletion — the sums privacy.html `:122` calls "aggregate,
    non-identifying usage statistics". So that each bank lands exactly once, the same document now holds
    a small ledger (`bank.orgs`, `bank.campaigns`, `bank.seq`): the ids of the orgs and campaigns banked
    while their deletion is still running. Ids only — never a name, a voter, an answer or any other
    customer data — and never served: `GET /super-admin/access/platform-stats` returns the sums alone.
    Each id is pruned once its org or campaign is gone, at the end of its cascade, and by the nightly
    reconcile for one a crash left behind, so an id outlives its deletion by a day at most. Also from
    this change: a Door Outcomes writer that finishes during an organization delete sweeps the tenant's
    rows only once that delete has banked the org's counts (its `platformStatsCaptured` mark, set before
    the cascade's first sweep) — the cascade's own sweeps still remove everything, so "deletion removes
    the organization's … canvassing records" holds unchanged. Pinned by
    [platformStats.int.test.js](../server/test/platformStats.int.test.js). **Policy text:** no
    privacy.html, Terms or DPA sentence becomes false — what is kept after a deletion is still sums only;
    the transient id is internal bookkeeping of the deletion itself. Flagged for the owner all the same,
    since it touches what a deletion leaves while it runs.
34. **[v6 2026-10-23 — Client report visibility switches are not enforced on the wire. Audit finding;
    NOT fixed yet.]** Verified by driving the real admin and share endpoints against a throwaway
    database. (a) With **Show the coverage map** off, publish still freezes every reached door's street
    line, coordinates, status and selected answers (`clientReports.js:697-704`), and
    `GET /share/:token/reports/:id/map` (`share.js:166-173`) serves them to anyone holding the link and
    its password; the switch only hides the map in the browser. (b) A survey question unticked from the
    report's visible list still ships its option counts in the report's `survey` field, and its answers
    on every map point, whenever it stays in `mapAnswerKeys` — which is seeded with every choice question
    at create, has no tie to the visible list, and whose checklist the builder hides while the map is off
    (`mapFilterSurvey`, `clientReportView.js:114-127`; an empty `mapAnswerKeys` also means every question
    there). (c) An operator-set link password may be one character (`shareUpdateSchema`,
    `clientReports.js:251`); the unlock limiter counts per IP + token only. (d) *[2026-10-24, review
    round 1, verified]* Two more fields carry hidden question keys to link holders:
    `visibility.mapAnswerKeys` is sent raw, and `supportQuestionKey` is sent even when that question is
    hidden (`clientReportView.js:68, 88-91`). Keys are slugs of the question's title
    (`SurveyBuilder.jsx:107-110`), so a key gives away the hidden question's wording. No client screen
    reads `visibility.mapAnswerKeys`. (e) *[verified]* Unticking every survey question shows all of them
    to the client: an empty `visibleQuestionKeys` means "all" (`clientReportView.js:10-12`), so an
    operator who meant to share no survey breakdowns shares every one. (f) *[2026-10-24, review round 3,
    verified with the real `normalizeAndFilterAnswers`]* A follow-up question on the map reveals the
    hidden question it depends on, door by door. Survey questions can be conditional (`visibleIf`,
    `SurveyTemplate.js`), and the field submit drops answers to questions that weren't shown
    (`normalizeAnswers.js`), so if "Yard sign?" is asked only after a Yes to a hidden "Back the recall?",
    every door carrying a yard-sign answer is a recall supporter. The map path never considers
    `visibleIf`. The fix (PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F1) keeps a follow-up off the map unless
    every question it depends on is on it too. **Policy text:** privacy.html
    `:101` says the map shows door statuses "and, where the customer chooses, responses to selected
    survey questions, shown at the address level" — (a) means a customer who chose no map still has
    address-level points served behind the link; (b) and (c) are control gaps, not false sentences. The
    proposed fixes ([PROPOSAL_CLIENT_REPORTS_UPGRADE.md](PROPOSAL_CLIENT_REPORTS_UPGRADE.md) §F) make the
    sentence true as written, with no policy, Terms or DPA edit. Until they ship, treat that sentence as
    at risk. Separately, the same line says links expire "after 90 days by default, or a period of up to
    one year chosen by an administrator": the API accepts it, the share panel offers no way to choose it.
    *[v6 2026-10-24 — CLOSED IN CODE by the client reports upgrade (PROPOSAL_CLIENT_REPORTS_UPGRADE.md,
    built 2026-10-24, uncommitted; deploy pending — stamp the deploy date here when it ships, and run
    `migrate:client-report-visibility -- --apply` for the reports published before it). What the code
    now does, read from it and pinned by `reportSecurity.int.test.js`, `clientReportBuild.int.test.js`,
    `clientReportMigration.int.test.js` and `shareLinks.int.test.js`:*
    - *(a) Map off serves nothing. Turning the map off deletes every map row of the report in the same
      PATCH and prunes the live snapshot's and any build's inputs (`routes/admin/clientReports.js`); a
      build commits no rows when its inputs say the map is off (`commitBuild`, `clientReportBuilds.js`);
      the readers serve a map only when both the report's setting and its live snapshot say yes
      (`mapServed`, `services/reports/reportVisibility.js`), else `404 MAP_NOT_SHARED`
      (`checkMapRequest`, `services/reports/clientReportMap.js`); the nightly `client-report-row-sweep`
      deletes any row left on a map-off report; the migration deletes the legacy rows of map-off reports
      (step 5).*
    - *(b) A hidden question reaches neither the charts nor the map. Map questions are `mapKeysFor` =
      `mapAnswerKeys` ∩ the visible questions (empty means none), intersected with the live snapshot's
      own map keys (`servedMapKeys`); `mapFilterSurvey` and the map payloads carry only those; answers
      outside them are `$pull`ed from the stored rows at the edit and at every build's commit, and the
      migration narrows legacy reports (steps 4-5).*
    - *(c) A link password set by the operator needs 12 characters, on create and on change (`400
      SHARE_PASSWORD_TOO_SHORT`, `routes/admin/clientReportShares.js`); an older short one is flagged
      after its next successful unlock (`passwordMeetsRule`, item 38(e)). Guessing is budgeted per link:
      no link checks more than 50 wrong passwords in any 24 hours, the slot reserved before bcrypt runs
      (`reserveUnlockSlot`, `services/reports/shareLinks.js`), beside the per-IP limiter.*
    - *(d) The client payload's `visibility` is `{ showMap, mapMode, areaSize }` only, and
      `supportQuestionKey` is sent only when that question is visible (`shapeReportForClient`,
      `services/reports/clientReportView.js`).* *[v6 2026-10-24, code review round 1 (PUBUX-1):
      `visibility` also carries `mapVersion`, an opaque 16-character HMAC (`opaqueKey`, salted with the
      server's secret) of the live snapshot's key, the map mode, the area size and the SERVED map
      questions — only what the map payload already shows the link holder; null when no map is served.
      No hidden question's key, no id, no time.]*
    - *(e) Empty means none for visible questions (`visibleKeysFor`, `shapeWindow`), on every report. The
      migration lists the legacy reports whose operator had unticked every question (step 1); by default
      they now show none, and `--keep-legacy-all` keeps their charts.*
    - *(f) A follow-up reaches the map only with every question it depends on (`closeUnderDeps` over the
      build's frozen `questionDeps`: the transitive closure of today's `visibleIf` and the survey's
      monotone `SurveyTemplate.depsEver` record, item 38(b)), in every writer and reader; a rule accepting
      every option of its parent isn't a dependency. Map answers come only from the campaign's own
      survey. In area view a follow-up shows area answers only when its parents do (item 38(a)).*
      *[v6 2026-10-24, code review round 1 (LEGACY-1) — reports published BEFORE the upgrade: their map
      rows were frozen from whatever survey gave the answers, and the campaign's survey may have been
      swapped, detached or edited since, so reading their dependencies from the current survey alone
      could still put a hidden question's follow-up on the map (and the migration would have frozen
      that). Now such a report takes its dependencies from EVERY survey with a response in its campaign,
      plus the current one (`legacyTemplatesFor`, `services/reports/clientReportMap.js`), united
      (`questionDepsOf`), and fails closed: a map question that is no question of any of those surveys
      is never served, and with no survey at all no map question is (`liveInputs`,
      `services/reports/reportVisibility.js`). Only a PUBLISHED report without `snapshotInputs` reads
      this way; any other report without them (a draft) has nothing live — no map, no map questions —
      so its old rows are never served. The migration follows the same rule (steps 3-5). One case code
      can't close: a condition removed BEFORE the deploy, with answers given under that older version —
      nobody stored that version's conditions. The migration's step 0 lists every survey with answers
      older than the version its record starts at (`olderVersionTemplates`, from the new
      `SurveyTemplate.depsEverFromVersion`, item 38(b)), and the builder's Before you publish warns on a
      draft whenever such an answer could reach a shown map beside a hidden question
      (`checks.conditionsUnknown`, `services/reports/clientReportChecks.js`). Said plainly: Before you
      publish renders on drafts only, so a report ALREADY published — including every report published
      before the upgrade, the case this matters for most — gets no on-screen warning; for those the
      migration's step-0 list is the only notice, and the owner should look over the map questions of
      the listed surveys' campaigns' published reports that hide a chart. Pinned by
      `clientReportEdits.int.test.js` (the survey swap, the migration's listing) and
      `clientReportChecks.int.test.js` (the warning).]* *[v6 2026-10-24, code review round 2 (P-2): the
      "no on-screen warning" gap above is closed — a published report's builder now shows the same
      warning in a **Worth a look** box (`PublishedChecks`, `client/src/components/clientReports/
      BeforePublish.jsx`), reports published before the upgrade included. The migration's step-0 list
      stays as the record.]*
    - *The expiry remark is closed too: the panel offers 30, 90, 180 or 365 days (default 90, still
      `SHARE_LINK_DEFAULT_DAYS`), Extend moves an expiry later but never past one year from the link's
      lifetime start, and an expired link is renewed to a new address. **Policy text:** privacy.html
      `:101` is true as written for these points once this deploys; no Privacy Policy, Terms or DPA edit.
      The new stores and records this upgrade adds are item 38.]*

35. **[v6 2026-10-24 — Per-person report drills returned other organizations' people, and let a team
    lead open anyone in their own organization. FIXED 2026-10-24; deploy pending (stamp the deploy
    date here when it ships).]**
    - **Found** by plan review (PROPOSAL_ADMIN_ACCOUNT_DELETION.md, rounds 3 and 4) and reproduced over
      HTTP, as an admin and as a campaign-scoped team lead.
    - **The leak:**
      - `GET /admin/reports/canvassers/:userId/summary` looked the account up by id alone
        (`User.findById(userId, 'firstName lastName email phone isActive lastLoginAt')`) and returned it
        for **any** valid user id. `parseUserIdParam` checked the format only, and the route answered
        404 only when no account existed at all.
      - `/canvassers/:userId/responses` did the same with name and email.
      - The canvasser CSV's `?coordinatorId=` crew stamp (`crewStampLabel`) printed any account's name.
      - So any admin, or any team lead (who can be the paying client), holding another organization's
        user id could read that person's name, email, phone, active flag and last sign-in. Inside their
        own organization, a lead could do the same for anyone, admins included, though the Users list
        walls leads to their managed campaigns (`leadVisibleUserIds`, `memberships.js`). Help Center
        `guides/roles-and-team.md` promises that wall ("a lead works inside the campaigns you grant
        them"; "admins and fellow leads are entirely out of their reach").
      - User ids are not secrets: an ObjectId encodes its creation time and a per-process counter.
      - The other eight drills scope their data by `organizationId` and leaked nothing beyond an empty
        result.
    - **Policy text that was untrue for these fields until the fix deploys:**
      - privacy.html `:105`: customer data "is not shared with, or visible to, other customer
        organizations";
      - privacy.html `:115`: "access controls that limit each user to the information of their own
        organization";
      - the signed DPA §4 (`DPA.md:41`): "tenant isolation limiting each customer's users to that
        customer's data".
    - **The fix**, checked on the report router's `:userId` param, so all ten `/canvassers/:userId/*`
      drills and any future one answer anyone else with the same 404 as an id that doesn't exist:
      - **An org admin** (super admins included) sees anyone the org carries: `orgCarriesUser` in
        `services/reports/canvasserIdentity.js`, meaning a membership here in any status, or the
        person's own knocks (desk marks excluded) or surveys on this org's ledger. Desk marks are left
        out because their `userId` is whoever pressed the button, which can be Doorline staff under a
        grant.
      - **A team lead** sees only people on a campaign they manage: `campaignsCarryUser`, meaning
        rostered there, granted to run it, coordinating a crew there, or with their own knocks or
        surveys there. Any managed campaign counts, because the phone's Users hub opens people from a
        lead's other campaigns.
      - **`crewStampLabel`** names a coordinator only if the same check passes, or the coordinator is
        stamped on the doors in the export's scope. Anyone else prints "unknown coordinator".
      - **`/summary` returns `lastLoginAt` only for a current member**, so a person carried only by old
        knocks doesn't reveal that they sign in somewhere else now.
    - **Pinned by** `test/reportsUserScope.int.test.js` (6 tests). For an admin and for a lead, every
      drill answers another org's live or deleted member identically to a non-existent id. Also pinned:
      - a lead is refused someone on a campaign they don't manage, and an org admin who is on none of
        their campaigns, but still sees their other campaigns' people;
      - this org's members in any status, departed members, and someone with only a survey still
        resolve;
      - a staffer with only desk marks stays hidden;
      - a removed member's `lastLoginAt` comes back null;
      - the crew stamp for an admin and for a lead;
      - the malformed-id 400.

      15 related suites stay green: reports, crews, team attribution and leads (211 tests in all).
    - **No policy, Terms or DPA text change:** the fix makes those three sentences true as written.
    - **For the owner and counsel:** DPA §5 requires notice "after confirming a breach of security
      leading to … unauthorized disclosure of or access to Personal Information". Whether anyone used
      this can't be read from a durable record:
      - `AccessLog` covers staff access only;
      - production's request log (`morgan('combined')`, `app.js:86`) records each request's path, which
        carries the drilled id, plus its status and IP address, but not who made the request;
      - those lines survive only as far back as Heroku's log retention, or any log drain if one exists.

      That is a fact for counsel's assessment, not a conclusion that nothing is owed.
    - **Owner decision (2026-10-24):** not referred to counsel, and no DPA §5 notice. The basis: review
      found it, and no record shows it was used. The record limits above stand, so nothing proves it
      wasn't used either.
    - **Watchlist:** see the 2026-10-24 bullet in *New policy sentences to keep true*.
36. **[v6 2026-10-24 — A customer's admin or team lead could put a Doorline staff account on a book or a
    walk-list crew, and read the staffer's contact details back. FIXED 2026-10-24; deploy pending (stamp
    the deploy date here when it ships).]**
    - **Found** by plan review (PROPOSAL_ADMIN_ACCOUNT_DELETION.md, round 4, R4B-3) and reproduced over
      HTTP on the old code, as a customer's team lead.
    - **The gap:**
      - `partitionAssignable` (`services/campaignRoster.js`) is the check behind all three assign paths:
        one book, `assign-bulk`, and a walk list's `POST /efforts/:id/members`. It let any super-admin id
        through in every org, with no membership needed. The exemption was meant for staff working
        Doorline's own orgs ("cross-org oversight + self-assign").
      - So a staff id earned a 201 (200 from `assign-bulk`) where any other outsider's id earns a 409,
        which confirmed the id belonged to staff.
      - The assignment also put the staffer on the customer's campaign team (`ensureCampaignAssignments`)
        without the customer adding them.
      - The book list and the crew list then returned the staffer's name and email. The Team list
        (`GET /admin/campaigns/:id/assignments`) also returned their phone, last sign-in time and
        `isSuperAdmin: true`.
      - A customer can come by a staff id: a row a staffer writes under a support grant carries it, for
        example `assignedBy` on a book assignment, which the book list returns as-is (read from the
        code). Ids are not secrets anyway (item 35).
      - **What it did not do:** let anyone into customer data. A roster row is not a membership, so the
        staffer gained no entry to the org (`orgContext` still requires a membership or a grant), and the
        customer read nothing but the staffer's own account fields.
    - **Whose data:** Doorline staff accounts' contact details, not customer data. The closest policy
      sentence is privacy.html `:115`, "access controls that limit each user to the information of their
      own organization", which was untrue for staff identities. No sentence about customer data was
      false. The DPA's notice clause (§5) covers customer Personal Information; this exposed staff
      identities only.
    - **The fix:**
      - `internalStaffIdSet` (`services/campaignRoster.js`) counts staff as members without a membership
        row only in an internal org (`Organization.isInternal`, the one place `orgContext` seats them as
        members), and only with a live account.
      - In a customer org a staffer needs an active membership like anyone else, and support access can't
        mint one (`vendorGuards.js`).
      - `partitionAssignable` and `departedMemberIdSet` (the snapshot-restore gate) both use it, so a
        restore can't hand back a book the assign paths now refuse.
      - The web book pickers (`useCampaignTeam`) offer staff "You" only in an internal org. The phone is
        unchanged: in a customer org its self-assign already stopped at the Team add, which needs a
        membership.
      - Also new: a switched-off staff account is refused in an internal org too. It used to pass.
    - **Rows made before the fix stay.** Nothing removes a staff account already on a customer's book,
      crew or team. Removing it from that book or the Team page works as for anyone. Removal deletes a
      member's roster rows (`releaseAssignedWork`), so a team row with no membership behind it can only
      have come from this gap or a race.
    - **Pinned by** `test/staffRosterScope.int.test.js` (4 tests, over HTTP) and three new tests in
      `test/partitionAssignable.int.test.js`.
      - In a customer org, a staff id on all three assign paths, from an admin and from a lead, gets the
        same 409 as an id that doesn't exist, and no book, crew or team row is written.
      - Kept: a staffer the customer made a member is assignable, and staff in an internal org still
        assign themselves a book.
      - On the old code the 5 tests of the refusal fail and the 5 that pin kept behavior pass.
      - 23 related suites stay green (298 tests).
    - **No policy, Terms or DPA text change:** the fix makes privacy.html `:115` true for staff
      identities as written.
    - **Watchlist:** the 2026-10-24 bullet in *New policy sentences to keep true* covers this direction
      too.
37. **[v6 2026-10-24 — An org admin can delete a member's account. BUILT 2026-10-24; deploy pending (stamp the
    deploy date here when it ships). Privacy-affecting: a new deletion path, and changes to what every
    deletion leaves behind. No published sentence becomes false; two get truer.]** Plan, rulings and review
    log: [PROPOSAL_ADMIN_ACCOUNT_DELETION.md](PROPOSAL_ADMIN_ACCOUNT_DELETION.md).
    - **The new path.** `GET /admin/memberships/:userId/deletion-check` (the review) and
      `DELETE /admin/memberships/:userId/account` (body `{ confirmEmail, expectKind }`), admins only, never team
      leads. Both run `reviewOrgDeletion` (`services/users/deleteAccount.js`); the first refusal ends it:
      - the person must be a member of this org (an unknown id gets the same 404);
      - who is asking, in `orgContext`'s order: staff with a non-admin membership here are refused
        (`ADMIN_ONLY`); staff in an internal org without a membership may delete; staff under a support grant
        may delete an unused account at support tier and any account at break-glass
        (`BREAK_GLASS_REQUIRED`); the store-review logins may not (`REVIEW_LOGIN`);
      - never yourself, never a staff account (a grant-holder aiming at staff gets `STAFF_SELF_MINT`);
      - **any membership in another organization, active or switched off, refuses**
        (`OTHER_ORGANIZATION`, owner decision 2026-10-24). The response then holds that one blocker and
        nothing else: no name, id or count of the other org;
      - billing access protects its holder: only an admin with billing access, or staff, may delete them
        (`BILLING_TARGET`);
      - the existing blockers, for this org only: a locked review account, the last live admin, the last live
        billing admin.
    - **Attribution.** `DeletedUserRecord.reason` gains `org_admin`; staff deleting inside an org record
      `super_admin`. `deletedBy` is the actor. The org's admins see the deletion on the person's row ("Deleted by
      Alex Kim", "Deleted their own account", "Deleted through Doorline support"); the deleter is named only to an
      org where they hold a membership. A grant-holder's review and deletion name the account in `AccessLog`.
    - **One model, all four doors** (self, the platform page, the CLI, the org door): one deletion at a time per
      account (the pending name record is the lock, `DELETION_IN_PROGRESS`); memberships switched off one row at a
      time, then a recount of LIVE admins and billing admins (`billingGuards.js` now counts live accounts only);
      the 14-field scrub as one conditional write; an idempotent finish; a sweep every 15 minutes and before the
      nightly purge for a crash on either side; and a purge that skips any record whose account isn't deleted.
    - **What a deletion now leaves, on every path:**
      - **The name record covers more organizations:** every membership in any status, plus every org where the
        person recorded their own doors or surveys (desk marks excluded). It used to be only the memberships
        active at deletion. That is new name exposure, inside the window privacy.html `:128` describes and only to
        orgs whose records carry the person (stamped at A4).
      - **Eight more lookups restore the name for the window:** the GPS audit, the leaderboard's and Timeline's
        team labels, the team breakdown and tag-team totals, the per-canvasser summary and responses, the Survey
        Results voters-by-answer CSV, and the canvasser CSV's crew stamp. All are org-scoped through
        `hydrateCanvassers`, which now restores nothing when handed no org. Team labels are lead-visible, and a
        lead can be the client. About 45 other surfaces still show "Deleted user" at once (a follow-up).
      - **An unused account** (created on or after 2026-05-15, never signed in, nothing on record here, never a
        coordinator) deleted from the org door loses that org's membership row, and the record keeps no name.
      - **Memberships lose `billingAccess`** when a deletion switches them off, so a deleted account's row never
        reads as a bill-payer and any admin can tidy it away.
      - **The email send log:** rows whose `userId` is the account (its own invites, resets and added-to
        notices) get the tombstone address in `to`, with `error` and `deliveryDetail` cleared: by account, never
        by address (owner decision 2026-10-24). A late bounce on such a row stores no text. **Residual:**
        deletion-warning and support-grant notice rows carry no `userId` and keep their recipient's address, as
        the evidence those notices went out (warnings for good, notices for the log's 365 days). Accounts deleted
        before this ships: `npm run migrate:scrub-deleted-email-log`, then `-- --apply` (Heroku Run console).
    - **No write lands on a deleted account.** The login and last-seen stamps, the self-service profile and
      password writes, reset and invite tokens, and an admin's identity and temp-password edits are conditional on
      the account being live. The membership edit, both Reactivates, the crew add and a member link re-check after
      their last write and converge: off, no billing access, no grants.
    - **Paused (read-only) orgs** may now delete an account, remove a member and Deactivate (both doors): the
      writes that END access. Nothing that turns access back on passes. (Stamped at each "exports only" passage.)
    - **Billing access now protects its holder from Remove from org** too (`BILLING_ACCESS_REQUIRED`), except on a
      deleted account's row.
    - **No org is left without a live admin, by any door.** Remove from org, a demotion and Deactivate now re-count
      live admins after their write and undo one that reached zero (`LAST_ADMIN`), the same backstop billing access
      already had. With deletion, two admins can take each other out from two doors at once; and staff can no
      longer remove, demote or switch off an org's only admin.
    - **Policy text.** No sentence becomes false, and none is added (owner answer 2026-10-23):
      - privacy.html `:118` keeps information "as otherwise instructed by the customer organization", and DPA §2
        counts the customer's "use and configuration of the Service's features" as instructions. DPA §9's 180-day
        sentence describes self-deletion; the admin path rests on §2.
      - **Truer:** privacy.html `:127` ("your email address … removed") now holds for a person's own mail in the
        send log, and privacy.html `:115` ("disable access promptly") now holds in a paused org too.
    - **Still open, recorded for the owner:** the address in `Subscription.billingContact.email`,
      `SubscriptionEvent` and `OrgDeletionRequest.requestedByEmail`, and in the 12-month backups; the ~45
      surfaces; until the phone clean-up (plan §E2) ships after Election Day, a deleted account's unsent doors go
      up under whoever signs in next on that phone (the review tells the admin to let the phone sync first); a
      refused deletion can drop a live phone's sync if it lands in the ~100 ms switch-off window.
    - **Pinned by** `test/orgAccountDeletion.int.test.js` (32 tests, incl. the crash and race cases a review
      reproduced on 2026-10-24), `test/deletedUserNames.int.test.js` (6) and the updated
      `test/billingAccess.int.test.js` (the Remove door checked with a staff actor).
    - **Watchlist:** five lines in *New policy sentences to keep true* (2026-10-24, account deletion).
38. **[v6 2026-10-24 — The client reports upgrade: what it stores, shows and keeps. BUILT 2026-10-24,
    uncommitted; deploy pending (stamp the deploy date here when it ships). Privacy-affecting (new stored
    records, new retention, a new reader of History), but no new subprocessor, and no published Privacy
    Policy, Terms or DPA sentence becomes false.]** Plan, rulings and *As built*:
    [PROPOSAL_CLIENT_REPORTS_UPGRADE.md](PROPOSAL_CLIENT_REPORTS_UPGRADE.md); doc of record
    [CLIENT_PORTAL.md](CLIENT_PORTAL.md). It closes item 34 (stamped there) and changes D11 (stamped
    there). Everything below was read from the code.
    - **(a) Area cells, a new stored aggregate with no address.** `ClientReportAreaCell` (new collection):
      per fixed H3 hexagon of an area-view report (resolution 9, about 1,100–1,400 ft across, or 8, about
      0.55–0.7 mi), the doors reached, the doors by status, and single-choice answer counts with `n`, the
      homes there that answered. No address, door coordinate, voter, canvasser or time. A question shows
      answers by area only when every area has at least five answers to it (all or nothing per question,
      owner ruling 2026-10-24; the decision reads counts only), and a follow-up only when its parents do,
      applied when the cells are written and again when they are read (`services/reports/areaCells.js`).
      What it can still reveal, and the builder says so in plain words: an area where every answering home
      agreed shows how each of them answered; statuses show for one-home areas; other reports on the same
      link can narrow things down (*Before you publish* names them). Replaced by each build, deleted with
      the report, the campaign (campaign cascade) and the organization (`ORG_SCOPED`), in
      `LATE_WRITE_MODELS`, swept nightly. privacy.html `:101`'s "shown at the address level" over-describes
      an area report, which shows less: an optional owner refinement, not a false sentence.
      *[v7 2026-10-25 — scoped by links to one report (item 38(m)): "other reports on the same link" now
      means a link to ALL the campaign's reports; a link to one report shows only that report. One person
      can hold several links, so Before you publish still names every shown report that could narrow an
      area report down (`areaNarrowing`, `services/reports/clientReportChecks.js`, whose comment says the
      same).]*
    - **(b) `SurveyTemplate.depsEver`**: every question-to-question dependency a survey has ever had, as
      question-key pairs. Survey structure, no personal data; it only ever keeps a follow-up off a client's
      map. Seeded by `migrate:client-report-visibility` (step 0), kept by survey create, edit and Duplicate.
      *[v6 2026-10-24, code review round 1 (LEGACY-1): beside it, `SurveyTemplate.depsEverFromVersion`, a
      version number — the oldest survey version that record is complete for (1 on create and Duplicate;
      the replaced version on the first questions edit that finds it missing; the current version when the
      migration seeds it). Survey structure again, no personal data. It drives the builder's warning
      (`conditionsUnknown`) and the migration's list of surveys with answers older than their record
      (gap 34(f)).]*
    - **(c) Per-link open counts.** `ClientReport.views`: per share link `{ opens, firstOpenedAt,
      lastOpenedAt }`, and apart from them the organization's own members by role (admins, leads, others)
      and Doorline staff. The report page pings once per report per browser per day, remembered by a
      `localStorage` marker holding the link's day and report ids. If the browser is signed in to
      Doorline, the page sends that session token, and the server resolves it with `requireAuth`'s checks
      (`resolveSessionUser`, no last-seen stamp) only to choose the bucket; it never grants or refuses
      anything. **No IP address, no device, and nothing identifying the link holder is stored.** Shown to
      the campaign's admins and leads ("Opened via Candidate: about 2 visits"). Lives on the report and is
      deleted with it, the campaign or the organization. **Owner ruling 2026-10-24: no policy sentence.**
      privacy.html `:97` already covers it: "we automatically collect … the pages or resources you request,
      and the date and time of your request". The same paragraph's "We use local storage on your device to
      keep you signed in" doesn't say *only*; the once-a-day marker is a second, non-identifying use of
      local storage on the report page. (The pre-upgrade `viewCount` counter also still moves on link
      opens: a counter, no new data; its label is a code-review item, PROPOSAL §P3.) *[v6 2026-10-24,
      code review round 1 (ADMINUX-12): no longer — opens don't move `viewCount` or `lastViewedAt` at all;
      both are frozen at their before-the-upgrade values, which the panel shows as "N views before
      per-link counts" (`recordReportOpen`, `services/reports/reportOpens.js`; pinned by
      `clientReportOpens.int.test.js`).]*
    - **(d) Wrong-password counts and times on each link.** `ReportShareLink.failedUnlockAt` (the times of
      up to 50 wrong passwords within the last 24 hours, each with a random id), `failedByDay` (counts per
      UTC day, the last 7), `failedUnlocksTotal` (lifetime), `lockedUntil` and `lastLockedAt`, plus
      History rows when a UTC day reaches 10 wrong passwords and at each lock. **Never the attempted
      password, an IP address or a user agent** (the per-IP limiter's in-memory counter is unchanged).
      Shown on the link panel to the campaign's admins and leads. Unlock now clears the 24-hour list,
      rotate and renew also clear the per-day counts, and the total lasts as long as the link (deleted with
      it, the campaign or the organization). Terms §6's "Anyone with an unrevoked, unexpired link (and its
      password) can view the report" is broader than the code during a lock, when a new device is refused
      until the oldest of the 50 is a day old or someone presses Unlock now or rotates: a risk disclosure,
      and the plan (§I, §O7) proposes no edit.
    - **(e) `passwordMeetsRule`**, a boolean on each link: true for every password set or generated under
      the 12-character rule; on an older link `null` until its next successful unlock, which records only
      whether the entered password's length met the rule (`notePasswordRule`, pinned to the hash it was
      checked against). The password is never stored; only its bcrypt hash, as before.
    - **(f) Keep me signed in on this device** (opt-in on the password screen): the share token lasts 30
      days instead of 24 hours and sits in the browser's `localStorage` instead of `sessionStorage`, on the
      client's own device. It ends at any credential change (password change, rotate, renew, disable: the
      token's `cv`), when the link expires, is deleted or the organization is suspended (the page drops it),
      and at **Sign out on this device**. Covered by privacy.html `:97`'s "We use local storage on your
      device to keep you signed in."
    - **(g) The Client Reports tab's History, customer-facing.** `CampaignChange` rows with source
      `client_report` (`services/reports/clientReportHistory.js`): report events (created, published,
      edited, numbers refreshed or discarded, taken down, put back up, deleted, switched to areas), team
      events (created, renamed, crews changed, ended) and link events (created, password changed, rotated,
      renewed, extended, disabled, enabled, wrong passwords, locked, unlocked, deleted), each naming who did
      it: a customer's admin or lead, or Doorline staff working under a support grant. **An edit row keeps
      the report's earlier title and notes** (operator-written text that can describe the campaign's
      voters) until an admin **Erases** it (one row, or every row of a report, including after the report
      is deleted, and optionally the same text in later drafts Next copied it into), or the campaign or
      organization is deleted (both cascades delete `CampaignChange`). Deleting a report keeps its History
      unless the admin ticks the erase option. **Readable by the organization's admins and by team leads
      on the campaign, who may be the client.** Link rows never hold the link's URL token, a password or its
      hash, an IP address or a user agent. The rows are kept out of the campaign's general History and the
      phone (`GET /admin/campaigns/:campaignId/history` filters them unless `?include=client_reports`). No
      policy edit; recorded here as customer-facing, with Erase. *[v6 2026-10-24, code review round 1
      (STATE-3): one more writer of the existing "deleted" row — ending a team with "delete its open
      drafts" now writes one per draft it actually deletes (only what is still a draft; a draft published
      meanwhile is left alone), naming who ended the team and the draft's period, as Delete does
      (`routes/admin/clientReports.js`). Same row shape, same readers, same Erase and cascades.]*
      *[v6 2026-10-24, code review round 2 (WALK-3): one new team event, **"Team continued"**
      (`clientReportSeries.continued`), written when an ended team is continued. It holds the team's label
      and its coordinators' user ids (`toValue: { label, coordinatorIds }`), exactly like the existing
      created and crews-changed rows; the "Team ended" and "Crews changed" rows now also carry the team's
      label as it read at the time. Operator data (a team name, which crew leads it covers), no canvasser
      beyond the crew-lead ids those rows already held. Same readers (the organization's admins and the
      campaign's leads), same cascades.]*
    - **(h) `OrgBranding`** (new collection): one logo per organization, stored as a fresh PNG the server
      writes from the upload's validated pixels (`services/branding/png.js`), so no metadata or other chunk
      of the uploaded file is kept; its size, and who changed it last. Admins write; it shows on the
      organization's client report pages and PDFs to anyone holding a link and its password. Deleted with
      the organization (`ORG_SCOPED`); it has no campaign.
    - **(i) Report series** (`ClientReportSeries`, new collection): each run of reports (whole campaign, a
      walk list, a team, a team on one walk list) with an operator-typed label and, for a team, the ids of
      the coordinators whose crews it covers, current and past. A team label containing a crew member's or
      coordinator's first or last name is refused, and a walk-list label that matches one needs the
      operator to confirm it names a place, so privacy.html `:101`'s "exclude … canvasser identities" holds
      for labels as for walk-list names before. A team report that one canvasser worked shows one person's
      work, without their identity; the builder warns. Deleted with the campaign and the organization.
    - **(j) [v6 2026-10-24, code review round 1 (PUBUX-4)] An in-process copy of each map payload.** The
      client map's pins and areas payloads are built once and kept gzipped in the web process's memory
      (`sendMapPayload` / `gzippedMapPayload`, `services/reports/clientReportMap.js`): door coordinates
      (rounded to six decimal places), door statuses, answer indexes into the served questions' options
      and the served questions' legend for a pins report; hexagon outlines, door counts by status and the
      area answer counts the area rule allows for an area report. **No street address** (a tapped door's
      address is still fetched per request and is not cached), no voter, no canvasser, no time, no id. It
      is exactly what the map endpoint already serves the link holder, built from the report's frozen
      rows, which stay in MongoDB as before. Held in that one process's memory only (the app writes it
      nowhere else: no file, no Redis, no database), to a byte budget (`CLIENT_REPORT_MAP_CACHE_MB`,
      default 64; `0` turns it off). An entry is served for at most 15 minutes after it was built; expiry is checked when an
      entry is asked for, so one nobody asks for again stays in memory until newer payloads push it out of
      the budget or the process restarts — never served in the meantime after a take-down, deletion, map
      switched off or question taken off, because every read passes the link's (or the admin route's)
      access checks and `checkMapRequest` before the cache is asked, and the cache key includes the live
      snapshot and the served questions. No new third party. Said out loud: it is a new, short-lived copy
      of already-stored map data, and a deleted report's map can sit unread in that memory until eviction
      or restart; no Privacy Policy, Terms or DPA sentence becomes false (DPA §9's deletion is an aim
      "within 30 days", and nothing here outlives a process restart). *[v6 2026-10-24, code review round 2
      (P-1) — the "stays in memory until newer payloads push it out or the process restarts" sentences
      above are superseded: a sweep every minute now drops every expired entry, asked for again or not,
      so no payload is held more than **at most about 16 minutes** after it was built (15-minute expiry,
      checked each minute; `sweepMapCache`, `services/reports/clientReportMap.js`). The sweep runs only
      while the cache holds something. `CLIENT_REPORT_MAP_CACHE_TTL_MS` / `…_SWEEP_MS` exist to shorten
      both times in tests; production uses the defaults. A deleted report's map can therefore sit unread
      in memory for at most about 16 minutes, never served.]*
    - **(k) [v6 2026-10-24, code review round 1 (LEGACY-1 ruling)] Old drafts' map rows go sooner.** Under the
      legacy fallback rule (gap 34(f)), a draft from before the upgrade — or any draft before its first
      build commits — has nothing live, so its old map rows are never served. The nightly
      `client-report-row-sweep` now counts such a report as map-off and deletes those rows
      (`services/reports/clientReportSweep.js`), and the migration's step 5 strips every answer from any
      it finds (`migrations/clientReportVisibility.js`). Retention only shrinks: rows that used to wait for
      the draft's first build to commit are deleted at the next nightly sweep.
    - **(l) [v6 2026-10-24, code review round 2 (CONCUR-2, P-3)] The builder's copy on the operator's own
      device.** The report builder keeps a change that hasn't reached the report in the operator's own
      browser (`localStorage`, one entry per report, `doorline.clientReport.unsentEdit.<reportId>`;
      `readUnsent`/`writeUnsent`, `client/src/components/clientReports/hooks.js`): since round 1, an
      unsent edit of a published report (and a draft change refused because someone published the report
      meanwhile); **since round 2 also a draft change that didn't save when leaving** — written before the
      unmount keepalive is sent, so a refused one is offered back. It holds the report's editable settings
      as the operator had them and as they started from (title, observation sections, which charts, map
      questions and voter groups show, the headline question, map and goal switches), so **it may include
      observation text** the operator wrote, which can describe a campaign's voters. It never holds a
      voter record, an answer, an address or a credential. It stays only in that browser until the
      operator restores it (it then goes to the server like any edit), discards it, cancels the edit, or
      the builder sees the change already landed and clears it; a newer copy replaces an older one, and a
      private window or blocked storage keeps nothing. **No server collection, no new third party**, and
      Doorline staff can't read it. privacy.html `:97` says "We use local storage on your device to keep
      you signed in"; like the report page's once-a-day marker under (c), this is another use of local
      storage that sentence doesn't exclude (it doesn't say *only*): the operator's own device, holding the
      operator's own unsaved work. No policy sentence becomes false; an owner refinement could mention it.
      *[v7 2026-10-25 — one more operator-device entry, beside this copy: the Client Reports page's **How
      it works** guide remembers **Got it** per person in the operator's own browser,
      `localStorage['doorline.clientReports.howItWorks.<userId>'] = '1'` (`howItWorksKey`,
      `client/src/components/clientReports/HowItWorks.jsx`). A UI flag, no personal data beyond the
      operator's own user id in the key; How it works deletes it, a private window or blocked storage keeps
      nothing (the guide just shows again). No server collection, no third party; the same `:97` reading as
      above.]*
    - **(m) [v7 2026-10-25 — links to one report (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D, built 2026-10-25,
      committed 07a296a; stamp the deploy date here when it ships). Narrows what a link holder reaches;
      collects nothing new.]** A share link can now open
      one report instead of every published report of its campaign: `ReportShareLink.reportId`
      (`models/ReportShareLink.js`, null or missing = all reports, as every link made before), set when
      the link is made and never changed, and only for a report the client can see then (published, not
      taken down: `409 REPORT_NOT_SHOWN` otherwise, `routes/admin/clientReportShares.js`). **What it
      reaches:** that report only — its page, its map, its tapped doors, its areas and its open count —
      and a hub that lists just it (`single`, `gone`). `loadReport` (`routes/public/share.js`) refuses
      any other report's id with the same `404 REPORT_NOT_FOUND` a taken-down report gets, before its
      query, for every route behind it; the hub filters `{ …reportScope, $and: [{ _id: <its report> }] }`,
      so no key of the scope can be overwritten (both failure modes of an `_id` inside `reportScope` were
      reproduced in the plan's review and are closed). Its page has no Older/Newer (`nav: null`) and no
      way to the other reports, and **its earlier-totals line names no other report**: "Totals from before
      Oct 19 were updated by −120 doors after they were first reported." (`earlierTotalsLine` with
      `oneReport`, `services/reports/clientReportRead.js`; the same counts, without the other report's
      period). **Deleting the report deletes its one-report links** (`DELETE /admin/client-reports/:id`),
      each with a History row read as "<label> · Link deleted" with "Deleted with its report" under it (`reportLink.deleted`, `toValue:
      { label, reportDeleted: true }`), and a link being made while its report is deleted deletes itself
      the same way; the demo reset deletes the demo campaign's one-report links and never adopts one as the
      demo link (`ensureShareLink` queries `reportId: null`). Campaign and organization deletion already
      delete every link. Each link keeps its own password, expiry, lock, sign-in tokens and open counts, as
      every link did. Readers of the share rows (the campaign's admins and leads) now see which report a
      link opens (its dates and its tab's name). Pinned by `clientReportSingleLinks.int.test.js`; a link to
      all reports renders byte for byte as before (`publicReportAllLinks.snapshot.json`).
    - **What reaches a link holder is otherwise less than before**: a door's street line only when tapped
      (`…/map/doors`, at most 200 per request, from the live snapshot only), coordinates rounded to six
      decimal places (about 4 in, still exact for a house), no internal ids or keys, and dates as civil
      dates (the report's own id, an ObjectId, carries the draft's creation time, not the numbers'
      cut-off). The "earlier totals were updated" line tells the client that earlier numbers moved, never
      why. *[v6 2026-10-24, code review round 2 (PRIV-2) — "no internal ids or keys" was not true of the
      sign-in token itself, whose payload any holder can read: it carried the link's and the campaign's
      ObjectIds, each with a creation time. Now: new share sign-in tokens are `{ kind, link, cv, iat, exp }`,
      where `link` is an HMAC-SHA256 of the link's id under the server's secret (`shareLinkKey`,
      `services/auth/tokens.js`; checked by `requireShareAccess` through `shareTokenNamesLink`,
      `routes/public/share.js`), with no ObjectId and no campaign id. Tokens issued before named the link
      and the campaign by ObjectId; they keep working on the old check until they expire (24 hours, or 30
      days with Keep me signed in), so for up to 30 days after the deploy a device signed in earlier still
      holds one.]*
    - **No new subprocessor.** H3 runs inside our server (`h3-js`), the logo is stored in our MongoDB, area
      hexagons are drawn on the Mapbox tiles the map already loads, and Mapbox's Static Images API is not
      used. DPA §6 is unchanged and no customer notice is due.
    - **Policy text.** No Privacy Policy, Terms or DPA sentence becomes false. privacy.html `:101`'s link
      sentence ("90 days by default, or a period of up to one year chosen by an administrator"; "a password
      can never be removed") is kept true by `SHARE_LINK_DEFAULT_DAYS` = 90 and the one-year lifetime cap
      (`services/reports/shareLinks.js`); leads may choose expiry too, under the owner's 2026-10-23 reading
      that "administrator" covers them. **The demo organization's link follows the same one-year life**
      (`ensureShareLink`, `services/platform/seedDemoOrg.js`): a demo reset moves its expiry out to 90 days,
      never shorter and never past the year, and once less than 90 days of the year remain it renews the link
      as the panel's Renew does (a new token unless `SEED_DEMO_SHARE_TOKEN` pins it, a new life, the
      credential version bumped, the failure budget cleared); its password's `passwordMeetsRule` comes from
      the password's length, so a short `SEED_DEMO_SHARE_PASSWORD` is flagged, never claimed to meet the rule.
      *[v6 2026-10-24, code review round 1 — re-checked after its fixes (stamps on (b), (c), (g), new (j)
      and (k), and gap 34(d) and (f)): still **no Privacy Policy, Terms or DPA sentence becomes false**, and
      still no new subprocessor (the map payload cache is in our own web process; DPA §6 unchanged, no
      customer notice). The round's other fixes narrow exposure rather than widen it: the series picker no
      longer reads another organization's crew names (SEC-1 — a cross-tenant read in the new, never-deployed
      picker, refused now with a 404), a draft's auto-save can no longer put
      half-written text in front of a client (ADMINUX-2), and an old report's follow-up can no longer
      reach the map through a swapped survey (LEGACY-1). privacy.html `:101`'s "shown at the address
      level" remark under (a) is unchanged.]*
      *[v6 2026-10-24, code review round 2 — re-checked after its fixes (stamps on (g), (j), the link-holder
      bullet, new (l), and gap 34(f)): still **no Privacy Policy, Terms or DPA sentence becomes false**, and
      still no new subprocessor (DPA §6 unchanged, no customer notice). Two fixes narrow exposure: the share
      sign-in token no longer carries ObjectIds (PRIV-2), and the map cache holds nothing much past 16
      minutes (P-1). Versioned edits (contract C8) close the path by which a stale builder screen could put a
      hidden chart, a deleted observation section or a removed map question back in front of a client
      (PRIV-1, CONCUR-1). The one widening is (l): the builder's on-device copy now also holds a draft change
      that didn't save on the way out, in the operator's own browser only. privacy.html `:97` and `:101` and
      Terms §6 still hold.]*
      *[v7 2026-10-25 — the simplify follow-up (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md; new (m), stamps on (a)
      and (l)) re-checked: still **no Privacy Policy, Terms or DPA sentence becomes false**, and **no new
      subprocessor** (DPA §6 unchanged, no customer notice). privacy.html `:101` ("a report … at a unique
      link", "protected by a password and expire automatically — after 90 days by default, or a period of
      up to one year chosen by an administrator", "a password can never be removed", "may revoke a link at
      any time") holds for a link to one report exactly as for one to all reports: Share's **Make a link**
      always generates a password and offers 30–365 days (90 by default), and New link keeps its usual
      rules. terms.html `:118` ("Anyone with an unrevoked, unexpired link (and its password) can view the
      report") holds; a one-report link views less. Nothing new is collected: the organization's report
      week (`Organization.reportWeekStartsOn`, a weekday), a yes/no about whether the campaign had a knock
      before this week (`knockedBeforeThisWeek`, computed, not stored), the duplicate guard's flag
      (`ClientReport.dupGuard`), and the race answer's `createdByName`, a teammate's name shown to another
      operator of the same organization, which History already shows. The guide's flag is under (l).]*
    - **Watchlist:** the 2026-10-24 client-reports bullet in *New policy sentences to keep true*.
39. **[v6 2026-10-24 — Automatic pause: Doorline pauses a canvasser's recording when their doors come in
    faster than anyone could knock them. BUILT 2026-10-24, uncommitted; deploy pending, and it acts only once
    the `PACE_PAUSE` config var is set (stamp both dates here when they happen). Privacy-affecting — the first
    automated adverse action about a named worker, a new stored machine verdict, more of the action-time GPS
    stamps kept when a door is re-saved, and a new email — but no new subprocessor, and no published Privacy
    Policy, Terms or DPA sentence becomes false.]** Plan, the owner's decisions 1–19 and both review rounds:
    [PROPOSAL_PACE_PAUSE.md](PROPOSAL_PACE_PAUSE.md); doc of record [AUDIT.md](AUDIT.md) → *Automatic pause*
    and §G. Everything below was read from the code. *[v6 2026-10-25: server deployed 2026-10-25 (`d1d12ac`);
    `PACE_PAUSE` not yet on for customers (it was set to the internal demo for the device check); the
    in-product preview removed (stamped at (e)).]*
    - **(a) The pause, and the record of it.** When 8 of any 20 judged visits in a canvasser's day came in
      faster than anyone could get there and knock, `runPaceCheck` (`services/audit/pacePause.js`) writes a
      `PacePause` (new collection, `models/PacePause.js`), and the mobile write routes refuse that canvasser's
      fresh door writes (`403 PACE_PAUSED`) until a person on their team unpauses them. It is the product's
      **first automated adverse action about a named worker** — recording stops; nothing is removed, hidden or
      re-counted, and no reader of `PacePause` changes a count, export, report, bill or FbTime (decision 2) —
      and its **first stored machine verdict** (the GPS-audit flags are computed live and never stored,
      H16(c)). Stored: the organization, campaign and canvasser ids; when it fired; the tipping row's id and
      time; the campaign day and time zone; the rule's numbers in force; the window of judged visits (each:
      row, household and campaign ids, the result, its time, the previous door's household, campaign, result
      and time, seconds, meters, the seconds the rule needed, the verdict, a pattern label, the survey check);
      the alert's outcome as counts (sent, failed, when); and who resolved it, when and how. **No coordinates,
      no addresses, no email addresses, no names and no free text** — addresses and names are read live when a
      review opens, through the existing readers (`hydrateCanvassers`, org-scoped).
    - **(b) `CanvassActivity.replaced.history`**: the earlier saves at the same door by the same canvasser in
      the same round, up to 20 — each save's time, GPS stamp (lat, lng, accuracy), result, server receive time
      and offline flag. "Latest wins" deletes the earlier row before the new one is written; its `replaced`
      snapshot already kept the last of them ([AUDIT.md](AUDIT.md) §B.5), and now keeps the rest too, so a
      visit can't be erased by saving the door again (C10, stamped). Built on the server from the pre-delete
      row, never accepted from a request. Same row, same readers, same retention as the row (the campaign, the
      organization, an unknock's frozen copy). Action-time stamps only: nothing new is captured.
    - **(c) `Membership.paceRestartAt` and `Organization.pacePause`**: a date per member (when their count last
      restarted — on an unpause, the org turning it off, the console rollback, or a role change), and the
      organization's setting (on or off, whether billing admins get the alert, the chosen recipients' user ids,
      when it was last turned on, who changed it and when). Each lives and goes with its document.
    - **(d) Who can see it.** Org admins: every pause. Team leads: pauses on the campaigns they manage, with
      another campaign's doors redacted to their time and verdict (no address, result, campaign or distance;
      and a hop whose other end is hidden keeps only its seconds and verdict, so two hops can't locate the
      door). A lead also learns, through a **roster line**, that a canvasser on their roster is blocked by a
      pause on a campaign they don't manage — the name only, nothing about the other campaign: the one fact
      `memberships.js` otherwise withholds, disclosed because that canvasser can't work the lead's campaign
      either. *[v7 2026-10-25: "the one fact" is the pause. `memberships.js` does give a lead the NAMES of a
      shared canvasser's other campaigns, for the switch-off warning (`/crews`, item 40), and nothing else
      about them.]* A lead may be the client ([ROLES.md](ROLES.md)). The paused canvasser sees only that they are
      paused, never the evidence. Doorline staff: under a support grant, like any of the organization's pages
      (E12, stamped).
    - **(e) The preview** (org admins, in the product): every moment, over up to 120 days, when the rule would
      have paused someone on a campaign, with names, days, doors and addresses — a re-reading of the
      organization's own ledger and unknock copies; nothing is stored. The console replay
      (`npm run replay:pace-pause`, Run console) prints **counts only** per customer organization — no name, id,
      address or coordinate, a count under 3 as *fewer than 3* — and skips internal and deleting orgs.
      *[v6 2026-10-25: **the in-product preview is removed** (owner, after go-live): `GET /admin/pace-pauses/preview`
      and its Audit-page panel are gone, so no screen lists would-be pauses with names and addresses any more.
      Exposure only shrinks. The console replay above is unchanged.]*
    - **(f) The alert email** (`pacePauseAlert`): one per recipient; a neutral subject (*A canvasser was paused
      for review*); a body naming the campaign, the organization, the day and the time, **no person and no
      address**, and a link behind sign-in. So Resend receives no more than privacy.html `:106` says (the
      recipient's name and email address): the address, and the organization and campaign names any
      organization notice carries. EmailLog: one
      row per recipient with `meta.userId`, scrubbed by account at deletion like the personal sends; the
      billing-contact fallback carries no account and keeps its address for EmailLog's 365 days, as the existing
      billing notices do; rows outlive organization deletion as today (stamped at the EmailLog entry).
    - **(g) Retention.** Deleted with its campaign (`deleteCampaign.js` `CAMPAIGN_SCOPED`) and its organization
      (`deleteOrganization.js` `ORG_SCOPED`), and in `LATE_WRITE_MODELS`. It **survives account deletion**, like
      door rows and `FlagReview`, for fraud attribution: `deleteAccount.js` counts the organizations holding a
      pause about the person among those that attribute their work, so their name shows on it for the
      DeletedUserRecord window (stamped at A4). An org admin may delete a **resolved** pause (decision 17); an
      open one lifts only by Unpause. No TTL.
    - **(h) What the canvasser is told — narrowed (H16(c), stamped).** Their Help Center now says their doors
      are checked for pace and that only a person on their team can lift a pause (`faq/why-is-recording-paused.md`,
      audience canvasser), and the phone's banner and alert say so. They are still not told about the far,
      rapid, one-spot and weak-GPS flags or the review records, and the article states no numbers.
    - **(i) No new subprocessor.** The email goes through Resend, already listed (DPA §6, privacy.html `:106`);
      nothing else leaves our servers. No DPA §6 notice event. The owner tells both customer organizations about
      the feature itself (decision 16; PROPOSAL §J) — a courtesy, not a §6 notice.
    - **(j) Claims checked, each against its line** (privacy.html, terms.html, delete-account.html and DPA.md
      are unchanged in this tree; lines at `aa01027`):
      - privacy.html `:90` (canvassing activity: "Authorized administrators within the same organization may
        review this activity. We use it to operate the canvass and to provide reporting") — a pause is the
        organization's own people reviewing canvassing activity, and stopping a recording is operating the
        canvass. **Silent, not false:** it doesn't say location stamps may automatically pause a canvasser's
        recording pending a person's review (decision 19).
      - `:94` (location only when an action is recorded; never continuous or in the background) — true: the
        rule reads only the stamps taken at recorded actions. A 10-second trail was considered and dropped for
        this sentence's sake; `replaced.history` keeps more of the same action-time stamps and adds none.
      - `:101` (published reports exclude canvasser identities and action timestamps) — untouched: nothing of a
        pause reaches a report.
      - `:105` (available within your organization by role; never to other customer organizations) — true:
        every lookup filters `organizationId`, and leads are walled per campaign (d).
      - `:106` (service providers; Resend receives the recipient's name and email address) — true (f).
      - `:112` (staff open customer data only under a grant) — true: the routes sit behind `orgContext`, and the
        console replay prints counts only.
      - `:122` (organization deletion removes canvassing records) — `PacePause` is in `ORG_SCOPED`.
      - `:127` (email, phone and password removed at account deletion) — `PacePause` holds none of them.
      - `:128` (field records stay with the organization; the name for 180 days; "Administrative records
        reflecting actions you took in a supervisory role … are likewise retained") — a pause about a person
        stays like their door records and `FlagReview`; the unpausing admin's or lead's `resolvedBy` is a
        supervisory action record, covered by the last sentence. **Silent, not false:** it doesn't mention that a
        review of a person's work, such as a pause record, stays (decision 19).
      - `:133` (rights requests) and `:137` (decline location and you can't record canvass actions) — unchanged;
        a paused canvasser can't record either, which `:137` doesn't list and doesn't deny.
      - `:143` (material changes communicated) — the Policy doesn't change.
      - delete-account.html `:100`–`101` and the in-app deletion sheet's summary (`retained.summary`,
        `GET /auth/account/deletion-check` in `routes/auth.js`) — the same reading as `:128`.
      - terms.html `:98` (the customer gives its workers any legally required notice about location collection)
        — still the customer's duty; Doorline's own in-app telling (h) adds to it. §13 (suspension and
        termination of the Service) isn't engaged — a pause stops one canvasser's recording, not the Service —
        and §15 (changes to the Terms) has nothing to do.
      - DPA §2 — on by default rests on the customer's "use and configuration of the Service's features" (the
        Off switch on the Users page is that configuration; *[v7 2026-10-27, item 42: the same switch, under the
        same billing-admin gate, now on the org Settings page]*) plus the owner's notice to both customers; §6 — no
        new subprocessor (i); §7 — a pause sits in the organization's records like its door rows, reachable by
        the same deletion paths (the campaign, the organization; an admin's delete of a resolved one); §9 —
        retention follows the campaign and the organization, and the account-deletion name window applies.
    - **(k) Owner ruling (decision 19, 2026-10-24): no wording change.** On file with its reasons: on the two
      points marked *silent, not false* above, the published text is silent rather than false — the pause is a
      use of location stamps under "to operate the canvass" (`:90`) and the customer's "use and configuration of
      the Service's features" (DPA §2), and a pause record staying after account deletion is the same silence
      `FlagReview` has today (H16(c)). This work touches none of privacy.html, terms.html, delete-account.html
      or DPA.md.
    - **Pinned by** `server/test/paceRule.test.js` (25), `pacePause.int.test.js` (18),
      `replayPacePause.int.test.js` (2) and `resolveOpenPacePauses.int.test.js` (2); on the clients
      `client/src/lib/pacePause.test.js` (2), `pacePauseRender.smoke.test.js` (5), `mobile/lib/pace.test.js` (7)
      and `mobile/lib/pacePauseText.test.js` (2).
    - **Watchlist:** the 2026-10-24 automatic-pause bullet in *New policy sentences to keep true*.
40. **[v7 2026-10-25 — A team lead's view of a person reached that person's work on campaigns the lead
    doesn't manage. FIXED 2026-10-25, shipped alone ahead of the people-pages plan; deploy pending (stamp
    the deploy date here when it ships).]**
    - **Found** while planning the people-pages upgrade (review round 1, 2026-10-25) and reproduced over
      HTTP on a throwaway mongod: a lead granted Campaign A, and a canvasser who works both A and B.
    - **The exposure.** The per-person drills on `/admin/memberships` check *who* a lead may look at
      (`leadMaySeeTarget`: anyone rostered on a campaign the lead manages), but what they returned was
      org-wide:
      - `GET /:userId/recent-activity`: that person's latest doors on **every** campaign in the
        organization, with each door's street address, city, outcome, time and campaign name;
      - `GET /:userId/stats`: their totals across every campaign (doors, surveys, lit drops, miles,
        campaigns worked, last activity);
      - `GET /:userId/crews`: every campaign they are on, with the coordinator's name and whether the
        campaign is live;
      - `GET /:userId/campaigns`: the ids of every campaign they are on, the set `GET /` already cuts for
        a lead;
      - `GET /` (the Users list): each listed lead's `managedCampaignIds`, so a lead learned which other
        campaigns a fellow lead runs.

      A lead may be the paying client (owner ruling 2026-09-23), and one organization can run several
      clients' campaigns with the same canvassers. So a client could see another client's door
      addresses and campaign names.
    - **It was on screen, not only in the API.** The read drills opened to leads on 2026-07-23
      (`5a4a335`). From 2026-08-09 (`fca1cf4`) the phone's member sheet links a lead to **Manage
      profile ›**, which loads `/stats` and `/recent-activity?limit=20` for any viewer and lists each
      door as `address, city · campaign` (`users/[id].jsx`). The web never showed it to a lead: the org
      Users page is admin-only.
    - **Published text that was untrue for this data until the fix deploys:**
      - privacy.html `:105`: information is available to authorized users "according to their role";
        a lead's role covers the campaigns granted to them;
      - Help Center `guides/roles-and-team.md:38`: a lead can't "see any campaign you didn't hand them";
      - Help Center `getting-started/lead-getting-started.md:14`: "Outside them you see almost nothing."

      Tenant isolation (privacy.html `:105` "other customer organizations", `:115`, DPA §4) was not
      broken: every row stayed inside the reader's own organization.
    - **The fix** (`server/src/routes/admin/memberships.js`, `leadCampaignScope`). For a lead, every
      drill now returns only the campaigns the lead manages; admins and Doorline staff are unchanged:
      - `/stats` and `/recent-activity` add `campaignId: { $in: <managed> }` to the ledger queries, so
        the totals, the miles and the door list stop at the lead's campaigns;
      - `/crews` keeps every campaign's **name** (the switch-off warning has to say which campaigns an
        org-wide switch reaches, the disclosure ruled with `1a4d855`, 2026-07-21) and nulls the
        coordinator and the live flag on the rest;
      - `/campaigns` returns managed campaigns only;
      - `GET /` narrows each row's `managedCampaignIds` to the reader's own grants.

      The gates are unchanged (who a lead may open), so a lead with no grants still gets 403, and the
      response shapes are unchanged, so released phones keep working: a lead simply sees smaller
      numbers. On released phones those numbers still sit under "Activity (lifetime)" until the people-
      pages update relabels them for leads. *[v7 2026-10-27: that update (item 42) labels them **On your
      campaigns** for a lead and leaves out miles walked; it ships over the air.]*
    - **Pinned by** `test/leadUserManagement.int.test.js`, test 11: for one canvasser on two campaigns,
      the admin gets all five doors, three surveys and both campaigns from every drill, and the lead gets
      Camp A's two doors and one survey, no Camp B address or campaign name, Camp B's crew row with its
      name only, `/campaigns` = Camp A, and a fellow lead's Camp B grant hidden. Against the unfixed code
      the same test fails (the lead got all five doors). Seven related suites (leads, the lead
      walkthrough, not-a-target, crews, both deletion suites; 126 tests) stay green.
    - **No policy, Terms or DPA text change:** the fix makes the sentences above true as written, with
      one exception that predates this item and is ruled: a lead still sees the NAMES of a shared
      canvasser's other campaigns in the switch-off warning (`1a4d855`, 2026-07-21). The Help Center line
      in `roles-and-team.md:38` now says so.
    - **The record of use** has the same limits as item 35:
      - `AccessLog` covers staff access only;
      - production's request log (`morgan('combined')`, `app.js:86`) records each request's path, which
        carries the person's id, plus its status and IP address, but not who made the request;
      - those lines survive only as far back as Heroku's log retention, or any log drain if one exists.

      Unlike item 35, this was visible on an ordinary phone screen, so a lead who opened a shared
      canvasser's profile saw it.
    - **Owner decision (2026-10-25):** no DPA §5 notice. Asked with the difference from item 35 spelled
      out (visible in normal use since 2026-08-09, not only reachable through the API), the owner chose
      no notice. The record limits above stand.
    - **Watchlist:** the 2026-10-25 bullet in *New policy sentences to keep true*.
41. **[v7 2026-10-25 — On a campaign, a team lead could put an organization member on their team and
    read back their email and phone, and could remove anyone from the team, admins and Doorline staff
    included. FIXED 2026-10-25 in the same ship-alone patch as item 40; deploy pending (stamp the deploy
    date here when it ships).]**
    - **Found** by the people-pages plan's review rounds 2 and 3 (2026-10-25) and reproduced over HTTP on a
      throwaway mongod, as a lead who manages one campaign.
    - **Putting someone on the team, three ways.** `GET .../assignments` returns each team member's name,
      email and phone to a lead, so whoever a lead can put on the team, they can read:
      - **by id**: `POST /admin/campaigns/:id/assignments` checked only that each id was an active member of
        the organization, so a lead could add anyone, including another client's staff. A request mixing a
        real member's id with a made-up one answered 400 naming only the made-up id, so it also told the
        caller who is a member;
      - **by book**: `partitionAssignable` (book assignment, bulk assignment) let anyone give a book to any
        active org admin or any lead granted on this campaign who wasn't on the team, and that rostered
        them;
      - **by walk-list crew**: the same check on `POST .../efforts/:id/members`, whose crew list then
        showed the person's email.

      User ids are not secrets (item 35), and the crew endpoint already gives a lead the ids and names of
      every admin and lead in the organization, as the coordinator picker. Leads never browse the directory
      by design ([ROLES.md](ROLES.md); the 2026-08-08 rescoping). Adding by email goes through a lookup that
      names the person (`POST .../crew/resolve`), limited to 30 an hour per person (in memory, per dyno);
      the add itself is not limited, and neither is recorded for a customer's own staff (`AccessLog` covers
      support-grant access only). *[v7 2026-10-27: since item 42, two counts per person: 60 an hour for
      lookups that find nobody, 30 for lookups that name somebody (owner ruling); the phone's add now goes
      through the lookup too.]* No screen did any of the three: every lead picker lists only the team
      plus the lead, and every lead call site in the apps adds by id only the lead themself.
    - **The remove.** `DELETE /admin/campaigns/:id/assignments/:userId` had no rule on the target: a lead
      could take an org admin, a fellow lead or a Doorline staff account off a shared campaign, which also
      clears the crew of everyone that person coordinates there (`releaseAssignedWork`). **This was on
      screen**: since `208c08b` (2026-07-12) the web Team panel offered every viewer, leads included,
      **Remove from campaign** for anyone, and the Campaigns page's Assignments window offered **Unassign**
      on every team row a lead sees. A removal writes no record, so whether a lead ever did it can't be
      read from anything.
    - **Published text** that was untrue for this until the fix deploys: privacy.html `:105` ("according to
      their role"); Help Center `faq/team-lead-vs-admin.md:29` (a lead "can't touch admins or fellow leads at
      all — the server refuses, not just the app") and `guides/roles-and-team.md:38` ("admins and fellow
      leads are entirely out of their reach"). Both Help lines now name the walls exactly. A lead still sets
      the crew of anyone on their campaign's team, which is how crews are organized. Tenant isolation was
      not broken; every row stayed inside the reader's own organization.
    - **The fix**, by owner rulings 2026-10-25:
      - **by id** (`assignments.js`): a lead's request may name only the lead themself, so self-assigning a
        book keeps working. Any other id is refused with one plain-message 403, given before the membership
        check, so the answer is the same for a member and a made-up id. This narrows the 2026-08-08 ruling
        never to role-filter this route, whose reason was the lead's self-assign;
      - **by book or crew** (`partitionAssignable`'s new `selfOnlyFor`, passed by `turfAssignments.js`,
        `turfs.js` and `efforts.js` as the caller's id when the caller is a lead): the off-the-team
        exceptions cover only the lead themself; people already on the team are unaffected, and an org
        admin calling is exactly as before;
      - **remove** (`assignments.js`): a lead may remove canvassers, people with no membership here any
        more, and themselves; an org admin, another lead or a Doorline staff account on the team is refused
        with a plain-message 403. Someone the organization and campaign don't have answers like a made-up
        id, so the answer never confirms an id is staff;
      - **web**: the Team page's panel and the Assignments window stop offering a lead what the server now
        refuses, and the window refreshes its list after a removal. The phone already offered neither.

      Org admins and staff are unchanged.
    - **Pinned by**:
      - `test/leadUserManagement.int.test.js` test 12: a lead's add of another member, of a made-up id, or of
        a mix with their own id is refused, the first two with identical answers, and nothing is written;
        their self-add answers 201; their removal of an admin, a fellow lead or a staff account on the team
        is refused and leaves the row; a staff account elsewhere answers exactly like a made-up id; their
        removal of a canvasser and of themselves answers 200; an admin still adds and removes anyone;
      - `test/partitionAssignable.int.test.js`: with `selfOnlyFor`, the lead and the team are assignable and
        an off-team admin and co-lead are not; without it, everyone as before;
      - `test/leadWalkthrough.int.test.js`: step 4, the lead's book and walk-list-crew assignment of the
        off-team admin is refused with `not-on-team` and rosters no one; step 5, the lead adds an existing
        canvasser by email and the same add by id is refused.

      Against the unfixed code each of these fails (the lead's add of another member, and the book for the
      off-team admin, answered 201).
    - **No policy, Terms or DPA text change:** the fix makes the sentences above true as written.
    - **The record of use** has item 35's limits: `AccessLog` covers staff only; production's request log
      (`morgan('combined')`, `app.js:86`) keeps each request's path, status and IP address but not who made
      it, and only as far back as Heroku's log retention. The three ways onto the team took a hand-made API
      call. The remove did not: it was on screen.
    - **Owner decisions (2026-10-25):** no DPA §5 notice for putting someone on the team (found by review;
      reachable only through the API), as with item 35. Asked again for the remove with the corrected facts
      above (on screen since 2026-07-12; no record of removals exists), the owner chose no notice for that
      too. The record limits above stand.
    - **Watchlist:** the tenant-isolation bullet's 2026-10-25 line in *New policy sentences to keep true*.
42. **[v7 2026-10-27 — The people pages: an org Settings page, one person panel for the Users and Team
    pages, a rebuilt Team page (filters, several people at once, adding with a crew) and the phone to
    match; and coming back to a campaign moves the person's earlier doors there. BUILT 2026-10-27,
    uncommitted; deploy pending (stamp the date here when it ships). Privacy-affecting in one small way: a
    control loosens (the email lookup's hourly limit, by owner decision), and the record corrects a false
    sentence. No new field about a person, no retention change, no new subprocessor, no new export, report
    or share link, and no published Privacy Policy, Terms or DPA sentence becomes false.]** Plan, owner
    rulings and six review rounds: [PROPOSAL_PEOPLE_PAGES.md](PROPOSAL_PEOPLE_PAGES.md) (§K is this item's
    source). Everything below was read from the code.
    - **(a) The lookup limit loosens (owner ruling 2026-10-26).** `POST /admin/campaigns/:id/crew/resolve`
      counted every lookup toward 30 an hour per actor. It now keeps two counts
      (`middleware/crewResolveLimit.js`): **60 an hour for lookups that find nobody** (`outside`) and **30 an
      hour for lookups that name somebody**. Once either is spent every lookup waits, so a refusal can't say
      which kind a lookup was. The cost: an address can be tried against the `outside` answer 60 times an
      hour instead of 30. That answer is byte-identical whether or not the address has an account elsewhere,
      and the membership query now runs either way (`resolveEmailInOrg`), which narrows the small timing
      difference the code names. The phone's **Add a canvasser** now goes through the lookup too, so phone
      adds are limited for the first time. In memory, per dyno, as before.
    - **(b) Correction: lookups were never written to `AccessLog` for a customer's own staff.** ROLES.md, the
      2026-08-08 stamp under EXCEPTION 3 and three code comments (`crewResolveLimit.js`, `createMember.js`,
      `leadCrew.js`) said every answer that names somebody writes an `AccessLog` subject line. The route does
      add the person to the record-level audit subjects, but `AccessLog` keeps those only for Doorline staff
      working under a support grant (`middleware/accessLog.js`), as item 41 already said. All five now say
      so. No published sentence depended on it (privacy.html `:112` describes staff access only).
    - **(c) What a lookup tells.** A named answer (`in-org`, `in-org-inactive`, `on-campaign`) now also
      carries `history`: the person's door count on this campaign and the teams those count for, each with
      whether its coordinator can still lead — this campaign only, about someone the organization already
      shows the viewer, and the same counts the campaign's Team page and Timeline show. `in-org-inactive`
      adds `onCampaign`. An `outside` answer carries nothing more. The add's can't-be-your-own-coordinator
      check runs only for named answers: for an `outside` address it would have answered for the account
      behind it.
    - **(d) Several people at once, with no new reach.** `POST …/crew/coordinator-bulk/preview` and `PATCH
      …/crew/coordinator-bulk` do what the one-person crew routes do, for up to 500 people (10 per write).
      For a team lead, an id not on this campaign's roster answers `{ skip: 'not-on-campaign' }` with no name
      or counts, the same for a member and a made-up id, checked before anything else; only an org admin's
      preview names someone off the roster, and the write never puts anyone on a campaign (adding is
      `POST …/assignments`, which checks the membership; a stale list can't undo a removal). The Team page's
      bulk **Resend invites** and **Remove from campaign** call the existing single routes, one person at a
      time, under their existing rules (item 41's for a lead).
    - **(e) Coming back moves doors (owner ruling 2026-10-26, "the doors follow the person").** Adding
      someone back to a campaign — by email, from the organization, or an admin or lead joining it through
      a book — moves their earlier doors on that campaign to the crew they join, or to No team. It changes
      which of the organization's own teams a door counts for; nothing leaves the organization, and the
      campaign's totals, coverage and bill don't move. Each move is a `CoordinatorChange` (source
      `campaign_join`) on the campaign's History, like a crew change.
    - **(f) The Settings page** (org admins) names the organization's own admins and leads, which the Users
      page already shows them, and now also a stored alert recipient who is no longer an admin or lead
      (`chosen` on `GET /admin/pace-pauses/settings`, named through the org-scoped `hydrateCanvassers`, the
      reader every report uses), so a billing admin can drop them. That entry used to be invisible and made
      every Save fail.
    - **(g) Unchanged.** The person panel shows what the old profile and the Team page's member panel showed,
      to the same viewers: a lead never gets Role, Remove from org, Delete account or the organization-wide
      section, and on the Team page their panel reads only that campaign's doors (item 40). The Paused badge
      and filter come from the lead-scoped pause list (item 39(d)). `lastSeenAt` stays super-admin-only. No
      new email: the automatic-pause alert's last line now names the Settings page.
    - **(h) Retention, kept true.** A crew change still running when an organization's or campaign's delete
      cascade removes its roster row loses its hold and writes its record (ids and counts, no name). That
      record is now swept with the tenant: `CoordinatorChange` is in `LATE_WRITE_MODELS`, and the job runs
      inside `sweptAfter` (`services/platform/lateWriteSweep.js`), so privacy.html `:122` (deletion removes
      the organization's canvassing records) holds. Found by the build's code review, before anything
      shipped: crew jobs are new in this build.
    - **(i) Claims checked:** privacy.html `:105` ("according to their role"; never other customer
      organizations) — true: every new route sits behind `requireCampaignManager` or `requireAdminRole`,
      filters by `organizationId`, and (d) keeps a lead to their campaign's roster. `:115` (access controls
      by organization) and DPA §4 (tenant isolation) — true. `:106` and DPA §6 — no new subprocessor; no
      DPA §6 notice event. Nothing in the Policy, the Terms or the DPA speaks to lookup limits or to which of
      an organization's teams a door counts for.
    - **Owner decisions:** the limits (N.1.21) and the return rule (N.1.19), both 2026-10-26. Nothing was
      exposed, so no DPA §5 question arises.
    - **Pinned by** `server/test/crewResolve.int.test.js` (6: both limits, a mistyped address, the
      identical `outside` body, `history`, `onCampaign`), `crewJob.int.test.js` (23, including the lead's
      `not-on-campaign` skip and the named-only coordinator check), `crewJobEdges.int.test.js` (18, including
      a bulk write that never puts anyone on a team, the preview's `deleted` and `switched-off` skips, and a
      crew record swept with an organization being deleted), `crewJobCrash.int.test.js` (6),
      `crewConsoleTools.int.test.js` (2) and `peoplePagesUnits.test.js` (2); on the clients
      `client/src/lib/rosterView.test.js`, `rosterView.parity.test.js` and `mobile/lib/rosterView.test.js`.
    - **Watchlist:** the tenant-isolation bullet's 2026-10-27 line (item 41's sub-bullet) in *New policy
      sentences to keep true*.

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
staff, because there the operator chooses the secret and could then impersonate the customer's user.]*

*[v4 2026-07-29 (later the same day): **the previous stamp's `VENDOR_READ_ONLY` sentence is SUPERSEDED by owner decision.**
The blanket write-block on team management is REMOVED: under a support grant, staff may now administer a customer's
users — create accounts, set temporary passwords, resend invites, change roles, deactivate — and every such write is
recorded in `AccessLog` by the existing middleware, exactly like the many grant-holder writes the other admin routers
always allowed (turfs, voters, imports, reports, billing…), which is what made the old carve-out inconsistent rather
than protective. The temp-password impersonation risk is accepted on the org-admin route's own reasoning (misuse is
not silent — the legitimate user is visibly locked out), now with an attributable AccessLog row on top. The ONE
surviving refusal, shared by `memberships.js` and `leadCrew.js` via `services/memberships/vendorGuards.js`: a
membership write targeting a SUPER-ADMIN account (`STAFF_SELF_MINT`) — the single write that would END the logging by
flipping orgContext to the member branch. The customer-side path is untouched: their own admin may add staff as a
member, which is what "authorized users" means in the published policy. The policy sentences themselves — grant-gated,
logged — remain TRUE; the grant now covers more actions, all recorded. `denyVendorPrivilegeWrite` (middleware/auth.js)
is deleted with its call sites. Pinned by seven tests in `supportAccess.int.test.js`; the two tests that pinned the
old blanket (`internalOrg`, `perCampaignCrews`) are updated to the new contract.]* Every bypass v1 found is closed: the identity-console triage lists are now grant-gated and
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
   > **(v4 stamp 2026-08-09) A WIDENING in the same family, ruled by the owner: team leads can now
   > EDIT IDENTITY — name, email, phone — via `PATCH /admin/memberships/:userId/user`, for
   > canvasser accounts on campaigns they manage** (`leadMayManageTarget`, the identical wall as the
   > lead password power above; route was `requireAdminRole` before). Why it is bounded: name and
   > phone are per-USER fields, so a lead's edit is visible in any other org the person works for —
   > but the **multi-org email lock** (`MULTI_ORG_EMAIL_LOCKED`) already refuses the field that
   > matters most, the login email of anyone with 2+ active memberships, to leads and admins alike;
   > the tombstone 409 and the vendor-staff refusal also apply unchanged, and a lead still cannot
   > touch admins, other leads, staff, or anyone off their campaigns. Pinned by
   > `test/leadUserManagement.int.test.js` ("lead identity edits" — target matrix + the lock).
   > Surfaces: the web campaign Team page's member panel and the mobile profile page (role picker
   > remains admin-only there). **No published-policy sentence changes** — the Privacy Policy does
   > not enumerate which org roles may correct member records; this stays within "your
   > organization's administrators," which a campaign-scoped lead now partially is by design. New
   > fields collected: none.
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

*[v6 2026-10-24: **now FOUR — item 37.** An org's own admin can delete a member who belongs to no other organization: `DELETE /admin/memberships/:userId/account`, after the `GET …/deletion-check` review. All four doors now run one model: one deletion at a time per account (the pending `DeletedUserRecord` is the lock), memberships switched off then a recount of LIVE admins and billing admins, the same 14-field scrub as one conditional write, an idempotent finish, and a sweep every 15 minutes for a crash on either side. The blocker list below still applies, counted over live accounts only; the org door adds its own checks (item 37).]*

1. **In-app, mobile only, password re-authenticated.** `DELETE /auth/account` (`server/src/routes/auth.js:235`) requires the caller's current password (schema `auth.js:37-39`; bcrypt-verified via `server/src/models/User.js:62-64`; 401 on mismatch). The only UI entry point is mobile Profile → Delete account (`mobile/app/(app)/profile.jsx:316` → `mobile/components/DeleteAccountSheet.jsx:80`). **Note:** the HTTP route itself is gated only by `requireAuth`, so the *interface* is mobile-only, not the *endpoint*.
2. **Operator CLI**, for people who have uninstalled the app and email in: `npm run delete:account <email> --apply` (`server/src/utils/deleteAccountByEmail.js:86`). It calls the identical service. **It performs no identity verification in code** — it takes an email and a flag. "VERIFY THE REQUEST FIRST" (`deleteAccountByEmail.js:24`) is a comment instructing a human, not an enforced control.

The web console has **no** in-product deletion. `client/src/pages/DeleteAccountPage.jsx` is a static instructions page (public route, `client/src/App.jsx:95`) with zero API calls. *[v4 2026-07-29: **FALSE as of the console delete.** The public `/delete-account` page is still static instructions — that sentence holds — but `SuperAdminUserDetailPage.jsx` now carries a break-glass danger panel that calls the endpoint above. There is still **no self-service deletion on web**: a user cannot delete their own account there, only staff can delete someone else's.]*

**The deletion itself (`server/src/services/users/deleteAccount.js:175-239`), in order:**

| Step | What it does | Line |
|---|---|---|
| 1 | Writes a **new record containing the user's identity** — `DeletedUserRecord` with firstName, lastName, email, phone, userId, organizationIds[], deletedAt, retentionUntil | `:190-204` |
| 2 | `releaseAssignedWork()` — hard-deletes, across **all orgs and all campaigns**, every `TurfAssignment`, `EffortMember`, `CampaignAssignment`, `CampaignManager` row **where the deleted user is the assignee**; nulls `Membership.coordinatorId` on anyone they supervised | `:212`, `:268`, `:274-286` *[v4 2026-07-21: line drift only — now `:285-290`]* |
| 3 | `Membership.updateMany({userId}, {$set:{isActive:false}})` — memberships are **retained**, only deactivated | `:217` |
| 4 | One `User.updateOne $set` overwriting exactly 11 fields *[v4 2026-07-22: now **13** — `lastLoginAt` and `lastSeenAt` joined the scrub]* *[v6 2026-10-10: now **14** — `endedSessionIds → []`]* | `:219-236` *[v4 2026-07-22: line drift — the block is `:224-248`]* |

**The 11 scrubbed fields:** `firstName → 'Deleted'`, `lastName → 'user'`, `email → deleted+<userId>@deleted.doorline.invalid`, `phone → null`, `passwordHash → a fresh random unusable bcrypt hash` (not null — the field is `required`), `isActive → false`, `deletedAt → now`, `mustChangePassword → false`, `tempPasswordSetAt → null`, `passwordResetToken → null`, `passwordResetExpiresAt → null`. *[v4 2026-07-22: **13 fields.** Add `lastLoginAt → null` and `lastSeenAt → null` — a tombstone no longer carries either activity clock.]* *[v6 2026-10-10: **14 fields** — add `endedSessionIds → []`, the session ids of the account's last 200 sign-outs (gap 29).]*

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
  *[v6 2026-10-24: `reason` gains `'org_admin'` (item 37). The record also carries the deletion lock — `pendingAt`, `pendingToken`, `unusedOrgId`, `touchedMemberships`, removed when the deletion finishes — and `finishedAt`. The purge now runs the deletion sweep first and skips, and counts, any record whose account is not deleted, so it can never de-pair a live account's FbTime.]*
- **No TTL index exists anywhere in the codebase.** I grepped `expireAfterSeconds` / `expires:` across all of `server/src`: **zero hits.** There is no database-level expiry on any collection. *[v3: one TTL index now exists — GeocodeCache's 18-month disuse expiry (F7). Still none on any identity or ledger collection; this section's conclusion stands for `DeletedUserRecord`.]*

**CAVEAT I could not close:** I verified the code and the Procfile. I **could not determine from code** that the worker dyno is scaled up in production. Repo memory records a prior incident in which deploying the wrong branch scaled the worker to 0. The codebase's own health text contemplates the job having **"NEVER run"** and says, in terms, *"we are promising a retention limit we are not enforcing"* (`purgeDeletedIdentities.js:85-89`). A health check exists (`retentionHealth`, `:67-91`, red after 48h) but it is a dashboard reading, not an enforcement mechanism.

> **Do NOT write:** *"We delete this information after 180 days."*
> **Write:** *"We retain this information for up to 180 days after your deletion request, after which the name, email address and telephone number on the deletion record are erased on our next scheduled retention run. A record of the deletion — an internal identifier, the organizations you belonged to, and the date — is retained."*

**Retention can also end EARLY, and by an unrelated event.** `deleteOrganization` pulls the org from `organizationIds` and then runs `DeletedUserRecord.deleteMany({organizationIds: {$size: 0}})` (`server/src/services/platform/deleteOrganization.js:94-98`). That `deleteMany` is **not scoped to the org being deleted** — it sweeps *every* zero-org record in the database. A user who had no active membership at deletion time (a platform user; someone removed from their org first) gets `organizationIds: []` (`deleteAccount.js:104`, `:186`, `:199`) and is destroyed as collateral by the next unrelated organization deletion. *[v5 2026-08-05: **FIXED.** The delete is now scoped to the ids the preceding `$pull` actually detached (`_id: { $in: touchedIds }`), so an unrelated zero-org tombstone survives an organization deletion it has nothing to do with. The early-end-of-retention hazard described here is closed; retention for a collateral user now runs its full 180 days. See the 2026-08-05 background-org-deletion entry.]*

## A3. After the retention window lapses, is the remaining data anonymous?

**VERIFIED: NO. It is pseudonymous. This is the legally load-bearing point in Section A.**

After the purge, **all field records persist in full and remain linked to the deleted user's identifier.**

- `CanvassActivity.userId` — `ref: User`, **`required`** (`server/src/models/CanvassActivity.js:28`)
- `CanvassActivity.location {lat, lng, accuracy}` — **`required`** (`:39`)
- `CanvassActivity.timestamp` — **`required`** (`:42`); `actionType`, free-text `note` (`:37`), `distanceFromHouseMeters` (`:40`), `coordinatorId` (`:69`)
- `SurveyResponse.userId` (required), with its own required `location` and `submittedAt` and the answer payload (`models/SurveyResponse.js:44`, `:52`, `:55`, `:49`)
- `FlagReview.reviewedBy` (required); `HouseholdLocationChange.userId` (required); `VoterNote.authorId` *[v6 2026-08-28: also `Household.correctedBy` (pin correction) and the new `Household.locationConfirmedBy` (Pin Fixes confirm — item 15). Same class, same posture: staff attribution on customer records, untouched by account deletion.]* *[v6 2026-08-29: also `Voter.doorAdded.byUserId` (who added a walk-up voter — item 16). Same class, same posture.]* *[v6 2026-10-19: also the Door Outcomes removal records' visit keys — `UnknockRunChunk.visitKeys` and `.notRestoredKeys`, `ConversionStrike.visitKeys` and `.notRestoredKeys` (door, round and canvasser ids) — and an answer-edit undo's stored `undo.summary.names[].detail.by` (who changed a survey since the edit) (item 32). Same class, same posture. Item 32(c)'s `scopeSummary` holds a canvasser's NAME, not an id — a separate owner flag, closed 2026-10-20: the identity purge now takes that name off when the window lapses.]*
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
*[v6 2026-10-24: **WIDER — item 37.** The record now lists every membership in any status plus every org holding the person's own doors or surveys (desk marks excluded), on every deletion path, self-deletion included. Still org-scoped: a name is restored only to an org on the record, and `hydrateCanvassers` now restores nothing at all when handed no org.]*

**Not every surface restores it.** At least six identity-rendering paths bypass the hydrator and show the tombstone even during the window — including, ironically, the GPS/quality audit that `DeletedUserRecord`'s own model comment names as its reason for existing (`server/src/services/audit/flagDetection.js:72`; also `reports.js:1474`, `:1903`, `:2010`, `:2350`, `:3507`).
*[v6 2026-10-24: **narrowed — item 37.** The GPS audit (`flagDetection.js`) and seven report lookups now restore the name for the window, org-scoped: the leaderboard's and Timeline's team labels, the team breakdown and tag-team totals, the per-canvasser summary and responses, the Survey Results voters-by-answer CSV, and the canvasser CSV's crew stamp. About 45 other surfaces still show "Deleted user" at once (a follow-up).]*
*[v6 2026-10-24 — item 39: one more record about a deleted person persists, beside `FlagReview`: a `PacePause` about them (ids, times, seconds, meters, verdicts, the alert's counts; no coordinate, address or email). The review screens name them for the window through `hydrateCanvassers` (org-scoped), to the organization's admins and that campaign's leads, and `deleteAccount.js` puts every organization holding one on the record. Deleted with the campaign and the organization, or by an org admin once resolved.]*

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

> **[v6 2026-10-05 — the import's map-pin pass (item 28) adds entries the same way imports always have.]**
> Addresses the pass looks up land in `GeocodeCache` under the same 540-day disuse TTL, and each probe of a
> cached answer refreshes it like any import does. The pass stops buying — re-checked before every chunk of
> lookups — on any of three signals: `Campaign.deletion.requestedAt`, `Organization.deletion.requestedAt`
> (set only once a deletion executes), or an `OrgDeletionRequest` with `{ organizationId, status:
> 'scheduled' }` (the customer's filed request, which can wait up to the 30-day SLA): `deletionRequested`
> in `placeStackedPins.js`. The existing import guard checks only the first two
> (`importProcessor.js`); the pass checks all three so it never keeps buying after a customer asked for
> deletion. Separately, a comment in `routes/superAdmin/organizations.js` says a running import is failed
> on the three retention paths; the reference plan's review (§O) found nothing implementing that. That gap
> predates this release and was not re-checked here.

> **[v6 2026-10-10 — Pin Fixes at scale (item 28 stamp) adds entries the same way.]** Addresses looked up
> by the widened import pass, by a Pin Fixes **Look up by address** job, or by `pins:measure-estimates` land in
> `GeocodeCache` under the same 540-day disuse TTL. The lookup job runs the same pass, so it stops buying on
> the same three deletion signals (`deletionRequested` in `placeStackedPins.js`). `pins:measure-estimates`
> is operator-run against one named campaign and checks no deletion signal; it should not be run against a
> campaign or organization with a pending deletion.

### EXCEPTION 2 — Identity snapshots can be orphaned. **VERIFIED.**

`PersonMergeCandidate`, `PersonEditProposal` (by personId) and `PersonMergeLog` are deleted **only inside a loop over `personIds` collected from that org's Voter rows** (`deleteOrganization.js:74-77`, `:119-127`). The belt-and-braces `Person.deleteMany({organizationId})` at `:130` cascades **nothing**. `PersonMergeLog` and `PersonMergeCandidate` carry **no organizationId** of their own, so nothing else can reach them.

`PersonMergeLog` stores `survivorSnapshot` and `victimSnapshot` — a **verbatim JSON dump of both complete Person documents**: name, phone, cellPhone, dateOfBirth, party, gender, registration status, voter-ID keys (`server/src/services/person/mergePersons.js:11-14`, `:110-119`). A merge *tombstones* the victim and moves its voters to the survivor (`mergePersons.js:143`, `:156`), so in a chained merge the earlier log references two voter-unlinked Persons and **survives the org deletion, orphaned, holding full pre-merge identity PII.**

### Other survivors of organization deletion (VERIFIED):

| Survives | Contains | Why it survives |
|---|---|---|
| **`User` accounts** | name, email, phone, bcrypt hash, `lastLoginAt` *[v4 2026-07-22: add `lastSeenAt` — a `User` surviving an **org** deletion now also carries a rolling last-activity clock. **Account** deletion scrubs both clocks; org deletion scrubs neither, by design.]* *[v6 2026-10-10: and `endedSessionIds` — up to 200 session ids from sign-outs (gap 29); org deletion keeps it, account deletion clears it.]* | Deliberate: *"global identities are kept even when this was their only org"* (`deleteOrganization.js:59-62`). Only `Membership` rows are removed. |
| **`AccessLog`** | staff actor id, org id, route template | Not in `ORG_SCOPED`. No voter PII. |
| **`SupportAccessGrant`** | staff actor id, org id, **required free-text `reason` (500 chars)** | Not in `ORG_SCOPED`. The free text can name the customer or its people. |
| **`GeocodeCache`** | street addresses + coordinates | See Exception 1. |
| **`DeletedUserRecord`** (multi-org users) | name, email, phone | The org is `$pull`ed from the array; the row is only destroyed when **no** org remains. A deleted user who also belonged to another org keeps their name/email/phone in our database. |
| **`RetentionRun`** | job receipts, no org id | Not swept. |
| **`OrgDeletionRequest`** | (see B6 — in practice, empty) | Not swept. |

**None of these has any retention limit.** No TTL, no purge job.

**The cascade runs in no transaction** (`Organization.deleteOne` is last, `:133`), so a mid-run failure leaves the customer partially deleted.

**Raw upload deletion is best-effort.** `rawImportStore.js:33-39` swallows every GridFS delete error (`.catch(() => {})`). The `ImportJob` rows keyed to those files are then destroyed, so a failed blob delete leaves the complete uploaded voter file orphaned with no key to find it and no retry. The deletion receipt reports `jobIds.length`, not files actually deleted (`deleteOrganization.js:87`). *[v5 2026-08-04: still best-effort per call, but no longer orphaned forever — the nightly `sweepStaleImportJobs` scans `rawImports.files` directly (no jobIds needed) and deletes any file >24h old whose ImportJob is terminal or gone, so a swallowed delete is retried nightly. See the v5 "orphan leak CLOSED" entry in the v3 section.]*

## B6. What automatic retention timers exist? What triggers deletion?

**PARTIAL — one of the three "triggers" is not wired up at all.**

> **[v6 2026-08-17 — one retained category added, no timer.]** A survey answer REMOVED from a door
> by the Door Outcomes → Surveyed reverse conversion is **archived, not deleted**: it moves to
> `SurveyResponseArchive` and is kept until its campaign or organization is deleted. There is no
> timer on it, and that is deliberate — the direction exists for fraud investigation, where the
> removed answers are the evidence, and the archive is what makes the change reversible and the
> answers restorable. The honest sentence is therefore: *"an answer removed from a door is kept in
> the archive until its campaign is deleted."* The `submit`/`restore` producers remain
> self-consuming (restore deletes the row it promotes); only `overwrittenVia: 'outcome_convert'`
> accumulates. Tenant deletion reaches it — see §B5 — so nothing here survives an org delete.
> Full context: gap 12 in the v3 list above.
> **[v6 2026-10-19 — corrected, item 31.]** `overwrittenVia: 'unknock'` (item 14) accumulates the same
> way: kept until restored or erased, or the campaign or organization is deleted (an unknock's undo removes
> the copies it puts back and keeps the rest). A desk-entered answer a canvasser re-surveys over is now
> kept as a `submit` row: consumed only if someone restores it, otherwise kept with no timer.
> *[Corrected 2026-10-19, code review round 1.]*
> **[v6 2026-10-19 — item 32.]** A third accumulating producer: `overwrittenVia: 'answer_edit'`, the
> earlier answers every admin edit keeps (Door Outcomes → Edit answers… and the profile's Edit). Kept
> until restored or erased, or the campaign or organization is deleted; an Undo removes the copies it
> puts back and keeps the rest; a clear-knocks re-cut moves a round's rows into its snapshot, and
> deleting a voter added at the door removes that voter's rows (every archive row, item 31). No timer;
> both cascades reach it, as they reach every archive row (§B5).

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
> **Do NOT write:** *"no door-knocking activity for 24 months."* The correct phrase is *"no canvassing activity recorded for approximately 24 months."* (And note: `POST /admin/turfs/restrict-bulk` writes `CanvassActivity` rows from the **web admin console** with no door knocked — `server/src/routes/admin/turfs.js:695`, insert at `:779` — and those rows reset the dormancy clock, because the trigger filters on `organizationId` alone.) *[v6 2026-08-21: the line pins have rotted — cite by route. The same row class now has ONE writer, `server/src/services/canvass/deskRestrict.js`, behind two route pairs on the turfs router: `POST …/turfs/restrict-bulk` / `unrestrict-bulk` (a whole book) and the new `POST …/turfs/restrict-doors` / `unrestrict-doors` (a single home), reachable from the web console AND the mobile admin app (already true for restrict-bulk via the mobile Books screens). A single-home desk mark is the same `CanvassActivity { actionType:'restricted', via:'bulk' }` row — a copy of the household's own pin, the acting admin's user id — so it **resets the dormancy clock too**, with no door knocked. Not privacy-affecting in substance: no new data category, no new party, no new export, no retention change, same undo semantics; nothing in the published Privacy Policy / ToS / DPA changes.]*

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

The only human-triggerable org deletion is the break-glass `DELETE /super-admin/organizations/:orgId` (`server/src/routes/superAdmin/organizations.js:181-196`), which requires `requireBreakGlass` + typed slug and executes **immediately** — no SLA, no request record, no cancellation window. *[v5 2026-08-05: the route no longer executes the cascade **synchronously** — it CAS-stamps `Organization.deletion` and enqueues on `org-delete-queue`, answering `202`, and the worker destroys the tenant minutes later. The substance of this finding is unchanged and still correct: still break-glass + typed slug, still **no SLA, no request record, and no cancellation window** — the stamp is not a grace period, it is the point of no return. What changed is that the tenant is walled off (every `/admin` and `/mobile` request 404s) from the instant of the stamp rather than after the last row dies. See the 2026-08-05 background-org-deletion entry.]*

> **Do NOT write:** *"A customer organization may request deletion of its data and we will complete it within 30 days,"* or anything implying a cancellable request window. **The code does not back it.**
> If the business intends to honour such a promise, it is a **manual, human process today**, and the policy must say so — or engineering must build the intake.

**Two more facts about the receipts, relevant if you promise a deadline:** *[v3: the first is fixed —
per-request try/catch keeps a failed request `scheduled` for retry (≤5 attempts,
`RETENTION_DELETE_MAX_ATTEMPTS`), then flips it to a terminal `failed` that turns the health surface
red; never a green receipt. The second (no per-org isolation in the two org-purge loops) is still
true.]*
- A **failed** deletion request produces a **green** `RetentionRun` receipt. `executeDueDeletionRequests` catches per-org failures, marks the request `status: 'failed'`, and **returns normally** (`triggers.js:121-136`), so `runRetentionTriggers` stamps `ok: true` (`:164-167`). The due-query filters `status: 'scheduled'` (`:113`), so a `'failed'` request is **never picked up again by any code path**. It is permanently dropped behind a successful-looking receipt and a green health banner (`purgeDeletedIdentities.js:68`; `routes/superAdmin/access.js:149-159`).
- `purgeWoundDownOrgs` has **no per-org error isolation** (`triggers.js:64-68`) and the three triggers run sequentially in one function (`:157-159`), so a single throwing organization aborts the whole nightly sweep. *[v5 2026-08-05: **CLOSED.** The three stages no longer call `deleteOrganization` at all — each due org is CAS-stamped and handed to `org-delete-queue` inside a per-org `try/catch`, so one org that cannot be enqueued increments `failedToEnqueue` and the sweep continues, including the delete-on-request stage that was previously skipped. Each org then carries its own BullMQ retry ladder instead of "wait for tomorrow's cron". Regression test: `test/retentionTriggers.int.test.js` — *"a single org that cannot be enqueued does NOT abort the sweep or the SLA stage"*. The `RetentionRun` receipt now reports `enqueued`; `purged` keeps its original meaning and is 0, because this sweep no longer destroys anything itself.]*

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

*[v4 2026-08-01: **superseded** — the Export Center adds a queued, artifact-based export
surface (background CSV/ZIP builds, 7-day-TTL GridFS artifacts, an admin-only full-backup
bundle; see the v4 watchlist entry and [EXPORTS.md](EXPORTS.md)). The five endpoints below
remain and are unchanged. "The original uploaded voter file cannot be re-downloaded" remains
TRUE — the Export Center's voter-file export is a reconstruction from current rows, never the
raw upload. "No full-account export" is history: the full-backup ZIP is exactly that,
admin-only, DNC-excluded, and audit-tagged.]*

*[v4 amendment 2026-08-02: the Export Center's voter-bearing CSVs (activity, both survey
files, notes) now carry their voter-identity columns as **`State voter ID` + `UID`** (the
customer's own import ids — the walk-list CSV below already exposed a Voter-ID-class column to
the same audience), and a read-only `POST /admin/exports/estimate` previews row counts before
queueing. Column contracts: [EXPORTS.md](EXPORTS.md) appendix; details in the v4 amendment
stamp above.]*

*[v5 2026-08-11: the two survey exports take an **opt-in** `includeVoterDetail` block — phone /
phone type / cell / gender / date of birth, and county / lat / lng / precinct / districts. Same
admin-or-lead gate as the `voter-file` export that already emits all of it, off by default,
DNC-guarded through the same suppressed voter object, columns-not-rows. The full-backup does not
inherit it. Full reasoning in the v5 2026-08-11 watchlist entry.]*

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

> **[v5 2026-08-09 — `voters-by-answer.csv` and `knocks-by-pass.csv` accept an optional
> `?coordinatorId` crew filter (the campaign home's crew scoping). Re-verified: no policy change.]**

> **[v6 2026-08-26 — NEW export: `GET /admin/campaigns/:id/outcome-entries.csv` (the Door
> Outcomes page's filtered table as a file).]** Per door ENTRY — timestamp (ISO + campaign-tz
> date/time), address/unit/city/state/zip, outcome, canvasser name, round, walk list — plus, for
> surveyed rows, the visit's voter/answer COUNTS and, under an answer filter, the **matched
> voters by name with their matched answer snapshots** and a **Do not contact** column naming
> flagged voters among those listed (record-of-past-contact posture: rows stay, marked — the
> `voters-by-answer.csv` rule). Capped at 50,000 rows; the exact `entryScopeSchema` +
> `resolveEntryScope` + `buildEntryFilter` machinery the table reads through, so the file cannot
> hold a row the table would not show, and the same refusals fire (`ANSWER_FILTER_NEEDS_NARROWING`
> et al.). **Gate: org admin only** (`loadForReclassify`) — STRICTLY NARROWER than
> `voters-by-answer.csv`'s admin-or-lead, and every column class it carries (voter name + chosen
> answer + address + canvasser identity) is already exported to that wider audience there — the
> §B8 same-audience ruling covers this a fortiori, **so no Privacy Policy / ToS / DPA text change.**
> Record-level audit: `addAuditSubjects` tags every household row written and every voter named
> (the `walklists.js` precedent), persisted for staff access under a grant. Uses the shared
> `csvWriter` cell escaping (formula-injection guard + BOM).**
>
> *[v6 2026-10-02: the file gains an appended **Offline** column ("Offline" or blank, from
> `wasOfflineSubmission`) — the evidence an admin needs to review entries an offline phone
> recorded after an outcome was switched off (item 25). Still org-admin only; the same flag
> already ships as "Offline submission" in the lead-visible canvass-activity export
> (`exportBuilders.js:455`, `:572`, `:630`), so no new disclosure.]*
>
> *[v6 2026-10-02 — placement note: the paragraph below is the body of the v5 2026-08-09
> `?coordinatorId` crew-filter stamp directly above this entry. The 2026-08-26 entry was inserted
> between that stamp's header and its body; nothing in it is about `outcome-entries.csv`.]*
>
> The parameter only **narrows** the row set to one coordinator's crew (or the no-crew bucket) —
> same gates, same audience, same columns, no new field and no new recipient; an omitted parameter
> is byte-identical to before. Line anchors in the table above have drifted with unrelated code
> insertions; as of this stamp: `voters-by-answer.csv` `reports.js:1516` (`EXPORT_CAP` `:1522`),
> `canvassers.csv` `:2770`, `buildKnocksByPass` `:2959` (threads the crew filter to the JSON route
> and the CSV alike), `knocks-by-pass.csv` `:3004`, `canvassers/:userId/export.csv` `:4035`, the
> admin-or-lead router gate `:51`.

> **[v4 2026-08-08 — the drill now RETURNS rows for the "Other" bucket, and each row carries the
> rendered answer. Re-verified: same audience, same categories, no policy change.]** Two facts
> changed. (1) Drilling the write-in bucket previously returned **zero** rows — the bucket carried a
> null id, so the filter matched its label against `answers.answer`, which holds the canvasser's typed
> text. It now matches by the `'__other__'` id, so this export can return up to `EXPORT_CAP` rows
> where it used to return none. That is a **bug fix, not a new exposure**: the same caller could
> already reach every one of those responses through the un-drilled list, the response detail view,
> and `survey-answers.csv` (which has carried dedicated **Option ids** and **Other text** columns all
> along). (2) The JSON drill row gained an `answer` field, rendered by the same `formatAnswerCell` as
> the CSV — the answer snapshot was already in the CSV column named above, so the screen merely stops
> being less informative than the download. The role gate, the lead-campaign gate, the 50k cap and
> the fail-closed access log are all unchanged. **No Privacy Policy / ToS / DPA text change.**
>
> Worth stating plainly because it is the one genuinely new *practical* capability: an operator can
> now list, read and export what canvassers typed about residents in free text. That data was always
> collected and always exportable — this makes it *findable*. It carries no retention or redaction
> treatment distinct from any other survey answer, and is removed by the same account/org deletion
> cascade.

**The fourth (voters-by-answer.csv) is a same-audience exposure, not a new recipient class.** It downloads exactly what the same caller could already page through on `GET /admin/reports/voters-by-answer` (same filter builder, same role + lead-campaign gate) — voter identity/address, canvasser identity, the chosen answer, and the door note were all already readable by that audience in-app, and the walk-list CSV above already put voter name/party/address in a file for the same roles. No new party receives data and no new category of data leaves the system, **so no Privacy Policy / ToS / DPA text change is required for it.** Staff (grant-based) access to it is covered by the fail-closed central access log (E13 — the finish-listener middleware logs unless explicitly exempted; this route has no exemption).

**The first one is effectively a bulk export of the entire campaign voter file, and this is a two-click product feature, not an edge case.** A walk list can be saved with an **empty filter** — `filter` is optional on `POST /admin/campaigns/:id/walklists` (`walklists.js:74-92`), and an empty filter resolves to `baseSet` = **every active geocoded household in the campaign and every voter in them** (`server/src/services/walklist/resolveWalkList.js:48-53`, `:131-132`). The web UI enables Save on a name alone (`client/src/pages/WalkListsPage.jsx:416`, `:27-47`) and puts an "Export CSV" button on every saved list (`:534-537`). **No row cap. No pagination. No size guard.**

**Also exportable, driven by survey answers:** walk-list filters include `surveyResponse` exists/not-exists, per-question `answerFilters`, and cross-question `answerTagFilters` (`resolveWalkList.js:89-128`). So "every voter who answered X" or "every voter tagged Supporter" can be resolved to a named, addressed, phone-bearing CSV.

**Client-side (browser-generated) downloads not counted above:** a jsPDF client-report PDF (`client/src/lib/reportPdf.js:33`), unmatched-voter-ID CSVs (`WalkListsPage.jsx:227-231`, `EarlyVotingPage.jsx:84-88`), and a billing-statement CSV (`client/src/components/OrgBillingPanel.jsx` → `downloadCsv()` — **platform-staff only**, rendered solely from the super-admin Organizations page; campaign-level counts and dollars, no personal data).

**Not exportable by any route:** full `SurveyResponse` documents (the voters-by-answer CSV carries only the **drilled** question's snapshot answer(s) — or the tag's matching entries — plus the response's door note, never the response's whole answer set), `VoterNote` bodies, tags, turf/book definitions, flag reviews, import history. **The original uploaded voter file cannot be re-downloaded** — `loadRawImport()` is called only by the background import worker (`services/import/importProcessor.js:56`) and is exposed by no route.

---

# C — LOCATION

## C9. How does the app collect location? Background? Continuous? Stored offline?

### (a) Background collection — **VERIFIED: DENIED. The app cannot collect location in the background.**

- iOS declares **only** `NSLocationWhenInUseUsageDescription` (`mobile/app.json:15`) and **no** `UIBackgroundModes`. *[v6 2026-10-03: what that one string says is narrower than what the app does. It reads "Doorline records your location only at the moment you log a knock or submit a survey", but a lead's or admin's GPS pin fix also records the phone's position, as the house's new pin with its accuracy (`HouseholdLocationChange`, `source: 'gps'`; §(c) lists the pin-correction endpoint). A drag pin fix sends a GPS fix too but stores none, so the string is false only for GPS pin fixes. Known mismatch, recorded here; the expo-location plugin's copy at `app.json:38` is the same sentence, and Android shows no such string. Changing it takes a native build; a rewording is proposed for the next one.]*
- The `expo-location` plugin is explicitly configured with `locationAlwaysAndWhenInUsePermission: false` and `locationAlwaysPermission: false` (`mobile/app.json:37-39`) — this **suppresses** the "Always" strings Expo would otherwise inject.
- Android declares **only** `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` (`mobile/app.json:27-28`). `ACCESS_BACKGROUND_LOCATION` is **absent**.
- A repo-wide grep of `mobile/` for `watchPositionAsync | startLocationUpdatesAsync | TaskManager | defineTask | ACCESS_BACKGROUND_LOCATION | requestBackgroundPermissionsAsync` returns **zero matches**. No geofencing. *[v6 2026-08-30: **THE GREP SPLITS — one term now matches, on purpose, and it is foreground-only by construction.** `watchPositionAsync` appears in `mobile/` in exactly one module: the canvasser houses map's owned location feed (`mobile/lib/useLocationFeed.js`), the plain foreground `expo-location` subscription that replaced the Mapbox `UserLocation` stream recorded in §(b). It cannot collect in the background: the app still declares only when-in-use permission on both platforms (every `app.json` fact above is untouched), a bare `watchPositionAsync` delivers nothing once the app leaves the foreground, and no background task exists to receive anything. The grep now reads: `startLocationUpdatesAsync | TaskManager | defineTask | ACCESS_BACKGROUND_LOCATION | requestBackgroundPermissionsAsync` → **zero matches, and must stay zero**; `watchPositionAsync` → **exactly one match, the module above** — a second match, or any match on the background terms, is a finding. The §(a) verdict — the app cannot collect location in the background — is unchanged. Not privacy-affecting in substance: no new data category, no new recipient, no transmission or retention change; nothing in the published Privacy Policy / ToS / DPA changes.]*
  *[v6 2026-10-03 grep hygiene: run the §(a) grep over **tracked** files (`git ls-files mobile | xargs grep -l …`, or exclude `node_modules/` and `dist/`). The gitignored `mobile/dist/` Hermes source maps bundle expo-location's own JS and contain all six terms, so a bare `grep -r mobile/` reports a false second `watchPositionAsync` match and false background-term matches. Re-verified 2026-10-03 on tracked source: one call site (`mobile/lib/useLocationFeed.js`) plus two comment lines; background terms zero. The 2026-10-03 location audit (`docs/GPS_ACCURACY.md`) changed no collection, transmission or retention.]*

**This is a genuinely safe statement and you should make it.** *Caveat, honestly stated:* verified from source config, not from a built binary's merged `AndroidManifest.xml` / `Info.plist`. An Expo config plugin from another package could in principle add a permission at prebuild; I did not inspect a built artifact.

### (b) Continuous collection while the app is open — **VERIFIED: YES, in device memory.**

Two of your own findings conflict here and I am telling you which is right.

- Location is read **once on map-screen mount** (`mobile/app/(app)/map.jsx:88`, `Location.getCurrentPositionAsync`).
- **While a map screen is mounted, the Mapbox SDK's own location engine streams position continuously** into React state: `<Mapbox.UserLocation>` with an `onUpdate` callback that fires repeatedly (`map.jsx:832-841`, stored at `:219`); `followUserLocation` at `map.jsx:824` and `books.jsx:352`; `<Mapbox.UserLocation visible />` at `books.jsx:357`. Admin/lead screens have pucks too (`admin/map.jsx:808`, `admin/book/[turfId].jsx:375`) — location capture is **not canvasser-only**.
- **INFERRED, NOT VERIFIED:** the canvasser pucks (`map.jsx:832`, `books.jsx:357`) have **no focus gate**, whereas the admin pucks do (`visible={isFocused}`, with comments saying the gate exists so "GPS stops while another screen covers this tab"). These are Stack screens, so the map stays *mounted* beneath pushed screens. The code's own reasoning implies the un-gated pucks keep the location engine running while the user is on a non-map screen. **I could not confirm from code whether the native SDK pauses its engine for a covered MapView. Do not assert either way.**

*[v6 2026-08-30: **MECHANISM REPLACED — the dot is the SDK's native LocationPuck now, and the React-state stream is our own foreground watcher; the open question above is ANSWERED, and the answer went the unsafe way.** (The mobile line pins in the two bullets above had ALL rotted — this stamp cites by component and predicate per the 2026-07-29 rule, and the old pins are knowingly stale history.) All four map screens render `<Mapbox.LocationPuck>` via the shared `AppLocationPuck` component (engine-drawn; the `<Mapbox.UserLocation>`/`onUpdate` bridge pipeline is gone), and on the canvasser houses map the "nearest to me" coordinates and the iOS Precise-off probe are fed by an `expo-location` `watchPositionAsync` subscription the screen owns (`mobile/lib/useLocationFeed.js`) — mounted only when the real map renders (never on its loading/error/archived bail-out screens), foreground-only, position still in device memory only, transmitted solely in the user-initiated request bodies of §(c). Verified from SDK source, both platforms: `LocationPuck`'s `visible={false}` merely swaps the puck images for empties and leaves the engine's location component RUNNING; only UNMOUNT stops it. The admin screens therefore now gate by conditional mount (`{isFocused && <AppLocationPuck/>}`), which verifiably stops engine location while covered — and the old Android build could not honor its own "GPS stops" comments at all: the SDK's location module increments the shared engine counter twice per start while stop decrements once, so the first focus cycle stranded the fused engine at 1Hz until process death. This migration removes the last reachable use of that module. The canvasser screens stay deliberately un-gated while mounted (the warm fix is what makes the knock gate's fast path instant) — the §(b) continuous-in-memory finding stands, with the collector now our own code instead of the SDK's. No new data category, no new recipient (Mapbox still receives only tile traffic; mobile telemetry stays disabled), no transmission or retention change — nothing in the published Privacy Policy / ToS / DPA changes.]*

### (c) Transmission — **VERIFIED: at action time, AND on a pin correction.**

- No location ping, heartbeat, presence, or live-tracking endpoint exists on the server. GPS reaches the server **only** in user-initiated request bodies: the five door-action endpoints (`server/src/routes/mobile/canvass.js:246`, `:264`, `:282`, `:300`, `:322`), the survey submit (`:358`), and the pin-correction endpoint (`:207`). *[v6 2026-10-02: **seven door-action endpoints now, not five, and every pin in this bullet has rotted.** One route per door result, each refusing a request that carries no GPS stamp (`LOCATION_REQUIRED`): `POST /mobile/households/:householdId/…` with `not-home`, `wrong-address`, `refused`, `lit-drop`, `not-target` (new with item 25), `restricted` and `no-soliciting` (`canvass.js:549`, `:569`, `:589`, `:609`, `:635`, `:664`, `:690`). The survey submit is now `:728` and the pin-correction endpoint `:486`. One more user-initiated body, never listed here, carries the stamp too: Add a person (`POST /mobile/households/:householdId/voters`, `:1004`, item 16) refuses a request without one and stores none of it. The bullet's finding is unchanged: no ping, heartbeat, presence or tracking route exists, and GPS reaches the server only in user-initiated request bodies.]*
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
*[v6 2026-10-05 (GPS upgrades step W1; item 27 of "Remaining honest gaps"): two clauses above are no longer true for `accuracy`. The zod schema no longer "accepts any `z.number()`" for it: `locationSchema.accuracy` and the pin route's `locationCorrectionSchema.accuracy` pass through `usableAccuracy` (`routes/mobile/canvass.js`), which keeps a finite number above zero and turns zero, negative and non-finite values into `null`. And the write no longer "assigns `location` verbatim": the parsed location carries that sanitised accuracy, and `buildReplacedSnapshot` copies prior accuracies through the same function. The coordinate itself is still stored raw and unrounded, but a coordinate that is not a finite number is now refused (`400 LOCATION_REQUIRED`, before any write). Finite coordinates off the Earth are still accepted until `npm run audit:gps-stamps` has counted the stored ones. Stores less, never more; stored rows are not rewritten. The before numbers from that count's first production run, and the `--since` numbers after the deploy, are added here in a later docs change. The web admin map now also draws each recorded stamp's accuracy as a circle: display only, from the field the map payload already carried to the same roles.]*

*[v6 2026-10-05, evening (W1-offEarth; item 27): the before numbers the stamp above promised. The count's first production run, right after the W1 deploy, found no zero, negative or non-finite accuracy and no non-finite, off-Earth or (0, 0) coordinate on any ledger: 0 of 86,672 door results (replaced snapshots included), 0 of 16,251 survey responses, 0 of 51 replaced survey answers, 0 of 396 frozen unknocked rows, 0 of 5 GPS pin fixes. A coordinate off the Earth is now refused like a non-finite one (`400 LOCATION_REQUIRED`, before any write). The `--since` run a few days after the deploy remains the after check.]*

*[v6 2026-10-08 — the after check: `npm run audit:gps-stamps -- --since=2026-10-05` in production found no odd stamp among the 4,000 door results, 1,280 survey responses and 2 replaced survey answers created since 2026-10-05 00:00 UTC; no unknocked entries were frozen and no GPS pin fixes were recorded in that window. The off-Earth refusal shipped in commit d2903dc.]*

*[v6 2026-10-19 — item 32: "surveys persist the coordinate twice" is a floor, not a count. Each kept earlier version of a survey (`SurveyResponseArchive` — an admin's answer edit now keeps one every time, `overwrittenVia: 'answer_edit'`) is a full copy that carries the same raw coordinate, so an edited survey's coordinate is stored once more per kept version, until that version is restored or erased, put back by its change's Undo (an Undo keeps the copy of a survey changed since), moved into a re-cut round's snapshot, removed with a voter added at the door, or the campaign or organization is deleted. A copy of a reading already held: no new precision, no new purpose, no new reader. *Corrected in code review round 3: this read "its edit undone, or the campaign is deleted".*]*

`distanceFromHouseMeters` is stored **in addition** to the raw coordinate, as `Math.round(haversineMeters(...))` (`canvass.js:83-86`). It does not replace or coarsen the raw lat/lng. It is null when the household has no pin.

*Two exceptions, so you do not write an over-broad sentence:*
- **Not every activity row is a device reading.** Admin bulk-restrict writes `CanvassActivity` rows whose `location` is a **copy of the household's own geocoded pin**, with `accuracy: null` and `distanceFromHouseMeters: 0` (`server/src/routes/admin/turfs.js:748`, `:758` — *"the house's own pin"*, inserted at `:779`). **Do NOT write** *"each activity record contains the GPS location of the canvasser's device"* — for these rows it would falsely imply someone stood at that door. *[v6 2026-08-21: the caveat now covers **single-home desk marks** as well — `POST …/turfs/restrict-doors` (web Turf Cutting popup, web Map page panel, mobile admin map sheet, mobile book house pop-up) writes the identical row shape through `services/canvass/deskRestrict.js` (`buildDeskRestrictRow`: the house's own pin, `accuracy:null`, `distanceFromHouseMeters:0`, `coordinatorId:null`). The line pins above have rotted; the row builder is the module, not turfs.js. Still no device reading, still no new data category.]*
- The device coordinate is not necessarily a fresh fix. `mobile/lib/location.js:29-33` reuses a cached OS fix up to **15 seconds** old, and `:47` falls back to `getLastKnownPositionAsync()` with **no age or accuracy bound**.
  *[v6 2026-10-03: the fallback has been BOUNDED since the 2026-07-14 location gate — the line pins above have rotted. Today `getCanvassLocation()` → `acquire()` (`mobile/lib/location.js`) reuses a cached fix only if ≤ 15 s old **and** ≤ 20 m accurate (`getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 20 })`), else takes a fresh high-accuracy read raced against 6 s, else the newest fix no older than `MAX_FIX_AGE_MS` = **2 minutes** (`getLastKnownPositionAsync({ maxAge: 120000 })`), else refuses the knock (`NO_FIX`). The stamp also carries `fixTimestamp` (the OS fix time) and `mocked`, nested in `location`, and the server's audit escalates a stamp whose fix predates its tap by > 5 min / > 30 min (`flagThresholds.js` `STALE_FIX_*`). So the stored coordinate is at most 2 minutes older than the action it is attached to. No new data category, recipient, retention or precision change; nothing in the published Privacy Policy / ToS / DPA changes. Full mechanics in `docs/GPS_ACCURACY.md` §A and §D.]*

**Server-side retention — VERIFIED: NO age-based expiry of location data exists anywhere.**
The retention subsystem never deletes, ages out, or coarsens GPS. `purgeDeletedIdentities` writes only to `DeletedUserRecord`. **There is no TTL index on any coordinate-bearing collection** (no `expireAfterSeconds` anywhere in `server/src`). For an active customer, canvasser GPS is **retained indefinitely**.

Coordinates are removed only by: (i) hard deletion of the whole organization (which cascades over `CanvassActivity`/`SurveyResponse`/`Household`); (ii) a canvasser overwriting their own prior action at the same door in the same round (`routes/mobile/canvass.js:139-144`, `:470-475` — replace-in-place, the earlier fix is destroyed); (iii) an admin discarding a round with "clear knocks" (`admin/turfs.js:342-344`); (iv) an admin undoing a bulk restrict (`admin/turfs.js:812`). **None of these is automatic or time-based.** *[v6 2026-08-21: (iv) is now **two routes** — `POST …/turfs/unrestrict-bulk` (every desk mark on a book's current doors for that round) and `POST …/turfs/unrestrict-doors` (one home's desk mark) — both `removeDeskRestrict` in `services/canvass/deskRestrict.js`, deleting only `{ actionType:'restricted', via:'bulk' }` rows; a field-recorded coordinate is never touched by either. Plus one adjacent path: `DELETE /admin/campaigns/:id/passes/:id` (draft round) now sweeps that round's desk rows. Still admin-initiated, never automatic or time-based.]* *[v6 2026-08-26: path (v) added — an admin **unknocking** entries from Door Outcomes (`POST /admin/campaigns/:id/unknock-entries`, `services/canvass/unknock.js`) hard-deletes the selected `CanvassActivity` rows, field coordinates included — but freezes each row verbatim on `UnknockRunChunk` for the life of the campaign, so the coordinate is *relocated*, not destroyed, until tenant deletion or a revert restores it. Admin-initiated, never automatic or time-based. See item 14 of "What changed".]* *[v6 2026-10-24 — item 39: (ii) no longer destroys the earlier fixes. The new row's `replaced` snapshot already kept the last one (AUDIT.md §B.5); its `replaced.history` now keeps up to 20 earlier saves' stamps (lat, lng, accuracy, time, result, receive time, offline flag), server-built from the pre-delete row, on the same row with the same readers and retention. More of the same action-time stamps kept, none new captured.]*
**Note:** `GeocodeCache` coordinates (address→point) are **never** deleted, including by organization deletion (B5, Exception 1).

**Purpose — VERIFIED, and it is broader than fraud detection.** Confirmed consumers of a canvasser's stored GPS:

1. **GPS quality / canvassing-fraud audit** — `far`, `weak_gps`, `rapid`, `one_spot` flags computed **live** from the ledger (`server/src/services/audit/flagDetection.js:1-60`). Only the reviewer's **decision** is persisted (`FlagReview`).
2. **A canvasser BREADCRUMB / PATH MAP.** `GET /admin/reports/canvassers/:userId/path` (`reports.js:2995-3047`) returns a **time-ordered array of raw `{lat, lng, accuracy, timestamp, actionType, household address}` points, up to 5,000 per request**, rendered as a map of that person's movements (`mobile/app/(app)/admin/canvasser/[id]/map.jsx:110`; `.../day/[date].jsx:95`).
3. **A raw-coordinate CSV export** — `Latitude`, `Longitude`, `Accuracy (m)` columns per action, alongside address, voter name, party and note (`reports.js:3383-3432`).
4. **A per-canvasser quality report** — average distance, far-door counts, distance histogram (`reports.js:3050+`).
5. **An activity feed** returning the full location object per action (`reports.js:2689`, `:2733`; `admin/activities.js:51-52`).
6. **A distance-walked metric** shown to the canvasser themselves (`routes/mobile/me.js:100-106`, `:381-389`).
7. *[v6 2026-10-24 — item 39]* **Automatic pause** — a new **enforcement** use: the time and distance between a canvasser's consecutive stamps decide whether their recording pauses for review (`services/audit/paceRule.js`, read by `runPaceCheck`). The stored `PacePause` keeps the derived seconds and meters, never a coordinate; its preview (org admins) re-reads the ledger and shows addresses, not coordinates. *[v6 2026-10-25: the preview is removed (item 39(e)).]*

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

*[v6 2026-10-02: "the household's canvass status" can now be `not_target` ("Not a target voter",
item 25) on campaigns that turned that outcome on. For this outcome the point gains only the status
value — never the door note; the share map offers its filter chip only on a report that has such a
door. Within `privacy.html:101`'s "door statuses" sentence either way.]*

*[v6 2026-10-23: these points are frozen and served even on a report whose **Show the coverage map**
switch is off, and a question hidden from the report's charts still reaches the points and the map
filters unless it is also unticked there. Verified; not fixed yet. See gap 34.]*

*[v6 2026-10-24, the client reports upgrade (items 34 and 38; deploy pending): the stored point is the
same five things, now tagged with its build's snapshot and a position (`snapshotId`, `seq`), with answers
only for the map questions the report may serve; nothing is stored or served on a map-off report (gap 34
(a)). What is served changed shape. `GET /share/:token/reports/:id/map` returns an address-free payload
(columnar coordinates rounded to six decimal places, about 4 in, a status index and answer indices per
position; no ids, no `canvassers` field at all), from the report's live snapshot only. A tapped door's
street line, city, state and answers come from `GET …/map/doors`, at most 200 positions per request (a
per-door list endpoint, which the 2026-08-08 note below says was not built): so a link holder can still
page through every address of a report, as the old full point list allowed, and nothing can be enumerated
across reports. An **area-view** report stores and serves no address or door coordinate at all (item
38(a)).]*

The model's own comment calls `addressLine1` a *"coarse address"* (`ClientReportMapPoint.js:33`). **That is not an accurate description of its precision.** What it excludes is the unit/apartment line (`addressLine2`) and the ZIP.

> **[v4 2026-08-08 — building grouping on the client report map: RE-VERIFIED, nothing new is exposed.]**
> `ClientReportMap` now groups points that share a coordinate into one building glyph
> (`client/src/lib/buildings.js` `groupHouseholds`), and clicking one opens a **status tally** — the
> street line, a count, and how many doors are in each status. Every input is derived from data the
> snapshot **already** sends (coordinates + `status`); no field was added to `ClientReportMapPoint`,
> `computeReport.js`'s projection, or `clientReportView.js`'s shape, and `share.js` is untouched.
> The unit-line exclusion recorded above **still holds and was the deciding constraint**: a per-door
> list was deliberately NOT built, because it would have needed `addressLine2` on the snapshot, which
> would put apartment numbers on an unauthenticated page and falsify this section. If that list is
> ever wanted, it is a schema change, a re-publish of every report, and an edit here — not a polish item.
> One inference does change shape: a glyph now makes the *number* of canvassed doors at one coordinate
> legible at a glance, where before it was N coincident icons. That is the same disclosure ("this
> household was canvassed") already recorded below, rendered honestly rather than hidden under itself.
> *[v6 2026-10-24: a tapped spot with several doors now also lists **each door's** status and answers
> (the client reports upgrade's `ClientReportMap`, paged 200 at a time through `…/map/doors`), still
> **without any unit line**: the street line shows only when the spot's doors differ in it, and no
> `addressLine2` was added to the snapshot. Each door's status and answers were already in the point list
> the old map endpoint served whole; the list shows them, it adds no field. The unit-line exclusion
> holds.]*

> **[v6 2026-10-05 — homes placed by address at import (item 28): more accurate, nothing new exposed.]**
> A report published after the import's map-pin pass placed a home shows that home at its own spot rather
> than on a coordinate it shared with other addresses, so a glyph above stops lumping separate houses
> together; exports' Latitude/Longitude columns carry the placed pin the same way. No field was added to
> `ClientReportMapPoint` or any export, and a report published earlier keeps the map it was frozen with
> until it is republished.

> **[v5 2026-08-10 — "Voter groups" (tag) rows on published reports: NEW OPT-IN EXPOSURE, verified.]**
> A published report can now carry a **Voter groups** section: per operator-ticked tag, the tag's
> **display name** and two **aggregate integers** (`identifiedVoters`, `currentVoters`) — frozen
> into `ClientReport.stats.*.tagBreakdowns` at compute time (`services/reports/computeReport.js`
> `computeTagBreakdowns`) and shaped at `services/reports/clientReportView.js` (`shapeWindow`).
> What reaches the unauthenticated page: **operator-authored label text + two campaign-level
> counts. No voter identity, no addresses, no per-door data, no canvasser identity** — the same
> exposure class as the report title and walk-list name recorded above. Three guards, all
> code-verified: (1) **opt-in allowlist** — `visibility.visibleTags` with **empty = show NONE**
> (deliberately the opposite of `visibleQuestionKeys`; a tag never appears without an affirmative
> per-tag tick, so internal labels like "Hostile" stay internal by default and every pre-feature
> report shows nothing); (2) the allowlist itself is **not emitted** to clients — only the
> filtered rows ride the wire; (3) tag names are structurally **operator-authored, never
> canvasser-typed** — `tagOptionMap` (services/surveys/tags.js) reads `option.tag` only, and the
> `'__other__'` write-in is a question flag that can never be a tag member, so the free-text
> channel documented in the map-point qualification below has no analogue here. Published policy:
> **no edit needed** — no new data is collected, retained, or sent to any third party; this is a
> new *presentation* of existing aggregate survey data behind the existing opt-in share-link
> surface, and the policy's report-sharing language already covers operator-published aggregates.
> Pinned by `server/test/surveyTagUnits.int.test.js` (opt-in default none; unticked names absent;
> old reports render nothing).

> **[v5 2026-08-14 — door-goal progress on published reports: NEW OPT-IN EXPOSURE, verified, no
> policy edit needed.]**
> A published report can now carry a **Door goal** block: the campaign's **door target**, an
> optional **goal date** (`YYYY-MM-DD`), and three derived integers — doors done, doors remaining,
> and a percent — frozen into `ClientReport.goalSnapshot` by `snapshotGoal()`
> (`server/src/routes/admin/clientReports.js`, inside `computeBothWindows`) and shaped at
> `services/reports/clientReportView.js` (`shapeReportForClient`). What reaches the unauthenticated
> page: **an operator-authored target number, an operator-authored date, and campaign-level door
> counts the report already published in its "Doors knocked" card.** No voter identity, no
> addresses, no per-door data, no canvasser identity, no personal information of any kind — the
> same exposure class as the report title, the walk-list name, and the tag rows above. Guards, all
> code-verified: (1) **opt-in** — `visibility.showGoal`, **default `false`**, deliberately following
> `visibleTags` rather than `visibleQuestionKeys` precisely because this page is unauthenticated, so
> every report published before this feature shows nothing and needs no migration; (2) the block is
> **omitted from the shaped payload entirely** unless ticked — an unticked goal never crosses the
> wire, so no downstream renderer can leak it; (3) **progress only** — the model stores no pace, no
> ahead/behind verdict and no projected finish date, so a frozen artifact cannot keep asserting a
> stale judgement; (4) an **effort-scoped report gets no snapshot at all**, and ticking the box
> without one is a `400 NO_GOAL_SNAPSHOT` rather than a silent empty render. **What we collect,
> how long we keep it, who can access it, and who we share it with are all unchanged** — this is a
> new presentation of aggregate door counts already inside the report, behind the existing opt-in
> share-link surface. Published Privacy Policy / ToS / DPA: **no sentence changes** (the §B8
> framing — *"aggregate counts, not records"* — applies directly). Pinned by
> `server/test/campaignGoal.int.test.js` (the goal fields themselves) and the
> `NO_GOAL_SNAPSHOT` refusal path.

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
| **Password on NEW links** | **VERIFIED.** Every link created through the admin API gets a bcrypt-hashed password; if the operator supplies none, a 12-char random one is generated and returned once (`clientReports.js:180-184`, `:231`, `:240`, `:247`). *[v6 2026-10-24: the link routes moved to `routes/admin/clientReportShares.js` and the generator to `services/reports/shareLinks.js`; an operator-set password must now be 12 or more characters too, on create and on change (`SHARE_PASSWORD_TOO_SHORT`), and an older short one is flagged after its next successful unlock (`passwordMeetsRule`, item 38(e)).]* |
| **Expiry on NEW links** | **VERIFIED.** `expiresAt = now + SHARE_LINK_DEFAULT_DAYS` (default **90**, `clientReports.js:173`, `:241`). Expired links return **410** before any report data (`share.js:35-40`). Expiry cannot be extended or cleared via the API. *[v6 2026-10-24: superseded — expiry is now chosen (30, 90, 180 or 365 days; default still 90) and can be **extended**, never past one year from the link's lifetime start (`lifetimeStartAt ?? createdAt`, compared inside the write, so it never shortens either); an **expired** link can't be extended (`SHARE_NEEDS_RENEW`) but is **renewed**: a new URL token, a new one-year life, the credential version bumped, so a URL forwarded long ago stays dead. Extend also gives a legacy never-expiring link its first expiry. Expiry still can't be cleared. `routes/admin/clientReportShares.js`.]* |
| **LEGACY links** | **VERIFIED OPEN.** Links created **before this release** have `passwordHash: null` and `expiresAt: null` and **remain fully live**. `share.js:57` waves through any link with a null password hash; `share.js:35` treats a null `expiresAt` as unexpired. **No migration remediates them** — I listed all 24 files in `server/src/migrations/` and grepped for `ShareLink`/`passwordHash`: **zero hits.** The code comments at `share.js:33` and `models/ReportShareLink.js:35` refer to "the migration" **as if it exists. It does not.** *[v3: still no migration, and the phantom comments are still in the code — but an operator bulk kill switch now exists (`POST /admin/client-reports/shares/revoke-legacy`, dry-run unless `confirm:true`, deliberately not automatic), and the policy now discloses the pre-July-15 links honestly. Legacy links stay live until an operator flips it.]* |
| **Search-engine indexing** | **VERIFIED: NO PROTECTION.** *[v6 2026-10-24: the control is now the `X-Robots-Tag: noindex, nofollow` header, on every `/r/` HTML response (the SPA fallback in `app.js`) and every `/api/share` response; robots.txt **no longer disallows `/r/`**, because a crawler it keeps out never sees a noindex and can still list a forwarded link's bare URL. Pinned in `staticPages.int.test.js`. The v3 stamp that follows is history.]* *[v3: protection added — `robots.txt:7` now has `Disallow: /r/`, and `PublicReportLayout.jsx` injects `<meta name="robots" content="noindex, nofollow">` on every `/r/` page. Precision: the noindex is client-JS-injected only (no `X-Robots-Tag` header, no server-rendered meta), so robots.txt is the load-bearing control against non-JS crawlers.]* No `noindex` meta tag, no `X-Robots-Tag` header, no noindex directive anywhere in the client or server (grep: zero hits). `client/public/robots.txt` is `User-agent: * / Allow: / / Disallow: /api` — **`/r/` is not disallowed.** *Mitigating: the URL is unguessable, and the page is client-rendered with its data fetched from `/api/share/...`, which robots.txt does disallow — so a compliant crawler like Googlebot would likely index the URL and shell but be blocked from the report content. **robots.txt is advisory only.** It does not bind scrapers, archivers, or link-preview/unfurl bots, none of which are prevented from retrieving the full report JSON from an open legacy link.* |
| **Revocation** | **PARTIAL.** Deactivate / delete / rotate work on the next request (`share.js:28`). A **bulk** revoke exists but targets **only** the legacy/open subset and is a **dry run unless `confirm: true`** (`clientReports.js:261-286`). It is **not automatic**. It also skips the per-campaign authorization check every other route in the file performs, so a team lead can revoke legacy links across campaigns they do not manage. *[v6 2026-10-24: the sweep has been admin-only since 2026-08-07 (item 10 of *What changed since v2*), lives in `routes/admin/clientReportShares.js`, and now bumps each swept link's credential version; disable, rotate, renew and a password change likewise end every open session at once (the `cv` stamp on the row below). Take down hides a single report from every link without touching the link.]* |
| **Password change ≠ revocation** | **VERIFIED.** The unlock JWT carries only `{shareId, campaignId}` with a 24h TTL (`services/auth/tokens.js:22-30`) and is never re-checked against the password (`share.js:63-68`). An already-unlocked viewer retains access for up to 24 hours after a password change. *(Link **revocation**, by contrast, does take effect immediately, because `loadShare` re-queries `isActive` on every request.)* *[v6 2026-10-24: fixed — the share token now carries the link's credential version (`cv`), bumped in the same write by a password change, rotate, renew, disable and the revoke-legacy sweep, and `requireShareAccess` refuses a token whose `cv` doesn't match, so every device is signed out at once (`routes/public/share.js`, `services/auth/tokens.js`; pinned in `shareLinks.int.test.js`). Tokens last 24 hours, or 30 days with Keep me signed in (item 38(f)).]* |
| **Password can be REMOVED from any link, today** | **VERIFIED.** `shareUpdateSchema` accepts `password: null` (`clientReports.js:197`), and `:310-312` sets `passwordHash` back to `null`. Passwordless links are **not** a closed legacy set. *[v3: fixed — a falsy password now 400s with `SHARE_PASSWORD_REQUIRED` ("replace it, or rotate the link"); removal is unsupported, which is what lets the policy say new links are password-protected as a class.]* |
| **Metadata is never gated** | **VERIFIED.** `GET /share/:token` (campaign name, organization name, link label) has **no** `requireShareAccess` (`share.js:84`). *[v6 2026-10-24: fixed — `GET /share/:token` now returns only `{ requiresPassword }`; the campaign and organization names and whether there is a logo ride `GET /share/:token/reports`, behind access, and the link's label is never sent. "Last opened" is stamped only when access is granted, never by the password screen or a wrong guess.]* |

> **Do NOT write:** *"Report links are password-protected and expire."* **False** as a statement about links as a class.
> **Write:** *"Report links created since [date] are protected by a password and expire after 90 days by default. Links created before that date may remain accessible without a password and do not expire until an administrator revokes them."*
> **COULD NOT DETERMINE:** how many open legacy links exist in production. That requires a database query. **Ask engineering before this sentence ships.**

**One thing an unguessable token is not:** it is a **capability**, not access control. It survives forwarding, it does not expire on a legacy link, and there is no rate limit or logging preventing its reuse by anyone who obtains it. The only rate limit on this surface throttles failed **password** attempts, not token access (`share.js:106-114`). *[v6 2026-10-24: password guessing is now also budgeted **per link**: a slot is reserved before bcrypt runs, so no link checks more than 50 wrong passwords in any 24 hours however many addresses the guesses come from, and the 50th locks it for new sign-ins (never ending a session already open) until the oldest of the 50 is a day old, Unlock now or a rotate (`reserveUnlockSlot`, `services/reports/shareLinks.js`; 300 concurrent guesses meet exactly 50 compares in `shareLinks.int.test.js`). The per-IP limiter stays. Logging: every link change, each UTC day's 10th wrong password and every lock write a History row (no IP or user agent, item 38(g)), and the report counts its opens per link (item 38(c)). The capability point stands: a valid link and password, or a session already open, are neither limited nor logged by who uses them.]*

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

*[v6 2026-10-24 — item 39: one new staff-facing output, and no new way in. `npm run replay:pace-pause` (the Heroku Run console) prints automatic pause's would-be pauses as **counts per customer organization only** — no name, id, address or coordinate, and a count under 3 as *fewer than 3*, since staff can see an organization's member list. The per-person preview stays in the product for the organization's own admins (`GET /admin/pace-pauses/preview`), and the pause review screens sit behind `orgContext` like every org page, so staff reach them only under a support grant.]* *[v6 2026-10-25: the per-person preview is removed (item 39(e)); the review screens' gate is unchanged.]*

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
>
> **[v4 2026-07-29, stamped 2026-08-07: STILL CLOSED, different mechanism.]** The blanket
> `VENDOR_READ_ONLY` rule and `denyVendorPrivilegeWrite` were removed by owner decision — support
> staff may now perform membership/crew writes, each recorded by `accessLog`. The self-mint hole this
> section describes stays closed by a per-**target** guard: `refuseVendorStaffTarget`
> (`services/memberships/vendorGuards.js`) 403s any membership write whose *target* is a Doorline
> staff account (`STAFF_SELF_MINT`) — on `/admin/memberships` and all four `leadCrew` writes
> (create, coordinator, deactivate, reactivate) — so a grant still cannot be converted into a
> Membership for the staffer. Pinned by `supportAccess.int.test.js` and
> `perCampaignCrews.int.test.js`.

`requireOrgRole()` returns `next()` **unconditionally for any `isSuperAdmin` caller, before any role check** (`middleware/auth.js:58`). So a super-admin holding a grant passes the admin gate on `/admin/memberships` and can **create a Membership — including for themselves** (`routes/admin/memberships.js:24` is the only gate). Once a Membership exists, `orgContext`'s membership-first branch takes over, `req.supportGrant` is never set again, and `accessLog` short-circuits **forever**. `/admin/memberships` is also absent from `VOTER_CONTENT_ROUTES`, so the membership-creation request itself writes no audit row.

I did **not** execute this and did **not** fully trace the `POST /admin/memberships` body schema to confirm a staffer can name themselves. **Treat as a control weakness for engineering review, not a proven exploit.** The first step (creating the grant) *is* recorded in `SupportAccessGrant`, so the escalation is not invisible — but the subsequent reads are.

### HOLE 4 — The Bull Board job console is outside everything. **VERIFIED.**

> *[v6 2026-10-10: the guard now accepts ONLY its own 10-minute ticket (`purpose: 'bullboard'`) and ONLY
> from the `bb_token` cookie — a session token (revoked or not), `Bearer` and `?t=` are refused, so no
> credential is logged through the query string and a revoked super-admin token no longer opens it. A
> still-valid super-admin token can still mint a ticket through the console's Jobs page, by design. A
> ticket already minted keeps working for up to its 10 minutes (the guard never reads the database).
> The job-payload findings below are unchanged.]*

`app.use('/admin/queues', requireBullBoardAuth, createBullBoardRouter())` — mounted at the **app root**, outside `/api` (`server/src/app.js:97` *[v3: line drifted from :77 as app.js grew; the finding itself was re-verified 2026-07-16 and still stands — no grant, no audit]*). It therefore never traverses `routes/index.js`, where `orgContext` and `accessLog` live. `queues/bullBoard.js` calls it *"a cross-tenant job console (all orgs' jobs)."* **No grant, no audit.**

I looked for voter PII and did **not** find any rendered: job payloads are ids (`{importJobId}`), and turf jobs carry `{campaignId, passId, mode, params, generatedBy}`. **But:**
- `params` is an **unvalidated pass-through of `req.body.params`** (`routes/admin/turfs.js:170`, `:211`) and in practice carries the admin's **hand-drawn map polygons** and **voter targeting criteria** (party, gender, age range, precinct/district/city/zip, survey-answer ids and their human-readable labels — `services/walklist/resolveWalkList.js:12-35`; `services/turf/generateTurf.js:74`). These are personal-data selection criteria, not "opaque ids."
- BullMQ persists a failed job's `failedReason` and stacktrace for **30 days** (`queues/index.js:22`). `importProcessor.js:287` rethrows **every** error, and `csvImporter.js:373`/`:413` `bulkWrite` against unique indexes on `{campaignId, normalizedAddress}` (`models/Household.js:90`) and `{organizationId, stateVoterId}` (`models/Voter.js:74`) with **no duplicate-key guard**. A MongoDB `E11000` message **embeds the offending key value** — a street address or a state voter ID. **REACHABLE MECHANISM, NOT AN OBSERVED LEAK** — I did not reproduce it.

> **Do NOT write:** *"Bull Board / our job console contains no voter content."* Say *"no voter records are enqueued"* if you must say anything.

---

# F — MULTI-TENANCY

## F14. Can one customer's data reach another customer's? What is shared across organizations?

**PARTIAL. No customer can read another customer's voter data. But five things cross the tenant boundary, and one of them is the platform staff console.**

> **(v6 stamp 2026-10-24) A sixth crossing, found and fixed.** The per-person report drills
> (`/admin/reports/canvassers/:userId/summary` and `/responses`) and the canvasser CSV's crew stamp
> returned **any** account's name, email, phone and last sign-in by user id. Any admin or team lead of
> any organization could read another organization's people that way, so "no customer can read
> another customer's data" did not hold for those fields. Fixed 2026-10-24, deploy pending: see
> numbered item 35 and the 2026-10-24 watchlist bullet.

### What is correctly isolated (VERIFIED — I traced it)

`orgContext` requires an **active Membership** in the org named by `X-Org-Id` on every request, else 403 (`orgContext.js:58-67`, `:101-103`). Every content-bearing admin router **and the query itself** scopes to `activeOrgId`: reports `baseFilter` always ANDs `organizationId` (`reports.js:123-136`, so a foreign `?campaignId` returns zero rows); voters (`admin/voters.js:47`, `:196`, `:256`, `:291`, `:309`); campaign-nested routers each re-verify campaign ownership against the active org before touching sub-resources (`turfs.js:33-47`, `efforts.js:26-46`, `walklists.js:27-42`, `passes.js:24-39`, `voted.js:20-35`, `campaignHouseholds.js:33-38`, and six more). Mobile 404s a household from another org (`mobile/canvass.js:55-68`). All seven `/super-admin` routers require `requireSuperAdmin`.

**I did NOT exhaustively audit every one of ~40 admin sub-routers.** I found no missing-filter bug in the routes I read. I cannot certify absence.

### EXCEPTION 1 — The `/super-admin/persons` cross-org identity console. **VERIFIED. See E13, Hole 1.**
This is **platform-staff** cross-org visibility, **not** customer-to-customer. No customer can reach another customer's data this way. But it is the single most important exception in this brief, and it means **no sentence of the form "your data is only ever visible to your organization and to Doorline staff acting under a logged, time-limited grant" is true.**

### EXCEPTION 2 — `GeocodeCache` is a global, cross-customer address cache. **VERIFIED.**
No `organizationId`. If org A geocodes an address and org B later imports the same address, **B hits A's cache entry** — the lookup is `{provider: 'geocodio', cacheKey: {$in: [...]}}` with **no org term** (`services/import/geocode/geocodeService.js:146-149`; upsert keyed on `cacheKey + provider` only, `:90-98`). Never deleted (B5).

**It is weakly observable to a customer, as a count.** `ImportJob` stores `geocodedNew` and `geocodedCached` (`models/ImportJob.js:36-37`) and the org-scoped import routes return the whole job document (`routes/admin/imports.js:348`, `:359-368`), so a customer admin sees how many addresses in their import were **already present in the global cache** — including entries put there by other customers (`geocodeService.js:165`). It is a **count, never a list**, and it is confounded by the org's own prior imports. **My assessment that this could in principle be turned into a one-bit "has any Doorline customer ever geocoded this exact address?" oracle (import a single address, compare the two counters) is INFERENCE from the code path, not an observed exploit — I did not test it.** Low severity. But it is why I would not describe the cache as "purely internal and invisible to customers."

> **[v6 2026-10-05 — the map-pin pass (item 28): its own counters are hidden from organizations; one
> residual signal recorded honestly.]** The pass keeps bought-vs-cached counts (`pinLookupsNew`,
> `pinLookupsCached`), its ceiling count (`pinLookupsOverCap`), the ledger of probed household ids
> (`pinProbedIds`) and the provider cause (`pinPassCause`) on `ImportJob`; `ORG_HIDDEN_IMPORT_FIELDS`
> (`routes/admin/imports.js`) strips all five from every org-facing import read — the list, the detail and
> the cancel route — pinned by `test/orgImportFields.int.test.js`, and the cause is never written to the
> org-visible `lastError`. Placement never comes from the cache alone: every in-budget candidate is probed
> through `resolve()`, and the over-ceiling cutoff is by position, never by cache state. **Residual:**
> during a provider failure, an import whose in-budget homes were all cached still places them, while one
> with a miss places nothing and its org-visible line reads "Map pins weren't checked this time" — a
> failure-time, count-level signal of the same kind as the existing `geocodedCached` precedent above.
> **Assessment for the owner to confirm before the deploy:** this does not materially decrease protection
> under DPA §4 (tenant isolation) or make `privacy.html:105` ("Customer data is not shared with, or
> visible to, other customer organizations") false — no other customer's data, list or address is shown,
> and the new counters that would have sharpened the existing signal are withheld.

### EXCEPTION 3 — The `User` account is a global, platform-wide record. **VERIFIED.**
One human has **one** `User` row (name, email, phone, password hash) with a **globally unique email** (`models/User.js:4-60`), and holds a separate `Membership` per organization (`models/Membership.js:41`). A user can be an active member of multiple customer organizations simultaneously.

**What such a user can SEE is correctly gated** — one org at a time, only orgs they are a member of. No union view, no cross-org query surface for them.

> **(v6 stamp 2026-10-24) There was one cross-org query surface, now closed.** The per-person report
> drills looked a `User` up by id alone, so the global record was readable by any other organization's
> admins and leads who held the id: name, email, phone and last sign-in. They now answer only for
> someone the organization carries, and for a team lead only someone on their campaigns. See numbered
> item 35.

**But two things cross the boundary:**

- **The global email namespace is an account-existence oracle, and lets one org attach another org's user.** When org A's admin adds a member whose email already exists **anywhere** on the platform, the API returns **409 `EMAIL_EXISTS_USE_LINK`** (`services/memberships/createMember.js:50-51`, `:61-66`). With `linkExisting: true`, org A creates a Membership on that existing global account — **with no consent gate of any kind** (`:53-60`, `:83-94`). Org A's Users page then displays that person's firstName, lastName, email, phone, `isActive`, `createdAt`, **`lastLoginAt`** (a *global* last-login, reflecting activity in any org) and **`isMultiOrg`** (`routes/admin/memberships.js:137-148`). Notification is **after the fact only** (`Membership.acknowledgedAt`). The same flow is reachable by a **team lead** (`routes/admin/leadCrew.js:23`, `:91-97`).
  > **(v4 stamp 2026-08-08) Narrowed on the CAMPAIGN door; unchanged on the org door. The line
  > citations above are pre-2026-08-08 and no longer resolve** — `createMember.js` now carries
  > `resolveEmailInOrg` ahead of `createOrgMember`, and the lead path is `leadCrew.js` `POST /` +
  > `POST /resolve`.
  > **What changed.** The campaign add flow resolves the address **before** it writes, and the answer is
  > org-bounded: a colleague is named, and *everything else* — no account anywhere, an account in another
  > customer's org, an address released by a deleted account — returns one byte-identical
  > `{outcome:'outside', person:null}`, pinned by a `deepStrictEqual` between the foreign-account and
  > no-account bodies (`test/teamLead.int.test.js`). The pre-commit oracle described above therefore **no
  > longer answers on this door**: `EMAIL_EXISTS_USE_LINK` is unreachable from `POST /crew`. Attaching
  > still works — owner decision, the returning-canvasser path is real — but the operator commits
  > *first* and learns the identity only in the 201, by which point an `addedToOrg` email has gone to
  > that person and an audit row exists. The typed name and typed password are **discarded** on that
  > branch, so an attach can no longer overwrite a stranger's name or set their password. The lookup is
  > rate-limited per actor (`middleware/crewResolveLimit.js`, 30/hour) and every answer that names
  > somebody writes an `AccessLog` subject line — the same record-level trail as opening a profile.
  > **What is NOT closed, said plainly.** `POST /admin/memberships` (org Users page, `requireAdminRole`)
  > keeps `linkExisting` and all three codes, so the oracle survives for **org admins on the org door**.
  > And the takeover path below survives one step later: once the attached person holds a Membership,
  > `PATCH /admin/memberships/:userId/password` is gated only on "a Membership exists in my active org",
  > and passwords are per-USER. Item 14 stands.
  > **Direction: narrows.** No new field, no new retention rule, no new subprocessor, no published-policy
  > sentence affected. The new audit line records a `userId` we already hold.
  > **(v7 stamp 2026-10-27, item 42) One correction and one loosening.** *Correction:* "every answer that
  > names somebody writes an `AccessLog` subject line" was never true for a customer's own staff. The
  > route adds the person to the record-level audit subjects, but `AccessLog` keeps those only for Doorline
  > staff working under a support grant (`middleware/accessLog.js`), so an org admin's or lead's lookup
  > leaves no access record; the per-actor limit is the defence (item 41 already said so). *Loosening, by
  > owner decision (2026-10-26):* the one 30-an-hour limit is now two per actor — **60 an hour for lookups
  > that find nobody** (`outside`), **30 an hour for lookups that name somebody** — and once either is spent
  > every lookup waits, so a refusal can't say which kind a lookup was. The `outside` body is still
  > byte-identical, and the membership query now runs whether or not an account exists, which narrows the
  > timing difference named in `createMember.js`. **Direction: loosens** (more `outside` probes an hour);
  > no published-policy sentence speaks to lookup rates.
  **And it is a takeover path.** *[v3: reviewed and left unprevented by decision — admin reset is the
  product's only password-recovery mechanism, so blocking it would strand multi-org users entirely;
  the reset now issues a visible forced-change temp password (misuse locks the victim out loudly, not
  silently), email changes are multi-org-locked (`MULTI_ORG_EMAIL_LOCKED`) while passwords are not,
  and the rationale is recorded at `memberships.js:423-432`, which cites this document. Closing it
  properly needs per-org credentials or self-serve email reset.]* Once the Membership exists, org A's admin can **reset that user's password** — `PATCH /admin/memberships/:userId/password` is gated **only** on "a Membership for this user exists in my active org" (`memberships.js:385-420`), which org A just minted. That password logs in, and the login response returns `memberships` **for every org the user belongs to** (`routes/auth.js:110-111`). `mustChangePassword` does not block `/auth`, so `POST /auth/change-password` clears the flag and yields a full cross-org session. **INFERRED FROM CODE PATHS, not executed.** It is destructive and detectable (it burns the victim's real password), but it is not prevented. **Escalate to engineering.** *[v4 2026-07-18: narrowed — the victim can now recover WITHOUT any admin via the emailed self-serve reset, and completing it REVOKES the attacker's minted session (`SESSION_REVOKED`); the attack itself (open by owner decision, item 14) is unchanged.]*
- **`isMultiOrg` is disclosed to customers.** An org admin is told, for each of their own members, a boolean indicating that person **also belongs to at least one other organization on the platform** — computed from an **unscoped** aggregate over all Memberships (`memberships.js:109-114`, `:145`). Only a boolean; never the name, id or count of the other orgs. Minor, but it is a genuine cross-tenant inference **shown to customers**.
  *[v6 2026-10-24: one more bit, by owner decision (item 37): the deletion review tells an org's admin when the person also holds a membership elsewhere in ANY status, switched off included (`OTHER_ORGANIZATION`), which `isMultiOrg` (active memberships only) does not. Nothing else crosses: no name, id or count.]*

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

*[2026-08-17: **FIXED in code.** The poll route now refuses any job whose `job.data.campaignId` is not the caller's gate-checked campaign — `routes/admin/turfs.js` `/jobs/:jobId` 404s on mismatch, with a comment naming this exact enumeration risk. The check governs every job kind on the queue: the 2026-08 turf batch added `claim` (walk-list door moves) and `supplemental` (add-books) jobs alongside `generate`, all carrying `campaignId` in `job.data` and all polled through this one ownership-checked endpoint. That batch collects no new personal data and sends nothing to any new party — its writes rearrange existing per-org Household/Turf rows and its one new ops script (`repair:orphan-attribution`) re-stamps existing per-org ledger rows in place.]*

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
| 6 | **Expo / EAS** | OTA update checks (device IP + update metadata). EAS Build receives the app **source code**. *[v6 2026-10-15: precisely — device IP, a per-install `EAS-Client-ID`, update metadata, and after a fatal error inside expo-updates' error window up to 1,024 characters of it (the error text on iOS). Error recovery Part A keeps post-launch JavaScript errors out of that window — item 30.]* | VERIFIED |
| 7 | **Apple / Google** | App distribution and review. Plus **platform location services** (see below). | PARTIAL |

### GEOCODIO — the loud one. **VERIFIED.**
The server builds a single-line address string — `addressLine1, city, STATE ZIP5` (e.g. `123 Elm St, Des Moines, IA 50310`) — and **POSTs batches of up to 1,000 of them** to `https://api.geocod.io/v2/geocode` with the API key in the query string (`services/import/geocode/geocodeService.js:64-70`, `:196-200`; `geocodioProvider.js:13-40`).

**Scope limits that are true and favourable, all verified:**
- **Only the address is sent.** No voter name, no voter ID, no party/age/gender. **The unit/apartment number is deliberately omitted** (`geocodeService.js:64-69`).
- **Only households MISSING coordinates are sent** (`:45-47`, `:127-135`). Addresses that arrive from the customer's file with coordinates, or that hit the local cache, are never transmitted.
- The whole path is gated behind `GEOCODE_ENABLED === 'true'` **plus** a `GEOCODIO_API_KEY` (`services/import/importProcessor.js:129`).

> **[v4 2026-08-08 — a second caller of this path: `repair:import-pins`. NOT a new subprocessor, NOT a
> DPA §6 event.]** `server/src/migrations/repairImportPins.js` re-checks the addresses of doors whose
> import pin looks wrong (out of state, far from their own street, sharing an exact pin with doors
> from other streets — a vendor placeholder coordinate — or knocked from far away by 2+
> canvassers) by calling the **same** `geocodeService.resolve()` with the **same** address string and the
> same unit-line omission. Same recipient, same data category, same purpose (turning an address into a
> coordinate) — so the subprocessor list in `docs/DPA.md` §6 and the Privacy Policy's service-providers
> paragraph are **unchanged and still true**; no customer notice is triggered.
> Two things narrow it further, both deliberate: the script is **cache-only by default**
> (`resolve(map, { cacheOnly: true })`, added for exactly this reason — it serves what `GeocodeCache`
> already holds and never calls the provider), so a routine audit transmits **nothing**; and a provider
> lookup happens only when an operator passes `--geocode` explicitly, for the shortlisted doors only,
> never the campaign. The bullet above — *"only households MISSING coordinates are sent"* — now has one
> narrow, operator-initiated exception: a door that HAS coordinates believed to be wrong. That is the
> only claim on this page the change touches, and this stamp is the correction.

> **[v6 2026-10-05 — a third caller of this path: the import's map-pin pass (item 28). NOT a new
> subprocessor, NOT a DPA §6 event.]** `server/src/services/households/placeStackedPins.js` runs at the end
> of every apply import and sends, through the **same** `geocodeService.resolve()` and the same address
> string, the addresses of **that file's** homes that the file put on a map spot shared with other
> addresses (or on a building's spot with a different address): homes that HAVE coordinates, believed
> wrong. It is gated exactly like import geocoding (`GEOCODE_ENABLED === 'true'` **plus**
> `GEOCODIO_API_KEY`, `importProcessor.js` `allowPaid`), automatic rather than operator-initiated, and
> capped at `PIN_PLACEMENT_MAX_HOMES` (default 25,000) homes per import. Two claims above are corrected by
> this stamp: **(1)** *"Only households MISSING coordinates are sent"* is no longer true at import either,
> and the v4 stamp's *"narrow, operator-initiated exception"* is no longer the only one; **(2)** *"The
> unit/apartment number is deliberately omitted"* holds for **line 2 only** — `addressString`
> (`geocodeService.js:64-69`) sends line 1 as the file gave it, so a unit written into line 1 ("100 Main St
> Apt 4") is sent, as it always has been for addresses missing coordinates. Line 2 and names are never
> sent. Same recipient, same data category, same purpose: `docs/DPA.md` §6 ("Geocodio (address
> geocoding)") and `privacy.html:106` ("we send only the street address — never anyone's name") stay true.
> `repair:import-pins` is unchanged by this release and still checks shared spots.

> **[v6 2026-10-10 — Pin Fixes at scale (item 28 stamp): wider import triggers and two more callers. NOT a
> new subprocessor, NOT a DPA §6 event.]** At import the pass now also looks up a file's homes pinned **far
> from their street** and any home whose file coordinate was **refused** (0,0, outside its state). A lead or
> admin can start the same pass from Pin Fixes (**Look up by address**: an ImportJob of kind `pin_lookup`
> over flagged homes of one campaign, earlier imports' included), and an operator can run `npm run
> pins:measure-estimates`, which looks up a sample of one campaign's ordinary vendor pins. All three use the
> same `geocodeService.resolve()`, the same address string and the same gate (`GEOCODE_ENABLED === 'true'`
> plus `GEOCODIO_API_KEY`). The bullet *"Only households MISSING coordinates are sent"* gains these
> exceptions; *"The unit/apartment number is deliberately omitted"* still holds for line 2 only (v6
> 2026-10-05 stamp). `docs/DPA.md` §6 and `privacy.html:106` stay true.

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
- **Voter names and street addresses**, whenever anyone uses a search box: `/admin/voters?search=John%20Smith` (`routes/admin/voters.js:71` — regex-matched against `fullName`, `stateVoterId`, `addressLine1`, `city`, `zipCode`), `/mobile/voters?search=` (`routes/mobile/voters.js:89-100`), `/super-admin/persons?q=` (`routes/superAdmin/persons.js:35`), household address search (`reports.js:2797`). *[v6 2026-10-01: plus `/admin/campaigns/:campaignId/voters?search=` — the campaign Voters tab (item 24), the same `listVoters` regex and the same query-string exposure, now reachable by team leads; the `voters.js:71` pin on this bullet has rotted (the org search lives in `services/voters/voterDirectory.js`), cite by module.]*
- **Free-text search over what canvassers wrote about voters** — `/admin/reports/notes?q=` (`reports.js:3415`).
- **Every public report capability token**, because it is a **path segment**: `/api/share/:token` (`routes/public/share.js:27`). **The token is a credential, and it is written to a log.**
- The client IP and user-agent of every request, including the continuous foreground polling from canvassers' phones.

> **Do NOT write:** *"Hosting-provider logs contain only IP addresses and technical metadata."*
> **COULD NOT DETERMINE:** Heroku's log retention, and whether a **log drain** forwards these to a further third party. No drain, log add-on, or error-tracker is configured anywhere in the repo — **but drains are attached via the Heroku dashboard/CLI and would not appear in code.** **This must be confirmed from the Heroku dashboard before the subprocessor list is final.**

### APPLE / GOOGLE — more than distribution. **PARTIAL.**
`mobile/eas.json:34-45` configures EAS Submit to App Store Connect and the Google Play `internal` track. **Doorline embeds no Apple or Google analytics, crash-reporting, advertising, push (no FCM/APNs), or payment SDK** — verified across all four `package.json` files. *[v6 2026-10-15: stands — error recovery adds no SDK; what the platforms already receive about errors is recorded in item 30.]*

**But two things are not "distribution only":**
1. **On Android, every location fix the app takes is served by Google Play Services' Fused Location Provider.** `expo-location` links `com.google.android.gms:play-services-location` and calls `LocationServices.getFusedLocationProviderClient`. On iOS the equivalent is Apple's CoreLocation. **Our code does not transmit canvassing data to Apple or Google, but we cannot assert from this codebase that these platform location SDKs send nothing to their vendors.**
2. **Apple and Google app reviewers are issued working logins to a demo organization in production** (`server/src/utils/seedDemoOrg.js:152-170`). That org's voter identities are **synthetic** (`:210`), so no customer data is exposed.

> **Safe language:** *"We do not integrate Apple or Google analytics, advertising, or tracking SDKs, and we do not transmit customer or voter data to Apple or Google. Our Android app obtains device location via Google Play Services' location APIs and our iOS app via Apple's location services; data those platform services may collect is governed by Apple's and Google's own privacy policies."*
> **See also "THINGS YOU DID NOT ASK ABOUT," item 2 — device backup. This is the Apple/Google issue that actually matters.**

### NOT PRESENT — verified negatives you may rely on
- **NO PAYMENT PROCESSOR. Stripe is NOT integrated and receives NO data.** There is no `stripe` package in any of the four `package.json` files. `models/Subscription.js:44-47` contains dormant placeholder fields (`source` enum permitting `'stripe'`, a null `stripeCustomerId`) with comments describing Stripe as a **future** phase. Billing is manual/internal. **Do NOT disclose Stripe as a subprocessor.** If the business collects payment out-of-band, that is outside this codebase.
- **NO email provider, NO SMS provider, NO crash-reporting, NO error-tracking, NO product analytics SDK.** Swept all four `package.json` files for Sentry, Bugsnag, Datadog, New Relic, LogRocket, Nodemailer, SMTP, SendGrid, Mailgun, Postmark, Resend, Twilio, AWS SES/S3, Segment, Amplitude, Mixpanel, PostHog, Firebase, GA, GTM: **zero.** The web page has no third-party script tags and self-hosts its fonts. **Consequence: there is no automated password-reset email — recovery is admin-issued temporary passwords only, and there is no mechanism to warn anyone of anything.** *[v4 2026-07-17: **THE EMAIL HALF OF THIS NEGATIVE FLIPS.** Transactional email via **Resend** now exists — `services/mail/mailer.js` POSTs to `api.resend.com` with global fetch, so the package.json sweep still finds zero mailer dependencies, but the CONCLUSION is void: self-serve password reset, invite/set-password links, org/campaign-add notices, support-grant notices, and pre-deletion warnings all send once `RESEND_API_KEY` + `MAIL_FROM` are set (dormant until then — the DPA §6 go-live switch). Emails carry the recipient's name + address to Resend: **Resend is a subprocessor and must appear in DPA §6 and the privacy policy's service-providers paragraph BEFORE the vars are set.** Emails never contain passwords. SMS/analytics/crash negatives all stand.]* *[v6 2026-10-15: the crash-reporting and error-tracking negatives still stand — the phone's error recovery (item 30) keeps post-launch JavaScript errors on the device and adds no SDK.]*
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
Raw `dateOfBirth` is stored (`Voter.js:45`, `Person.js:80`) and returned in full to the **web console** for org admins *[v6 2026-10-01: and to granted team leads, through the campaign-scoped profile — item 24; already true on the phone since 2026-07-30, see the next paragraph]*.

**The mobile bootstrap deliberately strips it and sends only a derived integer age** (`routes/mobile/bootstrap.js:22-38`), on the stated reasoning that *"a DOB is the most identity-theft-useful field in a voter file"* and must not sit in a volunteer's offline cache. **I verified this protection is intact: DOB is not in the offline file.** *[2026-07-31: the protection was route-scoped in a second way — `POST /mobile/voters/:voterId/survey` returned the **raw Voter doc (dateOfBirth, phone, phoneType, the full doNotContact subdoc)** in its response body on every survey submit, since the route existed. It never reached the offline file (the client's reconcile reads only `response.household.status`, verified against every shipped bundle's code history) — but it left the server and crossed the wire to canvasser phones on each submit. **CLOSED:** all action responses (5 disposition routes, survey, location, both superseded early-returns) now return a minimal wire shape via `toWireHousehold` — household `_id`/`status`/`lastActionAt` only, per-round — with no voter/surveyResponse/activity objects at all; pinned by `server/test/actionResponsePerRound.int.test.js` (asserts no `dateOfBirth` and no phone digits anywhere in the serialized response). Deferred, recorded here: `GET /mobile/voters` (the admin voter-search list) still ships the campaign-global `surveyStatus` boolean to any rostered caller — a cross-round tell, not PII; the chosen follow-up is a per-round rewrite for non-manager callers if that screen is ever re-exposed to canvassers.]*

**But the protection is route-scoped, not role-scoped.** `GET /mobile/voters/:voterId` returns raw `dateOfBirth` **plus `phone` and `cellPhone`** (`services/voters/voterProfile.js:141-146`; `routes/mobile/voters.js:151`), and **that route has no role gate** — the `isAdminOrSuper` check only *widens* scope. In the shipped app the only screen calling it is inside the **admin tab** (`mobile/app/(app)/voters/[id].jsx`, whose only two entry points from outside its own subtree are the **"Voter search"** row in `mobile/app/(app)/admin/more.jsx` — which opens the voter list, and the list opens the detail — and the tapped-voter link on `mobile/app/(app)/admin/notes.jsx`; both sit under `admin/_layout.jsx`, which redirects anyone who is not a super-admin and fails its `isConsoleRole(activeMembership?.role)` check), so **no canvasser-facing screen requests it**. But a canvasser's own credentials calling that endpoint directly, for a voter inside their assigned books, **would receive raw DOB and phone.** That is an authorization gap, not a product data flow. *[2026-07-30: **CLOSED.** `GET /mobile/voters/:voterId` is now management-only — `canManageCampaign` (super / org admin / lead with a grant for the campaign, and for leads the entry voter must belong to the granted campaign) or 403 `FORBIDDEN_ROLE`; the canvasser book-scope read path was removed (`routes/mobile/voters.js`). A canvasser's credentials can no longer retrieve DOB, phone, or cross-round survey answers through this route. The search list (`GET /mobile/voters`) stays canvasser-reachable but ships identity + status booleans only. Pinned by `server/test/perRoundVoterView.int.test.js` (canvasser 403 / lead 200 / cross-campaign 403 / admin 200).]* *[2026-07-29: this sentence used to pin three MOBILE line numbers (`more.jsx:131`, `notes.jsx:184`, `_layout.jsx:102-103`); every one of them had rotted — the rows and the gate had moved. **Cite a mobile entry point by its row LABEL and a gate by its predicate, never by line number.** The server-side pins in this paragraph are left as-is: they name a function in a service, which is stable. Re-verify by grepping `(app)/voters` outside `app/(app)/voters/` (two hits, both listed above) and `isConsoleRole` in the admin layout.]* *[v6 2026-10-01: **NARROWED for leads, and coded.** The route now passes `scopeCampaignId = campaign._id` to `buildVoterProfile` for every non-org-admin, so a lead's payload carries this campaign's survey answers and notes only and `otherCampaigns: []` — the cross-campaign union the 2026-07-30 stamp left in place for leads (other clients' campaign names, answers and notes, when the lead is a client) no longer reaches them; an org admin's payload is unchanged. The out-of-campaign refusal keeps its 403 status (the shipped app inspects 403 codes) and gains `code: 'VOTER_NOT_IN_CAMPAIGN'`; the add-note route refuses a manager's note on an out-of-campaign voter the same way. The same payload is now also served on the web at `GET /admin/campaigns/:campaignId/voters/:voterId` (404 `VOTER_NOT_IN_CAMPAIGN` there, for every role). Item 24 has the whole picture.]*

> **Do NOT write:** *"Dates of birth are never sent to canvasser devices"* (the API path is not blocked) **and do NOT write** *"canvassers' phones receive dates of birth"* (no canvasser screen requests them). **Write:** *"Dates of birth are stored and are visible to administrators and team leads. They are deliberately excluded from the offline data downloaded to a canvasser's device, which carries only a derived age."*

### (c) THE CANVASSER IS AN EMPLOYEE UNDER GPS MONITORING, AND IS TOLD ALMOST NOTHING. **PARTIAL.**
The fraud/quality audit makes **four machine-generated assertions about named workers** — `far`, `rapid`, `one_spot`, `weak_gps` — computed live from the GPS trail (`services/audit/flagDetection.js:18-19`, `:157-260`). The flags are not stored; what **is** stored is `FlagReview` — a human reviewer's decision with `status: 'reviewed' | 'dismissed' | 'confirmed'`, a free-text note, `reviewedBy`, `reviewedAt`, and `reasonsAtReview`. **A `confirmed` FlagReview is a stored, adverse, human-affirmed allegation about an identified worker, retained indefinitely and surviving that worker's account deletion** (`deleteAccount.js:170-173`).

**Disclosure to the canvasser:**
- **What they ARE told, in-app:** the OS permission string — *"Doorline needs your location to log when you knock on a door, so admins can verify field activity"* (`mobile/app.json:15`). And a canvasser-visible Help Center FAQ (`audience: all`, so it reaches them — `server/src/content/help/faq/delete-my-account.md:4`, `:25-28`) states: *"Canvassing records include the location where each door was logged, and an organization has to be able to check that work against a real person."*
- **What they are NOT told, anywhere in-app:** that the GPS trail is **algorithmically analyzed for canvassing-fraud flags**, that an adverse reviewer decision about them is **persisted**, or that their movements can be **replayed as a map and exported as a raw-coordinate CSV**. The Help Center articles explaining the audit are tagged `audience: lead` (`content/help/guides/audit.md:4`; `pages/page-audit.md:4`), and the role→audience map gives a canvasser only `['all','canvasser']` (`services/help/loadHelp.js:19-24`). **They cannot see them.**
- **There is no notification, no contest path, and no appeal path in the code.** There cannot be — the server has no notification capability of any kind.
  *[v6 2026-10-24 — item 39: narrowed in disclosure, widened in kind. **Disclosure:** canvassers are now told,
  in their Help Center (`faq/why-is-recording-paused.md`, audience canvasser) and on the phone's banner and
  alert, that their doors are checked for pace and that only a person on their team can lift a pause. **Kind:**
  a stored automated finding about a named worker (`PacePause`) that stops their recording until a person
  reviews it — no door removed, no number changed — kept like `FlagReview`, surviving account deletion.
  The "no notification capability" line is stale: the server has sent email since 2026-07-18, and a pause emails
  the organization's chosen admins and leads (never the canvasser). Still no contest or appeal path in the code:
  a person on the team reviews and unpauses. The far, rapid, one-spot and weak-GPS flags are still explained
  only to leads and admins.]*
- **A lead or admin who knocks doors is flagged too**, sees their own flags (the reports router admits `lead`), and — because `POST /flags/review` has **no self-review guard** (`reports.js:3340`) — **can dismiss a flag on their own knock.**

This is an **employee-monitoring / worker-privacy** exposure, not just a consumer-privacy one, and it needs its own treatment in the ToS and in whatever notice canvassers receive at onboarding.

### (d) VOTERS HAVE NO RIGHTS MECHANISM AT ALL. **VERIFIED.**
There is **no voter account, no voter role** (Membership roles are `['admin','lead','canvasser']` only — `models/Membership.js:21`), and **no voter-facing route**. A grep across server, client and mobile for do-not-contact / opt-out / unsubscribe / DSAR / data-subject / right-to-erasure returns **no implementation**. There is no `DELETE /admin/voters/:voterId` and no delete route on the Person router. *[v3 update 2026-07-17: the grep result is now stale in one respect — an admin-operated **do-not-contact** mechanism exists (`Voter.doNotContact`, `routes/admin/dnc.js`, enforcement layers per docs/VOTERS.md §D). The voter-INITIATED absence stands: no account, no self-serve route, DSARs still manual.]*

**What DOES exist:** an org admin can **correct** a voter's identity fields (`routes/admin/voters.js`, the identity PATCH), **delete a voter's survey response** (`DELETE /admin/voters/:voterId/surveys/:responseId`), and **delete a voter note**. *[v5 2026-08-02: the old line pins (`:186`, `:371`, `:303`) had rotted — the survey delete now sits at `:648`. Cited by route + method instead, per the 2026-07-29 rule below. That delete is reachable from the web voter profile and, since 2026-08, from the **mobile Duplicate surveys** screen; both are the same admin-only route.]* And a household can be marked `'restricted'` and excluded from future books via an admin `excludeRestricted` toggle (`models/Household.js:47-52`; `services/turf/generateTurf.js:49`, `:205`) — **door-level, admin-controlled, not voter-initiated,** and framed in the help copy as "couldn't physically reach the door," not as suppression. *[v6 2026-08-21: an admin can now also mark a **single home** restricted from the desk (`POST …/turfs/restrict-doors`, alongside the whole-book `restrict-bulk`) — still door-level, still framed as access ("one locked gate"), still not a voter-initiated mechanism and not suppression; the voter-rights finding is unchanged.]* *[v6 2026-10-19 — item 32: the admin's correction tools now include changing, taking out or clearing single survey answers — one voter on the profile, or many at once from Door Outcomes → Edit answers… — and every such edit keeps the earlier version. **Erase** (`DELETE /admin/voters/:voterId/surveys/archive/:archiveId`) is now on screen on each "Earlier answers" card, so a voter's request to have something removed is: edit the answer, then Erase the earlier version. Still admin-operated, still not voter-initiated; the finding is unchanged.]*

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

*[v6 2026-10-24: "disable access promptly" now also holds in a paused (read-only) org: Deactivate, Remove and delete are carved out of the billing gate (item 37). And no write can land on a deleted account any more — the login and last-seen stamps, the profile and password self-service writes, and an emailed reset or invite token are all conditional on the account being live.]*

**What actually fails to revoke is narrower and specific:**
- **Logout is a server-side no-op** (`routes/auth.js:193-195`). No denylist, no token version, no session store.
- **A password change does not invalidate existing tokens.** `change-password` writes only `{passwordHash, mustChangePassword:false, tempPasswordSetAt:null}` (`auth.js:141-145`); nothing compares a token to the hash. **A stolen or forwarded bearer token keeps working for up to 30 days after the victim resets their password** (`JWT_EXPIRES_IN`, default `'30d'`, `services/auth/tokens.js:6`). *[v4 2026-07-18: **FLIPPED.** A SELF-SET password change (emailed reset or `/auth/change-password`) now stamps `User.passwordChangedAt`, and `requireAuth` 401s (`SESSION_REVOKED`) any token whose `iat` predates it — every pre-change session dies on its next request; the changing device continues via a fresh token in the change-password response. An ADMIN temp reset deliberately does not stamp (the `mustChangePassword` gate already suspends live sessions recoverably; the stamp lands when the user completes the forced change). Null stamp grandfathers pre-feature sessions. The mobile offline queue HOLDS queued knocks on 401/`PASSWORD_CHANGE_REQUIRED` instead of dropping them, and the queue survives sign-out — billable field work survives a mid-shift reset. Guard test: `test/sessionInvalidation.int.test.js`.]*

> **Do NOT write** anything implying that logging out, or changing your password, terminates existing sessions. **Neither does.** *[v4 2026-07-18: half-flipped — a password CHANGE now does terminate other sessions, and the policy may say so. LOGOUT remains a server-side no-op; still do not claim logout ends the session.]*

> *[v6 2026-10-10 — SESSIONS revisited (gap 29): (1) **LOGOUT now ends the session server-side** when the
> request reaches the server — its `sid` goes on `User.endedSessionIds` and `requireAuth` refuses that
> token and every copy of it. The policy MAY say signing out ends that sign-in on Doorline's servers; it
> must NOT say signing out always does (an offline sign-out never arrives). (2) A self-set password
> change revokes by the sign-in time in milliseconds (`auth_ms`), carried through every extension, so an
> extended token dies exactly when its parent would. (3) Deactivation and removal are per MEMBERSHIP: they
> end access to that organization on the next request (still true, keep the sentence) but never ended
> the sign-in itself; a person left with no memberships stops being extended. (4) A used sign-in now
> lasts up to 90 days from the typed password (30 days idle; staff 30 days flat). A stolen copy of a
> session token can extend itself via `/auth/me`, so it works until 90 days after its owner last typed
> the password unless the owner signs out with signal (same `sid`) or changes the password; signing in
> again does not end it — the owner's DPA §4 call. (5) The JWT payload described above now also
> carries `auth_ms` (when the password was typed) and `sid` (the session id).]*

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

**It IS cleared on sign-out** (`mobile/lib/authState.js:41-50` calls `clearBootstrap()`) — credit that.
*[v6 2026-10-10: still true — the clear is now `authState.js:33-34` (`clearCaches`), run by
`sessionStore.js` `signOutSteps` on every sign-out (manual, password changed elsewhere, account
deleted), and a roster write guard stops a late save writing it back. A sign-in that merely RUNS OUT
is not a sign-out: the copy stays — through the prompt, after "Later", and after the password is typed
— until someone signs out, as with any expired session before (gap 29).]*
**But nothing else clears it, there is no expiry, and it persists indefinitely as long as the user stays logged in and the app stays installed.**

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
- **`diff`** (`models/ImportJob.js:86`) — samples of **moved voters** as `{stateVoterId, name, fromAddress, toAddress}` (`services/import/computeImportDiff.js:129-137`, `:200-219`). **A voter's name plus their previous and new home address, permanently, in import history.** *[v3 2026-07-17: the persisted diff now also carries `handEditConflicts.sample` — capped (100) kept-value/file-value pairs for hand-edited identity fields (can include a phone or DOB). Same class as the moved-voter samples: org-scoped, both values already held by the org (its own edit + its own upload), same ImportJob lifecycle and org-delete cascade. No new audience, no new third party.]* *[v5 2026-08-04: trimmed — `diff.samples.errors` (raw per-row error objects with `stateVoterId`, a duplicate of `ImportJob.errors` the client never read) is no longer produced or persisted. The moved/near-dup/hand-edit samples and `errors[]` below remain as described.]*
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
A campaign can only be hard-deleted if it has no canvassing history — **but that gate is a live-row existence check, not a latch.** `campaignHasCanvassed()` (`routes/admin/campaigns.js:54-58`) tests `CanvassActivity.exists()`. `POST /admin/turfs/discard` with `clearKnocks` **hard-deletes those very rows** (`routes/admin/turfs.js:343-344`) and is a **checkbox in the web console** (`client/src/pages/TurfsPage.jsx:425`). **Clearing every non-archived pass re-opens the hard-delete gate on a campaign that WAS canvassed.** *[v5 2026-08-05: `campaignHasCanvassed()` moved to `services/campaigns/deletionState.js` (the background delete worker re-checks it at claim time — a second enforcement of the same gate, not a change to it); the live-row-not-latch finding stands unchanged.]*

The campaign cascade removes 20 collections + the Voter rows housed in that campaign's households + the raw spreadsheets. **It does NOT remove:** `VoterNote` (keyed by voterId, no campaignId — **free-text notes about voters survive as orphans after the voter rows are gone**), `Person` (org-scoped — canonical identity rows with name, DOB, phone, party, gender simply left behind), `FlagReview`, `PersonMergeLog`/`Candidate`/`EditProposal`, and `GeocodeCache`. *[v5 2026-08-05: two halves of this list are superseded — the cascade has since gained VoterNote hygiene (a deleted row's notes re-point to a surviving sibling row, or delete with the person's last row; recorded in the per-campaign-voters entry of "What changed since v2"), and `CoordinatorChange` (campaignId-bearing rows) moved INTO the cascade with this release. The cascade also became a background job — same collections removed, same gate, different dyno. Person / FlagReview / merge-artifacts / GeocodeCache remain left behind exactly as recorded. See the 2026-08-05 v5 entry.]*

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
21. **`User` accounts have no retention limit at all.** A volunteer who canvassed for one weekend in 2024 still has a live row — name, email, phone, bcrypt hash, `lastLoginAt` *[v4 2026-07-22: and now `lastSeenAt`. The gap is otherwise unchanged — a **live** row keeps both clocks; only account deletion scrubs them.]* *[v6 2026-10-10: and `endedSessionIds` — up to 200 session ids from sign-outs (gap 29); org deletion keeps it, account deletion clears it.]* — indefinitely, unless they personally delete their account **from the mobile app** (there is no web deletion, and the operator CLI cannot delete a sole admin, sole billing admin, sole super-admin, or a `deletionLocked` account). (A1, B5) *[v4 2026-07-29: the parenthetical is now half-wrong — staff CAN delete an account from the web console (break-glass, typed-email confirmation, every blocker intact). **The gap itself is unchanged**: there is still no retention limit and still no SELF-service web deletion, and a staff-initiated delete is not a retention policy.]*
22. **Voters — the actual data subjects, who never consented to anything — have no account, no access, no correction, no deletion, no opt-out, and no do-not-contact mechanism.** Every request from a voter is a manual process with no tooling behind it. **This is the largest structural gap in the product from a privacy-law standpoint, and no sentence you write can paper over it.** (H16(d)) *[v3 2026-07-17: narrowed — do-not-contact is now admin-tooled (see v3 gap 1); the voter-initiated half of this finding is unchanged.]*