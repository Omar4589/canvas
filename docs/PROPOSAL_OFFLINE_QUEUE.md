# Proposal: Saved-without-signal doors are never lost or misfiled (the offline queue)

> **Status: PLAN v2 + review round 2's findings (2026-11-01). Two rounds done (seven reviewers). Round 2
> found 1 blocker and ~20 majors, mostly in what v2 added (§L). Four simplifications are the owner's to
> decide (§M); v3 is written in one pass once they are. Not built.** From
> the AAPC landing brief §10, Phase 2 ([PROPOSAL_AAPC_LANDING.md](PROPOSAL_AAPC_LANDING.md)): *"Never drop a
> queued item silently; show dropped items to admins with the reason. Stamp each item with who recorded
> it. Never upload it under another user; hold it until that canvasser signs in."* It also carries §E2 of
> [PROPOSAL_ADMIN_ACCOUNT_DELETION.md](PROPOSAL_ADMIN_ACCOUNT_DELETION.md) (a deleted account's unsent
> doors), which the owner sent to this plan on 2026-10-24. One server deploy, then one phone update
> (JavaScript only, no store build), staging first. One new collection with a self-expiry index
> (`migrate:build-indexes`). One new config var (the kill switch). Line references are to HEAD
> `27e8711`. What round 1 changed is in §K.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) (*Recording, replacement, and the offline queue's ordering
rule*), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (open item 6, §C9 *Store 1*, items 12, 37
and 51), [PROPOSAL_SESSION_EXPIRY.md](PROPOSAL_SESSION_EXPIRY.md) (why a queued door survives sign-out).

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
   person is signed in.** If someone else signs in first, the door waits on the phone until the right
   person signs back in there.
2. **Signing out with doors still waiting asks first:** *"3 saved items haven't uploaded yet."*
   **Upload now** · **Sign out anyway** (they stay on this phone for next time) · **Cancel**. It waits for
   a save already in progress before it counts.
3. **When someone else signs in on that phone,** the sign-in screen says *"3 saved items from Jane D. are
   waiting on this phone. They'll upload when Jane signs in here."* Badges count only your own work.
4. **A door the server turns down is never deleted silently.**
   - **The canvasser who recorded it** sees *"1 item wasn't saved — tap to see why"* on the map and
     Books, and only they see their own: the house, what was recorded, when, and why in plain words.
     **Try again** resends their items in the order they were recorded, when the reason can change (for
     example, after they're added back to the campaign). **Remove** clears one. The list clears itself
     after 30 days. For a reason that can't change (do-not-contact, a house or campaign gone), the phone
     keeps only what it needs to show the line, not the survey answers.
   - **Admins and the campaign's leads** see every turned-down door on the **Audit** page, in the console
     and on the phone: who, which house and book, what (Not home, Survey, Added a person, Moved a pin),
     when it was recorded, and why, with **Mark reviewed**. If Try again later saves it, the row says
     *Saved on retry*. **This part works for every phone from the day the server is deployed**, before
     anyone has the phone update, because the server is the one that turns the door down.
5. **A deleted account's waiting doors are removed from the phone**, with one line on the sign-in screen:
   *"3 saved items from this deleted account were removed from the phone."* They can't be credited to
   anyone any more (decision 7, decided).
6. **A kill switch.** A setting in the Heroku dashboard turns the who-recorded-it hold off on every phone,
   back to today's behavior, with no phone update. For an update that ships before Election Day.

## What it looks like

```
SIGN OUT, WITH ITEMS WAITING              SIGN-IN SCREEN, SOMEONE ELSE'S ITEMS WAITING
┌───────────────────────────────┐         ┌───────────────────────────────────┐
│ Items not uploaded yet        │         │  Email     [                   ]  │
│                               │         │  Password  [                   ]  │
│ 3 saved items haven't uploaded│         │  [            Sign in          ]  │
│ yet. If you sign out now, they│         │                                   │
│ stay on this phone and upload │         │  3 saved items from Jane D. are   │
│ the next time you sign in     │         │  waiting on this phone. They'll   │
│ here.                         │         │  upload when Jane signs in here.  │
│                               │         └───────────────────────────────────┘
│ Upload now                    │
│ Sign out anyway               │
│ Cancel                        │
└───────────────────────────────┘

MAP / BOOKS (the canvasser who recorded it)   "NOT SAVED" SHEET
┌───────────────────────────────┐         ┌───────────────────────────────────┐
│ ⚠ 1 item wasn't saved —       │  tap →  │ Not saved                       ✕ │
│   tap to see why              │         │ [ Try again ]                     │
├───────────────────────────────┤         │ 1412 Elm St · Not home            │
│            (map)              │         │ Oct 30, 3:42 PM                   │
│                               │         │ You were no longer on this        │
└───────────────────────────────┘         │ campaign's team when it uploaded. │
                                          │                          Remove   │
                                          └───────────────────────────────────┘

CONSOLE — AUDIT PAGE, NEW SECTION (the people who can open Audit today)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Doors not saved · 2 open                                  [Open] Reviewed  All    │
│ Recorded        Canvasser    Door                 What       Why                  │
│ Oct 30 3:42 PM  Jane Doe     1412 Elm St · Book 7 Not home   Taken off this campaign  [Mark reviewed] │
│ Oct 30 3:51 PM  Jane Doe     1418 Elm St · Book 7 Survey     The walk list's survey   [Mark reviewed] │
│                                                              was changed                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The phone's audit screen (admins and leads) gets the same list as a **Not saved** row with its count.

## What doesn't change

- Doors still save without signal and upload by themselves when signal returns. Canvassers aren't asked
  anything new, except the sign-out question when something is waiting.
- Everything the server already accepts late stays accepted (listed under *The problem*).
- Deleting the app still deletes anything waiting on it.

## Limits, said plainly

- **Items waiting for someone who never signs in on that phone again stay there.** The phone shows them
  (sign-in screen); the console can't, because the server never received them. This is the trade the brief
  asks for: today those doors upload under the wrong person.
- **Items saved before the update don't know who recorded them.** They upload under the first person
  signed in after the update applies, which is today's behavior, once. Phones apply updates on a
  restart, almost always with the same person still signed in.
- **A refusal is filed only where it can be shown:** under the campaign of a house, voter or book that
  still exists, in an organization the person belongs to or has worked in. A door whose house and book
  are both gone (Undo import, then the book deleted) is listed on the phone but not in the console.
- **The console's list doesn't keep survey answers**, only that a survey was turned down. The phone keeps
  the full survey while Try again can still save it.

## Timing and gates

1. **Server first.** The Audit list starts filling for every phone the day it deploys. Then
   `npm run migrate:build-indexes -- --apply`, so the records expire on time.
2. **Phone update on the staging lane** (TestFlight / Play internal), checked on a real phone with the steps
   in §J, in an internal test organization: staging phones talk to the production server.
3. **Privacy policy.** Its offline sentence (*"saved on your device until a connection is available, and
   each is removed once it has been delivered"*) stops being true with this update: a turned-down item is
   kept up to 30 days, and items held for someone else wait even with signal. **Your edit goes live
   before or with the production update** (decision 8: *"…stored on your device until the app has
   delivered them or no longer needs them."*).
4. **Production phone update** (`npm run ota:production` from `main`) once the staging check passes.
   Before Election Day is fine; the kill switch is there if something goes wrong.

## The owner's decisions

**Decided 2026-11-01: all as recommended, except #5: production can go out before Election Day. On 8 the
owner added: keep the policy general, not hyper-specific ("companies don't do that, so they can protect
themselves") — so the sentence below says only what stays true for every phone.**

| # | Question | Recommended |
|---|---|---|
| 1 | Should the sign-in screen say whose items are waiting (first name and last initial)? | **Yes** (decided) |
| 2 | How long does a turned-down item stay in the phone's **Not saved** list? | **30 days** (decided) |
| 3 | How long does the console keep turned-down door records? | **180 days** (decided) |
| 4 | Who sees them in the console? | **The people who can open the Audit page** (decided) |
| 5 | Production timing | **Once staging passes; before Election Day is fine** (decided) |
| 6 | Privacy policy, local storage line (*"to keep you signed in"*): add *"and to let the app work without signal"* | **Yes** (decided; your edit) |
| 7 | When an admin deletes an account, that person's unsent items can no longer upload under anyone. Remove them from the phone (with a one-line notice), or leave them stuck there, unsendable? | **Remove them** (decided) |
| 8 | Privacy policy, offline sentence (line 95). Today: *"…are saved on your device until a connection is available, and each is removed once it has been delivered to our servers."* New, general, true for old and new phones alike: *"…are stored on your device until the app has delivered them or no longer needs them."* | **Decided**; your edit, live before the production update |

# Part 2 — Technical reference

## A. What exists today (verified at `27e8711`, by reading and by replaying on a throwaway mongod)

- **The queue** — `mobile/lib/offlineQueue.js`, AsyncStorage key `canvass.offlineQueue`. Items are
  `{ id, path, body: { ...body, wasOfflineSubmission: true }, orgId?, enqueuedAt }` (`enqueue`, `:45`).
  **Nothing records the user.** `enqueue` runs only **after** the first upload attempt fails, which can be
  up to 20 seconds after the tap (`submitOrQueue`, `:197-209`; `api.js` timeout `:25`).
- **One writer** — `optimisticSubmit` (`recordAction.js:311`) → `submitOrQueue` (`:418`), for four kinds
  of write: the seven door results, surveys (`voter/[id]/survey.jsx:146`), walk-up adds (`recordAddVoter`)
  and pin moves (`recordLocationCorrection`). All four routes live in `server/src/routes/mobile/canvass.js`.
- **The flush** — `doFlush` (`:95`): no status or 5xx → stop; 401 or the temp-password 403 → hold
  (`:127`); **any other 4xx → `removeItem` (`:131-134`)**. The returned `errors` list is read by no caller.
  `api()` reads the stored token on **every** request (`api.js:57`), so a sign-in during a long flush
  changes whose token the rest of the queue goes up under.
- **Who it uploads as** — whoever is signed in at flush time; `login.jsx:100` flushes right after any
  sign-in; `notYouConfirm` (`sessionEnd.js:143-149`) says so. Plain Sign out (`CanvasserDrawer.jsx:152`,
  `admin/more.jsx:158`, `super-admin/more.jsx:41`, `map.jsx:794`) neither waits for in-flight saves nor
  looks at the queue. `SessionGate.jsx:118` already waits on `hasInFlightActions()` for automatic ends.
- **Readers of the queue** — `getPendingCount` (map, Books, `ReauthNotice`, `ReauthSheet`,
  `DeleteAccountSheet`, `login.jsx:54` via `pendingLine`, `sessionEnd.js:130`) and `getPending` in
  `confirmDoorChange` (`recordAction.js:507` → `doorChange.js` `ownSurveysHere`).
- **Helpers that exist** — `tokenSub(token)` (`sessionEnd.js:52`) reads the JWT `sub`; `atob` works on the
  app's Hermes (RN 0.81). The pending overlay (`markPendingHousehold`, `recordAction.js:127-155`) keeps a
  door's optimistic color through the 30-second change check, which sends only doors the server changed
  (`routes/mobile/bootstrap.js:499`); a live refusal clears it (`recordAction.js:445-447`).
- **What the server already forgives on a replay** (`wasOfflineSubmission: true`), reproduced: outcome
  toggles (`canvass.js:450-453`), the automatic pause (`:268-271`), writes stamped before an account pause
  (`entitlement.js:85-93`), archived campaigns for door results (201), a household a re-import marked
  inactive (`recomputeHouseholdActive.js:38` — 201), and replays superseded by a newer result, a repeat
  or an unknock (`200 { superseded: true }`, `:488-491`, `:517`, `:981`).
- **What the server still refuses on a replay**, reproduced: not assigned 403 *no code* (`:117`); org
  membership missing, inactive or removed 403 `ORG_CONTEXT` (`orgContext.js:129-136`); org being deleted
  404 `ORG_CONTEXT` (`:45`); super-admin without a grant 403 `SUPPORT_ACCESS_REQUIRED`; household
  hard-deleted 404 *no code* (`:427` — only Undo import, `undoImport.js:184`, and the delete cascades
  hard-delete a house), also the wrong-org case (`:104`); campaign deleting 404 (`:435`); 402 for a write
  stamped after the pause; survey: do-not-contact 403 (`:882`), voter not found 404 (`:871`, also a
  walk-up's survey that arrives before its add), household for voter not found 404 (`:874`), template not
  found 404 (`:901`), template mismatch 400 (the walk list's survey switched); wrong campaign type 400
  (door results, adds, surveys); walk-up add on an archived campaign 409 (`:1237`), id conflict 409
  (`:1288`, `:1329`); pin move by a non-lead 403 `FORBIDDEN_ROLE` (`:638`), `out_of_bounds` /
  `invalid_coords` 400 (`:676`); an opt-in outcome never turned on, `OUTCOME_DISABLED`. A malformed id is a
  500. Nothing on `/mobile` answers with `res.send` or `sendStatus`.
- **Membership** — the admin's **Remove** deletes the `Membership` row (`routes/admin/memberships.js:949`);
  **Deactivate** keeps it with `isActive: false` (`:1246`). Org deletion removes rows with the org.
- **Mount order** (`routes/index.js`) — `requireAuth` + `blockIfMustChangePassword` (`:92`),
  `requireEntitlement` (`:95`, its 402 is sent here with `req.activeOrg` still null), `accessLog`
  (`:102`); every `/mobile` path then passes `mobileBootstrapRouter`'s `requireAuth, orgContext,
  requireOrgMember` (`:170`) before reaching `canvass.js`. `express.json` is global (`app.js:100`).
  Express 4.22.1.
- **The web dyno has no `unhandledRejection` handler** (only `worker.js:54`; `pacePause.js:175` notes it).
  Node 20 exits on an unhandled rejection.
- **Deletion machinery** — org cascade (`services/platform/deleteOrganization.js`, `ORG_SCOPED`), campaign
  cascade (`CAMPAIGN_SCOPED`), late-write sweep (`lateWriteSweep.js`: `deletingTenant`, `sweepIfDeleting`
  — **which turns a missing campaign into `{ campaignId: null }` and would sweep every tenant's
  campaign-less rows**), account deletion (`deleteAccount.js:644-648`, `DeletedUserRecord.organizationIds`).
  `strictQuery` is on (`db.js:26`).
- **The privacy policy's offline sentence** (`client/public/privacy.html:95`): *"…saved on your device
  until a connection is available, and each is removed once it has been delivered to our servers."* The
  privacy record already parked it for the owner (`PRIVACY_VERIFICATION.md:2671-2675`).
- **The account-deletion plan's §E2** (`PROPOSAL_ADMIN_ACCOUNT_DELETION.md:789-833`) designed the
  deleted-account cleanup and left the trade to this plan (`:1191-1194`).

## B. The rules — one pure module

New `mobile/lib/queueRules.js`: plain ESM, no React Native imports (the `doorPaths.js` pattern), so
`queueRules.test.js` runs under `node --test`. It reuses `tokenSub`; it adds no decoder.

- `isMine(item, sub, holdOn)` — `!holdOn || item.recordedBy === sub`. Items without `v: 2` are legacy
  (stamped once, below). A `v: 2` item with a null stamp never matches; it can't happen (recording needs
  a session) and §F pins that.
- `classify(err)` — `'retry'` (no status, or 5xx) · `'hold'` (401, 403 `PASSWORD_CHANGE_REQUIRED`) ·
  `'refused'` (every other 4xx).
- `shouldQueue(err)` — §E2 step 2: false for a 401 whose reason is `deleted`. That save takes the
  existing hard-fail path.
- `canRetry(refusal)` — true for `NOT_ASSIGNED`, `ORG_CONTEXT` (membership), `SUPPORT_ACCESS_REQUIRED`,
  402, campaign archived; false for do-not-contact, house, voter, template or campaign gone, template
  mismatch, id conflict, invalid input, pin role.
- `reasonText(refusal)` — §E's words, by code, falling back to the server's message.
- `pruneNotSaved(list, now)` — drops entries older than 30 days, everyone's.
- `retryOrder(entries)` — sorts by `tapAt`, so a walk-up add always goes before its survey.

## C. Phone changes (OTA)

- **Stamp at the tap** (§E2 step 1): `optimisticSubmit` takes `recordedBy = tokenSub(getCurrentToken())`,
  `tapAt` and `recorderName` (first name + last initial, from the cached user) at entry, beside
  `inFlightPaths.add` (`recordAction.js:332`), and passes them through `submitOrQueue(path, body,
  { recordedBy, tapAt, recorderName })`. `enqueue` stores them with `v: 2`, `campaignId` and the existing
  `orgId` pin, and puts `queueItemId` (the item id) in the body.
- **Never queue a deleted account's save** (`shouldQueue`).
- **The flush decides and sends with the same token.** For each item: read the token once; no token →
  stop (hold); a legacy item → stamp it with that token's `sub` under the queue lock, once (never with
  null); `!isMine` → skip, so held items never block the signed-in user's; otherwise send with
  `api(path, { token, orgId })`, so a sign-in mid-flush can't move an item to the new person.
- **On `'refused'`** the item moves to `canvass.notSaved` with `{ recordedBy, recorderName, tapAt,
  refusedAt, kind, label, status, code, message }`, plus the body only when `canRetry` (so Try again can
  resend it). A **refusal sink** registered in `app/_layout.jsx` (the `setFlushPaceSink` pattern) does
  what a live refusal does: clears the door's pending marks, rolls back, invalidates the bootstrap.
- **Not saved list** — shows only `recordedBy === me`; banner on map and Books; `NotSavedSheet` with one
  **Try again** (all of my retryable entries, merged back into the queue by `retryOrder`, bodies carrying
  `retry: true`) and **Remove** per entry. A retried item answered `200 { superseded: true }` shows *"Your
  newer result at this door stands"* and leaves the list. Pruned at 30 days. It survives sign-out (it's
  that person's, like the queue).
- **Counts** — `getPendingCount()` and `getPending()` return the signed-in user's items. Every badge and
  `confirmDoorChange` use them. A new `getWaiting()` groups everything by `recordedBy` for the sign-in
  screen, which works signed out.
- **Sign out** — one `confirmSignOut()` behind every manual Sign out (`CanvasserDrawer`, admin and
  super-admin More, `map.jsx`'s error screen, `update-required.jsx`): it first waits for in-flight saves
  (`hasInFlightActions()`, as `SessionGate.jsx:118`), then counts mine; nothing waiting → signs out.
  **Upload now** flushes; if items were turned down it says so (*"1 item wasn't saved"*, **See why** /
  **Sign out anyway**) before signing out. On the password screen (`ReauthSheet`: *Not you? Sign out* and
  signing in as a different account) there's no Upload now (the session is dead) — only the count and
  *they stay on this phone*. Automatic ends (password changed elsewhere, account deactivated, the crash
  screen's Restart) can't ask; their items wait. `DeleteAccountSheet` keeps its own check (mine only) and a
  plain sign-out.
- **A deleted account** (§E2 steps 3–5): `authState.js` gains `setDeletedAccountCleanup(fn)`;
  `_layout.jsx` sets it to remove the queue items **and** Not saved entries whose `recordedBy` is the ended
  token's `sub`, and to clear pending colors (`clearAllPending()` in `recordAction.js`); `signOutSteps`
  runs it for reason `deleted` after in-flight saves settle and writes `deletedSub` and the count into
  the notice. `login.jsx` removes any item from `notice.deletedSub` just before its `flushQueue()`.
- **Sign-in screen** — the waiting line grouped by `recordedBy` (`recorderName`, falling back to "another
  account"); the deleted-account line (§E) instead, when that's what happened. It replaces `pendingLine`'s
  *"when you sign in as yourself"*.
- **Kill switch** — `MOBILE_QUEUE_HOLD` from `/api/build-status`, on by default, persisted on the phone
  as `MOBILE_ERROR_RECOVERY` is. Off → `isMine` is always true: today's upload behavior, with refusals
  still going to Not saved.
- **Admin audit screen** (`app/(app)/admin/audit.jsx`) — a **Not saved** row with its open count, opening
  the console's list (§D). Hidden if the endpoint 404s (a staging phone before the server deploy).
- **Along for the ride:** the admin menu's live-map subtitle *"Doors & canvasser pings"*
  (`components/CampaignHome.jsx:1107`) becomes *"Doors & where results were recorded"*, the site's own
  phrase (MARKETING_SITE.md); checked against the tile's two-line limit (`NavTileGrid.jsx:30`).

## D. Server changes

- **Model `RefusedUpload`** — `organizationId` and `campaignId` (both required and declared: `strictQuery`),
  `userId`, `kind` (`result` | `survey` | `add_person` | `pin_move`), `actionType`, `householdId`,
  `voterId`, `turfId`, `surveyTemplateId`, `recordedAt` (optional: the body's `timestamp`), `status`,
  `code`, `reason`, `queueItemId` (optional string), `outcome` (null | `saved_on_retry` | `replaced`),
  `reviewedAt`, `reviewedBy`, `expiresAt` (180 days). **No survey answers, notes or coordinates.**
  Indexes: `{ organizationId, campaignId, createdAt: -1 }`, `{ userId, queueItemId }` (not unique: a
  unique index could fail `build-indexes` on rows written before it runs), `{ expiresAt: 1 }` TTL (copy
  `models/DemoRequest.js:38,44`).
- **The recorder** — one `router.use('/mobile', …)` in `routes/index.js` between `:92` and `:95`, so it
  sees `requireEntitlement`'s 402 and the org-context refusals too. It touches only POSTs to the four
  queued route shapes, wraps `res.json` to keep `{ code, error, superseded }`, and decides on
  `res.on('finish')` (the `accessLog` pattern): no added latency. **Fully async, every promise caught and
  logged**: a rejection would take the web dyno down. It records when the body has `wasOfflineSubmission:
  true`, the status is 4xx, and it isn't 401 or 403 `PASSWORD_CHANGE_REQUIRED`.
  - **Filing comes from server records only.** The household or voter in the path, else the book in
    `body.turfId`, gives the organization and the campaign; the `X-Org-Id` header and any body
    `campaignId` are never trusted for filing. Written only if the user has a `Membership` row there
    (any state) **or** has worked there (`CanvassActivity` or `SurveyResponse`), so a removed canvasser's
    refusals reach their old org and a stranger's request writes nothing. Nothing resolves → nothing is
    written (the phone still lists it).
  - **Never during a deletion.** Skipped when the org is missing, inactive or has a deletion requested
    (mirror `orgContext.js:45`), or the campaign has a deletion requested; after the insert it re-checks
    and deletes its own `_id` if a deletion began meanwhile. **It never uses `sweptAfter` or
    `LATE_WRITE_MODELS`** (their missing-campaign path sweeps across tenants).
  - **Retries** (`retry: true` with a `queueItemId`) update the row for `{ userId, queueItemId }`: a new
    refusal refreshes the reason and reopens it; a 201 (or a walk-up add's repeat 200) sets
    `saved_on_retry`; a `200 { superseded: true }` sets `replaced`. No row yet → a refusal inserts one.
- **Codes on every refusal** — the code-less ones gain `NOT_ASSIGNED`, `HOUSEHOLD_NOT_FOUND`,
  `VOTER_NOT_FOUND`, `TEMPLATE_NOT_FOUND`, `SURVEY_TEMPLATE_MISMATCH`, `WRONG_CAMPAIGN_TYPE`. Additive: the
  phone's `api.js` acts only on `ORG_CONTEXT`, `FORBIDDEN_ROLE`, `SUPPORT_ACCESS_REQUIRED` and
  `SESSION_REVOKED`.
- **Endpoints** — `GET /admin/campaigns/:campaignId/refused-uploads?status=open|reviewed|all&userId=`
  and `PATCH …/:id { reviewed }`, behind `requireOrgRole('admin', 'lead')` + `canManageCampaign` (the
  Audit rule, `routes/admin/reports.js:68,143`), **not** `requireActiveCampaign` (an archived campaign is a
  main reason to look). Queries filter on `{ organizationId, campaignId }`; every join (names, addresses,
  books, survey names) is org-scoped. The PATCH is blocked for a paused org, like flag review. The open
  count joins the Audit summary (`GET /admin/reports/flags`).
- **Deletion** — `RefusedUpload` joins `ORG_SCOPED` (after `Membership`) and `CAMPAIGN_SCOPED`. Account
  deletion adds the person's `RefusedUpload` orgs to `DeletedUserRecord.organizationIds` (as for
  `PacePause`), so `hydrateCanvassers` (`canvasserIdentity.js:87`) still shows the kept name.
- **Kill switch** — `MOBILE_QUEUE_HOLD` (default on) joins `/api/build-status` (`routes/public/buildStatus.js`,
  beside `MOBILE_ERROR_RECOVERY`).
- **Not built** (dropped in round 1): a server-side recorder check (the phone decides and sends with one
  token; a server check could hold every queue on an id-format bug), "campaign unknown" rows (nowhere
  shows them), a unique dedupe index.
- **Console** — `AuditPage.jsx` gets the **Doors not saved** section (Part 1 sketch) with tabs, its
  canvasser filter, Mark reviewed, and the *Saved on retry* / *Replaced* labels.

## E. Exact copy

| Where | Text |
|---|---|
| Sign-out prompt | **Items not uploaded yet** — `{n}` saved item(s) haven't uploaded yet. If you sign out now, they stay on this phone and upload the next time you sign in here. · Upload now · Sign out anyway · Cancel |
| After Upload now, some left | `{n}` still waiting — they couldn't be sent right now. They're safe on this phone. Sign out anyway? |
| After Upload now, some refused | `{n}` item(s) weren't saved. · See why · Sign out anyway |
| Password screen | `{n}` saved item(s) stay on this phone and upload the next time you sign in here. |
| `notYouConfirm` | Signing out removes your saved houses from this phone. `{n}` saved item(s) will upload when you sign back in on this phone. Sign out anyway? |
| Sign-in line | `{n}` saved item(s) from `{Jane D.}` are waiting on this phone. They'll upload when `{Jane}` signs in here. |
| Deleted account | `{n}` saved item(s) from this deleted account were removed from the phone. |
| Hard fail, deleted | This account was deleted. This door wasn't saved. |
| Banner | `{n}` item(s) weren't saved — tap to see why |
| Superseded retry | Your newer result at this door stands. |
| Reasons | Not assigned: *You were no longer on this campaign's team when it uploaded.* · No membership: *You were no longer in this organization when it uploaded.* · Support access: *Doorline staff need an access grant for this organization.* · Survey switched: *The walk list's survey was changed after this was recorded.* · Do-not-contact: *This voter asked not to be contacted, so the survey wasn't saved.* · House gone: *This house is no longer in the campaign.* · Campaign deleted: *This campaign was deleted.* · Campaign archived: *This campaign is archived.* · Account paused: *The account was paused, so this wasn't saved.* · Pin role: *Only team leads and admins can move a house pin.* · Id conflict: *This person couldn't be added. Add them again.* · Anything else: the server's message. |
| Console labels | Doors not saved · Saved on retry · Replaced by a newer result · Empty: *Nothing has been turned down. Items saved without signal that the server couldn't accept would show here.* |

## F. Tests

- **Server** (`refusedUploads.int.test.js`, throwaway mongod): each refusal class is recorded with its
  code and campaign; live (non-replay) refusals, 401 and the temp-password 403 are not; filing comes from
  the household / voter / book, never the header or body; a removed member with prior work is recorded in
  the old org; a stranger and a member of another org write nothing; a deleting org or campaign writes
  nothing, and an insert racing a deletion removes itself; retry outcomes (`saved_on_retry`, `replaced`,
  reopened); the recorder never rejects (a forced write error is logged, the response is unchanged, the
  process stays up); leads see their campaign only; Mark reviewed; both cascades remove the rows and
  another tenant's rows survive; the TTL index exists.
- **Phone** (`queueRules.test.js`, plus a flush test with an in-memory store, the `sessionStore.js`
  injection pattern so nothing joins `package.json`): the stamp is taken at the tap, so a sign-out and
  another sign-in during the 20-second window keep the item with its recorder; one token per item; another
  user's items are skipped and don't block; a refusal reaches Not saved and fires the sink; Try again
  preserves tap order (an add before its survey); legacy items are never stamped with null; the deleted-
  account cleanup removes only the matching `sub`; the kill switch restores today's behavior; a matching
  `recordedBy` is sent.
- **Web** — the Audit section renders rows, tabs, labels and the empty state.

## G. Docs and Help Center

**Ordering rule:** Help Center content ships with the server, the phone behavior with the phone update. So
the Audit page's copy ships with the server; phone-behavior copy is worded true for old and new phones, or
goes out in a second server deploy right after `ota:production`.

Sentences that become false and change with this plan:

- Help Center: `canvasser-offline.md:24` (the badge) and `:32`; `signed-out-sign-in-again.md:40-42`;
  `delete-an-account.md:96-97`, `:100-101`; `canvasser-deleted-their-account.md:50-52`; the Audit page
  guide gains *Doors not saved*; a new canvasser FAQ, *"My phone says something wasn't saved"*.
- Docs: `CANVASSER_APP.md:629-630`, `:636-638`, `:1592-1596` and the queue section; `USERS.md:392-394`,
  `:694-697`, `:1585-1590`; `AUDIT.md:636`, `:641-642`, `:654`; `MARKETING_SITE.md:134`, `:136` (the
  *never lose data* row's reason); `PROPOSAL_ADMIN_ACCOUNT_DELETION.md` §E2 marked as carried here.
- Public page: `client/public/app.html:133`.

## H. Privacy, phones, release

- **Privacy-affecting: yes.** A new server record of turned-down items (who, which house, when, what kind,
  why; no answers, notes or coordinates), kept 180 days, visible to Audit-page users, removed with its org
  or campaign and named like other activity after an account deletion. A phone-side Not saved list: the
  full item only while Try again can save it, otherwise just the line's fields, up to 30 days, and only
  its recorder sees it. A deleted account's unsent items are removed from the phone. No subprocessor, no
  export, no new audience.
- **Published text: `privacy.html:95` becomes false** — decision 8, live before the production update.
  Line 98 (decision 6) was already incomplete.
- **`PRIVACY_VERIFICATION.md`**: item 6 (`:1341`: refused items kept 30 days, held items have no time
  limit, the deletion flush covers only that account's items); §C9 *Store 1* (add walk-up contacts at
  `:5446`; "exactly two ways" at `:5449` is no longer true; `:5451`), a new *Store 1b* for the Not saved
  list (and that `recorderName` survives sign-out); the *Do NOT write* line (`:5453`) stands, plus
  "refused items are deleted from the phone" joins it; item 12 (`:6342`) widens; item 37 (`:3471-3473`)
  is settled by decision 7; a new item for `RefusedUpload`.
- **Phones:** `npm run audit:mobile-api` can't see the queued writes (their paths are computed); it
  flags `canvass.js` by prefix and doesn't check `middleware/` or `models/`, so read those diffs by hand.
  No client-version gate: nothing is removed or made required. JS-only; if `ota:check` refuses, that's
  the signal to stop, never to override.
- **Order:** server deploy → `migrate:build-indexes -- --apply` → `npm run ota:staging` → §J in an
  internal test org → the policy edit live → `npm run ota:production` from `main`. **Build this and the
  website half one at a time:** the owner's single `git add -A` ships whatever is in the tree.

## I. Edge cases and risks

- **A loaner phone handed back to the office** — the sign-in line names whose items are waiting.
- **Two accounts in one person's hands** (an admin who also canvasses under a second login) — kept apart.
- **A super-admin on a support grant** — stamped with their own id; a lapsed grant is retryable.
- **Token rotation** (password changed in place) keeps the same `sub`; nothing is held.
- **A refusal caused by a server bug** — it lands in Not saved; Try again is offered for the reasons that
  can change, and a fixed server takes it.
- **A wrong stamp holds a person's own items** — the stamp comes from the session that recorded them, §F
  pins it, and the kill switch undoes the hold everywhere at once.
- **Survey switched mid-canvass** — every waiting survey for the old template is refused. Now it's listed
  with that reason; accepting such replays would be a separate change.

## J. Verification (on a staging phone, in an internal test organization)

Staging phones use the production server, so all of this runs in an internal org, and A is a plain
canvasser (admins skip the campaign-assignment check), each account with a book. Record outdoors or near a
window: airplane mode indoors can trip the GPS gate.

1. As A, record three doors in airplane mode. Sign out: the prompt shows 3. **Sign out anyway.**
2. Sign in as B (same org) with signal: the sign-in line names A; nothing uploads; B's badge counts only
   B's work; Door Outcomes shows none of the three under B.
3. Sign out, sign in as A: all three upload under A.
4. As A, record a door offline; in the console take A off the campaign; reconnect (don't pull to refresh:
   that swaps the map for *Not assigned to this campaign*): *1 item wasn't saved*, the team reason, and
   **Try again**; the console's Audit page lists it. Add A back, tap Try again: it saves, and the console
   row reads *Saved on retry*.
5. Survey a voter offline, flag them do-not-contact in the console, reconnect: Not saved, the
   do-not-contact reason, no Try again.
6. **Upload now:** record offline, turn signal back on, Sign out → Upload now: it uploads and signs out.
7. **Not you?** On the password screen, *Not you? Sign out*: the count and *they stay on this phone*.
8. **Saved before the update:** on the old app record offline, apply the update, reopen signed in as the
   same person: the items upload under them.
9. **Deleted account:** record offline as A; delete A in the console; reconnect: the save isn't queued
   again, the sign-in screen says A's items were removed, and nothing goes up under the next person.
10. **Kill switch:** set `MOBILE_QUEUE_HOLD=off`, reopen the app: B's sign-in uploads A's items (today's
    behavior). Set it back.
11. On a production-lane phone still on the old app, repeat step 4's refusal: the console lists it, which
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

## M. Four decisions that make it smaller (round 2)

Round 2's deepest bugs were in two extras the brief never asked for. Removing them keeps all three of
the brief's promises (never silently; admins see it with the reason; never under another person) and E2.

| # | Question | Recommended |
|---|---|---|
| 9 | **Drop Try again.** A turned-down item is shown, with its reason, and Removed — never resent from the phone. The canvasser re-knocks, or you re-enter it. The phone then keeps no survey answers at all for a refused item, only the line. | **Drop it** |
| 10 | **Drop Upload now** from the sign-out question. It becomes *"3 saved items haven't uploaded yet. They'll stay on this phone and upload the next time you sign in here."* **Sign out** · **Cancel**. Saves already upload by themselves the moment there's signal. | **Drop it** |
| 11 | **Items waiting for someone else** (the right person never signed back in, or their account was deleted while signed out) are removed after 30 days, with a line on the sign-in screen. Bounds what a shared phone holds; those doors are lost after a month. | **30 days** |
| 12 | **Drop the phone's admin Audit row** — the list lives on the console's Audit page only. | **Drop it** |

No review round has seen v3, because it doesn't exist yet; the build gets a code review before the phone
update ships.
