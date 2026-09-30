# Proposal: Voter ID spellings (leading zeros) — decision record and plan

> **Status: the upload half SHIPPED 2026-09-30; the importer's own identity (adoption or a stored
> key) is DEFERRED until after the 2026-11-03 election.** Decided with eight live campaigns (CT, TX, NE,
> FL, GA, TN) on one deploy and one operator. **Built:** the ID rule and the one outside-ID lookup
> ([`utils/voterIdKey.js`](../server/src/utils/voterIdKey.js),
> [`services/voters/voterIdLookup.js`](../server/src/services/voters/voterIdLookup.js)); zero-insensitive
> matching for early voting, do-not-contact and walk list from CSV, the un-mark box and the
> early-voting graduation job; the column picker on all three pages; the state-scoped do-not-contact
> upload; the import zero gate (preview callout + worker refusal); the structural test that fails the
> build on a new exact lookup; the read-only audit (§F). See *What shipped before the election*.
> **Still a plan:** everything in §D (the stored key), import-time adoption, do-not-contact graduation
> by zeros, the Excel-safe export column, the directory search boxes, the raw-string people counters.
> The two related things built on 2026-09-29 are separate and in the tree: the import mapping suggester
> recognizes L2 files, and the Import page shows sample values under each mapped column
> ([IMPORTS.md](IMPORTS.md)). Read this before touching anything that compares voter IDs.

What this covers: why the same voter ID can arrive spelled two ways, which campaigns that exposes,
what it looks like when it bites, what to do about it *today* by hand, the two designs that fix it
for good, everything a code sweep found that both designs must handle, and the order to build it in.

Related: [EARLY_VOTING.md](EARLY_VOTING.md) (the uploads that match on IDs), [IMPORTS.md](IMPORTS.md)
(the importer that stores them), [VOTERS.md](VOTERS.md) (do-not-contact, per-campaign rows),
[PERSONS.md](PERSONS.md) (the person directory's own ID keys), [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md)
(the maintenance-window procedure a migration would use), [WALKLISTS.md](WALKLISTS.md) (walk list from CSV).

---

# Part 1 — For everyone

## The problem in one paragraph

Everywhere the app asks "is this the same voter?", it compares the voter ID as exact text. Georgia
writes its IDs eight digits wide with zeros in front (`08719967`); Excel turns that into `8719967` the
moment a file is opened and saved. In the Fulton County L2 file, **83% of IDs start with a zero**, and
they are not a random 83%: numbers under ten million belong to people who registered before about
2010, the older, most reliable voters, exactly the people who show up on early-vote and absentee lists.
So a list that lost its zeros fails on precisely the voters most likely to be on it. And a voter file
that lost its zeros, imported into a campaign that already has those voters, imports every one of them
a **second time**: the app sees `8719967` and `08719967` as two people at the same door.

## Which campaigns are exposed

**Exposure runs both ways.** A campaign is exposed whenever a list from another source could spell
its IDs differently: because the stored IDs are *padded* with zeros (a list that lost them fails), or
because they are *unpadded* plain numbers (a list that pads them, such as the state's own file, fails).
Only a campaign whose IDs are all one width with no zeros, or carry letters, is safe in both directions.

**Production audit, 2026-09-30** (`npm run audit:voter-id-spellings`; 339,467 voter rows across the
customer organization):

| State (campaigns) | What the stored IDs look like | Exposed? |
|---|---|---|
| GA | Not imported yet. The Fulton L2 file is 8 digits, 83% starting with 0. | **Yes, padded**, the moment it is imported. |
| NE (2), CT, KY (archived) | Plain numbers of 3 to 7 digits, none starting with 0: sequential numbering without padding. Not damage. | **Yes, unpadded**: a padded list would not match. |
| FL (3), TX (2, archived) | One width (9 for Florida, 10 for Texas), no zeros. | No. |
| IN (2, archived), OH | Every ID carries letters. Immune to Excel. | No. |
| FL CD22 (archived) | 1,146 eight-digit IDs among 164,734 nine-digit ones, none starting with 0. Odd but archived; worth a look only if that campaign is ever revived. | No action. |

Nothing had gone wrong: no voter stored under two spellings, no campaign holding the same person
twice, no person-directory collisions, and none of the 1,389 parked early-vote IDs was waiting on a
zero (they are simply voters outside the campaigns' universes, which is normal). Re-run the audit after
the Georgia import and after any early-vote upload; the exposure table is built from the data.

The exposure only matters when a *second* file arrives: an early-vote list, a do-not-contact list, a
walk-list CSV, or a re-sent voter file. The first import of a file is always fine.

## What to look for (the symptoms, while nothing is fixed)

1. **An upload matches almost nothing.** On Early Voting, Do Not Contact, or Walk list from CSV, the
   preview says **Not in this campaign** (or **Not found**) for most of the file, and the few that
   matched are the newest voters. The list lost its zeros. (If it matched *nothing at all*, first check
   **Matched on column** in the preview: it may have picked the wrong column.)
2. **A re-sent voter file previews as all new.** The Import page's preview says *N new voters · 0
   updated* where N is about the whole file, for a campaign that already holds those voters. **Do not
   confirm it.** The file lost its zeros; importing it doubles the campaign.
3. **The same person twice at one door.** A voter's name appears twice on a door, or a canvasser sees
   duplicate names. An Excel-damaged re-import already happened. Use **Undo** on that import in
   Recent imports; it removes the net-new rows that haven't been worked yet.
4. **Un-mark says "not in this campaign"** for a voter you can see in the app. The ID was typed
   without its leading zero. Type it exactly as the app shows it.
5. **Counts drift upward.** The Voters directory total, or Do Not Contact's "people flagged", is higher
   than the number of people you know you have. Duplicates.
6. **A file built from our own export doesn't match.** Our CSV exports write the ID bare, so Excel
   reads it as a number and drops the zeros. A list someone assembled from a Doorline export and
   uploaded back will not match the zero-padded campaign.

## What to do if it happens (the interim runbook)

- **A list lost its zeros:** in a spreadsheet, add a column with `=TEXT(A2,"00000000")` (eight zeros for
  Georgia; use the width of the IDs in the app), copy it, paste as values over the ID column, save as
  CSV, upload again. Or ask whoever sent it for a fresh export with the ID column as text. The preview
  should then show most IDs matching.
- **A re-sent voter file previews as all new:** don't import it. Ask the client for an untouched export
  (not one that has been opened in Excel). If it was already imported, **Undo** it.
- **Typing an ID** (un-mark, search): include the zeros exactly as the app displays them.
- **Handling any CSV:** don't open it in Excel before uploading. If you must, format the ID column as
  **Text** before saving, and remember that *Save As CSV* strips the zeros too.
- **For leads:** the Help Center FAQ *My early-vote list says most IDs aren't in this campaign* says the
  same in their words.

## What shipped before the election (2026-09-30)

The decision was to keep the change away from the importer's write path and the biggest table during
get-out-the-vote, and to ship the part that pays off the first time a stripped list arrives:

1. **One rule for "same ID":** an all-digits ID is the same voter with or without leading zeros; an ID
   with letters is only ever the same as itself; an all-zero value is no ID.
2. **Uploads use the rule, both ways** (early voting, do-not-contact, walk list from CSV), and so do the
   un-mark box and the "remembered" early-vote IDs that get marked when a voter is imported later. The
   preview names the column it matched on, shows a few of its values, lets you change the column, and
   says how many matched only because zeros were ignored (with an example pair).
3. **Do Not Contact asks which state the list is for**, matches only inside that state's campaigns, and
   reports (never flags) anything the file names outside it. Its remembered IDs are stamped with the
   state, and the exact graduation job honors the stamp. Why: a stripped Georgia `123456` and a genuine
   Nebraska `123456` are the same bytes, and no rule can tell them apart — only the admin knows.
4. **Voter Import refuses a re-import whose IDs only match by zeros** — in the preview (red note,
   Confirm off) and on the worker (the job fails with the count and an example pair) — instead of
   doubling the campaign. No "import anyway".
5. **A structural test** fails the build if a new exact-string lookup of an outside ID appears.
6. **The read-only audit** (§F), run on production the same day: nothing wrong anywhere.

## What waits until after the election

- **The importer's own identity.** Its upsert, in-file dedupe and shields still key on the exact
  spelling; the gate keeps that from doubling a campaign but does not make a re-sent file *update* the
  campaign. Either import-time adoption of the organization's stored spelling (§C) or the stored key
  (§D). Both are migrations of behavior on the write path; §D is a data migration too.
- **Do-not-contact graduation by zeros.** Its job is exact and state-aware today; with the state stamp
  on every parking it can safely ignore zeros later (the rule: inside the parking's state only).
- **Exports that keep the zeros** when opened in Excel (the app's own CSV writer emits the ID bare).
- **The two directory search boxes** (web and phone) compare a typed ID exactly.
- **People counters** (`totalFlagged`, the directory total, platform counters) group on the raw string —
  correct while the audit finds no person under two spellings, which the gate now protects.
- **All-zero placeholder IDs in voter files** still import as one voter per campaign; the audit reports them.
- **Undoing an import** still does not give back the parked requests it graduated (pre-existing).

---

# Part 2 — Technical reference

## A. The rule

```
canonicalVoterId(id):
  s = trim(id)
  if s is all digits:  strip leading zeros; if nothing is left it is NOT an id (all-zero placeholder)
  else:                s unchanged            (letters mean the vendor formatted it on purpose)
```

- The app's own walk-up IDs are `manual:<hex>` ([canvass.js:1039](../server/src/routes/mobile/canvass.js#L1039))
  and demo IDs are letter-prefixed, so both stay exact-only.
- **Scope by state.** Person keys are `(registeredState, stateVoterId)`
  ([computeImportDiff.js:42](../server/src/services/import/computeImportDiff.js#L42),
  [Person.js:114](../server/src/models/Person.js#L114)), but the Voter sibling index is
  `{organizationId, stateVoterId}` with no state ([Voter.js:143](../server/src/models/Voter.js#L143)).
  This organization runs campaigns in six states; after zeros are ignored, Georgia `01234567` and a
  Texas `1234567` would read as one person. Every "same person across campaigns" lookup must add
  `voter.registeredState || campaign.state`.
- **Width.** Do not hard-code it. Derive the widest numeric ID per organization at query time (North
  Carolina pads to 12, the widest known); a constant silently stops matching wider IDs.

## B. Where the app compares IDs (sweep of 2026-09-30: 287 sites, 132 misbehave with two spellings)

The sites that decide behavior. Everything else is display, projection, or copying the value along.

**Importer write path** ([csvImporter.js](../server/src/services/import/csvImporter.js))
- [:319](../server/src/services/import/csvImporter.js#L319) in-file dedupe is exact: a file holding both spellings keeps both rows.
- [:885](../server/src/services/import/csvImporter.js#L885) hand-edit shield prefetch, [:895](../server/src/services/import/csvImporter.js#L895) do-not-contact seed prefetch: a row spelled the other way misses both, so the shield does nothing and a flagged person arrives contactable.
- [:911](../server/src/services/import/csvImporter.js#L911) `$set` spreads the file's spelling; a stored row is never re-spelled by a later file.
- [:941](../server/src/services/import/csvImporter.js#L941) **the upsert key.** Exact, so a re-import spelled the other way inserts every voter again; the unique index cannot object because the strings differ. Households key on address, so the twins land at the same doors.
- [:708](../server/src/services/import/csvImporter.js#L708) `countOrgPeople` groups on the raw string; the lifetime people counter grows by the whole file on such a re-import.
- [:1031](../server/src/services/import/csvImporter.js#L1031) the CLI `runImport` path calls `parseAndValidate` then `applyImport` directly: no person linking, and the two sticky-ID jobs never run for it.

**Import preview** ([computeImportDiff.js:109](../server/src/services/import/computeImportDiff.js#L109)) finds existing voters by exact ID, so the forecast reads "all new" for a zero-stripped re-import. That is the only tell today.

**Every import entry point** would need the same treatment, and there are seven:
[imports.js:279](../server/src/routes/admin/imports.js#L279) (sync preview), [:317](../server/src/routes/admin/imports.js#L317) (preview-enqueue), [:366](../server/src/routes/admin/imports.js#L366) (geocode-check); [importProcessor.js:222](../server/src/services/import/importProcessor.js#L222) (in-memory rows), [:243](../server/src/services/import/importProcessor.js#L243) (spill batches); [seedDemoOrg.js:1006](../server/src/services/platform/seedDemoOrg.js#L1006); the CLI path above.

**Uploads and typed IDs**
- [parseVoterIdList.js:40](../server/src/services/import/parseVoterIdList.js#L40): the shared matcher (early voting, do-not-contact lists, walk list from CSV), one unchunked `$in` for the whole file.
- [voted.js:238](../server/src/routes/admin/voted.js#L238) un-mark; [voted.js:169](../server/src/routes/admin/voted.js#L169) and [dnc.js:184](../server/src/routes/admin/dnc.js#L184) delete parked IDs by the *stored* spelling, so a parked row under the list's spelling survives.
- [dnc.js:253](../server/src/routes/admin/dnc.js#L253) "people flagged" groups on the raw string.

**Sticky jobs** [reapplyVotedLists.js:34](../server/src/services/voted/reapplyVotedLists.js#L34)/[:95](../server/src/services/voted/reapplyVotedLists.js#L95) and [reapplyDncLists.js:33](../server/src/services/dnc/reapplyDncLists.js#L33)/[:90](../server/src/services/dnc/reapplyDncLists.js#L90): exact match, exact delete. Called only from [importProcessor.js:331](../server/src/services/import/importProcessor.js#L331) and [:342](../server/src/services/import/importProcessor.js#L342).

**Directory and propagation** ([voters.js](../server/src/routes/admin/voters.js)): [:104](../server/src/routes/admin/voters.js#L104) search box, [:121](../server/src/routes/admin/voters.js#L121) and [:140](../server/src/routes/admin/voters.js#L140) org-wide dedupe and total, [:586](../server/src/routes/admin/voters.js#L586) do-not-contact propagation to sibling rows by the stored ID. The platform people counters in [platformStats.js](../server/src/services/platform/platformStats.js) group on the raw string too. [deleteCampaign.js:104](../server/src/services/campaigns/deleteCampaign.js#L104) parks a do-not-contact request under the stored ID.

**Person layer** (NUL-bearing files: use `grep -a`): [normalizePersonKeys.js](../server/src/services/person/normalizePersonKeys.js) trims and uppercases the state, and does nothing to zeros. [Person.js:114](../server/src/models/Person.js#L114) is a unique index on `(org, state, ID string)`. `mergePersons` has exactly one caller, the per-pair super-admin route ([persons.js:423](../server/src/routes/superAdmin/persons.js#L423)); the merge queue is documented as unreachable in PERSONS.md.

**Exports** [csvWriter.js:16](../server/src/services/export/csvWriter.js#L16) writes IDs bare, so every export round-trips through Excel as a number. The app manufactures the second spelling itself.

**Undo** [undoImport.js](../server/src/services/import/undoImport.js) never touches `VotedPendingId` or `DncPendingId`. Import → graduate (parked row deleted) → undo loses the parked request permanently. Pre-existing; better matching makes it fire more often.

**Uploads are CSV-only** ([parseVoterIdList.js:20-21](../server/src/services/import/parseVoterIdList.js#L20-L21)); "Save As CSV" from Excel strips the zeros before the file reaches the app, so query-time matching is the only fix for that surface.

**Mobile is untouched by any of this.** `stateVoterId` is not in [MOBILE_VOTER_PROJECTION](../server/src/routes/mobile/bootstrap.js#L53); the phone only displays it.

## C. Design A: query-time matching plus import-time adoption (no schema change)

> **Amended and partly built 2026-09-30, after a three-reviewer design review.** The upload half below
> is what shipped, with these changes from the first draft: (1) the do-not-contact upload takes a
> required `state` and matches inside that state's campaigns only — the "exact wins / ambiguous" rule
> was wrong, because a stripped id from a padding state is byte-identical to a genuine id from an
> unpadded one; outside-state hits are reported, never flagged; `DncPendingId.state` is stamped and the
> exact graduation job honors it (a Florida parking never flags a Georgian; a test proved the hole
> before the fix). (2) The import side is a *refusal*, not adoption: `computeImportDiff` counts
> `zeroOnlyMatches` for the review panel and the worker fails the apply (`ZERO_ONLY_MATCHES`) before
> `applyImport`; there is no "import anyway". (3) The early-voting graduation job went through the
> helper (campaign-scoped, ~10 lines); the do-not-contact one stayed exact. (4) Blank and all-zero
> values are a `noId` count, never looked up or parked; `idsInFile` is canonical-distinct;
> `matchedViaZeros` means no matched row's stored spelling equals the file's. (5) No stale-response
> guard on the new pages (the query library discards superseded mutations); the apply sends the
> column the preview matched on, which also fixed Walk lists sending a stale local choice. (6) The
> width scan runs lazily after the .xls refusal and the column pick (a DB-less unit test depends on
> that order), capped at 24. (7) Fields declared in the three strict schemas. Adoption itself (below)
> is still deferred.

- **Helper** (`server/src/utils/voterIdKey.js`): `canonicalVoterId` and `voterIdVariants(ids)`, which expands each canonical ID to every zero-padded spelling up to the organization's widest numeric ID. Lookups use `stateVoterId: { $in: variants }` on the **existing** indexes, chunked at 2,000 IDs per query (the importer's own lookups already chunk at 10,000 and 5,000; the shared matcher and the sticky jobs do not chunk at all).
- **Applied to:** the shared matcher, un-mark, both sticky jobs, and the parked-ID deletes. Preview and apply responses gain `matchedViaZeros`, one example pair, and sample IDs from the chosen column. `VotedUpload`/`DncUpload` record `idColumn` and `matchedViaZeros`.
- **Column picker** on Early Voting and Do Not Contact, always visible after a preview; Walk lists switches to the same component. Apply sends the column the preview used; a stale-response guard mirrors the Import page's `latestFileRef`.
- **Import side, two options.** *Refuse:* the preview looks up the misses by variants and, when any match only by zeros, blocks confirmation with the same acknowledgment gate the broken-ID-column case uses. No write-path change; the safe version. *Adopt:* one exported stage rewrites each row's ID to the spelling the organization already stores (this campaign's row, else a sibling campaign's, else the person directory), scoped by state, and marks the rows `__adopted`; `computeImportDiff` and `applyImport` throw if rows are not marked, mirroring Door Outcomes' `__resolved` guard, so none of the seven entry points can skip it.
- **Hardening that makes A honest:** per-campaign import serialization (the worker runs two jobs at once, [worker.js:21](../server/src/worker.js#L21), with no per-campaign lock, so two imports into one campaign could race the adoption read); a unit test that greps `server/src` (with `-a`) for `stateVoterId: { $in` or `stateVoterId: req.` outside the helper's allowlist and fails the unit suite CI runs on every push, the same trick as the `watchPositionAsync` test; and the audit plus repair shipped together.
- **A's honest weaknesses:** the no-duplicate guarantee is procedural; data already mixed stays miscounted at the `$group` sites until repaired; and **"first stored spelling wins" can lock in the damaged spelling** if the Excel-stripped file was the first one into the organization, after which every export carries the wrong number. The audit must report organizations whose stored spelling is the stripped one, with a one-time widening repair.
- Roughly twelve production files. Rollback is a redeploy.

## D. Design B: a stored canonical key (schema change plus migration)

`Voter.svidKey = canonicalVoterId(stateVoterId)`, indexes `{campaignId, svidKey}` unique and `{organizationId, svidKey}`; the raw `stateVoterId` stays for display and exports; every match, group, dedupe and propagation site switches to the key; the importer upserts by key; `VotedPendingId`/`DncPendingId` gain the key; `normalizePersonKeys` canonicalizes and Person `svidKeys` are rewritten. About twenty files and roughly three times A's effort. The blockers, each verified:

1. **Person collisions with no tool.** Rewriting Person keys trips the unique index at [Person.js:114](../server/src/models/Person.js#L114) for any two Persons differing only by zeros, and the only merge path is one pair at a time. A bulk merge for this reason code must exist before the migration can run.
2. **The deploy cannot be ordered safely.** The Procfile has `web:` and `worker:` only. Even with a `release:` phase, an import interrupted by the deploy is **retried** on the new code ([queues/index.js:37](../server/src/queues/index.js#L37) `attempts: 3`; the old worker drains 25 s and exits, [worker.js:269](../server/src/worker.js#L269)) against rows the first attempt already wrote without a key. The key-based upsert misses them and inserts twins. Only a read fallback to the raw string covers that, which is A's helper by another name. So: maintenance mode **and worker off** per [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md), the backfill, the index build, then worker on, **plus** the fallback.
3. **The Mongoose default is a trap.** A function default for `svidKey` is invoked with a null scope on every bulk upsert before Mongoose checks what the op set, so a naive `this.stateVoterId` throws inside the importer. Write it null-tolerant, and then it contributes nothing on upserts: the importer's bulk writes and [deleteCampaign.js:104](../server/src/services/campaigns/deleteCampaign.js#L104) must set the key explicitly. 38 test files insert voters directly; 3 bypass Mongoose with raw collection writes and need hand-added keys.
4. **The unique index has no clean rollback.** Strict, and after a dashboard rollback (old code writes no key) every import of two or more voters fails on a `(campaignId, null)` collision, uncaught at [csvImporter.js:952](../server/src/services/import/csvImporter.js#L952), until someone types a raw `dropIndex` into the Run console. Partial (`svidKey: { $type: 'string' }`, as Person's already is), and the guard weakens. Either way it needs a scripted by-name drop and a written rollback runbook. Keep the old `{campaignId, stateVoterId}` unique index; it is harmless alongside. Never re-option an existing key shape: [buildIndexes.js:50](../server/src/migrations/buildIndexes.js#L50) compares key shape only, and `--sync` ([:62](../server/src/migrations/buildIndexes.js#L62)) drops every undeclared index on every model; never hand it to the operator.
5. **The backfill wakes every phone.** Voter has `timestamps: true` ([Voter.js:130](../server/src/models/Voter.js#L130)); a Mongoose `updateMany` bumps `updatedAt`, and the phone's delta sync selects on it ([bootstrap.js:496](../server/src/routes/mobile/bootstrap.js#L496)). Run the backfill through the raw driver.
6. **The audit that says whether any of this is needed does not exist yet.**

B's real strengths are just as real: the database itself refuses a duplicate person in a campaign for every writer including future ones; the eleven `$group` sites become correct by a field-name change, even over already-mixed data; every lookup is one equality with no width cap; and the right thing becomes the visible thing. They are only safe to build on top of data that A (or a clean audit) has already converged.

## E. Gaps both designs must close

1. State scoping (§A). 2. Undo re-parks graduated early-vote and do-not-contact requests; the do-not-contact half is privacy-relevant, so reconcile [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) when built. 3. Excel-safe ID column in exports. 4. All-zero placeholder IDs: today one voter with ID `0` can exist per campaign ([csvImporter.js:122](../server/src/services/import/csvImporter.js#L122) is a truthiness check); treating all-zero as "no ID" turns those rows into visible errors on the next import, so the audit reports them first. 5. The FAQ must say "Save As CSV" strips zeros too.

## F. The audit script (BUILT 2026-09-30)

[`migrations/auditVoterIdSpellings.js`](../server/src/migrations/auditVoterIdSpellings.js), proxied in the
root `package.json` so the dashboard Run console reaches it. Read-only; it never writes.

```
npm run audit:voter-id-spellings                    # every organization
npm run audit:voter-id-spellings -- --org <slug>    # one organization
npm run audit:voter-id-spellings -- --json          # machine-readable; samples capped by --samples N (10)
```

Per organization it reports:

1. **Exposure per campaign**: voters, share numeric, share starting with 0, a histogram of numeric ID
   widths, letter-bearing IDs, all-zero placeholders, and a `padding` class with an `exposed` verdict:
   `padded` (IDs start with 0), `unpadded` (several widths, no zeros: plain numbering, exposed the other
   way), `uniform` (one width, no zeros: safe), `none` (letters: safe), `empty` (no voters yet; listed so
   the campaign about to be imported is visible), and `mixed` (zeros present *and* shorter rows, the
   doubled-import tell, with `shorterRows` counted). `widestNumeric` is the width the matching would use.
   The first production run (2026-09-30) is what taught the report that mixed widths without zeros are
   numbering, not damage: Nebraska, Connecticut and Kentucky all look that way.
2. **Same person under two spellings across campaigns** (grouped by organization and canonical ID),
   with **CHECK** when names or birth dates differ within the group and **STOP** when the group's
   campaigns are in different states (two states can issue the same digits; never merge across states).
3. **Same person twice inside one campaign**: the unique index forbids the same string twice, so two rows
   per canonical ID always means two spellings.
4. **Person-directory keys that would collide** once zeros are ignored, tombstones excluded: the exact
   pairs a stored-key migration (§D) would have to merge before its index could build.
5. **Parked early-vote and do-not-contact IDs** classified three ways: *by zeros* (the voter is here under
   the other spelling: a list uploaded stripped and waiting), *exact* (the voter is here under this very
   spelling, so the parking should already have graduated: a sign the sticky job did not run, check),
   *unmatched* (normal). Early-vote parkings are matched inside their campaign and tallied per campaign
   (`byCampaign`) so the report says which lists are waiting; do-not-contact parkings are org-wide.

The comparable form of an ID is computed inside MongoDB by `CANON_EXPR`, the aggregation twin of
`canonicalVoterId`; the integration test seeds both shapes and asserts they agree. Whole-collection
passes run with `allowDiskUse`; the parked-ID lookup chunks 5,000 canonical IDs per query. Test:
[`test/auditVoterIdSpellings.int.test.js`](../server/test/auditVoterIdSpellings.int.test.js) runs the
real script as a child process (the way the operator does) over a seeded organization carrying every
shape above plus a clean organization, and locks that nothing is written. Every decision in §G reads
this output first.

## G. Sequencing after 2026-11-03

Steps 1–3 of the original order shipped on 2026-09-30 (the audit, the upload half, the refusal gate).
What remains, in order: 1. Re-run the audit; it must still be clean. 2. Do-not-contact graduation by
zeros, inside the parking's state. 3. Undo re-parking graduated requests, and the Excel-safe export
column. 4. The importer's identity: adoption (§C) or the stored key (§D), chosen from the audit —
the stored key only with a reason (mixed data found, or multi-vendor organizations become normal),
staged: key field non-unique first, raw-driver backfill, switch the `$group` sites and the two search
boxes, then the partial unique index once the audit is empty.

## H. Verification when built

Unit tests for the rule (digits, all-zero, letters, `manual:`, demo IDs, width). A new `votedUpload.int.test.js` over the real server with multipart uploads (mirror of `dncUpload.int.test.js`): both zero directions, graduation of a parked ID spelled the other way, letters never zero-matching, column override honored by preview and apply, un-mark by either spelling, one walk-list-from-CSV case. Extend `dncUpload.int.test.js`. Importer: a zero-stripped re-export previews with `newVoters === 0` and imports zero new rows. Real-file check with the Fulton L2 file: its own ID column with zeros stripped must match 12,324 of 12,324, 10,275 by zeros. Screenshots of each preview state.

## I. Privacy

No new data, no new third party, no new exposure. Zero-insensitive matching can only widen a match to the same voter, and for early voting and do-not-contact a wider match means fewer knocks, the safe direction. The one privacy-relevant item is §E.2: an undone import silently losing a "never contact me" request.
