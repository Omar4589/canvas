# Voter imports & Intake

What happens when you upload voters — how rows match existing doors/voters, what goes live
immediately, and how new doors reach the field through **Intake**.

- **Part 1 — For everyone** is plain language.
- **Part 2 — Technical reference** is for developers (and Claude): the upsert keys, normalization,
  and the known data-quality gaps (a documented follow-up).

Related: [EFFORTS.md](EFFORTS.md) (Intake → assign to an effort), [WALKLISTS.md](WALKLISTS.md) (turn a
Voter-ID CSV into a walk list without re-importing the universe), [VOTERS.md](VOTERS.md).

---

# Part 1 — For everyone

## How an upload is matched

- A row is matched to a **household by its address** (after light normalization: trim + uppercase,
  5-digit zip). A different/misspelled address makes a **separate** household; it does **not** merge.
- A row is matched to a **voter by their state Voter ID** (org-wide). Re-uploading the same voter
  updates their info in place.

## What goes live, and what waits in Intake

There is **no review/approval step** — an upload is applied as soon as it finishes. But where a voter
ends up depends on the door:

- **New voter at a door an effort already owns** → joins that door immediately (the door is already
  cut and assigned). It also appears so it isn't missed.
- **New voter at a new address** → the door lands in **Intake** (owned by no effort) and is **not
  canvassed** until you assign it to an effort (Efforts page → open an effort → *Claim*). This is the
  deliberate control point for new doors.

## Things to watch (today's behavior)

- **A voter can move doors silently.** If the same Voter ID is re-uploaded with a different address,
  that voter is moved to the new household with no warning, and the old door lingers.
- **A new voter at an already-knocked door doesn't re-open it.** The door keeps its status, so a
  canvasser won't be sent back automatically.
- **Bad/odd addresses aren't validated** beyond requiring coordinates in the file; a door with no
  coordinates is created but excluded from cuts.

These are flagged for a future **import preview** (see Part 2).

---

# Part 2 — Technical reference

Import pipeline: [services/import/csvImporter.js](../server/src/services/import/csvImporter.js),
[services/import/importProcessor.js](../server/src/services/import/importProcessor.js),
[utils/normalizeAddress.js](../server/src/utils/normalizeAddress.js).

## A. Matching keys

| Entity | Key | Behavior |
|---|---|---|
| `Household` | unique `{campaignId, normalizedAddress}` | Upsert: address/location fields `$set`; `status`/`isActive` only `$setOnInsert`. **Never sets `effortId`** → new doors stay `null` (Intake); existing doors keep their owner. **Never touches `turfId`/`status`** → a new voter at an owned door rides the existing book. |
| `Voter` | unique `{organizationId, stateVoterId}` | Upsert `$set: {...row, householdId}` → re-import with a new address **moves** the voter's household (no audit). |

`normalizeAddress` = `[addr1, addr2, city, state, zip5]` upper-trimmed and joined with `|` — exact
match only (no fuzzy / "St" vs "Street").

## B. Intake is automatic

`Household.effortId` defaults to `null` and the upsert never writes it, so **new-address doors are in
Intake by construction** — no import-processor change was needed. They become canvassable only once an
effort claims them (`POST .../efforts/:id/claim`, then a supplemental cut). See [EFFORTS.md](EFFORTS.md) §B.

Separately, an uploaded **Voter-ID CSV** can be turned directly into a walk list (matched by
`stateVoterId`, no universe re-import) and used to seed/claim an effort — handy when you already have an
exact list of people. IDs not already in the universe simply won't match; import them first. See
[WALKLISTS.md](WALKLISTS.md).

## C. Coverage / cut visibility

Cuts and `/doors` require `location.coordinates`; coordinate-less households persist but are excluded.
"New voters since last cut" for an effort = voters whose `createdAt` is after the effort's active
round was cut, on doors the effort owns (derive; no extra field).

> **Known gap / follow-up (not built).** An **import preview/diff** before apply: show how many rows
> are new doors vs existing, **which voters would change households** (silent re-housing), and
> **near-duplicate addresses** that won't merge — with a confirm step. Plus optionally reopening an
> already-knocked door when a new voter is added there. Tracked but intentionally out of the efforts
> build.
