# Do not knock — address-level suppression

The as-built reference. Design rationale and the rejected alternatives live in
[PROPOSAL_DO_NOT_KNOCK.md](PROPOSAL_DO_NOT_KNOCK.md).

Related: [VOTERS.md](VOTERS.md) (person-level **Do not contact** — the sibling feature, read it
first), [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (cutting), [METRICS.md](METRICS.md) (coverage
buckets), [IMPORTS.md](IMPORTS.md) (household upsert), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

---

# Part 1 — For everyone

## What it is

A standing request attached to an **address**: *nobody comes to this door again.*

It exists because **Do not contact** is a fact about a *person*, and a door only disappears once
**every** voter there is flagged. That was wrong about the physics of a door — the knock IS the
contact. You cannot ring the bell for a housemate without summoning whoever asked to be left alone.

## What it does

- **Immediate.** The door leaves cutting, books, walk packets and every canvasser's map the moment
  it's set — including books already cut and already downloaded to a phone.
- **Org-wide and permanent.** It follows the address into every future campaign and **survives that
  campaign being deleted**. Re-import the address years later and it arrives already suppressed.
- **Always attributed.** Who set it, when, and why — required, and listed in the register at
  **Voters → Do-not-knock addresses**.

## Who can set it

**Org admins, team leads, and super admins.** A lead can only mark a door in a campaign they
manage.

**Canvassers cannot** (owner ruling, Aug 2026). The request reaches us at the door, but darkening an
address org-wide and permanently is a management decision. A canvasser who hears it records it in
the door note and tells their lead, who marks the address.

## What it does *not* do

- **It does not flag the residents.** Their individual Do-not-contact status is untouched — that's
  the whole reason it's a separate flag. Someone who moves away carries no mark from a request about
  a house they left.
- **It changes nothing historical.** Knocks already walked stay billed, past surveys stay in
  reports. It answers *"where may we go next?"*, never *"what did we do?"*
- **It doesn't hide the door from admins.** The admin map still shows it, badged — that map is the
  record of work performed and billed.
- **It is not a disposition.** The visit keeps whatever outcome it had (usually **Refused**), so the
  walk counts and the knock is billable.

## The new-resident question (the deliberate inversion)

`fullyDnc` **reopens** a door when a new resident is imported — that person asked for nothing.

**Do not knock does the opposite: it never reopens on its own.** The request was about the address,
and a refreshed file showing new names is not consent.

That's the safe direction but it isn't free, so the register flags any suppressed address that has
gained a voter imported **after** the request, as a re-review prompt. A human decides. Nothing
reopens automatically, ever.

## Two limits we show rather than hide

1. **Formatting drift.** Matching is by exact address key. If two campaigns' files write the same
   house differently (`123 N MAIN ST` vs `123 NORTH MAIN STREET`), the second door is not
   suppressed. The register's **Check similar addresses** finds these; you suppress them yourself.
   We never auto-match, because a coincidence would darken a *neighbour's* door with nobody to
   notice.
2. **Turnover.** See above — surfaced, never automatic.

---

# Part 2 — Technical reference

## A. Why an org-level record and not a Household boolean

`Household` rows are **per-campaign** (`{campaignId, normalizedAddress}` unique,
[Household.js:103](../server/src/models/Household.js#L103)). A bare boolean there fails three ways —
the same three that per-campaign `Voter` rows forced person-level DNC to solve:

| Failure | Bare boolean | Solved by |
|---|---|---|
| Sibling doors | Campaign B's row for the same address stays knockable | Record keyed by address → one lookup resolves every campaign's row |
| Campaign delete | Household deleted, request gone | Record has no `campaignId` — **nothing to park**, it simply survives |
| Future imports | New campaign's door arrives knockable | `$setOnInsert` seeding + `reapplyDoNotKnock` |

## B. Data model

| Thing | Where | Notes |
|---|---|---|
| `DoNotKnockAddress` | [models/DoNotKnockAddress.js](../server/src/models/DoNotKnockAddress.js) | **Source of truth.** Keyed `{organizationId, normalizedAddress}` (unique). Carries `reason`, `source` (`admin`\|`lead`\|`super`), `byUserId`, `at`, a denormalized copy of the address (so the record outlives every Household), and `looseKey` (**advisory only**). In the org-delete `ORG_SCOPED` sweep. |
| `Household.doNotKnock` | [models/Household.js](../server/src/models/Household.js) | **Mirror**, never the truth. Written ONLY by [recomputeDoNotKnock.js](../server/src/services/dnc/recomputeDoNotKnock.js), whose unconditional `$set` bumps `updatedAt` — the mobile `/changes` delta depends on that bump. |
| `KNOCKABLE_DOOR_FILTER` | [knockableDoorFilter.js](../server/src/services/canvass/knockableDoorFilter.js) | Gained its **5th flag**. That one line reached all 21 cut/serve/count sites. |

## C. Write paths

| Path | Who | Notes |
|---|---|---|
| `POST /admin/households/:householdId/do-not-knock` | admin, lead (own campaigns), super | Body `{reason}`, min 3 chars. **Idempotent and non-restamping** — a second set keeps the original author/reason/timestamp (`$setOnInsert`), same rule as a DNC re-flag. Returns `doorsAffected` across every campaign. |
| `DELETE /admin/households/:householdId/do-not-knock` | same | Deletes the record — which is what stops future imports re-applying it. |
| `GET /admin/do-not-knock` | **org admin only** | The register. Org-wide, so a lead would see campaigns they don't manage. Rows carry live `doors` and `newResidents`. |
| `GET /admin/do-not-knock/:id/near-misses` | org admin | Advisory loose-key scan, ZIP-scoped and capped; returns `truncated` so a partial scan never reads as "none". |
| `DELETE /admin/do-not-knock/:id` | org admin | **Not a duplicate** of the household route: after a campaign delete a request can outlive every door, and then there is no `householdId` to address it by. |

Service layer: [services/dnc/doNotKnock.js](../server/src/services/dnc/doNotKnock.js) —
`setDoNotKnock`, `clearDoNotKnock`, `suppressedAddressSet` (import seeding),
`reapplyDoNotKnock` (import hook), `nearMissAddresses`, `newResidentsSince`.

**Import persistence**, two hooks mirroring the DNC path:
1. [csvImporter.js](../server/src/services/import/csvImporter.js) adds `doNotKnock: true` to the
   household upsert's **`$setOnInsert` only**. Survival for existing doors is **by omission** — if
   the field ever appears in the `$set` spread, every re-import silently un-suppresses.
2. `reapplyDoNotKnock(orgId, campaignId)` in
   [importProcessor.js](../server/src/services/import/importProcessor.js), beside `reapplyDncLists`.
   Bounded by the number of suppressed addresses, never by campaign size. **No "reopen" half** —
   that asymmetry with the voted/DNC blocks above it is the point.

## D. Read side

| Site | Behaviour |
|---|---|
| 21 sites via `KNOCKABLE_DOOR_FILTER` | Excluded from cutting, books, mobile bootstrap, packets, counts |
| [aggregations.js](../server/src/services/reports/aggregations.js) | New `doNotKnock` coverage bucket, **first** in the `$switch` — precedence `doNotKnock > dnc > voted`, so a door in several counts once and segments sum to the universe. In `NON_KNOCKED_BUCKETS`. |
| [resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js) | Base set excludes `fullyDnc` **and** `doNotKnock` (ruling 4) so preview == cut. `fullyVoted`/`excludedFromTurf` deliberately still absent — they're cycle/admin exclusions, not standing requests. |
| [buildPacket.js](../server/src/services/packet/buildPacket.js) | `omissionReason` → `doNotKnock` |
| [turfs.js](../server/src/routes/admin/turfs.js) | `doNotKnockDoorCount`, kept disjoint from the voted/dnc counts |
| [undoImport.js](../server/src/services/import/undoImport.js) | A suppressed door is **kept** — undo must never destroy a standing request |
| Admin map | **No filter** — shows suppressed doors, badged, with the set/lift control |

## E. Invariants

1. `DoNotKnockAddress` is the truth; `Household.doNotKnock` is a mirror written only by
   `recomputeDoNotKnock`.
2. Suppression never touches `Voter.doNotContact`, and flagging voters never sets `doNotKnock`.
   Independent in both directions.
3. **No report or billing query reads `doNotKnock`** — sole exception the coverage bucket, and only
   for doors never knocked.
4. **Never auto-reopens.** Only an explicit admin/lead clear.
5. Exact key only for matching; `looseKey` is advisory forever.
6. Every record has an author and a reason. No system-generated suppressions.

## F. Tests

[test/doNotKnock.int.test.js](../server/test/doNotKnock.int.test.js) — 12 cases: the role gate
(canvasser never / lead only in managed campaigns), sibling fan-out, independence both ways,
suppression across cut + walk list + admin map, coverage-bucket precedence, the `updatedAt` bump,
non-restamping, campaign-delete survival + re-import re-suppression, **no-auto-reopen asserted side
by side with the `fullyDnc` case that DOES reopen**, the register + turnover flag + record-id lift,
and the `ORG_SCOPED` sweep.

## G. Deploy gates

1. `npm run audit:mobile-api` — flags `households.js`, `turfs.js`, `bootstrap.js`. All additive
   (new fields, new endpoints), so **no `CLIENT_API_VERSION` / `MIN_CLIENT_API_VERSION` bump**.
2. **`npm run migrate:build-indexes -- --apply` after deploy** — prod `autoIndex` is OFF, so
   `Household.doNotKnock` and the three `DoNotKnockAddress` indexes exist only once this runs. Run
   it from the **repo root** in the Heroku dashboard's **Run console** (the root proxy already
   exists). This is a GATE, not a follow-up: until it runs, the register's queries and every
   suppression lookup are unindexed collection scans.
3. No backfill — `default: false` covers every existing door.
