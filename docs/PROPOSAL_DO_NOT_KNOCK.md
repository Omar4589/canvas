# Proposal: Do not knock — address-level suppression

> **Status: BUILT (superseded by [DO_NOT_KNOCK.md](DO_NOT_KNOCK.md)).** This proposal has been
> implemented, with four owner rulings that changed it — see [DO_NOT_KNOCK.md](DO_NOT_KNOCK.md) for
> the as-built reference. The rulings, recorded here because the rejected options are the point of
> keeping this file:
>
> 1. **Canvassers CANNOT set it** (§C1 below proposed they could, effective immediately). Only
>    org admins, team leads (inside a campaign they manage), and super admins. The request still
>    reaches us at the door; acting on it org-wide and permanently is a management decision.
> 2. **Never auto-reopens** — accepted as proposed.
> 3. **Exact address key only, loose key advisory** — accepted as proposed.
> 4. **Fix the walk-list preview discrepancy for BOTH flags** — `resolveWalkList` now excludes
>    `fullyDnc` and `doNotKnock` in its base set, so preview == cut.
>
> Kept for the design rationale and the options that were considered (notably §L, why flipping
> `fullyDnc` from `.every()` to `.some()` was rejected).

Related: [VOTERS.md](VOTERS.md) (person-level DNC — read that first), [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
(cutting), [METRICS.md](METRICS.md) (coverage buckets), [IMPORTS.md](IMPORTS.md) (household upsert),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (§ to stamp).

---

# Part 1 — For everyone

## The problem

Today **Do not contact** is a fact about a *person*. A door only disappears once **every** voter at
it is flagged ([`recomputeFullyDnc.js`](../server/src/services/dnc/recomputeFullyDnc.js) uses
`.every()`). So when one resident tells a canvasser "never come back here again," the address stays
in the books: the canvasser is routed there next round and knocks again — for the housemates.

That's wrong about the physics of a door. **The knock is the contact.** You cannot ring the bell for
the housemate without summoning the person who asked to be left alone. The current advice in the
canvasser FAQ — write it in a door note and tell your admin — is a workaround for a missing feature,
and it doesn't stop the next round.

## What Do not knock is

A standing request attached to an **address**, not a person: *nobody comes to this door again.*

- **Immediate.** The moment it's set, the door leaves cutting, books, walk packets, and every
  canvasser's map — including books already cut and already on a phone.
- **Org-wide and permanent.** It follows the address into every future campaign and survives a
  campaign being deleted. Like Do not contact, it transcends the election.
- **Set at the door.** The canvasser standing there hears the request, so the canvasser can honor it
  on the spot — no admin round-trip, no "we'll stop after the next sync." An admin can also set it
  from the voter profile or the admin map, and only an admin can clear it.
- **Always has a reason and a name on it.** Who set it, when, and why, visible in an admin review
  list. Suppressing a door is never silent.

## What it does *not* do

- **It does not flag the residents.** Their individual Do-not-contact status is untouched. This is
  the whole reason it's a separate flag: if someone moves away, they carry no mark from a request
  that was about a house they no longer live in — and a housemate who moves out isn't suppressed at
  their new address.
- **It changes nothing historical.** Knocks already walked stay billed, past surveys stay in
  reports. The flag answers *"where may we go next?"*, never *"what did we do?"* — the same rule
  `fullyDnc` lives by.
- **It doesn't hide the door from admins.** The admin map still shows it (styled as suppressed), for
  the same reason it still shows fully-DNC doors: that map is the record of work performed and
  billed, and hiding a surveyed pin would erase delivered work from the person paying for it.
- **It is not a disposition.** The visit where it was recorded is still whatever it was — usually
  **Refused** — so the walk counts, the knock is billable, and contact rate is unaffected. Do not
  knock rides *alongside* the disposition, it doesn't replace it.

## The new-resident question (the deliberate inversion)

`fullyDnc` **reopens** a door automatically when a new resident is imported: the new person never
asked for anything, so the address becomes knockable again.

**Do not knock does the opposite — it never reopens on its own.** The request was about the address.
A file refresh showing new names at that address is not consent, and auto-reopening would send a
canvasser back to the exact door someone asked us to stop visiting.

That's the safe direction, but it isn't free: eventually a suppressed address really has turned over.
So the admin review list flags any suppressed address that has gained a voter imported *after* the
suppression date, as a **re-review prompt**. A human decides. Nothing reopens automatically, ever.

---

# Part 2 — Technical reference

## A. The structural trap: households are PER-CAMPAIGN

This is the part that makes the feature more than a boolean.

```js
householdSchema.index({ campaignId: 1, normalizedAddress: 1 }, { unique: true });
```
— [`Household.js:103`](../server/src/models/Household.js#L103)

The same address imported into two campaigns is **two Household documents**. A boolean stored only
on the Household therefore fails three ways, all of which person-level DNC already had to solve on
`Voter` (whose rows are per-campaign for the same reason):

| Failure | Why a bare `Household.doNotKnock` breaks | How DNC solved it on `Voter` |
|---|---|---|
| **Sibling doors** | Suppressing in campaign A leaves campaign B's row for the same address knockable. | Writers write by `{organizationId, stateVoterId}`, flipping every sibling row. |
| **Campaign delete** | Deleting the campaign deletes the Household — the request vanishes. | `DncPendingId` parks the request ([`deleteCampaign.js:64-98`](../server/src/services/campaigns/deleteCampaign.js#L64-L98)). |
| **Future imports** | An address imported into a *new* campaign arrives unsuppressed. | `csvImporter` seeds flagged siblings via `$setOnInsert`, and [`reapplyDncLists.js`](../server/src/services/dnc/reapplyDncLists.js) graduates pendings. |

**So the source of truth cannot be the Household.** It has to be an org-level record keyed by
address, with the Household field as a mirror.

### The address-key limitation, stated honestly

`normalizeAddress()` is exact — `[line1, line2, city, state, zip5].join('|')`, uppercased and
trimmed ([`normalizeAddress.js:3-10`](../server/src/utils/normalizeAddress.js#L3-L10)). Two
campaigns whose source files format an address differently (`123 N MAIN ST` vs
`123 NORTH MAIN STREET`) produce **different keys**, and sibling fan-out misses.

`looseAddressKey()` exists for exactly this drift, and its own comment says it is
*"never used as an upsert key — that stays exact `normalizeAddress`."*
([`normalizeAddress.js:22-26`](../server/src/utils/normalizeAddress.js#L22-L26))

**Ruling: keep that rule.** Store both keys on the record. Match and suppress on the **exact** key
only. Use the **loose** key to surface near-miss addresses in the admin review list as an advisory
*"this address may also be this one — suppress it too?"* prompt. Auto-suppressing on a loose key
would eventually darken a *neighbor's* door on a formatting coincidence — a silent false positive
with no one to notice it. Advisory-with-a-human is the right trade; pretending exact matching is
complete is not.

## B. Data model

### B1. `DoNotKnockAddress` — new model, the source of truth

`server/src/models/DoNotKnockAddress.js`, mirroring [`DncPendingId`](../server/src/models/DncPendingId.js)'s
org-level shape:

```js
{
  organizationId,                 // required, indexed
  normalizedAddress,              // required — the EXACT key, matches Household.normalizedAddress
  looseKey,                       // advisory only (near-miss review); never a match key
  // Human-readable copy of the address as it stood when suppressed, so the review list and
  // the record survive every Household being deleted.
  addressLine1, addressLine2, city, state, zipCode,
  reason,                         // required, min 3 chars — same bar as the DNC flag
  source: 'canvasser' | 'admin',
  byUserId,                       // who set it (never null — an address suppression always has an author)
  at,                             // when
  // Provenance for a canvasser-set flag: the visit it was recorded during.
  activityId,                     // → CanvassActivity, null for admin-set
  campaignIdAtSet,                // which campaign the canvasser was in (context only, NOT scope)
}
```

Indexes:
```js
{ organizationId: 1, normalizedAddress: 1 }  // UNIQUE — the upsert key + suppression lookup
{ organizationId: 1, createdAt: -1 }         // admin review list
{ organizationId: 1, looseKey: 1 }           // near-miss advisory scan
```

No `campaignId` in the identity — deliberately, and for the same reason `DncUpload` has none: the
fact transcends campaigns.

### B2. `Household.doNotKnock` — the mirror

```js
// Address-level do-not-knock: the residents asked that nobody come to this door again. Unlike
// fullyDnc this is NOT derived from the voters — it is mirrored from the org-level
// DoNotKnockAddress record (the source of truth, keyed {organizationId, normalizedAddress}),
// because Household rows are per-campaign and would lose the request on a campaign delete or
// miss a sibling campaign's door entirely.
//
// Written ONLY by services/dnc/recomputeDoNotKnock.js. Like recomputeFullyDnc, its $set is
// UNCONDITIONAL so updatedAt bumps and the mobile /changes delta re-sends the door.
//
// The ADMIN map still shows it (routes/admin/households.js does not filter on this) — same rule
// as fullyDnc: this flag answers "where may we go NEXT", never "what did we DO".
doNotKnock: { type: Boolean, default: false, index: true },
```

### B3. The shared filter gains its 5th flag

[`knockableDoorFilter.js`](../server/src/services/canvass/knockableDoorFilter.js) reserves this slot
in its own comment (*"If a 5th eligibility flag ever appears, it goes HERE and nowhere else"*):

```js
export const KNOCKABLE_DOOR_FILTER = Object.freeze({
  isActive: true,
  fullyVoted: { $ne: true },
  fullyDnc: { $ne: true },
  doNotKnock: { $ne: true },      // ← new
  excludedFromTurf: { $ne: true },
});
```

That one line covers **21 query sites** — all of turf cutting, the mobile bootstrap and delta, the
canvasser door list, walk-packet printing, and the supplemental-book counts. The filter is spread
consistently everywhere today (verified: no hand-rolled copies of the flag bundle survive), which is
precisely why this design is cheap on the read side.

## C. Write paths

### C1. Canvasser, at the door — the primary path

`POST /mobile/households/:householdId/do-not-knock` `{ reason, location, timestamp }`

Not a new `CanvassActivity.actionType` and **not** a new `Household.status`. The visit keeps its own
disposition (normally `refused`, which is already *"a billable knock + contactRate bucket"*); do-not-knock
is a suppression flag set alongside it. Reasons:

- It leaves `KNOCK_ACTIONS`, `statusPrecedence`, billing, and contact rate completely untouched. No
  aggregation anywhere has to learn a new action type.
- The walk still counts. This is the [No Soliciting](../server/src/routes/mobile/canvass.js) lesson:
  the sign ended the visit, the walk still happened.

**UI:** a checkbox on the Refused sheet — *"They asked us never to come back"* — plus a standalone
action on the door screen for when it comes up outside a refusal. Reason required.

**Effective immediately, by design.** A two-step admin approval would mean going back tomorrow, which
defeats the entire feature. The asymmetry justifies it: a wrongly-suppressed door costs one door; a
wrongly-knocked door costs the complaint we're trying to prevent.

**The abuse vector, and the mitigation.** A canvasser could suppress doors to shrink their own book.
This is handled by making suppression *visible*, not by gating it:
- Every record carries `byUserId` + `reason` + `activityId`, listed in the admin review list.
- Suppressed doors get their own coverage segment (C4) — the volume is on the dashboard, not hidden.
- A per-canvasser do-not-knock count belongs on the existing audit/flags surface, beside the GPS
  flags, where an outlier is already the thing that surface is for.

### C2. Admin

- **Voter profile** — a checkbox on the existing DNC flag dialog: *"Also never knock this address."*
  Sets both, one confirmation.
- **Admin map / household detail** — set + clear, reason required both ways.
- **`DELETE /admin/households/:householdId/do-not-knock`** — the only clear path. Admin-only, reason
  required, and it deletes the `DoNotKnockAddress` row (which is what un-suppresses every sibling
  door and stops future imports re-applying it).

**Not wired to the DNC list upload.** `/admin/dnc/import` takes a CSV of *Voter IDs*; making those
rows suppress addresses would turn a 5,000-row suppression list into an unknown and much larger
number of darkened doors. An **address**-list upload is a separate feature with its own problem
(parsing and normalizing arbitrary address CSVs into the exact key), and the §A limitation would make
it silently lossy. Explicitly out of scope, with that reason — not deferred.

### C3. Import seeding — how a new campaign's door arrives suppressed

Two hooks, both mirroring what DNC already does:

1. **Household upsert** ([`csvImporter.js:526`](../server/src/services/import/csvImporter.js#L526),
   `filter: { campaignId, normalizedAddress }`) — look up `DoNotKnockAddress` for the batch's
   addresses and add `doNotKnock: true` to **`$setOnInsert` only**. Survival for *existing* rows is
   by omission: the field must never appear in the `$set` spread — the same mechanism that protects
   `surveyStatus` and `doNotContact`.
2. **`reapplyDoNotKnock(organizationId, campaignId)`** — run beside the existing
   `reapplyDncLists` hook in [`importProcessor.js:336-342`](../server/src/services/import/importProcessor.js#L336-L342),
   catching addresses that already existed as Household rows. Feeds the same
   `recomputeDoNotKnock` call the DNC path already makes there.

### C4. `recomputeDoNotKnock(householdIds)`

`server/src/services/dnc/recomputeDoNotKnock.js`, a near-clone of
[`recomputeFullyDnc.js`](../server/src/services/dnc/recomputeFullyDnc.js) but simpler (no per-voter
roll-up — it's a direct lookup against `DoNotKnockAddress` by `{organizationId, normalizedAddress}`).

**Inherit the unconditional `$set` verbatim, including the comment.** It is load-bearing for exactly
the same reason: Mongoose 8 applies schema timestamps to `bulkWrite` `updateOne`s, so every touched
door's `updatedAt` bumps, and that bump is how an already-bootstrapped phone learns about the change
through `/changes`. Never optimize it to skip unchanged docs.

Sibling fan-out: a set/clear resolves `{organizationId, normalizedAddress}` → **every** Household row
across all campaigns, then recomputes them all in one call.

## D. Read side — the sites that need more than the shared filter

| Site | Change |
|---|---|
| [`aggregations.js:198-210`](../server/src/services/reports/aggregations.js#L198-L210) | New `'doNotKnock'` branch in `coverageBucketExpr`, **first** in the `$switch` (strongest statement wins over `dnc`/`voted`), same `status: 'unknocked'` guard. Add to `NON_KNOCKED_BUCKETS`. |
| [`buildPacket.js:36`](../server/src/services/packet/buildPacket.js#L36) | New `dropReason` branch → `'doNotKnock'`; add the field to the projection at [`:237`](../server/src/services/packet/buildPacket.js#L237). |
| [`turfs.js:556-558`](../server/src/routes/admin/turfs.js#L556-L558) | Supplemental-book breakdown gains a `doNotKnock` count beside `fullyVoted`/`fullyDnc`/`excludedFromTurf`. |
| [`undoImport.js:93,136,187`](../server/src/services/import/undoImport.js#L93) | Add to the keep-reason string, the keep predicate, and the `$ne: true` filter — undoing an import must never delete a suppressed door. |
| [`seedDemoOrg.js:704`](../server/src/services/platform/seedDemoOrg.js#L704) | Same guard the seeder already applies to `fullyDnc`: never stage knocks on a door we promise never to knock. |
| Admin map / `households.js` | **No filter change** — suppressed doors stay visible, styled. |

**One pre-existing inconsistency to decide on, not silently inherit:**
[`resolveWalkList.js:173`](../server/src/services/walklist/resolveWalkList.js#L173) builds its base
household set from `{ campaignId, isActive, location.coordinates }` — it does **not** apply
`KNOCKABLE_DOOR_FILTER`. Suppression happens later, at cut time in `generateTurf`. So a walk list's
`householdCount` already over-reports versus what actually cuts, for `fullyDnc` doors today.
`doNotKnock` inherits that layering for free (the door still never cuts), but the preview number
inherits the discrepancy too. Either fix both flags in the preview or neither — do not fix it for
one and leave the other.

## E. Invariants

1. **`DoNotKnockAddress` is the source of truth; `Household.doNotKnock` is a mirror.** Only
   `recomputeDoNotKnock` writes the boolean. Nothing else, ever.
2. **Suppression never touches `Voter.doNotContact`.** The two flags are independent in both
   directions. A person can be DNC at a knockable door; a door can be suppressed with zero flagged
   residents.
3. **No report or billing query reads `doNotKnock`** — the single exception is the coverage bucket,
   and only for doors that were never knocked. Identical to the rule `fullyDnc` lives by.
4. **Never auto-reopens.** No import, no file refresh, no resident turnover clears it. Only an
   explicit admin clear.
5. **Exact key only for matching.** `looseKey` is advisory forever.
6. **Every record has an author and a reason.** No system-generated suppressions.

## F. Cascades

- **Campaign delete: nothing to park.** The record is already org-level and keyed by address, so it
  survives untouched. This is where the §A design pays for itself — compare the ~40 lines of
  `DncPendingId` parking logic in [`deleteCampaign.js`](../server/src/services/campaigns/deleteCampaign.js#L64-L98)
  that a `Voter`-shaped design forced. Worth an explicit test asserting the survival.
- **Org delete:** add `DoNotKnockAddress` to `ORG_SCOPED` in
  [`deleteOrganization.js:55-62`](../server/src/services/platform/deleteOrganization.js#L55-L62).
  This is the exact gap that was found and closed for `DncPendingId`/`DncUpload` — don't repeat it.

## G. Mobile

- **Bootstrap:** suppressed doors are filtered out server-side by `KNOCKABLE_DOOR_FILTER`, so nothing
  changes there. But the **delta** path needs `doNotKnock: 1` in the projection at
  [`bootstrap.js:422`](../server/src/routes/mobile/bootstrap.js#L422), and the client-side drop at
  [`map.jsx:508`](../mobile/app/(app)/map.jsx#L508) needs the matching clause — that line is how an
  already-loaded door disappears from a running app.
- **Offline:** goes through the existing `lib/recordAction.js` optimistic-first + reconnect-flush
  queue, like every other door action.
- **Client-version gate: no bump.** Purely additive — a new endpoint and a new optional field. A
  shipped app that doesn't know about `doNotKnock` simply never sets it, and still receives the
  suppressed doors' removal through the normal delta. Per [CLAUDE.md](../CLAUDE.md), only a genuine
  breaking change moves `CLIENT_API_VERSION` / `MIN_CLIENT_API_VERSION`.
- **`npm run audit:mobile-api` will flag** `bootstrap.js`, `me.js`, `canvass.js`, and `turfs.js`.
  All four changes are additive; read the diffs to confirm nothing is removed or renamed.

## H. Deploy gates

1. **`npm run audit:mobile-api`** before deploy (four flagged files above).
2. **`npm run migrate:build-indexes -- --apply` after deploy** — prod `autoIndex` is OFF, so the new
   `Household.doNotKnock` index and all three `DoNotKnockAddress` indexes exist only once this runs.
   The script auto-discovers new model files from `models/`, so no registration step is needed.
   The root-`package.json` proxy already exists, so the Heroku dashboard **Run console** command is
   literally `npm run migrate:build-indexes -- --apply` (console starts at the app root, not
   `server/`).
3. No backfill migration — `default: false` covers every existing door.

## I. Tests

New `server/test/doNotKnock.int.test.js` (one `before()` per file, no `await import` between
`test()` definitions — the record-level-audit trap):

- Sibling fan-out: same address in two campaigns, suppress via one → both Household rows flip.
- Campaign delete: suppress, delete the campaign, re-import the address into a new campaign →
  arrives suppressed.
- Import seeding: `$setOnInsert` on insert; a re-import of an existing suppressed door does **not**
  clear it (survival by omission).
- No auto-reopen: import a brand-new voter into a suppressed address → still suppressed (the exact
  inverse of the existing `fullyDnc` reopen test — assert them side by side so the divergence is
  deliberate and documented in the suite).
- Independence: suppressing a door leaves `Voter.doNotContact` untouched, and vice versa.
- Cut/serve: a suppressed door is absent from `generateTurf`, the mobile bootstrap, and
  `buildPacket`; present on the admin map.
- Coverage: an unknocked suppressed door lands in the `doNotKnock` bucket, not `unknocked`.
- Billing: a door suppressed *after* being knocked keeps its billed knock.
- Org delete sweeps `DoNotKnockAddress`.

## J. Doc + Help Center cascade

- **`docs/VOTERS.md`** — the *"What it doesn't do"* bullet currently promises *"a mixed door — one
  flagged voter, one not — stays fully knockable for the housemates."* Still true of `fullyDnc`, but
  it now needs the pointer to this feature. Add `Household.doNotKnock` to the data-model table.
- **`docs/PASSES_AND_TURF.md`, `docs/METRICS.md`** — the 5th cut exclusion and the new coverage bucket.
- **Help Center — two published articles say the opposite and must change in the same commit:**
  - `guides/do-not-contact.md:44` — *"The rest of the household is unaffected — one flagged voter
    doesn't hide the door."*
  - `faq/what-does-do-not-contact-mean.md:17,26` — *"you can still talk to the other people at the
    address"* and *"If a resident asks you to never come back, record it in your door note and tell
    your [admin]"*, which is precisely the workaround this feature replaces.
  - Plus a new canvasser-audience article for the door-side button.

## K. 🛑 Privacy — this change IS privacy-affecting

Flagging it out loud, per [CLAUDE.md](../CLAUDE.md):

- **New personal data.** `reason` is free text attached to a specific residential address and will in
  practice contain statements about the people living there. A free-text note about a person is
  named in the trigger list.
- **Retention.** `DoNotKnockAddress` is permanent *by design* and deliberately **survives campaign
  deletion** — a new retention claim that our current text does not describe.
- **New exposure surface.** The admin review list shows addresses + reasons + authors. Decide
  explicitly whether it enters the Export Center; if it does, that's a separate export-exposure
  review.

**Not a subprocessor event** — no new third party receives anything, so **DPA §6 notice is not
triggered** and nothing is gated on customer notice.

**Required before ship:** a new stamped entry in [`PRIVACY_VERIFICATION.md`](PRIVACY_VERIFICATION.md)
(v3 layer governs; append a stamp, never edit history), and an owner decision on whether the
Privacy Policy's retention paragraph needs to name address-level suppression records as data that
outlives a campaign.

## L. Rejected alternative: flipping `fullyDnc` from `.every()` to `.some()`

The one-line version. Rejected for four reasons:

1. **DNC list uploads become door-nukes.** `/admin/dnc/import` takes Voter IDs — often a purchased
   suppression list. Under `.some()`, 5,000 flagged people would suppress every address any of them
   lives at, a large and unpredictable multiple.
2. **Doors would never reopen** — silently losing the documented `fullyDnc` reopen behavior for
   genuine resident turnover, with no separate flag to carry the intent.
3. **The name would lie.** `fullyDnc` is read at ~20 sites; a flag meaning "any" but named "fully"
   is how a suppression bug ships two quarters later.
4. **It suppresses people who never asked**, with no record of the decision, no author, and no
   reason — and it poisons the *person's* record for a fact about a *house*.
