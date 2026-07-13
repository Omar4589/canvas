# Remediation plan — restoring processor posture

**Status:** plan only. No code changed. Derived from the read-only audit of 2026-07-13.

## Why this exists

Doorline's entire legal posture is that of a **processor**: each customer's data siloed, touched only
on that customer's instruction. In one respect the code does not behave that way.

`Person` (`server/src/models/Person.js`) is a **global** record with no `organizationId`.
`services/person/propagateIdentity.js:98-107` queries `{ personId }` with **no org filter** and
bulk-writes ten identity fields into **every Voter row in every organization** linked to that person.
The trigger is not platform staff: `routes/admin/voters.js:230` is gated on `requireOrgRole('admin')`,
so **a customer's own admin editing their own voter writes into another customer's database**. A lead
can do the same through a CSV import.

That is controller behaviour — we decide the canonical value, we merge records across customers, and we
push one customer's edit into another's database without either one's instruction. It also directly
contradicts the published policy sentence *"It is not shared with other customer organizations."*

**Target end state: identity is org-scoped. No cross-org identity graph. No cross-org writes.**

What is *not* broken, and should be said plainly: **canvassing data is genuinely isolated.** Survey
answers, door status, notes and GPS never cross between customers — no `personId` on `CanvassActivity`
or `SurveyResponse`, and the propagation allowlist structurally cannot write them. That half of the
promise holds today.

---

## ⚠️ The sequencing trap — read this before anything else

**Workstream 1's contamination rollback needs the raw uploaded import files. Workstream 3 deletes
them.**

Identity already propagated into other orgs' Voter rows does not un-copy itself when propagation
stops. For rows where we have no `identityBackup`, the only way to recover an org's *own* original
values is to re-derive them from that org's own most recent import — which lives in **GridFS**.

Ship WS3's GridFS deletion first and that data is **permanently unrecoverable.**

> **Hard dependency: WS1 rollback MUST complete before WS3.1 (GridFS purge) ships.**

---

# Workstream 0 — Published report exposure (ship first, decoupled)

### (a) Target end state
No published report can contain free-text. Report links are password-protected and expire by default.
Address-level precision is a deliberate, documented product choice rather than an accident.

### (b) Files
| What | Where |
|---|---|
| Unvalidated answer-key whitelist | `routes/admin/clientReports.js:64` — `mapAnswerKeys: z.array(z.string())` |
| Filter that trusts it | `services/reports/computeReport.js:185` |
| What lands in a map point | `services/reports/computeReport.js:206-212` — `lng`, `lat`, `addressLine1`, `city`, `state`, `status`, `answers[]` |
| Password is opt-in | `models/ReportShareLink.js:26` — `passwordHash: { default: null }` |
| Unauthenticated path | `routes/public/share.js:44` — `if (!req.share.passwordHash) return next();` |
| **The fix already exists** | `choiceQuestionKeys(template)` — already used for defaults at `clientReports.js:296,311` |

**The `mapAnswerKeys` fix needs no new code.** `choiceQuestionKeys(template)` is already written, already
used to compute the safe default, and simply isn't applied as a *validator* on the write path. Reuse it.

### (c) Migration / contaminated data
Existing published reports may **already** carry free-text answers pinned to street addresses, on
links that are passwordless and never expire.

1. **Audit script (read-only first):** scan `ClientReportMapPoint.answers` and flag any `questionKey`
   that resolves to a `type: 'text'` question in the report's frozen template. Output: affected report
   ids, org, share-link token, whether the link is live and passwordless.
2. **Remediate:** re-freeze affected reports with text keys stripped, or revoke the link.
3. **Existing links** — see the decision below; this is not a code question.

### (d) Risk / blast radius
- `mapAnswerKeys` whitelist — **low.** It can only reject a configuration that is already the bug.
- Password + expiry on **new** links — **low.** UX change only.
- Password + expiry on **existing** links — **high.** Breaks live client-facing URLs your customers
  have already sent to candidates. Product decision, not an engineering one.
- Coarsening coordinates — **high, and I recommend against it.** See below.

### (e) Effort / sequence
**S — 1-2 days.** Independent of everything else. Ship immediately.
Order: audit script → `mapAnswerKeys` guard → password/expiry defaults on new links → decide on
existing links.

### (f) Tests
- A report whose template has a `text` question: publishing with that key in `mapAnswerKeys` is
  **rejected** (400), and the frozen map points contain no text answer.
- A new share link created with no password gets one (or is refused).
- A share link past `expiresAt` returns 410, not 200.
- Regression: a choice-only report still publishes and reads identically.

### (g) Decisions needed
**D0.1 — [OMAR] Existing passwordless, never-expiring links.** Leave them, force-expire with notice, or
retro-fit a password and re-send? Every option has customer cost; doing nothing leaves live open URLs
carrying addresses + opinions.

**D0.2 — [OMAR + LAWYER] Coordinate precision. My recommendation: do NOT coarsen.** The recipient of a
client report is the customer's own client — the campaign that already owns the voter file. Showing
them their own doors at street level is not a new disclosure *to them*. The exposure is the **link's
access control**, not the precision. Coarsening would gut the product's core value to fix a problem
that is actually an authentication problem. **Fix the link; then fix the policy sentence** (WS4) to
describe what the report truly contains. Free-text stays banned regardless — it is unbounded and a
canvasser can write anything in it.

---

# Workstream 1 — Org-scope identity (the anchor)

### (a) Target end state
`Person` is org-scoped. Dedup happens **within** an organization only. No query on Voter/Person ever
crosses an org boundary. No customer can learn that another customer holds a given voter.

### (b) Options

**Option A — add `organizationId` to `Person`; identity becomes per-org. ← RECOMMENDED**

**Option B — delete the Person layer entirely; each org's `Voter` row is self-contained.**

**Recommendation: A.** Reasons:
- It **preserves the machinery you already built and tested** — merge/split, field locks,
  `fieldProvenance`, `identityBackup` — which is genuinely useful *within* an org (the same human
  appearing twice in one org's file under two state voter IDs, cross-state movers, re-keys).
- Option B is a large destructive refactor: ripping out `Person` also means ripping out
  `PersonEditProposal`, `PersonMergeCandidate`, `PersonMergeLog`, `mergePersons.js`, the super-admin
  People pages, and the reconcile service. More diff, more risk, and it throws away working code to
  solve a scoping problem.
- A leaves the door open for a *future* cross-org feature built on **explicit, contractual, per-customer
  consent** — which is a legitimate product, just not a default.

**What we keep:** within-org dedup by `uid` / `stateVoterId`, merge/split, field locks, provenance.
**What we delete:** the ownership state machine (`identityOwnerOrgId`, `ownerProvisional`), edit
proposals, and every cross-org read/write. Inside one org there is no "other owner" to negotiate with —
the org simply owns its own identities.

### (c) Files
| Change | Where |
|---|---|
| Add `organizationId` (required, indexed) | `models/Person.js` — currently has none by design (`:5-8`) |
| Unique indexes become compound with org | `models/Person.js:80-87` (today: platform-wide unique on `(uidSource,uid)` and `(registeredState,stateVoterId)`) |
| **The cross-org write — scope it** | `services/person/propagateIdentity.js:98-107` — add `organizationId` to the query object |
| Same unscoped fan-out on import | `services/person/reconcileIdentityFromImport.js:29-39` (`fanOutVoters`), `:103-107` |
| Ownership machine — delete | `reconcileIdentityFromImport.js:112-186` |
| Merge keeps a foreign owner | `services/person/mergePersons.js` — zero references to `identityOwnerOrgId`; `:141-143` re-points voters |
| **Leak: names another customer** | `services/voters/voterProfile.js:113-125` → `client/src/pages/VoterDetailPage.jsx:52-57` ("managed by {ownerOrgName}") |
| **Leak: cross-org presence oracle** | `services/import/computeImportDiff.js:28-62` (`forecastPersons` queries Person **globally**, `:40-41`) → `client/src/pages/ImportPage.jsx:89-90` |
| Super-admin cross-org People pages | `routes/superAdmin/persons.js`, `services/person/personOversight.js` — become org-scoped or are removed |
| Orphan GC | `services/import/undoImport.js:155` — `Voter.countDocuments({personId})` unscoped |

**Both leaks die naturally under Option A.** With no cross-org Person, `ownerOrgName` has nothing to
resolve — delete the lookup and the banner. `forecastPersons` scoped to the org turns "existing people"
into "people already in **your** file," which is the genuinely useful meaning and leaks nothing.

### (d) Migration + the contaminated data — the hard part

**Migration (split the global graph):**
1. For each `Person` P: for each distinct `organizationId` among Voters linked to P, create a per-org
   copy `P_org` carrying the same identity fields and key arrays; re-point that org's Voters to `P_org`.
2. Drop `identityOwnerOrgId` / `ownerProvisional`. Retire `PersonEditProposal` (nothing to propose to).
3. Rebuild unique indexes as compound-with-org. **Note prod runs `autoIndex: false`** — this needs
   `migrate:build-indexes -- --apply`, and the old *global* unique indexes must be **dropped**, or they
   will reject the split copies.
4. Keep `PersonMergeLog` as an historical record (it holds pre-merge PII — see D1.3).

**Rollback of already-propagated identity.** Stopping propagation does not un-copy what was written.
Signals available:
- `Person.fieldProvenance` — per field: `{source, orgId, userId, at, prevValue}`. **Tells us which org
  wrote the current canonical value, and what it displaced.**
- `Voter.identityBackup` — one-time snapshot of the org's pre-overwrite values.
- `Voter.locallyEditedFields` — fields the org edited itself (propagation skips these).

Per Voter `V` in org `O`, for each identity field `F`:

| Condition | Action |
|---|---|
| `F ∈ V.locallyEditedFields` | Keep — it is O's own value. |
| `V.identityBackup[F]` exists | **Restore** `V[F] = V.identityBackup[F]` — O's pre-contamination value. |
| `P.fieldProvenance[F].orgId === O` | Keep — O wrote the canonical value itself. |
| Otherwise | **Contaminated, no backup.** Re-derive from O's own most recent import of that voter — **which requires the GridFS raw file.** If unavailable, flag for the org to re-import. |

Run it **dry-run first** and report: rows touched, rows restorable from backup, rows needing
re-derivation, rows unrecoverable. That report is also what counsel needs to answer D1.1.

### (e) Risk / blast radius
**Highest in the plan.** This rewrites voter identity rows in production. Mitigations: dry-run by
default; a full `Person` + `Voter`-identity snapshot before applying; do it org-by-org, smallest first;
and keep the rollback script itself reversible (write an `identityRestoreBackup` before restoring).

Single-org customers see **no behavioural change at all** — they never had a second org linked.

### (f) Effort / sequence
**L — 1-2 weeks**, most of it in the migration and the rollback, not the scoping change itself.
Order: scope the queries → migration (split) → rollback (restore) → delete the ownership machine →
remove the two leaks → re-scope the super-admin People pages.

### (g) Tests
- **The anchor test:** Org A edits a voter's phone. Org B holds the same human (same `stateVoterId`).
  Assert **Org B's Voter row is unchanged.** This test would fail today.
- Import in Org A does not touch Org B's rows.
- `GET /admin/voters/:id` returns **no** `ownerOrgName` / `ownerOrgId` field at all.
- Import preview counts only voters already in the **calling org**; a voter that exists solely in
  another org counts as **new**.
- Within-org dedup still works: two rows, same human, same org, one `Person`.
- Migration test: a global Person linked to 2 orgs splits into 2 Persons, each org's Voters re-pointed.
- Rollback test: a Voter whose `phone` was overwritten by another org, with an `identityBackup`,
  restores to the backup value.

### (g) Decisions needed
**D1.1 — [LAWYER, blocking]** Were we a controller for this identity data, and does remediating it
prospectively cure the exposure? **Do we owe notification** to customers whose voters' identity data
was written into another customer's database, and to voters themselves? The dry-run rollback report
gives the exact scope. *Nothing else in this plan matters more than this question.*

**D1.2 — [OMAR]** Option A or B. I recommend A.

**D1.3 — [LAWYER]** `PersonMergeLog` holds **full pre-merge snapshots of both Person documents**
(`:24-25`) — durable copies of cross-org identity PII. Keep as an audit record, or purge?

---

# Workstream 2 — Vendor access governance

### (a) Target end state
**Operational metadata** (org/user/campaign counts, activity totals, billing, usage, health) stays
broadly available to vendor staff. **Voter-file content** (names, addresses, DOB, party, survey answers,
notes, GPS) becomes **exceptional, scoped, time-limited, reason-logged, and disclosed to the customer.**

### (b) Files
| What | Where |
|---|---|
| **The bypass** — no membership check | `middleware/orgContext.js:35-38` — super-admin + `X-Org-Id` → `req.activeOrg = org; return next();` |
| Role gates waved past | `middleware/auth.js:37` (`requireOrgRole`), `:54` (`requireOrgMember`) |
| The switcher *is* the impersonation UI | `client/src/components/OrgSwitcher.jsx:17-23`; `client/src/auth/AuthContext.jsx:115-118` (comments it explicitly) |
| Cross-org content in the Control Room | `routes/superAdmin/platform.js:196-231` — returns canvasser name, org name, **household `addressLine1`/`city`/`state`**, exact timestamp |
| Cross-org identity in People | `services/person/personOversight.js:116-135` — names, DOB, party, phone, **full addresses**, state voter IDs |
| **A false comment in our own source** | `personOversight.js:57-62` claims *"Counts / dates / booleans / status tallies only."* It is not. (Answer bodies and note text genuinely are never read — that half is true.) |
| No audit logging exists | No audit model anywhere. `app.js:52` `morgan('combined')` — its `remote-user` field is **HTTP-Basic-only** and we use a bearer JWT, so it is always `-`. It writes to stdout (ephemeral). **morgan cannot capture the actor. It is not the answer.** |

### (c) Plan
1. **`SupportAccessGrant` model** — `{ actorUserId, organizationId, reason (required, free text), grantedAt, expiresAt, revokedAt }`. Default TTL short (4h). A grant is **self-service for break-glass** but never silent.
2. **`AccessLog` model** — append-only: `{ actorUserId, organizationId, grantId, method, route, resourceType, at }`. Written by middleware on every route that returns voter content. This is what replaces morgan.
3. **Gate the bypass:** `orgContext.js:35-38` — a super-admin presenting `X-Org-Id` must hold an **active, unexpired grant** for that org, else 403.
4. **Two roles, not one:**
   - **`support`** (new, least-privilege): metadata, org config, users, campaign structure, billing.
     **Cannot** read voter content, survey answers, notes or GPS. This is the role a future second
     employee gets. Today's model gives any new admin an omniscient login — that is the thing to avoid.
   - **`break-glass`** (today's `isSuperAdmin`): can grant themselves voter-content access **with a
     typed reason**, time-limited, always logged.
5. **Tell the customer.** Notify the org's admins (in-app banner + email) when support accesses their
   voter content. This is what mature B2B SaaS does, it is the single strongest trust signal available,
   and it makes the access *disclosed* rather than merely *logged*.
6. **Strip the Control Room feed** (`platform.js:223-230`) of household addresses — org name, campaign
   name, action type and counts are enough for an ops dashboard. If the address is genuinely needed,
   gate it behind a grant.
7. **Fix the false comment** in `personOversight.js:57-62`.

### (d) Risk / blast radius
Low technically; **high for Omar's own workflow.** Today you support a customer by switching org.
After this, you type a reason and get 4 hours. That is the entire point — but it is friction on the
person who most needs to work fast, and it needs your explicit buy-in, not just approval.

### (e) Effort / sequence
**M-L — ~1 week.** Independent of WS1 technically, but the People-page and Control-Room fixes are
cleaner after WS1 lands (Person is org-scoped by then). Sequence after WS1, or in parallel by a second
pair of hands.

### (f) Tests
- Super-admin + `X-Org-Id` with **no grant** → **403** on `/admin/voters`. (Passes 200 today.)
- With an active grant → 200, **and an `AccessLog` row is written** naming actor, org and route.
- An **expired** grant → 403.
- A `support`-role user → 200 on metadata, **403 on voter content**.
- The Control Room feed contains **no** household address.
- A grant fires the customer notification.

### (g) Decisions needed
**D2.1 — [OMAR]** Accept the friction: you can no longer silently enter a customer org. Yes/no.
**D2.2 — [OMAR + LAWYER]** Do we notify customers when support reads their data? I recommend **yes**.
**D2.3 — [LAWYER]** How long must `AccessLog` be retained, and does it become discoverable?

---

# Workstream 3 — Retention & deletion integrity

### (a) Target end state
Deletion actually deletes. Retention is **enforced by code and fails loudly**, not by a dashboard
setting nobody can see.

### (b) Files
| What | Where |
|---|---|
| Raw import files orphaned (campaign) | `services/campaigns/deleteCampaign.js:53-54` — **self-acknowledged** |
| Raw import files orphaned (org) | `services/platform/deleteOrganization.js:42-49` — 30 collections swept; `deleteRawImport` never called |
| The purge is a CLI nothing calls | `migrations/purgeDeletedIdentities.js` — dry-run by default, imported by nothing; only an npm script (`package.json:40`) |
| Existing worker + queues to reuse | `Procfile` (`web`, `worker`), `queues/index.js:7-10` (IMPORT, TURF only), `worker.js:44-53` |
| Survives its own org's deletion | `models/DeletedUserRecord.js:38-40` — `organizationIds` is an **array**; not in `ORG_SCOPED`, and would not match `deleteMany({organizationId})` even if added |
| No TTL exists anywhere | `grep expireAfterSeconds` → **zero hits** repo-wide |

### (c) Plan
**3.1 — Delete the raw imports.** Both cascades enumerate the scope's `ImportJob` rows and call
`deleteRawImport` for each before removing them. Also add `DeletedUserRecord` to the org cascade —
matching on `organizationIds` (array), not `organizationId`.
> **BLOCKED BY WS1's rollback.** See the sequencing trap at the top. Do not ship first.

**3.2 — Make the 180-day purge real.** Move it from a CLI into a **BullMQ repeatable job on the
existing `worker` dyno**. The dyno already exists; the queue infrastructure already exists (add a
`MAINTENANCE` queue alongside IMPORT and TURF). No new infrastructure, no dashboard dependency, and it
lives in code where a test can see it.

**Fail loud, not silent.** A `RetentionRun` model — `{ startedAt, finishedAt, purged, error }` — plus a
super-admin panel and a health check that goes **red if the last successful run is older than 48h**.
Today, if the Heroku Scheduler add-on were deleted, the promise would stop being kept and *nothing
would fail*. That is the actual finding; the purge running is not the point.

Keep the CLI as a manual escape hatch.

**3.3 — Three disclosed retention triggers**, each a real, testable purge:
- **Delete-on-termination + wind-down.** `Subscription → canceled` starts a wind-down clock (export
  window, e.g. 30d), then hard-deletes the org via the existing cascade. Notify at start and before
  execution.
- **Dormancy auto-purge.** No activity for N months → notify → purge. Reactivation cancels.
- **Delete-on-request.** The cascade exists (super-admin, typed-slug). Expose it as a customer-initiable,
  verified request with a stated SLA — and it must now also take the GridFS files.

### (d) Risk / blast radius
**3.1 is irreversible** and must not precede WS1. **3.3 deletes paying customers' data on a timer** —
every window and notification is a contract term before it is code (D3.2). 3.2 is low-risk.

### (e) Effort / sequence
**M — 3-5 days.** 3.2 can ship any time (independent, low risk — do it early, it is cheap insurance).
3.1 waits on WS1. 3.3 waits on the lawyer.

### (f) Tests
- Deleting an org removes its GridFS import blobs **and** its `DeletedUserRecord` rows.
- Deleting a campaign removes its GridFS blobs.
- The retention job is **registered** — a test asserting the repeatable job exists, so deleting it fails
  CI. *(This is the test that would have caught the original gap.)*
- A `DeletedUserRecord` past `retentionUntil` is blanked and `purgedAt` stamped; one inside the window
  is untouched.
- Health check goes red when the last `RetentionRun` is > 48h old.
- Wind-down: a canceled subscription purges after the window, and **not** before.

### (g) Decisions needed
**D3.1 — [LAWYER]** Retention windows: wind-down period, dormancy threshold, and delete-on-request SLA.
These are contract terms.
**D3.2 — [LAWYER]** Must anything survive a delete-on-request for our own legal defence (invoices,
`AccessLog`)? Today the invoice depends on `CanvassActivity`, which org-delete destroys.

---

# Workstream 4 — Document alignment (last, against the fixed state)

Write these **after** WS0-3 land, describing what the code then does — not what we hope it does.

| Current claim | Status today | Must say, after remediation |
|---|---|---|
| *"It is not shared with other customer organizations."* | **False for identity.** True for canvassing data. | **True as written** once WS1 lands. Keep the sentence. |
| *"access is limited to that customer's authorized users"* | **False** — any super-admin, silently, unlogged. | "…and to Doorline support staff, only under a time-limited access grant that records who accessed what and why, and which we notify your administrators of." |
| *"Published reports… only aggregate campaign statistics and a map of door statuses."* | **False.** Individual addresses + that household's survey answers. | Describe it truthfully: a map of individual doors at their street addresses, each with its status and the household's **choice-based** survey answers. **Free-text is never published.** Links are password-protected and expire. |
| *"A customer may request export or deletion of the information it controls."* | **False** — the raw uploaded voter file survives in GridFS. | True once WS3.1 lands. |
| Retention: *"…thereafter as needed to comply with legal obligations or resolve disputes."* | Reads bounded; **nothing expires, ever.** | State the actual triggers and windows from WS3.3. |
| The in-app 180-day purge promise | Real, but enforced by a dashboard setting no code references. | Unchanged in wording; now actually enforced in code (WS3.2). |

**`docs/COUNSEL_BRIEF.md` must be corrected.** It **never mentions the Person layer** — grep for
"person" hits only "personal information." It was written against a model the code does not implement,
and it is the document going to an attorney. Add the identity layer, and rewrite Q2 (processor vs
controller) and Q4 (CCPA threshold) with this fact in front of them.

**Effort: S — 1-2 days.** Blocked on everything else by definition.

---

# Sequence, dependencies, effort

```
WS0  Report exposure      [S]  ──► ship NOW, independent
WS3.2 Retention job       [S]  ──► ship early, independent, cheap insurance
WS1  Org-scope identity   [L]  ──► the anchor
      └─ rollback (needs GridFS) ──┐
WS2  Access governance    [M-L] ───┼─► after/parallel with WS1
WS3.1 GridFS deletion     [S]  ◄───┘  BLOCKED until WS1 rollback completes
WS3.3 Retention triggers  [M]  ──► after lawyer (D3.1)
WS4  Documents            [S]  ──► last, against the fixed state
```

**Critical path:** WS1 → WS3.1 → WS4. Everything else parallelises.
**Total: roughly 3-4 weeks** of focused work, dominated by WS1's migration and rollback.

---

# Decisions needed before any coding

### Blocking — lawyer
1. **D1.1 — The big one.** Were we a controller for this identity data? Does remediating prospectively
   cure it, or do we owe **notification** to affected customers (and voters)? The WS1 dry-run rollback
   report gives the exact scope. *Nothing else here matters more.*
2. **D3.1** — Retention windows (wind-down, dormancy, delete-on-request SLA). Contract terms.
3. **D3.2** — What must survive a delete-on-request for our own defence? Today the invoice depends on
   `CanvassActivity`, which org-delete destroys.
4. **D1.3** — `PersonMergeLog` holds full pre-merge cross-org identity snapshots. Keep or purge?
5. **D2.3** — `AccessLog` retention, and its discoverability.

### Blocking — Omar
6. **D0.1** — Existing passwordless, never-expiring report links: leave, force-expire, or retro-password?
7. **D0.2** — Coordinate precision. **My recommendation: do not coarsen** — the recipient is the
   customer's own client, who already owns the voter file. The exposure is the link's access control,
   not the precision. Lock the link; fix the policy sentence.
8. **D1.2** — Option A (org-scope `Person`) vs B (remove it). **I recommend A.**
9. **D2.1** — Accept that you can no longer silently enter a customer org to support them.
10. **D2.2** — Do we notify customers when support reads their data? **I recommend yes.**

### Not a decision, a warning
**Do not ship WS3.1 before WS1's rollback.** Deleting the raw import files first makes the identity
contamination permanently unrecoverable.
