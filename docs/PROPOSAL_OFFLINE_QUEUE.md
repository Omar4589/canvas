# Proposal: Saved-without-signal doors are never lost or misfiled (the offline queue)

> **Status: BUILT 2026-11-01 (uncommitted, not deployed) from PLAN v3.1, with a code review of each half
> fixed (§P, "As built", at the end). Plan v3.1 is v3 after review round 3 (three reviewers, the last plan
> round); §O is the binding list of round 3's changes and overrides any older line above it; §P records
> where the build differs.** From the AAPC landing brief §10, Phase 2
> ([PROPOSAL_AAPC_LANDING.md](PROPOSAL_AAPC_LANDING.md)): *"Never drop a queued item silently; show
> dropped items to admins with the reason. Stamp each item with who recorded it. Never upload it under
> another user; hold it until that canvasser signs in."* It also carries §E2 of
> [PROPOSAL_ADMIN_ACCOUNT_DELETION.md](PROPOSAL_ADMIN_ACCOUNT_DELETION.md) (a deleted account's unsent
> doors), which the owner sent to this plan on 2026-10-24. One server deploy, then one phone update
> (JavaScript only, no store build), staging first. One new collection with a self-expiry index (built
> when the server starts — no `migrate:build-indexes` step). Two new config vars (the phone's kill switch
> and the server recorder's). Line references are to HEAD `162feb1`. Round 1's changes are §K, round 2's
> findings §L, what v3 changed §N, round 3 §O, the build §P.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) (*Recording, replacement, and the offline queue's ordering
rule*), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (open item 6, §C9 *Store 1*, items 12 and
37), [PROPOSAL_SESSION_EXPIRY.md](PROPOSAL_SESSION_EXPIRY.md) (why a queued door survives sign-out).

# Part 1 — For everyone

## The problem

With no signal, the app saves each door on the phone and sends it when signal comes back. That part
works. Three things around it don't:

1. **A saved door the server turns down is deleted without a word.** Nobody sees it, not the
   canvasser and not you. The server turns a late door down when, by the time it arrives:
   - the canvasser has been taken off the campaign, or removed from the organization;
   - the walk list's survey was switched to a different one (every survey still waiting is refused);
   - the voter was marked do-not-contact (a survey);
   - the campaign was deleted, or archived (for walk-up people and pin moves);
   - the house was taken out by **Undo import**;
   - a pin move came from someone who is no longer a lead;
   - the organization's account was paused **before** the door was recorded.

   A lot is already accepted late on purpose, and stays that way: an outcome switched off, a paused
   canvasser, an account paused after the door was recorded, an archived walk list or campaign (for door
   results), a house a re-import no longer lists, an expired sign-in.
2. **Saved doors upload under whoever is signed in.** If a canvasser signs out with doors still waiting
   and someone else signs in on that phone, the doors go up as the second person's knocks, counted and paid
   to the wrong canvasser. If the second person is in a different organization, the doors are turned down
   and deleted, as in 1. The app says so itself today: *"3 saved items will go up under whoever signs in
   next."* The ordinary **Sign out** button doesn't mention waiting doors at all.
3. **A deleted account's waiting doors go up under the next person too** — the gap the account-deletion
   plan left for this one (§E2 there).

## What changes

1. **Every saved door remembers who recorded it, from the moment of the tap, and only uploads while that
   person is signed in.** If someone else signs in first, the door waits on the phone for the right person.
   Whoever is signed in sees a line saying so: *"2 saved items from Jane D. are waiting on this phone.
   They'll upload when Jane signs in here."*
2. **Signing out with doors still waiting asks first:** *"3 saved items haven't uploaded yet. They'll stay
   on this phone and upload the next time you sign in here."* **Sign out** · **Cancel**. If a save is still
   on its way, the phone says *"Finishing a save…"* for up to 20 seconds before it counts.
3. **A door the server turns down is never deleted silently.**
   - **The canvasser who recorded it** sees *"1 item wasn't saved — tap to see why"* — on the map and
     Books, and also on the *Not assigned to this campaign* screen, the organization picker and the menu,
     because the reasons that take those screens away are the common ones. The list shows the house, what
     was recorded, when, and why in plain words, with **Remove**. Nothing is resent from the phone: the
     canvasser re-knocks the door, or you re-enter it. It clears itself after 30 days, and the phone keeps
     no survey answers for it — only the line.
   - **Admins and the campaign's leads** see every turned-down door on the console's **Audit** page: who
     was signed in, which house and book, what (Not home, Survey, Added a person, Moved a pin), when it was
     recorded, and why, with **Mark reviewed**. **This works for every phone from the day the server is
     deployed**, before anyone has the phone update, because the server is the one that turns the door
     down.
4. **A deleted account's waiting doors are removed from the phone**, with a line on the sign-in screen:
   *"3 saved items from a deleted account were removed from this phone."* They can't be credited to
   anyone any more. The phone remembers that the account is gone, so this holds after a restart too.
5. **Doors left waiting for someone else are removed after 30 days**, the next time another person is
   signed in on that phone, with a line on the sign-in screen. That bounds what a shared phone holds.
6. **A kill switch.** A setting in the Heroku dashboard turns the who-recorded-it hold, the deleted-account
   cleanup and the 30-day removal off on every phone, back to today's upload behavior, with no phone
   update. A phone picks it up at its next launch, or when it comes back to the screen after 15 minutes.

## What it looks like

```
SIGN OUT, WITH ITEMS WAITING              SIGN-IN SCREEN, SOMEONE ELSE'S ITEMS WAITING
┌───────────────────────────────┐         ┌───────────────────────────────────┐
│ Items not uploaded yet        │         │  Email     [                   ]  │
│                               │         │  Password  [                   ]  │
│ 3 saved items haven't uploaded│         │  [            Sign in          ]  │
│ yet. They'll stay on this     │         │                                   │
│ phone and upload the next     │         │  3 saved items from Jane D. are   │
│ time you sign in here.        │         │  waiting on this phone. They'll   │
│                               │         │  upload when Jane signs in here.  │
│ Sign out          Cancel      │         └───────────────────────────────────┘
└───────────────────────────────┘

MAP / BOOKS / "NOT ASSIGNED" SCREEN       "NOT SAVED" SHEET (only the person who recorded them)
┌───────────────────────────────┐         ┌───────────────────────────────────┐
│ ⚠ 1 item wasn't saved —       │  tap →  │ Not saved                       ✕ │
│   tap to see why              │         │ 1412 Elm St · Not home            │
├───────────────────────────────┤         │ Oct 30, 3:42 PM                   │
│            (map)              │         │ You were no longer on this        │
│                               │         │ campaign's team when it uploaded. │
└───────────────────────────────┘         │                          Remove   │
                                          └───────────────────────────────────┘

CONSOLE — AUDIT PAGE, NEW SECTION (the people who can open Audit today)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Doors not saved · 2 open                                  [Open] Reviewed  All    │
│ Recorded        Signed in as   Door                 What       Why               │
│ Oct 30 3:42 PM  Jane Doe       1412 Elm St · Book 7 Not home   Not on this campaign's team  [Mark reviewed] │
│ Oct 30 3:51 PM  Jane Doe       1418 Elm St · Book 7 Survey     The walk list's survey changed [Mark reviewed] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## What doesn't change

- Doors still save without signal and upload by themselves the moment signal returns. Canvassers aren't
  asked anything new, except the sign-out question when something is waiting.
- Everything the server already accepts late stays accepted (listed under *The problem*).
- Deleting the app still deletes anything waiting on it.

## Limits, said plainly

- **A door the server turns down is not recovered.** It's listed, with the reason, for the canvasser and
  for you; the door is re-knocked or re-entered. (A phone-side *Try again* was designed and dropped: it was
  where both review rounds found the deepest bugs — decision 9.)
- **Doors waiting for someone who never signs in on that phone again** are removed after 30 days. The
  server never received them, so the console can't show them.
- **Doors saved before the update** don't know who recorded them. They upload under the first person
  signed in after the update applies, which is today's behavior, once.
- **Removing a canvasser** (rather than deactivating) while their phone still holds a shift's doors leaves
  nothing tying those refusals to your organization, so the console won't list them. The Remove
  confirmation now says so.
- **The console's list keeps no survey answers**, only that a survey was turned down.

## Timing and gates

1. **Server first.** The Audit list starts filling for every phone the day it deploys. The new records'
   indexes, the 180-day expiry included, are built when the server starts: no index step.
2. **The policy sentence** (decision 8) is true for old and new phones alike, so your edit can go live
   with this first server deploy, or any time before the production phone update.
3. **Phone update on the staging lane** (TestFlight / Play internal), checked with §J's steps in an
   internal test organization: staging phones talk to the production server.
4. **Production phone update** (`npm run ota:production` from `main`), first to 20% of phones
   (`-- --rollout-percentage=20`), then everyone. Before Election Day is fine; the kill switch is there.

## The owner's decisions

**All decided 2026-11-01, as recommended** (except #5: production may go out before Election Day).

| # | Decision |
|---|---|
| 1 | The sign-in screen and the signed-in person's line name whose items are waiting (first name and last initial) |
| 2 | A turned-down item stays in the phone's Not saved list for 30 days |
| 3 | The console keeps turned-down door records for 180 days |
| 4 | Whoever can open the Audit page sees them |
| 5 | Production once staging passes; before Election Day is fine |
| 6 | Privacy policy, local storage line: *"…to keep you signed in and to let the app work without signal"* (your edit) |
| 7 | A deleted account's unsent items are removed from the phone, with a one-line notice |
| 8 | Privacy policy, offline sentence, under the subject *What you record while offline*: *"…stored on your device until the app has delivered them or no longer needs them."* General on purpose (your edit) |
| 9 | No *Try again*: a turned-down item is shown with its reason and removed, never resent from the phone |
| 10 | No *Upload now*: the sign-out question warns, with **Sign out** and **Cancel** |
| 11 | Items waiting for someone else are removed after 30 days, with a line on the sign-in screen |
| 12 | No phone-side admin row: the list lives on the console's Audit page |

# Part 2 — Technical reference

## A. What exists today (verified at `27e8711`/`162feb1`, by reading and by replaying on a throwaway mongod)

- **The queue** — `mobile/lib/offlineQueue.js`, AsyncStorage key `canvass.offlineQueue`. Items are
  `{ id, path, body: { ...body, wasOfflineSubmission: true }, orgId?, enqueuedAt }` (`enqueue`, `:45`).
  **Nothing records the user.** `enqueue` runs only **after** the first upload attempt fails, up to 20
  seconds after the tap (`submitOrQueue`, `:197-209`; `api.js` timeout `:25`).
- **One writer** — `optimisticSubmit` (`recordAction.js:311`; `inFlightPaths.add` at `:349`) →
  `submitOrQueue` (`:418`, its only caller), for four kinds of write: the seven door results, surveys
  (`voter/[id]/survey.jsx:146`), walk-up adds (`recordAddVoter`) and pin moves
  (`recordLocationCorrection`). All four routes live in `server/src/routes/mobile/canvass.js`. The GPS
  alert releases the lock and its Try again calls `optimisticSubmit` again (`:384-390`).
- **The flush** — `doFlush` (`:95`): no status or 5xx → stop; 401 or the temp-password 403 → hold
  (`:127`); **any other 4xx → `removeItem` (`:131-134`)**, whose `errors` list no caller reads. `api()`
  reads the stored token on **every** request (`api.js:57`). `flushQueue` joins a flush already running
  and returns only its last pass (`:163-178`).
- **Who it uploads as** — whoever is signed in at flush time; `login.jsx:100` flushes right after any
  sign-in; `notYouConfirm` (`sessionEnd.js:143-149`) says so. The plain Sign out buttons
  (`CanvasserDrawer.jsx:152-156`, `admin/more.jsx:158`, `super-admin/more.jsx:41`, `map.jsx:794`) clear the
  query cache, then sign out, never looking at the queue or waiting for a save in flight.
  `SessionGate.jsx:118` waits up to 5 s (20 × 250 ms) on `hasInFlightActions()` for automatic ends.
- **Readers of the queue** — `getPendingCount` (map, Books, `ReauthNotice`, `ReauthSheet`,
  `DeleteAccountSheet`, `login.jsx:54` via `pendingLine`, `sessionEnd.js:130`) and `getPending` in
  `confirmDoorChange` (`recordAction.js:507` → `doorChange.js` `ownSurveysHere`).
- **Helpers that exist** — `tokenSub(token)` (`sessionEnd.js:52`) reads the JWT `sub` (`String(user._id)`);
  `atob` works on the app's Hermes (RN 0.81). The pending overlay (`markPendingHousehold`,
  `recordAction.js:127-155`) keeps a door's optimistic color through the 30-second change check, which
  sends only doors the server changed (`routes/mobile/bootstrap.js:499`); a live refusal clears it
  (`recordAction.js:445-447`) with a rollback patch held in that tap's closure (`:557-560`).
- **Screens a refusal can take away** — a not-assigned 403 from the bootstrap is final and replaces the map
  and Books with *Not assigned to this campaign* (`map.jsx:843-875`, `books.jsx:326`); an `ORG_CONTEXT`
  error sends the phone to select-org (`_layout.jsx:57-70`).
- **What the server already forgives on a replay** (`wasOfflineSubmission: true`), reproduced: outcome
  toggles (`canvass.js:450-453`), the automatic pause (`:268-271`), writes stamped before an account pause
  (`entitlement.js:85-93`), archived campaigns for door results (201), a household a re-import marked
  inactive (`recomputeHouseholdActive.js:38` — 201), and replays superseded by a newer result, a repeat
  or an unknock (`200 { superseded: true }`).
- **What the server still refuses on a replay**, reproduced: not assigned 403 *no code* (`:117`); org
  membership missing, inactive or removed 403 `ORG_CONTEXT` (`orgContext.js:129-136`); org being deleted
  404 `ORG_CONTEXT` (`:45`); super-admin without a grant 403 `SUPPORT_ACCESS_REQUIRED`; household
  hard-deleted 404 *no code* (`:427` — only Undo import, `undoImport.js:184`, and the delete cascades), and
  the wrong-org case (`:104`); campaign deleting 404 *no code* (`:435`, `:890`, `:1235`); 402 for a write
  stamped after the pause; survey: do-not-contact 403 (`:882`), voter not found 404 (`:871` — also a
  walk-up's survey that arrives before its add, because the voter is looked up before access is checked),
  household for voter not found 404 (`:874`), template not found 404 (`:901`), template mismatch 400 (the
  walk list's survey switched); wrong campaign type 400; active organization required 400 (`:102`); zod
  invalid input 400 (ten sites); walk-up add on an archived campaign 409 (`:1237`), id conflict 409
  (`:1288`, `:1329`); pin move by a non-lead 403 `FORBIDDEN_ROLE` (`:638`), `out_of_bounds` /
  `invalid_coords` 400 (`:676`), campaign deleting 409; an opt-in outcome never turned on,
  `OUTCOME_DISABLED`. The survey, add and pin routes rebuild their error body as `{ error }` (`:877`,
  `:1231`, `:628`). A malformed id is a 500. Nothing on `/mobile` answers with `res.send` or `sendStatus`.
- **Membership** — the admin's **Remove** deletes the `Membership` row and the assignments
  (`routes/admin/memberships.js:949`, `:968`); **Deactivate** keeps it with `isActive: false` (`:1246`).
- **Mount order** (`routes/index.js`) — `requireAuth` + `blockIfMustChangePassword` (`:92`; 401 and the
  temp-password 403 are answered here), `requireEntitlement` (`:95`), `accessLog` (`:102`); every
  `/mobile` path then passes `mobileBootstrapRouter`'s `orgContext, requireOrgMember` (`:170`).
  `express.json` is global (`app.js:100`). Express 4.22.1. At `finish`, `req.params` is empty for refusals
  answered by middleware.
- **The web dyno has no `unhandledRejection` or `uncaughtException` handler** (only `worker.js:54-58`).
  Node 20 exits on either.
- **Deletion machinery** — org cascade (`services/platform/deleteOrganization.js`, `ORG_SCOPED`), campaign
  cascade (`CAMPAIGN_SCOPED`), late-write sweep (`lateWriteSweep.js` — whose missing-campaign path sweeps
  every tenant's campaign-less rows), account deletion (`deleteAccount.js:644-648`,
  `DeletedUserRecord.organizationIds`). `strictQuery` is on (`db.js:26`).
- **Kill-switch precedent** — `MOBILE_ERROR_RECOVERY` on `/api/build-status`: only the literal `off` turns
  it off (`buildStatus.js:65-66`), the phone stores only `off` (`cache.js:466-471`), applied in
  `UpdateGate.jsx:82-87`, re-checked at launch, on returning after 15 minutes, and every 4 hours.
- **The privacy policy's offline sentence** (`client/public/privacy.html:95`): *"…saved on your device
  until a connection is available, and each is removed once it has been delivered to our servers."*
  The privacy record parked it (`PRIVACY_VERIFICATION.md:2671-2675`).

## B. The rules — one pure module

New `mobile/lib/queueRules.js`: plain ESM, no React Native imports (the `doorPaths.js` pattern), tested
under `node --test`. It reuses `tokenSub`.

- `isMine(item, sub, holdOn)` — `!holdOn || item.recordedBy === sub`.
- `classify(err)` — `'retry'` (no status, or 5xx) · `'hold'` (401, 403 `PASSWORD_CHANGE_REQUIRED`) ·
  `'refused'` (every other 4xx).
- `shouldQueue(err)` — false for a 401 whose reason is `deleted` (§E2 step 2): that save takes the
  existing hard-fail path.
- `reasonText(code, kind, message)` — §E's words, chosen by code **and** kind (a `FORBIDDEN_ROLE` on a pin
  move is the lead rule; from `requireOrgMember` it's lost membership), falling back to the server's
  message.
- `stale(item, now)` — the item has waited 30 days (`enqueuedAt`).
- `pruneNotSaved(list, now)` — drops entries older than 30 days.

## C. Phone changes (OTA)

- **Stamp at the tap** (§E2 step 1). `optimisticSubmit` takes `recordedBy = tokenSub(getCurrentToken())`,
  `recorderName` (first name + last initial, cached user), `tapAt`, `householdId` and `label` (the door's
  address line from the bootstrap cache) at entry, beside `inFlightPaths.add` (`:349`). With no session it
  refuses to record (*"Sign in again to record this door."*). The GPS alert's Try again (`:390`) passes
  the original stamp through instead of taking a new one.
- **The live attempt** — `submitOrQueue(path, body, stamp)`: if the session's `sub` is no longer
  `recordedBy`, it doesn't send; it queues (held). Otherwise as today.
- **`enqueue`** stores `{ v: 2, recordedBy, recorderName, tapAt, householdId, label, campaignId }` with the
  existing `orgId` pin, and puts `queueItemId` (the item id) in the body.
- **Never queue a deleted account's save** (`shouldQueue`).
- **The flush**, under the queue lock:
  1. If a session exists, stamp **every** unstamped (pre-update) item with its `sub`, in one write.
  2. Remove items whose recorder is in the deleted-accounts list (below), counting them for the notice.
  3. If someone is signed in, remove items that are **not theirs** and `stale` (30 days), counting them by
     `recorderName` for the sign-in screen's line.
  Then for each item in order: read the token once (none → stop); `!isMine` → skip, so held items never
  block; otherwise send with `api(path, { token, orgId })`, so a sign-in mid-flush can't move it.
- **On `'refused'`** the item leaves the queue for `canvass.notSaved` as `{ id, recordedBy, recorderName,
  tapAt, refusedAt, kind, actionType, householdId, label, status, code, message }` — **no body, so no
  answers** (decision 9). A refusal sink registered in `app/_layout.jsx` (the `setFlushPaceSink` pattern)
  clears that household's pending marks and invalidates the bootstrap; there is no rollback patch for a
  flushed item, and none is needed once the overlay is gone.
- **Not saved** — shows only `recordedBy === me`; pruned at 30 days; survives sign-out. `NotSavedBanner`
  appears on the map, Books, both screens' *Not assigned to this campaign* state, select-org and the drawer;
  `NotSavedSheet` lists entries newest first, each with **Remove**.
- **Deleted accounts** (§E2 steps 3–5), persisted as `canvass.deletedAccounts` (subs, kept 30 days):
  `authState.setDeletedAccountCleanup(fn)` — set in `_layout.jsx` — removes the ended `sub`'s queue items
  and Not saved entries, clears pending colors (`clearAllPending()`), and adds the `sub` to the list.
  `signOutSteps` runs it for reason `deleted` after in-flight saves settle; app start runs the list's
  cleanup again; `DeleteAccountSheet` runs it for its own account once the deletion succeeds. The notice
  (`discardedLine`) is stored with the list, so it survives a restart.
- **Sign out** — one `confirmSignOut()` behind every manual Sign out button (the four above,
  `update-required.jsx`, and `ReauthSheet`'s *Not you?* and other-account paths), called **before**
  anything clears the cache. It shows *Finishing a save…* while `hasInFlightActions()` (up to 20 s), then
  counts my queue items plus any save still sending; none → signs out; otherwise the question (§E), with
  **Sign out** and **Cancel**. Automatic ends can't ask; their items wait (or the E2 cleanup runs).
- **Counts** — `getPendingCount()` and `getPending()` return the signed-in person's items (every badge,
  `DeleteAccountSheet`, `confirmDoorChange`). `getWaiting()` groups the rest by `recordedBy` for the
  sign-in screen and for the signed-in person's line in the drawer and Books.
- **Kill switch** — `MOBILE_QUEUE_HOLD` from `/api/build-status`, on unless the server sends the literal
  `off`, persisted like `MOBILE_ERROR_RECOVERY`. Off: `isMine` is always true, the deleted-account
  cleanup and the 30-day removal don't run, the waiting lines are hidden and `notYouConfirm` says today's
  words. Not saved keeps working, still filtered by its recorder.
- **Along for the ride:** the admin menu's live-map subtitle *"Doors & canvasser pings"*
  (`components/CampaignHome.jsx:1107`) becomes *"Doors & where results were recorded"* (checked against the
  tile's two lines, `NavTileGrid.jsx:30`); the console's and the phone's **Remove** confirmation adds
  *"If they still have doors on their phone that haven't uploaded, let it sync first — after you remove
  them, those doors can't reach you."*

## D. Server changes

- **Model `RefusedUpload`** — `organizationId` and `campaignId` (required and declared: `strictQuery`),
  `userId` (who was signed in), `kind` (`result` | `survey` | `add_person` | `pin_move`), `actionType`,
  `householdId`, `voterId`, `turfId`, `surveyTemplateId`, `recordedAt` (optional: the body's
  `timestamp`), `status`, `code`, `reason`, `queueItemId` (optional string), `reviewedAt`, `reviewedBy`,
  `expiresAt` (180 days). **No survey answers, notes or coordinates.** Indexes:
  `{ organizationId, campaignId, createdAt: -1 }`, `{ userId, queueItemId }` (not unique: a unique index
  could fail `build-indexes` on rows written before it runs), `{ expiresAt: 1 }` TTL (copy
  `models/DemoRequest.js`).
- **The recorder** — one `router.use('/mobile', refusalRecorder)` in `routes/index.js` between `:92` and
  `:95`, so it sees `requireEntitlement`'s 402 and the org-context refusals too.
  - **When the request arrives** it matches, inside a try/catch, a POST to one of the four queued route
    shapes, and keeps `{ kind, householdId | voterId }` parsed from `req.originalUrl` (at `finish`,
    `req.params` is empty for middleware refusals). Anything else passes untouched.
  - It wraps `res.json` to copy `{ code, error }` inside a try/catch and **always** calls the real
    `res.json`; on `res.once('finish')` it calls an async `record()` whose every step is awaited and whose
    promise is caught and logged. No throw can escape to the process (§F tests each path).
  - It records when the body has `wasOfflineSubmission: true`, the status is 4xx, and it isn't 401 or 403
    `PASSWORD_CHANGE_REQUIRED` (those are answered at `:92`, before it, anyway).
  - **Filing from server records only:** the household or voter from the URL, else the book in
    `body.turfId`, gives the organization and campaign — joins checked to belong to the same organization;
    the header and any body `campaignId` are never trusted. Written only if the person has a `Membership`
    row there (any state) **or** has worked there (`CanvassActivity` / `SurveyResponse` lookups with
    `.hint` on their `userId` indexes and `maxTimeMS: 2000`, memoized per person and org for a minute).
    Nothing resolves → nothing written.
  - **Never during a deletion:** skipped when the org is missing, inactive or has a deletion requested, or
    the campaign has a deletion requested; after the write it re-checks and deletes its own row if a
    deletion began. Never `sweptAfter` / `LATE_WRITE_MODELS`.
  - **No duplicates:** with a `queueItemId`, it upserts on `{ userId, queueItemId, kind, householdId |
    voterId }` (a resend after a lost response finds its row); without one (old phones, which drop the
    item after one refusal) it inserts.
  - **A cap:** at most 500 rows per person per organization per day, counted in memory (one web dyno) —
    enough for a shift, a wall for a removed canvasser's token.
  - **Shutdown:** in-flight `record()` promises are tracked, and `server.js` waits for them (5 s at most)
    before exiting on SIGTERM.
- **Codes on every refusal** — the code-less ones gain `NOT_ASSIGNED`, `HOUSEHOLD_NOT_FOUND`,
  `VOTER_NOT_FOUND`, `HOUSEHOLD_FOR_VOTER_NOT_FOUND`, `TEMPLATE_NOT_FOUND`, `SURVEY_TEMPLATE_MISMATCH`,
  `WRONG_CAMPAIGN_TYPE`, `CAMPAIGN_NOT_FOUND`, `ORG_REQUIRED`, `INVALID_INPUT`, and the three routes that
  rebuild `{ error }` pass the code through. Additive: the phone's `api.js` acts only on `ORG_CONTEXT`,
  `FORBIDDEN_ROLE`, `SUPPORT_ACCESS_REQUIRED` and `SESSION_REVOKED`; no client matches the messages.
- **Endpoints**, in the campaign-nested admin router (`routes/admin/campaigns.js` area — never the
  `passes`/`efforts` routers, which apply `requireActiveCampaign`): `GET
  /admin/campaigns/:campaignId/refused-uploads?status=open|reviewed|all&userId=` and `PATCH …/:id {
  reviewed }`, behind `requireOrgRole('admin', 'lead')` + `canManageCampaign` (the Audit rule,
  `reports.js:68,143`). Every query filters `{ organizationId, campaignId }` (the PATCH adds `_id`; never
  `findById`), and every join is org-scoped. The PATCH is blocked for a paused org, like flag review. The
  Audit summary (`GET /admin/reports/flags`) gains `notSavedOpen`, campaign-wide and not date-filtered.
- **Deletion** — `RefusedUpload` joins `ORG_SCOPED` (after `Membership`) and `CAMPAIGN_SCOPED`; account
  deletion adds the person's `RefusedUpload` orgs to `DeletedUserRecord.organizationIds`, so
  `hydrateCanvassers` still shows the kept name.
- **Kill switch** — `MOBILE_QUEUE_HOLD` on `/api/build-status`, beside `MOBILE_ERROR_RECOVERY`.
- **Console** — `AuditPage.jsx` gets **Doors not saved** (Part 1 sketch): Open / Reviewed / All, its
  canvasser filter, **Mark reviewed**, the *Signed in as* column.

## E. Exact copy

| Where | Text |
|---|---|
| Sign-out question | **Items not uploaded yet** — `{n}` saved item(s) haven't uploaded yet. They'll stay on this phone and upload the next time you sign in here. · Sign out · Cancel |
| Still sending | Finishing a save… |
| Password screen, *Not you?* | Signing out removes your saved houses from this phone. `{n}` saved item(s) will upload when you sign back in on this phone. Sign out anyway? (plus today's *You'll need signal to sign back in.* when there's none) |
| Password screen, another account | `{n}` saved item(s) from `{Jane D.}` stay on this phone and upload when `{Jane}` signs in here. |
| Waiting line (sign-in screen, drawer, Books) | `{n}` saved item(s) from `{Jane D.}` are waiting on this phone. They'll upload when `{Jane}` signs in here. · Without a name: `{n}` saved item(s) from another account are waiting on this phone. They'll upload when that person signs in here. |
| Waited 30 days | `{n}` saved item(s) from `{Jane D.}` waited 30 days and were removed from this phone. |
| Deleted account | `{n}` saved item(s) from this deleted account were removed from the phone. |
| Hard fail, deleted | This account was deleted. This door wasn't saved. |
| No session at the tap | Sign in again to record this door. |
| Banner | `{n}` item(s) weren't saved — tap to see why |
| Reasons | Not assigned: *You were no longer on this campaign's team when it uploaded.* · No membership: *You were no longer in this organization when it uploaded.* · Support access: *Doorline staff need an access grant for this organization.* · Survey switched: *The walk list's survey was changed after this was recorded.* · Do-not-contact: *This voter asked not to be contacted, so the survey wasn't saved.* · House gone: *This house is no longer in the campaign.* · Walk-up person missing: *The person this survey was for wasn't added.* · Campaign deleted: *This campaign was deleted.* · Campaign archived: *This campaign is archived.* · Account paused: *The account was paused, so this wasn't saved.* · Pin role: *Only team leads and admins can move a house pin.* · Pin off the map: *The new pin was outside the campaign's area.* · Id conflict: *This person couldn't be added. Add them again.* · Anything else: the server's message. |
| Console | Doors not saved · Signed in as · reasons as above in the third person (*Not on this campaign's team*) · Empty: *Nothing has been turned down. Items saved without signal that the server couldn't accept would show here.* |

## F. Tests

- **Server** (`refusedUploads.int.test.js`, throwaway mongod, the real mount order): each refusal class is
  recorded with its code and campaign — the 402 and the org-context refusals for all four kinds, a pin
  move included; live refusals, 401 and the temp-password 403 are not; filing comes from the URL's record
  or the book, never the header or body, and a mismatched-org join files nothing; a removed member with
  prior work is filed in the old org, a stranger nowhere; a deleting org or campaign writes nothing, and a
  write racing a deletion removes itself; a repeated `queueItemId` writes one row; the daily cap; leads see
  their campaign only; the PATCH can't touch another org's row; both cascades remove the rows and another
  tenant's rows survive; the TTL index exists. **Crash safety:** a throwing matcher, a throwing capture, a
  throw before `record()`'s first await, and a rejection that isn't an Error — each leaves the response
  unchanged and the process up.
- **Phone** (`queueRules.test.js`, plus a flush test on an in-memory store, the `sessionStore.js` injection
  pattern): the stamp is taken at the tap and survives the GPS alert's retry; no session refuses; the live
  attempt queues when the session changed; one token per item; every legacy item is stamped in one write;
  another person's items are skipped and never block; the 30-day removal runs only for someone else's
  items; a refusal reaches Not saved with no body and fires the sink; a deleted account's items go at
  sign-out, after a restart and after a self-deletion, and only that `sub`'s; the kill switch restores
  today's behavior; a matching stamp is sent.
- **Web** — the Audit section's rows, tabs, column and empty state.

## G. Docs and Help Center

Help Center content ships with the server, the phone behavior with the update, so phone-behavior copy is
worded for both (*"after the app update, …"*, the pattern of `passes.md:70`, `undo-archive.md:38`); the
Audit page's copy ships with the server.

Sentences that change:

- Help Center: `canvasser-offline.md:8`, `:14`, `:24`, `:32`; `canvasser-first-day.md:42` (*never loses a
  knock*); `signed-out-sign-in-again.md:40-42`; `delete-an-account.md:96-97`, `:100-101`;
  `canvasser-deleted-their-account.md:50-52`; the Audit page guide gains *Doors not saved*; a new canvasser
  FAQ, *My phone says something wasn't saved*.
- Docs: `CANVASSER_APP.md:629-630`, `:636-638`, `:1592-1596` and the queue section; `USERS.md:392-394`,
  `:694-697`, `:1585-1590`; `AUDIT.md:636`, `:641-642`, `:654`; `MARKETING_SITE.md:134`, `:136`;
  `OPERATIONS.md` and `mobile/README.md` gain a `MOBILE_QUEUE_HOLD` runbook beside `MOBILE_ERROR_RECOVERY`;
  `PROPOSAL_ADMIN_ACCOUNT_DELETION.md` (`:5`, `:75`, `:789-792`, `:819-821`, `:1154`, `:1184`,
  `:1191-1194`) and `docs/README.md:80` say E2 shipped with this plan.
- Public page: `client/public/app.html:133`.

## H. Privacy, phones, release

- **Privacy-affecting: yes.** A server record of turned-down items (who was signed in, which house, when,
  what kind, why; no answers, notes or coordinates), kept 180 days, visible to Audit-page users, removed
  with its org or campaign. On the phone: each queued item now also holds the door's address line; a
  **Not saved** list holds the line's fields (address, kind, time, reason — no answers) for its recorder,
  up to 30 days, through sign-out; a deleted account's items are removed; other people's items are removed
  after 30 days of waiting; the waiting line shows a recorder's first name and last initial to whoever
  holds the phone. No subprocessor, export or customer-facing audience is added.
- **Published text** — `privacy.html:95` (decision 8) and `:98` (decision 6), the owner's edits; decision
  8's sentence is true for old and new phones, so it can go live with the server deploy.
- **`PRIVACY_VERIFICATION.md`** — open item 6 (refusals are kept, held items wait up to 30 days, the
  deletion flush covers only that account's items); §C9 *Store 1* (now holds walk-up contacts and the
  door's address; *"exactly two ways"* is no longer true) and a new *Store 1b* for Not saved, both riding
  iOS backups (`:93`, `:6255-6260`); the *Do NOT write* line stands, with "refused items are deleted from
  the phone" added to it; item 12 narrows (others' items are bounded at 30 days of waiting); item 37
  settled by decision 7; the parked policy question (`:2671-2675`) closed by decision 8; a new item for
  `RefusedUpload`.
- **Phones:** `npm run audit:mobile-api` can't see the queued writes (computed paths); it flags
  `canvass.js` by prefix and doesn't check `middleware/` or `models/`, so those diffs are read by hand. No
  client-version gate. JS-only; if `ota:check` refuses, stop, never override.
- **Order:** server deploy → `npm run ota:staging` → §J in an internal org →
  `npm run ota:production -- --rollout-percentage=20` → everyone. *(As built, §P: no
  `migrate:build-indexes` step — the server builds this collection's indexes at boot.)* **Undo:** the kill switch
  for the hold; for a flush bug, republish the previous update (`eas update:republish`). After an undo,
  nothing prunes `canvass.notSaved` — harmless, since it holds no answers.
- **Build** in this tree from `162feb1`; the website half is committed.

## I. Edge cases and risks

- **A loaner phone handed back to the office** — the waiting line names whose items are on it.
- **Two accounts in one person's hands** — kept apart.
- **A super-admin on a support grant** — stamped with their own id; a lapsed grant reads as such.
- **Token rotation** (password changed in place) keeps the same `sub`.
- **A refusal caused by a server bug** — listed on the phone and in the console with the server's message,
  so it's seen and the door can be re-entered.
- **A wrong stamp** holds a person's own items, shown to them as *waiting for* someone; the kill switch
  undoes the hold everywhere.
- **Survey switched mid-canvass** — every waiting survey for the old template is refused and listed.

## J. Verification (on a staging phone, in an internal test organization)

Staging phones use the production server, so this runs in an internal org. A is a plain canvasser (admins
skip the assignment check); A and B each have a book. Record near a window: airplane mode indoors can trip
the GPS gate. After changing a config var, force-quit and reopen the app (build-status is cached 15
minutes).

1. As A, record three doors in airplane mode. **Still offline**, Sign out: the question shows 3. **Sign
   out.**
2. Sign in as B (same org) with signal: the sign-in screen and B's drawer name A; nothing uploads; B's
   badge counts only B's work; Door Outcomes shows none of the three under B.
3. Sign out, sign in as A: all three upload under A.
4. As A, record a door offline; in the console take A off the campaign; reconnect: *1 item wasn't saved*
   shows — on the *Not assigned to this campaign* screen if the map is replaced — with the team reason; the
   console's Audit page lists it under A.
5. Survey a voter offline, flag them do-not-contact in the console, reconnect: Not saved, the
   do-not-contact reason, no answers kept (check the sheet shows only the line).
6. **Pre-update items:** on the old app record offline; apply the update; go offline; record one more;
   force-quit; reopen; sign out; sign in as B: nothing goes up under B; sign in as A: all of A's go up.
7. **Deleted account:** with a throwaway canvasser C, record offline; delete C in the console; reconnect
   on a door screen: the save isn't queued again; the sign-in screen says C's items were removed; force-quit
   and reopen: still removed, nothing under the next person.
8. **Kill switch:** queue items as A, set `MOBILE_QUEUE_HOLD=off`, force-quit, reopen, sign in as B: A's
   items upload under B (today's behavior). Set it back.
9. On a production-lane phone still on the old app, repeat step 4's refusal: the console lists it, which
   proves the server half alone.

## K. What changed after review round 1 (2026-11-01, four reviewers)

Server on a throwaway mongod; phone in a simulation of the real queue; privacy, release and simplicity;
the website plan (reported in PROPOSAL_AAPC_LANDING.md).

| Found | Change |
|---|---|
| **Blocker:** the recorder was stamped at enqueue, up to 20 s after the tap, from whatever token was current — a sign-out and sign-in in that window put A's door under B | Stamped at the tap from the session that recorded it (§E2 step 1) |
| **Blocker:** `privacy.html:95` becomes false; the plan said nothing did | Decision 8, a release gate |
| **Blocker:** §E2 (deleted accounts) was assigned to this plan and missing | Carried whole; decision 7 settles the trade |
| The flush read the token per request — a sign-in mid-flush moved 5 of 8 items to B (simulated) | One token per item, used to decide and to send |
| The Not saved list wasn't per person — B saw and could remove A's | Filtered by recorder; final reasons keep no answers |
| The pin kept its "done" color after a refusal | A refusal sink does what a live refusal does |
| Missed readers of the queue (the door-change confirm, the sign-in line) | Listed; mine vs. everyone's decided per reader |
| Sign-out paths missing (password screen's other-account sign-in), Upload now on a dead session, false "no signal" copy, refusals during Upload now | Fixed in §C and §E |
| Try again could re-order an add after its survey, and treated *superseded* as saved | Tap-order merge; superseded says so; console says *Replaced* |
| The admin's Remove deletes the membership row, so "removed canvassers reach their old org" was false | Also filed when the person has worked there |
| Filing trusted the header and the body's campaign — another org's address could reach the wrong admins | Server records only, org-checked joins |
| A recorder mounted later would miss the 402 and org refusals | Mounted between `requireAuth` and `requireEntitlement` |
| Fire-and-forget writes could crash the web dyno (no rejection handler) | Every promise caught; §F tests it |
| A unique index could fail `build-indexes` | Not unique |
| Writes could land during a deletion; the late-write sweep pattern would sweep across tenants | Skip + self-delete; that pattern is banned here |
| "A re-import removes the house" was wrong (it's accepted) | Re-import wording gone; Undo import named |
| Refusals missing from the list (survey switched, template gone, pin bounds, …) and code-less refusals | Listed; every refusal gets a code |
| No kill switch for a pre-Election production update | `MOBILE_QUEUE_HOLD` |
| Help copy would change before the phone does; a dozen sentences elsewhere become false | Ordering rule and the full list in §G |
| Simplicity | Dropped the server recorder check, "campaign unknown" rows and the unique index; reuses `tokenSub` |

## L. What review round 2 found (2026-11-01, three reviewers)

Server on a throwaway mongod (real mount order); phone in a simulation built on the real `sessionStore.js`
and `sessionEnd.js`; a pre-mortem (*"the update shipped Nov 2 — what broke by Election night?"*) with a
coverage audit of round 1. **One blocker, found by all three:** a walk-up person's survey that waits
behind a refused add is refused as *voter not found* (`canvass.js:870-871` looks the voter up before it
checks access), which v2 treats as final — so Try again saves the person and throws the answers away.

The rest, grouped by what fixes them:

| Area | Finding | Fix (in v3) |
|---|---|---|
| Try again (v2's addition) | Pairing an add with its survey; a retried pin move overwrites a newer pin fix (`updateHouseholdLocation.js:112-160` has no staleness check); *superseded* has no place to show; legacy entries break the tap-order sort | **Decision 9** — removing Try again removes all four |
| Upload now | `flushQueue` joins a running flush and returns only its last pass, so Upload now can't see a refusal; on the password screen the session is dead | **Decision 10** |
| Held items | Only the signed-out sign-in screen shows them; a wrong stamp reads as a zero badge; an account deleted while signed out leaves its items, answers and GPS on the phone forever | A line for the signed-in person in the drawer and Books; **decision 11** (a 30-day limit) |
| The stamp | A null stamp is possible through the GPS alert's Try again (`recordAction.js:384-390`); only the first legacy item gets stamped when the flush stops at a network error | Carry the stamp through that retry; refuse to record with no session; stamp every legacy item in one locked write |
| Sign out | Waiting 5 s (SessionGate's loop) misses a save that takes up to 20 s; every Sign out button clears the query cache before signing out | Ask first, then clear; count saves still sending ("1 still sending"), with a spinner |
| The banner | The refusal's refetch replaces the map and Books with *Not assigned to this campaign*, or sends the phone to select-org — the two screens that show the banner | Show the not-saved line on those screens, select-org and the drawer too; the sink only clears pending marks (a flushed item has no rollback) |
| Not saved labels | A queue item holds no address, and sign-in clears every cached house before the flush | Store the house and its address at the tap (privacy: those addresses outlive sign-out — Store 1b) |
| E2 | The deleted-account notice lives only in memory (lost on restart); deleting your own account never runs the cleanup; the kill switch didn't cover E2 | Remember deleted accounts on the phone and re-run the cleanup at startup; run it after a self-deletion; the switch covers E2 and reverts the copy |
| Recorder (server) | At `finish`, `req.params` is empty for middleware refusals (402, org context) | Parse the kind and ids from `req.originalUrl` inside the async writer |
| Recorder (server) | A synchronous throw in the `finish` listener or the `res.json` wrapper exits the web dyno (Node 20, no handler) or turns a 403 into a 500 | try/catch around the matcher and the capture; always call the real `res.json`; the writer awaited and caught; tests for each |
| Recorder (server) | The "worked there" check scanned a 300,001-row org (144 ms) | Hint the `userId` indexes, `maxTimeMS`, memoize per person and org |
| Recorder (server) | Lost-response resends add duplicate rows | Upsert on `{ userId, queueItemId, kind, door }` whenever a `queueItemId` is present |
| Codes | Still code-less: campaign not found, active organization required, invalid input, household for voter not found; three routes rebuild the body as `{ error }` | Add them and pass them through; choose copy by code **and** kind |
| Endpoints | `canManageCampaign` passes any admin whatever the org | Every query filters `{ _id, organizationId, campaignId }`; the Audit summary field named apart and campaign-scoped |
| Removal | A temporary canvasser **removed** (not deactivated) with a whole shift queued leaves no tie to the org, so the console sees nothing | The Remove confirm (web and phone) says to let their phone sync first, or Deactivate; Limits says so |
| Console | The Canvasser column shows whoever uploaded (old phones, or the switch off) | Call it *Signed in as*; word the reason *Not on this campaign's team* |
| Release | A deploy's SIGTERM can drop a write started after the response; a removed canvasser's token can spam their old org | Await in-flight writes (bounded) before exit; cap rows per person, org and day |
| Release | One OTA to everyone; a second server deploy for help copy doesn't fit one `git add -A` | `--rollout-percentage=20` first, with the undo ready; help copy worded "after the app update" |
| Docs | §G missed `canvasser-offline.md:8`, `:14`, `canvasser-first-day.md:42`; no kill-switch runbook; E2's own plan still says "after Election Day" in seven places | Added to §G; a runbook beside `MOBILE_ERROR_RECOVERY`; the E2 plan updated |
| Policy | Decision 8's wording is true for old and new phones alike | It can ship with the **first** server deploy, not gate the phone update; its subject becomes "What you record while offline" (it covers walk-up contacts too) |
| Process | The website half sits in this tree now | Build the queue half in its own worktree after the website commit; hand it over as one patch and check the combined tree |

## N. What v3 changed (2026-11-01, after the owner's decisions 9–12)

- **Removed** (decisions 9, 10, 12): phone-side Try again and everything that served it (`retry: true`,
  retry outcomes on the server, `retryOrder`, `canRetry`, bodies kept in Not saved, the walk-up pairing
  — so round 2's blocker is gone with it); Upload now in the sign-out question; the phone's admin Audit
  row.
- **Added** (decision 11): items waiting for someone else are removed after 30 days, the next time another
  person is signed in, with a line on the sign-in screen.
- **Every other §L row, fixed:** the stamp carried through the GPS alert's retry, no recording without a
  session, the live attempt queued when the session changed, every pre-update item stamped in one write;
  sign-out asks before the cache is cleared, waits up to 20 s with *Finishing a save…*; the banner also on
  the *Not assigned* screen, select-org and the drawer; the house and its address stored at the tap; a
  waiting line for the signed-in person; deleted accounts remembered on the phone, cleaned at sign-out, at
  start and after a self-deletion; the kill switch covering the hold, the E2 cleanup and the 30-day
  removal; the recorder parsing the URL at arrival, crash-proof, its lookups hinted and memoized, upserting
  on the queue item, capped per person per day, drained on shutdown; codes on every refusal, passed
  through, copy chosen by code and kind; endpoint queries filtered by organization and campaign; the Remove
  confirmation's warning; *Signed in as* in the console; a 20% first rollout; help copy worded for both
  versions; the full doc list; the policy sentence able to ship with the server.

## O. Review round 3 and v3.1 (2026-11-01, three reviewers — the last round)

Server probes on a throwaway mongod and a crash harness on Node 20; the phone in a simulation built on the
real `sessionStore.js`/`sessionEnd.js` with a settable clock; a coverage, privacy and pre-mortem pass.
**Two blockers, both fixed by making things smaller.** This list overrides older lines above.

| Found | v3.1 |
|---|---|
| **Blocker:** v3 copied each door's address into the queue item and Not saved — both survive sign-out and ride iPhone backups, while `privacy.html:95` says the walk-list copy (addresses included) is deleted at sign-out | **No address is stored on the phone.** Items and Not saved entries keep `householdId` only; the sheet looks the address up in the cached books when the recorder has them, else shows *"A door you recorded Oct 30, 3:42 PM"* with what was recorded. Not saved drops `recorderName` too (only its recorder sees it). |
| **Blocker (rare):** the 30-day removal trusted the phone's clock at queueing — a phone 40 days behind lost doors the moment its clock corrected | `heldSince` is stamped the first time an item is seen while someone else is signed in; an item is stale when now − max(`enqueuedAt`, `heldSince`) > 30 days, and a date in the future is never stale |
| The "waited 30 days" and deleted-account lines were held in memory or counted once | Both persist (with the deleted-accounts store), read their counts live, say *"a deleted account"* (no name), show once in the signed-in person's drawer and on the sign-in screen until the next sign-in |
| Pre-update items showed *"waiting for … another account"* though they upload under the next sign-in | `getWaiting()` skips unstamped items; signed out, a separate line: *"`{n}` saved item(s) from before the app update will upload under the next person who signs in."* |
| The kill switch left the sign-out promise, the other-account line and the no-session refusal on | Off: the sign-out question says *"They'll upload with the next person who signs in on this phone"*, the waiting lines hide, recording never refuses (a null stamp), and a refusal of an item sent under someone else reads *"It uploaded while someone else was signed in."* |
| Each refusal reloaded the multi-MB bootstrap (40 phones × 25 refusals ≈ 1,000 builds on a survey switch) | The sink clears marks per item (`clearPendingHousehold` **and** `clearPendingLocation`); the bootstrap is invalidated **once per flush pass** |
| Flush locking was ambiguous | Steps 1–3 are one locked write that reads the session inside the lock; sends run outside the lock; each removal takes the lock (today's pattern) |
| Stamp sources | `recorderName` from `qc.getQueryData(['bootstrap']).user` at entry (sync); `householdId` passed by the wrappers (`:539`, `:584`, `:600`); a survey's from `bootstrap.voters`; pre-update items' from their `/households/:id/` path |
| The live attempt patched the map in B's session | The session is re-checked before the optimistic patch; changed → only queue |
| *Finishing a save…* can't live in an Alert | Rendered by `SessionGate` beside *Signing out…* |
| Not saved pruned only when opened | Every recorder's entries pruned on each flush and at app start |
| `classify` | Reuse `answeredByDoorline` (`seatedRoster.js:16-27`); 429 is temporary |
| Deactivate and *remove from this campaign* lose late doors too; the member review says *"refused and thrown away"* (`mobile/lib/memberDeletion.js:93`, `client/src/lib/memberDeletion.js:86`) | The warning goes on Remove, Deactivate and remove-from-campaign (web `PersonBody.jsx:58` and the phone), and those lines are updated |
| **Server:** the cap counted rows, not bytes — a removed canvasser's token could store ~2 MB ids | Body fields are kept only if sane: `queueItemId` a string of ≤ 64 characters, `recordedAt` a finite date, ids 24-hex; else null |
| **Server:** the "worked there" hints named an index `SurveyResponse` doesn't have — a rejected check in production would silently stop filing removed canvassers | Reuse `orgCarriesUser` (`services/reports/canvasserIdentity.js:53`: membership in any state, or their own knocks or surveys there, desk marks excluded; no hint needed; 7–9 ms at 200k rows), memoized a minute per `userId:orgId`, pruned |
| Tracking `record()` in the wrong order exits the process | `record().catch(log)` first, then track that promise; the logger itself wrapped in try/catch |
| A lost response, then an accepted resend, left an open row | A 2xx replay carrying a `queueItemId` closes open rows for `{ userId, queueItemId }` (`savedLaterAt`; out of Open) |
| Duplicates under concurrency; the TTL waiting on build-indexes | Indexes built at boot (the `syncPacePauseIndexes` pattern, `server.js:21`) including a **unique partial** `{ userId, queueItemId }` (`$type: 'string'`); E11000 caught as "already recorded" — so this model needs no build-indexes step |
| The matcher | On `req.path` at the mount: POST only, `/^\/(households\|voters)\/([^/]+)\/([^/]+)\/?$/i`, `decodeURIComponent` in try/catch, a non-hex id matches with id null (filing falls back to the book). The only other /mobile POST, `/voters/:id/notes`, doesn't match |
| `res.json` called twice recorded the wrong refusal | Capture status and body on the first call only, while `!res.headersSent`; no `close` listener (a dropped client resends) |
| The cap's day; no recorder switch | A Central-time day, the map cleared at rollover; a `REFUSAL_RECORDER=off` config var, read per request |
| `FORBIDDEN_ROLE` from `requireOrgMember` ("No active org membership") read as the pin rule | Copy by code, kind **and** message |
| `notSavedOpen` with no campaign (an admin's all-campaigns /flags) counted 0 | Org-wide in that case |
| The console list | Capped like the flag list (`ENTRY_LIMIT`) and polled with `livePollOptions` (`AuditPage.jsx:37`, `:209`) |
| Overclaims | Part 1 says *"turned-down doors the server can file"* and Limits names the gaps (the cap, deletions, people with no tie, a pin move on a hard-deleted house); *"or you re-enter what you can"* (answers aren't kept); §H lists every stored field, `voterId` included |
| E2 tests not carried | The ordering test (a save answered after the deletion 401 is gone after sign-out; nothing under the next account), `shouldQueue`, the cleanup decision; `signedOutNote` stays unchanged (`sessionEnd.parity.test.js`) |
| §J steps 2, 5, 6, 8 couldn't run as written; decision 11 untested | B records one door offline (badge 1); step 5 puts A back first; step 6 downloads the update, taps Later, goes offline, records, force-quits and reopens offline; step 8 signs out offline before flipping the var; decision 11 tested with an injected clock |
| Release | Everything under `mobile/` ships with an OTA — checked 2026-11-01: **nothing has changed under `mobile/` since the production update of `95a532e`**, so this update carries only the queue fix (re-check on build day). Commands run from `mobile/`; `-- --rollout-percentage=20` reaches `eas update`; everyone via `eas update:edit <group> --rollout-percentage 100`; undo mid-rollout via `eas update:revert-update-rollout --group <group>`, per platform. The policy edit goes live before `ota:staging` (staging phones are real phones on production) |
| Stale references | `app.js:100` → `:103`; `MARKETING_SITE.md:134/:136` → `:190/:192`; `PRIVACY_VERIFICATION.md:6255-6260` → `:6297-6298`; `delete-an-account.md:96-97` → `:97-98`; §G adds `canvasser-deleted-their-account.md:8`, `:16` and notes `page-audit.md` is console-only for this section |

## P. As built (2026-11-01)

Built from v3.1, both halves, uncommitted. What was built is documented in
[CANVASSER_APP.md](CANVASSER_APP.md) → *Work saved on the phone* and *The offline queue*,
[AUDIT.md](AUDIT.md) → *Doors not saved* (Part 1) and §H, [OPERATIONS.md](OPERATIONS.md) (the release and
both switches), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 54, and the Help Center (§G's list,
plus a new canvasser FAQ, *My phone says something wasn't saved*).

**Where the phone differs from the plan**

1. **Every sign-out** stamps pre-update items as the ending account's and clears the in-memory pending
   colors and pin moves (`sessionStore` `onSessionEnd` → `app/_layout.jsx`: `clearAllPending`,
   `prepareQueue`, then the deleted-account cleanup for reason `deleted`). The code review found the
   sign-out question promising pre-update items to the person signing out while only a flush stamped
   them, and the next person's map showing the last person's unsent colors.
2. **`heldSince` restarts** while the recorder is signed in: the 30 days are 30 days of waiting while
   someone else holds the phone.
3. **A failed storage read rejects** (as the old queue's did) instead of reading as empty, so no write can
   save an empty list over the items; a refusal is written to Not saved **before** it leaves the queue.
4. **The kill switch and E2:** off, the cleanup remembers the deleted account but removes nothing; the
   flush finishes it if the switch comes back on. Deleted accounts are dropped from the phone after their
   30 days (found in testing).
5. **The removal notices** (deleted account, waited 30 days) show on the sign-in screen and in the menu,
   not on Books.
6. **Copy:** a survey whose person is gone reads *"The person this survey was for isn't in this
   campaign."* (Undo import too, not only a walk-up add); the Not saved sheet drops *"Your team sees them
   too"* (the console lists only what the server can file); the other-account line with the switch off is
   today's words exactly; the member warning reads *"…after you {remove|deactivate} them, those doors
   can't be saved"* on Remove from org, Deactivate and remove-from-campaign, web and phone; the member
   review's switched-off line points at *"Doors not saved on the web console's Audit page"* on both (the
   parity test holds them word for word).
7. **The sign-out question** waits until the app is in front (Android drops an alert fired in the
   background), and **a pause answer** from a flush applies only if the session didn't change mid-send.
8. **The stamp's campaign** reads `bootstrap.campaign.id` (the phone's field), and a pin move held for its
   recorder drops its overlay.

**Where the server differs from the plan** (the builder's list, checked against the code)

1. Any 2xx replay closes the row, `200 { superseded: true }` included (the server already holds that tap
   or a newer one); the close filter adds kind and door, so another request reusing a queue id can't close
   a refusal.
2. The upsert and close filters state `queueItemId: { $eq, $type: 'string' }`: a plain equality skips the
   partial index (checked on MongoDB 7.0). A repeated refusal takes the latest status, code and message and
   keeps the review state.
3. Filing: any disagreement between the door's, the voter's and the book's organization files nothing; a
   book in another campaign of the same organization is dropped and the row is filed from the door. Checks
   run cap → the carries memo (which remembers "no" too) → the deletion check; the cap counts inserted rows.
4. Indexes are synced at boot by the web dyno only (`server.js`), so **there is no `migrate:build-indexes`
   step** (Part 1's gates and §H's order are corrected). A second config var, `REFUSAL_RECORDER`.
5. `GET` answers `{ open, all, total, limit, rows }`; a malformed campaign id is 404; a PATCH on a campaign
   being deleted is 409 `campaign-deleting`. A malformed percent-escape in the path doesn't match (Express
   answers 400 first).
6. The console words `TEMPLATE_NOT_FOUND` as *"The survey was deleted"* (not in §E); other unlisted codes
   show the server's message. The member warning isn't on a deleted account's Remove, and the campaign
   assignments modal's Remove (no confirmation step) is unchanged.
7. **`notSavedOpen` was dropped** (the server review): nothing read it, and it added a count query to every
   `/flags` poll; the section's own `open` count is what the page shows. *(§D's line and §O's row about it
   are superseded.)*
8. A *house not found* whose house is still in the campaign reads *"Uploaded while another organization was
   selected on the phone"* on the console (the server hides another organization's house behind the same
   404); a survey whose person is gone reads *"…isn't in this campaign"* there too.

**Code review of the build (2026-11-01).** Phone half, one reviewer: nine findings — one medium (a failed
storage read could wipe the queue), the rest low (a refusal lost if its second write failed; pre-update
items at sign-out; the alert in the background; the sheet reopening itself; pending colors across a
sign-out; the 30-day clock; copy; the pace answer) — all fixed, with tests. Server half, one reviewer: no
crash, response, cross-tenant or retention bug (probed: responses byte-identical with the recorder on and
off; the daily cap exact; a deletion racing the write leaves no row; SIGTERM drains a held write); four
low findings — a console reason contradicting a row filed across organizations (fixed, item 8), account
deletion's lookup scanning this collection (its comment corrected; small by design), the unread
`notSavedOpen` (dropped, item 7), and the app page's line while the switch is off (a runbook note) — and two
accepted edges below.

**Verified** (after every fix above). Phone 446/446 (`queueCore` 18, `queueRules` 10, the rest unchanged);
server unit 766 passed, 0 failed (an unrelated event-loop timing test failed once under load from a
concurrent run, and passes alone); web 1,223/1,223; integration suites through `npm run test:int` (which builds the hinted indexes first):
`refusedUploads` 17/17, `teamLead` 21/21, `teamAttribution` 22/22, `orgAccountDeletion` 32/32,
`campaignDeleteJob` 13/13, `buildStatus` 11/11, plus the builder's 67-suite run, 1,178/1,178.
`npm run audit:mobile-api` flags `canvass.js`, `campaigns.js`, `reports.js` and `buildStatus.js` — read by
hand, all additive (on the queued routes only a `code` was added; no status or message changed), so no
client-version gate. `ota:check`: both lanes match their latest builds (staging Android 5 / iOS 30,
production Android 4 / iOS 27) — nothing hashed changed.

**Limits that stay.** Pre-update items recorded by someone other than the account signed in when they're
stamped go to that account; a `heldSince` stamped while the phone's clock is wrong can still shorten the
30 days once the clock corrects; the campaign cascade's `deleteMany({ campaignId })` and account deletion's
`distinct` on `userId` scan this collection (small by design: the cap and the 180-day expiry); a queue
item id reused on a different door is filed once (the unique index; phone ids never repeat); a resend
accepted while the first refusal's write is still running can leave that row Open (milliseconds; it is
marked reviewed by hand); a 402 or membership refusal computed for another selected organization is filed
in the door's organization with that reason (phones pin each save to its organization, so only very old
queued items can do it).
