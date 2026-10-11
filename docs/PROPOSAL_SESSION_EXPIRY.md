# Proposal: Stay signed in, and ask for the password in place when a sign-in runs out

> **Status: BUILT 2026-10-10 (uncommitted at time of writing), to this plan, with every recommended
> default in §B (the owner said "go ahead and build").** Where the build differs from the plan is listed
> in [§M, "As built"](#m-as-built-2026-10-10) at the end, along with what was verified. Everything above
> §M is the plan as approved. The documentation of record is [USERS.md](USERS.md) → *Sessions* and
> *Staying signed in*, and [CANVASSER_APP.md](CANVASSER_APP.md).
>
> **Plan status before the build: PLAN v4, 2026-10-09.** Three review rounds with three reviewers each. Every
> finding was checked against the code before it was accepted ([§K](#k-review-log)).
>
> Round 3 still found blockers, all in what the v3 rewrite had introduced, and v4 fixes them. v4's
> own changes are listed at the top of §K. They have not been reviewed, so a fourth round would
> target them.
>
> Line references are to HEAD `cd1829c`. Server, web and phone. No migration, no index build, no new
> config var, no client-version bump. One optional array is added to `User` (§C7).

Related: [USERS.md](USERS.md) (*Passwords & lockouts*, *Auth & the forced-password-change flow*),
[CANVASSER_APP.md](CANVASSER_APP.md) (*Session & role recovery*),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the `requireAuth` revocation passages),
[PROPOSAL_LEAD_CAMPAIGN_LANDING.md](PROPOSAL_LEAD_CAMPAIGN_LANDING.md) (touches the same web
sign-in files, see §J2).

# Part 1 — For everyone

## The problem

A sign-in lasts exactly **30 days from the moment someone types their password**, whether they use
Doorline every day or never. When it runs out:

- **On the phone,** screens show **"Invalid token"** with a **Retry** button that can never work.
  The only way out is to find **Sign out** in the menu and sign in again.
- **On the web,** a console tab left open shows the same error on every panel until the page is
  reloaded.

This hits everyone once a month, including canvassers who work every day. People read it as
"Doorline is down."

## What changes

**1. When a sign-in runs out, Doorline asks for the password right where you are.**

A screen covers the app: **"Enter your password to keep going."** It explains: *"For security,
Doorline asks for your password again from time to time. Nothing is wrong, and what you were doing
is still here."* Your email is already filled in. Type the password and you're back where you were:
the same map, the same unsaved edits on the web.

On the phone, this screen never interrupts a door or a survey:

- **Mid-door,** anything you save is kept on the phone, and the screen waits until you're back on
  the map or list.
- **If your signal is too weak to sign in,** a **Later** button appears. The map then shows a short
  notice: *"Password needed. 3 items are waiting to send, and your team sees them once you enter
  your password."*

**2. Using Doorline keeps you signed in, once your app is up to date.**

- About once a day, opening the app or using the console quietly extends your sign-in.
- It runs out after **30 days without using Doorline**, or **90 days after you last typed your
  password**, whichever comes first.
- Doorline staff accounts keep today's 30 days.

These rules are about the app. A browser can forget a web sign-in sooner: Safari may clear it after
about a week without a visit.

**3. Some sign-outs are deliberate, and those really sign you out.**

- **A password change on another device, or a deleted account:** you land on the sign-in screen
  with a note saying why. On the phone this waits until you're off a door.
- **Signing out in one browser tab** signs out the other tabs too.

**4. Signing out ends the sign-in on Doorline's servers too, when you have signal.** Today it only
forgets it on your device.

**5. Apps that haven't updated yet are better too, from the day of the change.**

- They stop showing "Invalid token" and go to the sign-in screen instead.
- They still clear their saved houses when that happens, as signing out always does, and download
  them again after sign-in.
- The password-in-place screen and the daily extension need the update.

## What stays the same

- **Changing your own password signs you out everywhere else,** on each device's next request. A
  phone waits until you're off a door.
  - That is what to do if you lose a signed-in phone or leave a shared computer signed in: change
    the password **yourself**.
  - A temporary password from an admin or lead does not sign other devices out.
- **Deleting your account ends its sign-ins on their next request.**
- **Removing someone from an organization ends their access to it on their next request,** as
  today. It never ended the sign-in itself. Someone left with no organizations stops being
  extended, so their sign-in runs out within 30 days.
- **Recorded work stays on the phone until it is sent.** Always sign back in as yourself: saved work
  goes up under whoever signs in next. Doorline can still turn an item down, for example if you
  were taken off the campaign meanwhile, and those items aren't kept.

## What people see

| What happened | What the app shows |
|---|---|
| The sign-in ran out while you were using the app, or when you opened it | The password screen in place (on the phone, after you leave a door) |
| You pick **Later** on the phone because the signal is too weak | The map's notice: *"Password needed. 3 items are waiting to send, and your team sees them once you enter your password."* Tapping it, or **Refresh**, brings the password screen back. |
| Your password was changed somewhere else while the password screen was already up | The same screen: *"Your password was changed. Enter your new password to keep going."* |
| Your password was changed somewhere else otherwise | The sign-in screen: *"Your password was changed, so you were signed out here. Sign in with your new password."* |
| You signed out in another browser tab | The sign-in page: *"You've been signed out. Sign in again to keep going."* |
| Your account was deleted | The sign-in screen: *"This account has been deleted, so it can't be used to sign in."* |
| A very old account that was switched off long ago | The sign-in screen: *"This account can't be used to sign in. Ask your organization's admin if that's a mistake."* |

**The saved-items line.** When work is waiting on the phone, the phone's sign-in note for a changed
password adds: *"3 recorded items are saved on this phone. They'll be sent when you sign in as
yourself."* With one item it reads *"1 recorded item is saved … It'll be sent…"*. An item is one
queued save, such as a door result, one voter's survey, a walk-up voter or a pin fix. That matches
the map's pending badge.

# Part 2 — Technical reference

## A. What the design rests on (checked at `cd1829c`)

**Tokens and the server check**

- **Token life.**
  - [tokens.js:3-12](../server/src/services/auth/tokens.js) signs `{ sub, email, isSuperAdmin }`
    with `expiresIn: process.env.JWT_EXPIRES_IN || '30d'`.
  - Only login ([auth.js:116](../server/src/routes/auth.js)) and change-password (:246) mint
    session tokens.
  - `signUserToken(` has about 220 call sites in about 100 server test files.
  - `verifyToken` (tokens.js:14-18) is also used by the share-unlock route (share.js:62), whose
    24-hour expiry PRIVACY_VERIFICATION.md:3194 relies on.
- **`requireAuth`'s 401s.** [middleware/auth.js:6-56](../server/src/middleware/auth.js) answers four
  different ones, and only one carries a code:

  | Line | Case | Body |
  |---|---|---|
  | 10-11 | no `Bearer` header | `Missing bearer token` |
  | 19-21 | user missing, `!isActive`, or `deletedAt` | `Invalid or inactive user` |
  | 28-36 | `iat` before `passwordChangedAt`, in whole seconds | `SESSION_REVOKED` |
  | 53-55 | anything thrown (see below) | `Invalid token` |

  The last row catches every thrown error:
  - an expired or malformed token, or a bad signature;
  - a payload that isn't JSON (`SyntaxError`), or a `sub` that `findById` can't cast;
  - a database error, or a missing `JWT_SECRET`.

  It runs once on `/auth/*`, two to three times on `/admin`, and five times on `/mobile/me/*`.
- **Deactivation is per organization.**
  - At HEAD only deletion sets `User.isActive = false`
    ([deleteAccount.js:246](../server/src/services/users/deleteAccount.js)).
  - Deactivate and Remove change the `Membership` ([memberships.js:770](../server/src/routes/admin/memberships.js),
    :568, [leadCrew.js:503](../server/src/routes/admin/leadCrew.js)). Remove also releases work
    (:581).
  - The sign-in stays valid. `/auth/me` returns 200 with `memberships: []`, and org routes answer
    403 `ORG_CONTEXT`.
  - Pre-multitenancy code (253c813, f74f678) set `isActive = false` too, and nothing reset it, so
    legacy rows may exist. Login refuses them (auth.js:98).
  - Stale comments call deactivate a reversible account toggle: User.js:35-37, USERS.md:953,
    canvasser-left-the-team.md:31 and page-team.md:26.
- **Temporary passwords don't revoke.** An admin or lead's temp reset writes
  `{ passwordHash, mustChangePassword: true, tempPasswordSetAt }` and no `passwordChangedAt`
  (memberships.js:696). It suspends sessions with 403
  `PASSWORD_CHANGE_REQUIRED` instead.
- **Sign-out never reaches the server.** `POST /auth/logout` returns `{ ok: true }` (auth.js:292-294),
  and neither client calls it.
- **Other tokens share `JWT_SECRET`.**
  - **The bull board ticket** ([bullBoard.js:15-23](../server/src/queues/bullBoard.js)) is
    `{ sub, isSuperAdmin, purpose: 'bullboard' }`, valid for 10 minutes.
    - It passes `requireAuth` as an API session today.
    - Bull board's guard (bullBoard.js:36-49) takes any token from the cookie, `Bearer` or `?t=`,
      and checks only `isSuperAdmin`. So a revoked super-admin token opens it, and `?t=` is logged
      in full.
    - The console uses only the `httpOnly` cookie scoped to `/admin/queues`
      (routes/admin/queues.js:13-22).
  - **Share tokens** carry `kind: 'share'` and no `sub`, so they fail `requireAuth` today.
- **401s that must never end a session.**
  - Wrong typed passwords (auth.js:99, 102, 107, 221, 341).
  - The share-password routes.
  - FbTime's `KEY_REVOKED`, `KEY_INVALID` and `KEY_EXPIRED` passthroughs (integrations.js:72-80).
- **`err.message` reaches clients in production** ([error.js:5-12](../server/src/middleware/error.js)).
- **`lastLoginAt` is written only by `POST /auth/login`,** and org admins see it as "Last login."
  - Where it shows:
    - UserProfileModal.jsx:345, CampaignTeamPage.jsx:97/135/599-600;
    - mobile admin/users/[id].jsx:443 and admin/canvasser/[id]/index.jsx:363;
    - the "Recently signed in" sort (UsersPage.jsx:42, mobile admin/users.jsx:41).
  - [PRIVACY_VERIFICATION.md:306-311](PRIVACY_VERIFICATION.md) records that showing admins when
    someone last *opened the app* would need new policy text.
- **jsonwebtoken 9.0.3 behaviour.**
  - It reads a unitless `JWT_EXPIRES_IN` as milliseconds: `"2592000"` gives 2,592 s, and `"60"`
    gives 0 s.
  - Its expiry rule is `floor(now/1000) >= exp`.
  - `ignoreExpiration` turns off only the `exp` block, including its type check.
  - Without `ignoreExpiration`, a forged expired token reads "invalid signature."

**The phone today**

- **How a session ends now.** [api.js:106-109](../mobile/lib/api.js) tags `SESSION_REVOKED`, and
  [_layout.jsx:107](../mobile/app/_layout.jsx) signs out, but only from react-query's `onError`.
- **Paths that swallow the 401:**
  - `bootstrapQueryFn` falls back to disk at cold start (bootstrapQuery.js:26-53);
  - `refreshSession` runs at cold start, on every foreground, from select-org and from recoverRole;
  - the offline queue's flush;
  - select-org's super-admin branch;
  - AddedToOrgBanner.
- **Paths that never go through `api()`:** [csv.js](../mobile/lib/csv.js),
  [artifactDownload.js](../mobile/lib/artifactDownload.js) and
  [admin/books.jsx:218-236](../mobile/app/(app)/admin/books.jsx).
- **Token reads.** `api()` reads the token from SecureStore on every call (api.js:30) and omits
  `Authorization` when there is none.
- **Sign-out order.** `signOut` writes SecureStore first and sets `_token = null` last. Before that,
  it awaits cache clears that queue behind a multi-MB roster save
  ([authState.js:41-51](../mobile/lib/authState.js)). Three of those clears are bare `removeItem`
  calls that can reject (cache.js:200, 222, 309).
- **Roster writes.**
  - `saveBootstrap` coalesces into one queued writer (cache.js:124-144).
  - `writeBootstrap` (recordAction.js:14-21) and bootstrapQuery.js:24 save whenever there is data.
  - `bootstrapQueryFn` ignores react-query's abort signal, although `QueryCache.clear()` cancels
    in-flight queries (query-core `query.js:86-88`).
  - privacy.html promises the walk-list copy "is deleted when you sign out."
- **The door flow.** OtaUpdatePrompt.jsx:34's `CANVASS_FLOW = /^\/(household|voter)\//` and
  `hasInFlightActions()` (recordAction.js:204) guard reloads, re-checked after a settle loop
  (:95-105).
  - Survey and practice answers live in component state.
  - Android Back pops a door screen. SurveyForm only intercepts it in one-block-per-screen mode
    (SurveyForm.jsx:316-335).
  - Quick results are recorded on the map and building screens, and household/[id].jsx:255
    navigates back before its save settles.
  - AddPersonModal and FixPinModal are RN `<Modal>`s inside the door flow, and 15 more sheets
    elsewhere are too. They draw above any root View.
  - Root overlays use zIndex and elevation 1000 (OtaUpdatePrompt.jsx:146-154, UpdateGate.jsx).
- **The map's error states.**
  - The `if (error)` branch (map.jsx:793-813) replaces the whole map, even when data is loaded.
  - DataHealthBanner says *"Offline — showing houses as of … syncs when you reconnect"* for any
    disk fallback (DataHealthBanner.jsx:39).
  - Refresh, which carries the pending badge, refetches.
- **The offline queue.**
  - It holds on any 401 (offlineQueue.js:79-85) and survives sign-out, and login.jsx:70 flushes it.
  - Items carry their org, not their user. The server stamps `req.user._id` at upload
    (canvass.js:338).
  - The flush drops every other 4xx (offlineQueue.js:120-125).
- **Old bundles.** Dormant users run the old bundle on the launch where expiry bites
  ([app.json:77-79](../mobile/app.json) defaults). Bundles since 6818a2b (2026-07-18), including
  every frozen ref, sign out on `SESSION_REVOKED`.
  - On those bundles, the landings that sign out by themselves are the map, campaigns, admin and
    lead, and super admin. select-org signs out only after a tap; the forced change-password screen
    only on submit.
  - Their sign-out deletes the roster, but their central path doesn't clear the query cache, so a
    late door save can write it back.
  - The legacy `com.canvassapp.mobile` app and older fingerprints get no new bundles.
- **Help is behind sign-in** ([help.js:12](../server/src/routes/help.js)).

**The web today**

- **How a session ends now.**
  - [client.js:115-129](../client/src/api/client.js) clears the token and redirects to `/login` on
    `SESSION_REVOKED`, except on public pages.
  - [AuthContext.jsx:20-37](../client/src/auth/AuthContext.jsx) checks `/auth/me` on every page
    load, public pages included, with no cleanup. It clears the token and the active org on any
    failure.
  - Both live in shared localStorage.
  - `login()` resets the active org per roles.js:55-58.
- **Unsaved work.** The survey builder holds its edits in component state (SurveyBuilder.jsx:925-935).
  Nothing blocks navigation.
- **Overlays.** Drawers and modals portal to `document.body` as `fixed inset-0 z-50` and close on a
  document-level Escape ([ui/Overlay.jsx:39-69](../client/src/components/ui/Overlay.jsx)).
  SupportAccessGate is `fixed inset-0 z-50` (:72).
- **Other details.**
  - downloadFile.js fetches by itself.
  - React Query retries once (main.jsx:21-28).
  - There is no `storage` listener.
  - select-org and change-password render outside `Layout`.

**Published claims**

- [privacy.html](../client/public/privacy.html):
  - *"We use local storage on your device to keep you signed in."*
  - The phone's walk-list copy *"is deleted when you sign out."*
  - Offline results are saved on the device *"until a connection is available."*
  - Administrators have *"the ability … to disable access promptly."* This stays true, because
    membership is checked on every request (PRIVACY_VERIFICATION.md:3677).
  - The technical-information paragraph is at :97.
- No published text states a session length.
- [DPA.md:41](DPA.md) (§4) says Doorline *"shall not materially decrease the overall protection of
  Personal Information."*

## B. Decisions for the owner

| # | Decision | Recommended | What users notice | Security effect |
|---|---|---|---|---|
| B1a | Extend sign-ins that are used | **Yes** | Daily users type their password about 4 times a year instead of 12 | A used sign-in can last longer (see B1b) |
| B1b | Hard limit on an extended sign-in | **90 days from the typed password** | One in-place password prompt every 90 days | Bounds how long a copied token stays alive |
| B1c | Extend staff (super-admin) sign-ins | **No** | Staff keep 30 days | Staff tokens reach every customer's data |
| B1d | Make Sign out end the session on the server | **Yes** | Nothing | A copied token dies when its owner signs out with signal |
| B2 | Password changed while the password screen is already up | **Ask for the new password in place** (no **Later** in that state) | "Forgot password?" from the screen doesn't wipe the phone's houses | Without the screen up, a password change still signs out and wipes, as planned |
| B3 | Rename "Last login" to **"Last password login"** on every screen listed in §A | **Yes** | The column stops looking wrong for daily users | None |
| B4 | Recorded work picked up by whoever signs in next (§J1) | **A separate plan right after this one** | Nothing now | None now |
| B5 | Send crews a one-message notice before the server deploys | **Yes** (draft below) | Fewer "is it down?" messages from old-app users | None |
| B6 | Put the sign-in FAQ's short version on the public doorline.app/app page | **Yes** | People who are signed out can read it | None |

**The DPA §4 judgment** (B1a-d together). Measured against today:

| | Change |
|---|---|
| **Less protection** | A used sign-in can last up to 90 days, not 30. |
| **More protection** | Sign out ends that session and every copy of it, when there is signal. |
| **More protection** | Bull board accepts only its own ticket, so a revoked super-admin token no longer opens it, and `?t=` no longer logs a credential. |
| **More protection** | A bull board ticket no longer works as a 10-minute API session. |
| **Neutral** | Millisecond revocation closes a gap that extension would otherwise open. |

Whether the net is "not a material decrease" is the owner's call. What each "no" removes from the
build is in §L.

**Check before building: the idle window.** In the Heroku dashboard, open **Settings → Config
Vars** and look for `JWT_EXPIRES_IN`:

| What it shows | What it means |
|---|---|
| Unset, or set with a unit under 90 days (`30d`) | That is the idle window. Copy that says "30 days" changes to match. |
| 90 days or more | Extension adds nothing. Tell me the intended value first. |
| No unit | jsonwebtoken reads it as milliseconds. Fix it first. |

**B5 crew notice, draft.**

> Doorline update: if the app ever asks for your password again, nothing is wrong. Type your
> password and keep going. If it sends you to the sign-in screen, sign in **as yourself**: anything
> saved on your phone goes up under whoever signs in next. Don't delete the app. Forgot your
> password? Tap **Forgot password?** on that screen.

## C. Server

### C1. One answer for every ended session

Every `requireAuth` 401 becomes:

```
401 { error, code: 'SESSION_REVOKED', reason }
```

| `reason` | When | `error` (what old apps show where they catch it) |
|---|---|---|
| `missing` | no `Bearer` header | Sign in to continue. |
| `expired` | past `exp`, or past the cap | Your sign-in has ended. Sign in again to keep going. |
| `invalid` | any throw from verification, a failed shape check, no such user, or a session ended by sign-out | Your sign-in has ended. Sign in again to keep going. |
| `deleted` | `deletedAt` set | This account has been deleted. |
| `inactive` | `isActive: false` without `deletedAt` (legacy rows only) | This account can't be used to sign in. |
| `password_changed` | sign-in time before `passwordChangedAt` | Your password was changed — sign in again. |

**Why reuse `SESSION_REVOKED`:** every bundle since 2026-07-18, and the web, already turn it into
"go to sign-in." `reason` is additive. Old apps show the `error` text only where they catch a 401
without signing out, so the text never claims a sign-out happened.

### C2. Verification and the order of checks

`verifySessionToken(token)` is new, and **only `requireAuth` uses it.** `verifyToken` stays as it
is for share.js, so share unlocks still expire at 24 hours.

1. **No `Bearer` header** → `missing`.
2. **No `JWT_SECRET`** → 503, below. Then `jwt.verify(token, secret, { ignoreExpiration: true })`.
   **Any throw from that call** is `invalid`, whatever the error class: a bad signature, a
   malformed token, a non-JSON payload, or an `nbf` in the future.
3. **Shape check, before any database read.** The payload must:
   - be an object, with no `purpose` and no `kind`;
   - have `typeof sub === 'string'` and `mongoose.isObjectIdOrHexString(sub)`;
   - have integer `iat` and `exp`;
   - have `auth_ms` absent or finite, and `sid` absent or a string.

   Anything else is `invalid`. `ignoreExpiration` skips jsonwebtoken's own `exp` type check, so
   this one carries the weight.
4. **Derive two values.**
   - `authMs = auth_ms ?? iat * 1000 + 999` (§C4).
   - `sid = payload.sid ?? 'legacy:' + sha256(signatureSegment)` (§C7).
5. **`User.findById(sub)`.** A throw → 503. No user → `invalid`.
6. `deletedAt` → `deleted`.
7. `!isActive` → `inactive`.
8. `authMs < passwordChangedAt.getTime()` → `password_changed`.
9. `sid` listed in `endedSessionIds` → `invalid`.
10. `floor(now/1000) >= exp` → `expired`. This is jsonwebtoken's own rule.
11. The cap (§C6) → `expired`.
12. **Today's tail:** the `lastSeenAt` stamp and `req.user`, plus
    `req.auth = { iat, exp, authMs, sid, hasAuthMs }`.

**A 503 is a server fault.** For a missing secret or a database throw, requireAuth logs the original
and calls `next(Object.assign(new Error('Sign-in check unavailable. Try again.'), { status: 503 }))`.
Today a database blip answers 401, which would now end every session at once.

This is the one response change that isn't additive. Every shipped app already treats a 5xx as
"try again later," checked on HEAD and both frozen refs.

### C3. One token, one job

- **requireAuth** refuses `purpose` and `kind` (step 3).
- **`requireBullBoardAuth`** reads **only the `bb_token` cookie** and requires
  `purpose === 'bullboard'`. A session token, revoked or not, no longer opens the job console, and
  nothing is logged through `?t=`.
  - A **still-valid** super-admin token can still mint a ticket through the Jobs page, by design.
- **Ship this in its own commit,** since it is unrelated to the complaint. DEPLOY_RUNBOOK.md:121
  changes with it (§G).

### C4. Sign-in time in milliseconds

- **New claim `auth_ms`.** Login captures `Date.now()` **before** `User.findOne` (auth.js:93).
- **change-password** computes one `changedAt`, writes it as `passwordChangedAt` (:239), and mints
  with `authMs: changedAt.getTime()`.
- **`signUserToken(user, { authMs, sid } = {})`** defaults `authMs` to now and `sid` to a random UUID.
- **`renewUserToken(user, { authMs, sid })`** throws unless both are set.
- **Revocation** is `authMs < passwordChangedAt.getTime()`. For an old token that is identical to
  today's whole-second rule, and a sweep of 15,000 cases found no mismatch.
- **Residual:** one database write round trip plus dyno clock skew, both in milliseconds.
  change-password takes its `Date` before the write commits, and reset-password stamps inside its
  `findOneAndUpdate` (auth.js:172-193). A login that started in that window, while reading the old
  hash, survives.

### C5. Extension on `GET /auth/me`

**`renewalDue(payload, nowSec)`** is true when `nowSec - iat >= min(86400, (exp - iat) / 2)`.

`/auth/me` ([auth.js:204-211](../server/src/routes/auth.js)) adds `token` when **all** of these
hold:

- `renewalDue`;
- `!mustChangePassword`;
- `memberships.length > 0`;
- `!isSuperAdmin` (B1c);
- `Date.now() < authMs + cap`, using the derived `authMs`, so it never mints a token that is
  already expired.

The new token:

- is `renewUserToken(req.user, req.auth)` from the fresh user, carrying the same `auth_ms` and the
  same `sid`;
- for an old token, carries the derived legacy `sid`. **Every copy of one old token therefore
  shares one session id.**

A throw while extending is caught and logged, and the response simply has no `token`.

Every `/auth/me` response sends **`Cache-Control: no-store`**. Extension **writes nothing,** and
never touches `lastLoginAt`.

### C6. The cap

`SESSION_MAX_DAYS = 90` (B1b). requireAuth answers `expired` when the token **carries** `auth_ms`
and `now - authMs` exceeds the cap. Tokens minted before the deploy expire on their own `exp`, so a
long idle window can't become a mass sign-out.

### C7. Sign out ends the session (B1d)

- **Every session has a `sid`.** Login and change-password mint one. Extension carries it. Old
  tokens use the derived `'legacy:' + sha256(signature)`.
- **`User.endedSessionIds`** is `{ type: [String], default: undefined }`. That way it isn't written
  as `[]` on every create and `.save()`.
- **`POST /auth/logout`** runs
  `User.updateOne({ _id }, { $push: { endedSessionIds: { $each: [sid], $slice: -200 } } }, { timestamps: false })`.
- **requireAuth** refuses a listed `sid` (step 9) at no extra read.
- **The limit:** an ended session could only come back after 200 later sign-outs **by the same
  account** within its 90-day cap.
- **Account deletion's tombstone `$set`** clears the list.
- **Clients** call it fire-and-forget on a manual Sign out, before forgetting the token (§D2, §E9),
  and on a token they discard. With no signal the call never arrives, and the session runs out on
  its own.

### C8. Server tests

**Unit** (`server/test/sessionLifetime.test.js`):

- `renewalDue`;
- the legacy-sid derivation;
- `signUserToken` and `renewUserToken`;
- the `authMs` equivalence sweep.

**Integration** (`server/test/sessionLifetime.int.test.js`): one `before()`, no `await import`
between tests, `User.findById` stubbed with `t.mock.method`, tokens hand-minted with a backdated
`iat`.

- **Reasons.**
  - Every reason in §C1, with its text.
  - `invalid` for:
    - a string payload, a non-JSON payload, a numeric `sub`, a non-integer or string `exp`;
    - a share token, a bull board ticket;
    - a forged expired token, a future `nbf`.
  - None of the `invalid` cases above may reach the database.
  - An expired token of a deleted account reads `deleted`.
  - A legacy inactive row reads `inactive`.
- **503:**
  - a missing secret, and a stubbed database throw, never leaking the internal text;
  - **an expired share token still answers `password-required`.**
- **Extension, new tokens:**
  - It is returned and carries the original `auth_ms` and `sid`.
  - It is withheld for a token under a day old, `mustChangePassword`, no memberships, a super
    admin, and a token near its cap.
  - `lastLoginAt` is unchanged.
  - A thrown `renewUserToken` still answers 200.
- **Extension, old tokens:**
  - Extended with `auth_ms === iat*1000+999` and the legacy `sid`.
  - Refused after a stamp placed **between** the old `iat` and the extension's `iat`.
  - **Two copies of one old token are both extended. Signing one out refuses both.**
- **Revocation and the cap:**
  - The same-second race is refused.
  - A 91-day `auth_ms` reads `expired`, and an old long-`exp` token is not capped.
- **Sign out:**
  - It refuses that session and its copies, and leaves the user's other sessions working.
  - The 201st entry drops the oldest.
  - `updatedAt` is unchanged.
  - Deletion clears the list.
- **Headers:** `/auth/me` sends `Cache-Control: no-store`.
- **Bull board:** a session token via cookie, `Bearer` or `?t=` gets 403. A ticket via cookie gets
  200.
- **Untouched:** FbTime's `KEY_*` 401s and the wrong-password 401s.

The existing sessionInvalidation.int.test.js must pass unchanged.

## D. Phone

### D1. `mobile/lib/sessionEnd.js` (plain, no imports, tested)

- **`sessionEndReason(status, data)`** returns null for anything but a 401 with `SESSION_REVOKED`.
  A missing reason maps to `password_changed`, and an unknown one to `invalid`.
- **`phoneAction(reason, { reauthUp })`:**
  - `'reauth'` for `expired`, `invalid` and `missing` (on the phone, a lost SecureStore token);
  - `'reauth'` for `password_changed` when the password screen is already up for that token (B2);
  - `'signout'` otherwise.
- **`tokenToEnd({ sentToken, heldAtSend, current })`** returns the sent token when `current` is
  undefined or equal to it. With no token sent, it returns `heldAtSend` only while it was a string
  and `current` still equals it. A bare request from a previous session can never end the next one.
- **`shouldDefer(path, inFlight)`** uses `CANVASS_FLOW = /^\/(household|voter|survey-practice)\//`,
  moved here and imported by OtaUpdatePrompt.
- **The retry predicate:** `(count, err) => err?.status !== 401 && count < 1`. react-query starts
  counting at 0, so this is two calls for anything else and one for a 401. That was checked by
  running it.
- **All copy:**
  - the screen title and body, and the password-changed variant;
  - the map notice, with its n = 0, 1 and N forms;
  - the sign-in notes per reason, and unknown;
  - the pending line and the "Not you?" confirm.
- **The roster-guard decision** `mayWriteRoster({ signedIn, ending })`, for §D6.

### D2. `mobile/lib/sessionStore.js`: one lock for every token change (plain, injected, tested)

```
createSessionStore({ readToken, persistToken, clearCaches, loadEmail, notifyServerSignOut, clearSupportPrompt })
```

`loadEmail` is async: `(await loadCurrentUser())?.email ?? null`. The store holds `_token`,
`_notice`, `_reauth` and `_ending` under one promise-chain lock. Nothing awaits the lock from
inside it, and no `requestFn` touches the store.

| Operation | Inside the lock |
|---|---|
| `hydrate()` | Sets `_token` from storage only while it is `undefined`. |
| `signIn(t)` | Persist; set `_token`; clear `_notice` and `_reauth`; emit. |
| `signOut()` *(manual)* | No-op when `_token` is null. Otherwise: `notifyServerSignOut(_token)`; set `_ending`; persist null; run each clear under its own catch; `clearSupportPrompt()`; set `_token = null` last; in a `finally`, clear `_reauth` and `_ending`; emit. |
| `endSessionIfCurrent({ reason, token })` | When `_token === token`, the same steps without the server call. It also sets `_notice = { reason, email }`, leaving the email out for `deleted` and `inactive`. |
| `requireReauthIfCurrent({ reason, token })` | When `_token === token`, set or update `_reauth = { reason, collapsed: false, laterAllowed: false }`. A `password_changed` arriving while it is already up updates the reason (B2). |
| `completeReauth(sent, next)` | When `_token === sent`: persist `next`, set it, clear `_reauth`, emit, and return true. Otherwise return false. |
| `adoptRenewedToken(sent, next)` | Only for a string `sent` equal to `_token`. Persist and set. Never touches `_notice` or `_reauth`. |
| `rotateToken(requestFn)` | `requestFn` is the bare `api()` call. Adopt `res.token` if `_token` is unchanged. change-password.jsx:58 and profile.jsx:118 lose their own `signIn` calls. |
| `collapseReauth()`, `expandReauth()`, `allowLater()` | Presentation flags only. |

**Wiring.** authState.js wires SecureStore, the four cache clears, `loadEmail`,
`notifyServerSignOut` and `clearSupportAccessPrompt`. `notifyServerSignOut` is
`api('/auth/logout', { method: 'POST', token, quiet: true })`. authState keeps its current exports
and adds hooks for `_notice`, `_reauth` and `_ending`. All of it lives in memory.

**Tests:**

- sign out during an extension (memory and storage both end empty);
- two extensions in flight;
- an old-token 401 during a rotation;
- an end during a slow clear;
- a bare stale request after a new sign-in;
- re-auth, then a stale extension;
- a sign-out during re-auth;
- a `completeReauth` that returns false;
- hydration racing an early end;
- a rejecting clear (`_ending` still clears).

### D3. `api.js`

- **New options** `token` (override) and `quiet` (don't report a session end).
- **It captures `heldAtSend = getCurrentToken()`** before reading SecureStore.
- **On a 401** it keeps the existing tag rule, sets `err.reason`, and when `tokenToEnd` returns a
  token, calls the registered handler with `{ reason, token }`, fire-and-forget.

### D4. `SessionGate`: one root component, one path mirror, one deferral rule

The handler is registered at module scope in [_layout.jsx](../mobile/app/_layout.jsx) and routes by
`phoneAction`:

- **`'reauth'`** → `requireReauthIfCurrent`.
- **`'signout'`** → a pending end, replacing any earlier one.
- The temp-password redirect (`routeToForcedChange`, _layout.jsx:87-97) also becomes a pending
  action, so it no longer unmounts a door screen.

`SessionGate` is mounted in the root layout next to OtaUpdatePrompt. It mirrors `usePathname()`
into the module ref the handler reads, and clears pending actions when the token changes.

**When deferral applies,** that is while `shouldDefer(path, hasInFlightActions())`, it shows
nothing. Saves made meanwhile get the 401 and are queued.

**Otherwise:**

1. A pending end or forced-change route runs. First the settle loop runs (20 × 250 ms). Then the
   gate re-checks the path and keeps the action pending if the person is back in the door flow. It
   checks on every path change, and on a 1-second timer while something is pending; cleanup clears
   the timer.
2. While `_ending` is set, it shows a **"Signing out…"** cover.
3. While `_reauth` is set and not collapsed, it shows the **password screen** (§D5). It isn't shown
   while `_ending` is set.
4. While `_reauth` is collapsed, the map, books and building screens show the **notice** in their
   top chrome, next to DataHealthBanner, pushing controls down rather than covering them. Every
   other screen shows the full password screen.

**Layering.** The hard update wall stays above everything. Then "Signing out…", then the password
screen (zIndex/elevation 1001), then banners. The OTA banner is hidden while re-auth is pending. RN
`<Modal>` sheets outside the door flow still draw above the password screen while open. Their save
gets the server's "sign-in has ended" text, and closing them reveals the screen. That is a known,
rare limit.

**While `_reauth` is set,** `focusManager.setFocused(false)` pauses polls. `onAppStateChange` sets
focus to `active && !_reauth`.

**Removed:** the `SESSION_REVOKED` branch in `onGlobalError`, and change-password.jsx's own
sign-out (:69-71). `(app)/_layout.jsx` already redirects to `/login` when the token is null.

### D5. The password screen (`ReauthSheet`)

**Shell:**

- An opaque root View on `colors.bg`, with `accessibilityViewIsModal`. The rest of the tree gets
  `importantForAccessibility="no-hide-descendants"`. Focus goes to the title.
- A `BackHandler` listener while it is up, removed in cleanup. Back collapses the screen if
  **Later** is allowed, and does nothing otherwise. The newest listener wins, so it beats
  SurveyForm's.

**Content:**

- The title and body, or the password-changed variant (B2).
- The email, prefilled and **editable** (`autoComplete="email"`), so autofill offers the saved
  password. A changed address can be corrected.
- `PasswordInput`, and **Sign in** as the primary button.
- **Later,** only after a sign-in attempt failed with no response (too little signal) and never in
  the password-changed state.
- **Forgot password?**, which opens the web reset as login.jsx does.
- **Not you? Sign out,** a small link. When items are waiting, or the last attempt failed for lack
  of signal, it confirms first: *"Signing out removes your saved houses from this phone, and 3
  saved items will go up under whoever signs in next. Sign out anyway?"*

**Sign in** calls `api('/auth/login', { method: 'POST', body, quiet: true })`.

- **If `res.user.id` is the cached user's id and `completeReauth(sent, res.token)` returns true:**
  1. save the user, memberships and server meta as login.jsx does, leaving the org and campaign
     alone;
  2. refetch **only failed** queries (`invalidateQueries({ predicate: q => q.state.status === 'error' })`),
     so the multi-MB roster is not refetched;
  3. restore focus;
  4. `flushQueue().then(refreshPending)`;
  5. if `mustChangePassword` and not already on `/change-password`, route there. The screen is
     never up in the door flow, so nothing is unmounted mid-door.
- **If `completeReauth` returns false** (signed out meanwhile), send `/auth/logout` with `res.token`
  and do nothing else.
- **If the id differs,** do a manual `signOut()`, then show the sign-in screen.
- **Errors show inline:** a wrong password, `TEMP_PASSWORD_EXPIRED`, a 429, or *"Couldn't reach
  Doorline. Check your signal."*

**Later and re-expanding.** Later collapses the screen into §D4's notice. It re-expands:

- on the next app foreground;
- when a 401 arrives outside the door flow at least 30 minutes after Later. That 401 proves there is
  signal.

While `_reauth` is set, the map's **Refresh** opens the screen instead of refetching. A password
typed here is a real login, so it stamps `lastLoginAt`.

### D6. The roster guard

- **In `saveBootstrap`'s writer,** right **after** `queuedSave = null; snapshot = pendingSave; pendingSave = null`,
  the writer returns without writing when `mayWriteRoster(...)` is false. It never calls
  `setBootstrapSaveFailed`, so the coalescer keeps working.
- **`bootstrapQueryFn`** passes react-query's `signal` to `api()`, and rethrows when the signal was
  aborted, so `queryClient.clear()` at sign-in cancels the previous session's fetch.
- **Result:** no late save writes the walk list back after an automatic sign-out. Re-auth keeps the
  roster, because nobody signed out.

### D7. `login.jsx`

- `queryClient.clear()` (via `useQueryClient()`, before the early return) runs just before `signIn`.
- When there is a note (a deliberate sign-out), it shows:
  - an info banner on `colors.infoBg`;
  - the email, except for `deleted` and `inactive`;
  - for `password_changed`, the pending line.

### D8. `session.js`

`refreshSession` snapshots `sent`.

- **If the token has changed when `/auth/me` answers,** it saves nothing.
- **Otherwise** it saves the user and memberships, then, in its own `try/catch`,
  `adoptRenewedToken(sent, res.token)`.
- **The comment at :11-12** becomes "offline never signs you out; the server saying it ended does."

### D9. Small changes

- **change-password.jsx and profile.jsx** wrap only their `api()` call in `rotateToken`.
- **csv.js, artifactDownload.js and admin/books.jsx,** on a 401, call `refreshSession({ force: true })`
  fire-and-forget, then throw as today.
- **update-required.jsx** redirects to `/login` when the token is null.
- **The root QueryClient** uses the §D1 retry predicate.
- **map.jsx:793** shows its full-screen error only when there is no data, or for a 404. A failed
  background refetch no longer blanks a working map.
- **DataHealthBanner** reads *"Password needed — showing houses saved on this phone"* when the disk
  fallback came from a 401. `bootstrapQueryFn` records `fallbackReason: 'auth'`.

## E. Web

### E1. `client/src/lib/sessionEnd.js` (plain, tested)

- **Shared with the phone:** the reasons, `sessionEndReason` and the copy. A parity test imports the
  phone module and compares every string, following datePresets.parity.test.js.
- **`webAction(reason, { reauthUp })`:**
  - `'reauth'` for `expired` and `invalid`;
  - `'reauth'` for `password_changed` while the modal is already up (B2);
  - `'signout'` for `missing`, `deleted`, `inactive`, and `password_changed` otherwise.
- **`sessionEndDecision({ status, data, sentToken, storedToken })`** returns
  `{ reason, action }` only for a 401 with `SESSION_REVOKED` **and** a live session
  (`sentToken ? sentToken === storedToken : !storedToken`). Tests prove it returns null for
  wrong-password, share and FbTime `KEY_*` 401s.
- **`tokenClaims(token)`** returns `sub`, `email` and `iat`, for display and cross-tab checks only.
  The server stays the authority.
- **`renewCheckDue({ token, now, lastCheckAt, lastInteractionAt })`** is true only when:
  - the token's `iat` is more than a day old;
  - the last check was more than 6 hours ago;
  - `lastInteractionAt` is after the token's `iat`.
- **`shouldAdoptRenewedToken`,** and the retry predicate.

### E2. `client.js`

- **Options:** `quiet`, and `token` for an explicit override.
- **`'reauth'`** dispatches `doorline:reauth-required` with `{ reason, sentToken }`, once per token.
  It **never clears the token**, because clearing it would push every other tab into `missing`.
- **`'signout'`** clears the token. Unless the page is public, it sets a latch **immediately before**
  `location.assign('/login?signedOut=<reason>')`.

### E3. Re-auth state lives in AuthContext

**`reauth`** is `{ reason, sentToken, identity }`.

- **What sets it:**
  - the client.js event, when `sentToken === getToken()`;
  - the page-load check (§E5).
- **What clears it:** `login()`, `reauthenticate()`, `logout()`, and a same-person storage event
  (§E7).
- **`identity`** is the loaded user, or `{ id: sub, email }` from `tokenClaims` when the page loaded
  with a dead token.

**`ReauthModal`** renders while `reauth` is set, `getToken() === reauth.sentToken`, and the page
isn't public.

- **Where it renders.**
  - It portals to `document.body` at **`z-[60]`**, above Overlay's `z-50`.
  - While open, it adds a capture-phase `keydown` listener on `window` that stops Escape from
    reaching an open drawer and keeps Tab inside, and sets `inert` on the other body children.
  - `role="dialog"`, `aria-modal`, `aria-labelledby`, with focus on the password field.
  - Everything is undone in cleanup.
- **The form.** A real `<form>` with:
  - an email `<input type="email" autocomplete="username">`, prefilled and editable;
  - a password `<input autocomplete="current-password">`;
  - **Sign in**, then **Not you? Sign out** (`logout()`), then **Forgot password?**, which opens a
    new tab.
- **Copy:** the shared copy, or the password-changed variant (B2).

**`reauthenticate(email, password)`:**

1. Captures `sent = getToken()` and an `AbortController` held in a ref, which `logout()` aborts.
2. Posts `/auth/login` with `quiet: true`.
3. **If `getToken() !== sent` when the answer arrives,** it discards the new token with a
   fire-and-forget `/auth/logout` carrying that token.
4. **If `res.user.id === identity.id`:**
   - `setToken`, `setUser` and `setMemberships`, leaving `activeOrgId` alone;
   - clear `reauth`;
   - refetch only failed queries;
   - if `mustChangePassword`, `location.assign('/change-password')`.

   Unsaved form state survives, because nothing navigated or unmounted.
5. **If the id differs,** it discards the token the same way, clears the stored token, and goes to
   `/login`.

### E4. `login()` keeps the person's org when it is the same person

If the token being replaced belongs to the same `sub` as `res.user.id`, and the stored active org
is still one of their console memberships, `login()` keeps it. Otherwise it applies
`activeOrgIdForLogin` as today.

Without this, re-signing in on `/login` in one tab would wipe a multi-org person's org in a tab
whose modal is holding edits. It refines roles.js's recorded rule for the same-person case only,
and roles.js's comment and ROLES.md are updated to say so.

### E5. The page-load check

- **Cleanup.** The effect gets an `AbortController`, is called `quiet`, and aborts in cleanup.
  `setLoading(false)` runs only when it wasn't aborted.
- **On a re-auth reason** (`expired` or `invalid`), it keeps the token **and** the active org, and
  sets `reauth` with the token's identity. ProtectedRoute renders the modal in place instead of
  redirecting. The deep link stays, nothing calls `login()`, and on public pages nothing shows.
- **On a sign-out reason,** it clears the token and org as today. ProtectedRoute's redirect passes
  `state: { from, signedOut }`.
- **On a 5xx or a network failure,** it keeps the token and sets `bootError`.
  - ProtectedRoute shows **"Couldn't reach Doorline."**, but only while there is no user.
  - It offers **Try again**, which reloads, and **Sign in again**, which goes to `/login` without
    clearing anything.
  - `login()` clears `bootError`.
- **On success,** it sets the user only while `getToken() === sent`, and adopts a renewed token
  through `shouldAdoptRenewedToken`.

### E6. Extension while a tab stays open

- **Activity tracking.** Passive `pointerdown` and `keydown` listeners on `window` record
  `lastInteractionAt`.
- **When it checks.** On `visibilitychange` to visible, and on a fixed 6-hour interval, it calls
  `/auth/me` only when `renewCheckDue` is true and the modal is closed. **One call per 6 hours at
  most, whatever the answer.**
- **Who it covers.** An unattended wall display never renews. It runs out at 30 days and shows the
  modal. A staff tab costs one call per 6 hours.
- **What it adopts.** Only the token, through `shouldAdoptRenewedToken`. It never replaces the user.
- **Cleanup** removes the listeners and the interval, and aborts the request in flight. `logout()`
  aborts it first.

### E7. Tabs stay in step

A `storage` listener on the token key, with cleanup:

- **A new token with the same `sub`** as this tab's user or identity: if this tab's `reauth` is
  set, clear it and refetch failed queries. Otherwise do nothing; a renewal in another tab needs no
  refetch.
- **A new token with a different `sub`:** reload the console home.
- **The token removed:** nothing. The next request answers `missing` and redirects, unless this
  tab's modal is up, in which case the modal keeps its edits safe until the person decides.

### E8. `LoginPage.jsx`

- **The note** comes from an allowlisted `?signedOut=` or `state.signedOut`. It uses
  `border-info/30 bg-info-tint text-info-fg`, a combination already in use.
- **Deep links** are restored as today, through `from`.

### E9. Small changes

- **`logout()`** first calls `api('/auth/logout', { method: 'POST', quiet: true })` without
  awaiting it. client.js reads the token before its first `await`, so the header still goes out.
  If the lead-landing plan's `useSignOut` ships first, this moves there.
- **`downloadFile`**, on a 401, calls `api('/auth/me')` with a catch, then throws as today.
- **main.jsx's QueryClient** uses the retry predicate.

## F. Privacy

**This changes how long a device keeps access to customer data, and how sign-out works.** Under
CLAUDE.md's second invariant that counts as "who can access customer data," so it is flagged here.

**The change, with B1 as recommended:**

- A used sign-in lasts up to 90 days from the typed password, and staff keep 30.
- It still ends at once on a password change made by the person, on account deletion, and on a
  manual Sign out made with signal.
- The DPA §4 judgment is the owner's (§B).

**What the phone keeps while the password screen is pending, or after Later.** It keeps the
walk-list copy, and anyone holding the unlocked phone can use the app after tapping Later.

- That matches today exactly: an expired session already serves the saved copy (bootstrapQuery.js:26-53)
  and deletes nothing.
- The password screen is **not** recorded as a protection, and the PRIVACY_VERIFICATION stamps say
  so.
- Every sign-out, manual or automatic, deletes the copy. §D6 closes the late-write race on updated
  apps.

**Owner review, no change proposed.**

- **privacy.html's offline-copy paragraph** ("deleted when you sign out," and results kept "until a
  connection is available"). A canvasser who tapped Later now holds results on a phone that has
  signal until they type the password.
  - The policy's sentences stay true in the sense that the person hasn't signed out.
  - Today's expired sessions behave the same.
  - The owner confirms.
- **No other published sentence becomes false:**
  - "keep you signed in";
  - "disable access promptly," because membership is checked per request;
  - no stated session length.

**[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) stamps,** following the v3 convention:

- **A watchlist bullet** at :88 covering three things: extension, the password screen keeping the
  copy with no time limit, and the §D6 guard.
- **Stamps:**
  - :317;
  - :3194/:1146, share unlocks unchanged because they use a separate verifier;
  - :3407-3415, bull board HOLE 4 closed;
  - :3675-3677 and :3680-3683: `auth_ms`, extension, the cap, and logout now ending tokens that
    carry or derive a `sid`;
  - :3708, the copy persisting through the password-screen state.
- **The "Remaining honest gaps (v3)" list** at :1058 gains:
  - a sign-out with no signal never reaches the server;
  - an ended session could come back only after 200 later sign-outs by the same account within the
    cap;
  - old app versions still sign out on expiry through a path that can let a late door save write
    the walk list back. Updated apps close that race.

**Data.**

- `endedSessionIds` is a new `User` field:
  - it holds random ids from the last 200 sign-outs;
  - it survives organization deletion and is cleared by account deletion;
  - it is covered by privacy.html:97's technical-information paragraph.
- Nothing new is shared, and no new third party is involved.
- The email shown on the password screens is what the app already caches.
- Extension never writes `lastLoginAt`.

## G. Docs and Help Center (same change)

**[USERS.md](USERS.md)**

- **Part 1:** add *Staying signed in*, with the lost-device advice (change it yourself).
- **Part 2 rewrites:**

  | Lines | Becomes |
  |---|---|
  | :214 | "last sign-in" → last password login |
  | :535-538 | `lastLoginAt`: typed passwords only, including the password screen |
  | :582, :584-586 | the 503 |
  | :612-614 | `auth_ms` |
  | :633 | every coded 401 |
  | :953 | deactivation is per membership |
  | :957 | the idle window, the cap and `sid` |
  | :978 | the queue holds on 401 |

- **Additions:** the §C contract.

**[CANVASSER_APP.md](CANVASSER_APP.md)**

- **Part 1:** *When the app asks for your password*. It is the help source.
- **Part 2, *Session & role recovery*:**
  - :583-584 becomes "offline never signs you out";
  - add the store, `SessionGate`, the password screen and the roster guard.

**Other docs**

- [ROLES.md](ROLES.md) and roles.js's comment: the same-person org rule (§E4).
- [PLATFORM.md](PLATFORM.md): :157-159 (sessions) and :285 (bull board, cookie ticket only).
- [../PROJECT_BRIEF.md](../PROJECT_BRIEF.md):39.
- [DEPLOY_RUNBOOK.md:121](DEPLOY_RUNBOOK.md): open the console's **Jobs** page first.
- [docs/README.md](README.md): exactly one row. That file carries another session's uncommitted
  edits, so use the shared-tree hand-off.

**Code comments and config**

- middleware/auth.js: :15-18, :22-27, :40-42.
- User.js:35-37.
- lastSeen.js:3-5.
- session.js:11-12.
- [server/.env.example:9](../server/.env.example).

**Help Center**

- **New `faq/signed-out-sign-in-again.md`.**
  - **Frontmatter:**
    - `slug: signed-out-sign-in-again`
    - `title: Doorline asked for my password again. Is something wrong?`
    - `audience: all`, `kind: faq`
    - `order: 19`. It is free; FAQ orders at HEAD start at 20.
    - `sourceDoc: CANVASSER_APP.md`
    - a `summary`
    - `tags: sign in, signed out, password, session, log in, expired`
  - **It covers:**
    - nothing is wrong, and you type your password where you are;
    - Later on weak signal;
    - daily use keeps you in once your app is up to date (link `app-asks-to-restart`);
    - the 30- and 90-day rules, for the app;
    - password changes and deleted accounts;
    - **"Always sign back in as yourself — saved work goes up under whoever signs in next"**;
    - Doorline can turn an item down;
    - lost a device? change your password yourself; a temporary password from your admin or lead
      doesn't sign other devices out.
  - No staff line.
- **[guides/canvasser-offline.md](../server/src/content/help/guides/canvasser-offline.md):**
  - :14 and :24 change "doors" to "items";
  - add the "as yourself" condition;
  - add a paragraph on the password screen and the map notice.
- **[faq/reset-my-password.md:30](../server/src/content/help/faq/reset-my-password.md):** add the
  "as yourself" condition.
- **[pages/page-team.md](../server/src/content/help/pages/page-team.md):**
  - :12 becomes "Last password login," pointing at *Last door knocked*;
  - :26's deactivation wording.
- **[faq/canvasser-left-the-team.md:31](../server/src/content/help/faq/canvasser-left-the-team.md):**
  the deactivation wording.

## H. Verify

### Tests

| Where | Command |
|---|---|
| `server/` | `npm test` |
| `server/` | `npm run test:int -- test/sessionLifetime.int.test.js test/sessionInvalidation.int.test.js` |
| `client/` | `npm test` |
| repo root | `npm run test:mobile` |

### Real runs

Run against a throwaway local database, started from the repo root:

```
MONGODB_URI=mongodb://127.0.0.1:27017/doorline_session_test JWT_EXPIRES_IN=2m npm run dev:server
```

The phone points at it with `EXPO_PUBLIC_API_BASE_URL`.

**1. The unmodified current app against the new server.** On each landing screen (map, campaigns,
admin, super admin, select-org, forced change):

- The sign-in screen appears where §A says it does.
- After the sign-out, the bootstrap, tmp and legacy roster files are absent
  (`FileSystem.getInfoAsync` in a dev build).

**2. The new phone code:**

- **Expiry mid-survey:** the screen waits, the save is queued, and the screen appears after leaving
  the door. After sign-in the map stays put, the badge clears, and the roster isn't refetched.
- **Android Back** with the screen up does nothing, or collapses it after Later.
- **Weak signal:** the sign-in fails, **Later** appears, the notice shows, and **Refresh** reopens
  the screen. Then kill the app, reopen it with signal, and sign in.
- **Extension:** foreground after 60 seconds. The token changes and works after a relaunch.
- **A password changed on the web mid-survey:**
  - It waits until the person leaves the door, shows "Signing out…", then the note, email and
    pending line.
  - The roster files are absent afterwards, including with a door save in flight.
- **Forgot password? from the screen:** reset on the web, return, and the screen asks for the new
  password (B2) with the houses still there.
- **A slow save, then the next door within 5 seconds.**
- **Not you? Sign out** with items waiting: the confirm appears.
- **An admin sheet open at expiry:** its save shows the server text, and closing it shows the
  screen.
- **Sign out during an extension:** still signed out after a relaunch, and the token answers
  `invalid` from a copy.
- **A deleted account with items:** the note, no email, and no pending line.
- **A different account signing in with items:** record what happens, for §J1.
- **Downloads** (csv and artifact) and **update-required** with a dead token.

**3. The web, with a single-org admin, a super admin and a two-org lead:**

- **Builder edits past expiry:** the modal, then the edits save.
- **An Edit-campaign drawer open at expiry:** press Escape, then sign in, and the drawer's edits are
  still there.
- **Two tabs:** the modal over edits in tab A. Open a console tab and an `/r` link in others, and
  sign in on `/login` in a third. A's modal closes in place, its org is kept, and the edits save.
- **A tab opened after expiry:** the modal in place, and the deep link kept.
- **Sign out in one tab:** the other goes to sign-in on its next request. Sign in as someone else:
  the other reloads as them.
- **Interaction and staff:** a visible tab with interaction renews within one 6-hour check. A staff
  tab calls `/auth/me` at most once per 6 hours.
- **A database stopped at page load:** the wall, with both buttons working.
- **A web Sign out:** a copied token then answers `invalid`.
- **The Jobs page iframe** still opens the bull board.

**4. The mobile-API audit.** Run `npm run audit:mobile-api`. It flags `routes/auth.js`. Record the
hand check of `middleware/auth.js` and `bullBoard.js`: every change is additive except the 503,
which every shipped app retries.

**5. `git status --short`** before handing over.

## I. Release

**The phone update ships first.** The new phone code is safe against today's server:

- an uncoded expiry dead-ends exactly as today;
- a `SESSION_REVOKED` without a reason reads `password_changed`, and signs out off the door with a
  note;
- `/auth/me` returns no token.

Shipping the server first would push every not-yet-updated phone into old-bundle sign-outs before
it could update. 6818a2b followed the same rule.

**Steps:**

1. Check `JWT_EXPIRES_IN` (§B).
2. Finish every local run in §H.
3. From `mobile/`, run `npm run ota:staging`. On a staging build, against today's production
   server, confirm nothing changed. Then run `npm run ota:production`. The owner runs both.
4. The owner sends the crew notice (B5).
5. The owner pushes `main`, and Heroku deploys the server and web together. Ship the bull board
   change as its own commit (§C3). No migration, no `build-indexes`, no config var.
6. **Smoke-test on production:**
   - a password reset on the web reaches a staging phone as the note;
   - a sign-out in one tab sends the other to sign-in;
   - a fresh sign-in, then `/auth/me`, carries `Cache-Control: no-store`.
7. Admins reload any console tab that stays open all the time.

**Old app versions after step 5.** Phones that never updated, the legacy `com.canvassapp.mobile`
app, and older fingerprints sign out on expiry instead of dead-ending. They delete their saved
houses, download them again after sign-in, and keep 30-day sign-ins.

**No client-version gate.** Everything is additive except the 503, which shipped apps already
retry.

**Rollback:**

- Reverting the server restores today's behaviour. Tokens carrying `auth_ms` and `sid` stay valid,
  revoked by `iat` as before.
- Sessions ended by sign-out work again until their own `exp`.
- New phone code against an old server behaves as in the release note above.

## J. Found while planning, not in this plan

1. **Saved work picked up by whoever signs in next is misattributed or lost.**
   - The server stamps `req.user._id` at upload (canvass.js:338).
   - Same org and assigned, or an admin, who skips the check at canvass.js:110: the work is
     credited to them, which affects pay and billing.
   - Otherwise a 403 follows, and the flush deletes the item (offlineQueue.js:120-125). The same
     silent drop hits the original person if they were removed from the campaign meanwhile.
   - The password screen removes this for the common case, since only the same account can
     complete it. The "Not you?" confirm warns about it.
   - **Next plan (B4):** pin the user at enqueue, flush only that person's items, and count and show
     refused items.
2. **Coordination with [PROPOSAL_LEAD_CAMPAIGN_LANDING.md](PROPOSAL_LEAD_CAMPAIGN_LANDING.md).** It
   changes LoginPage:40 and adds `useSignOut` plus `queryClient.clear()` to AuthContext. This plan
   adds `reauth`, `reauthenticate`, `bootError`, the listeners, the logout call, and §E4's
   same-person org rule. Whichever ships second rebases. The logout call moves into `useSignOut`.

## K. Review log

**v4's own changes, unreviewed, which a fourth round should target first:**

- On the phone, one `SessionGate` now owns the door-flow deferral for **both** re-auth and
  deliberate sign-outs, plus the forced-change route. It also owns the collapsed notice.
- **Later** appears only after a no-signal failure, and Back collapses the screen.
- Re-auth survives a password change while it is up (B2).
- The web handles page-load expiry in place, with identity taken from the token.
- `login()` keeps a same-person org.
- Old tokens get a derived `sid`.
- A separate `verifySessionToken`.
- Interaction-gated, 6-hourly web renewal.
- The phone update ships before the server.
- Only failed queries are refetched.
- The map's error state is narrowed.

**Round 3** (mechanisms by simulation; product and simplicity; security, privacy and contract):

- **Blockers.** The screen said "signed out" while keeping the walk list. Opening a new tab
  destroyed another tab's edits. The web modal reopened after sign-in and sat under drawers, where
  Escape discarded the drawer. Android Back popped the door screen under the cover.
- **Majors.**
  - Old-token copies could survive Sign out and mint fresh session ids.
  - `verifyToken` was shared with share unlocks.
  - Sign out during re-auth re-signed the person in.
  - The roster guard's placement would have stopped all saves.
  - **Not now** misled people, and Refresh rebuilt the dead end.
  - The cover popped up mid-door.
  - The banner blocked the header.
  - A blanket refetch undid "where you left off."
  - The staff renewal loop ran every minute.
  - Forgot-password ended in a wipe.
  - Old apps would be pushed by a server-first release.
- **Minors.** About 25, from layering and accessibility to line drift, all folded in.

**Round 2** (mechanism simulation; consistency; pre-mortem):

- The design changed to re-auth in place.
- A stale bare request could sign out the next person.
- The copy over-promised uploads.
- The redirect latch could die on a public page.
- A deferred end could stall outside the door flow.
- An automatic sign-out could write the walk list back to disk.
- The DPA weighing listed non-changes.
- A long idle window would have mass-capped old tokens.

**Round 1** (server, phone, web plus docs):

- Deactivation never ended a sign-in.
- A renewal could resurrect a signed-out token.
- The pending line promised uploads for deleted accounts.
- The bull board accepted session tokens.
- `safeNextPath` let `/\t/evil.com` through.
- The web page load signed out on any error.

## L. If a §B choice is "no"

| Choice | If no, drop or change |
|---|---|
| B1a extend | Drop §C5, the `sid` carry in renewals, `adoptRenewedToken` and its tests, §D8's adoption, §E1's `renewCheckDue`, §E5's adoption, and §E6. Rewrite Part 1 #2 and the FAQ line to "a sign-in lasts 30 days from your password." §B1b–d and the DPA table fall away. |
| B1b cap | Drop §C6, its tests, and the cap condition in §C5. Remove "90 days" from Part 1, the FAQ and §F, where a used sign-in becomes unbounded. |
| B1c staff | Drop `!isSuperAdmin` from §C5, and the staff lines in Part 1. |
| B1d real sign-out | Drop §C7, the `sid` checks in §C2 (step 3's `sid` rule, step 4's legacy derivation, step 9), `sid` in §C4/§C5, its tests, the deletion clear, `notifyServerSignOut`, §E9's logout call, the discard-by-logout steps in §D5/§E3, Part 1 #4, and the DPA row. §F keeps "a copied token stays extendable after sign-out." |
| B2 | Remove the `reauthUp` rule from §D1/§E1, and the password-changed screen copy. A reset from the screen then signs out and wipes. |
| B3 | Leave the labels. The help copy changes anyway. |
| B6 | Skip the public page. The crew notice still goes out. |

## M. As built (2026-10-10)

Built in the repo on `main`, uncommitted. Release order is §I: the phone update first, then the server
and web.

**Where the build differs from the plan, and why**

1. **A session generation, not react-query's abort signal (§D6).** Consuming the signal in
   `bootstrapQueryFn` would also abort a multi-MB walk-list download every time the map unmounts (react-query
   cancels a signal-consuming fetch when its last observer goes), which on weak signal means downloading it
   again. Instead `sessionStore` keeps a `generation` that changes only when the person changes (sign-in,
   sign-out) — never on an extension or a password typed into the in-place screen — and `bootstrapQueryFn`
   discards a roster that lands in a different generation. The roster write guard (§D6) is as planned.
2. **The web reports, the provider decides (§E2).** `api/client.js` dispatches one `doorline:session-ended`
   event for every live session end and never clears the token itself; `AuthContext` decides prompt versus
   sign-out, because only it knows whether the prompt is already up (the password-changed-while-up rule,
   B2). The latch, public-page rule and redirect are as planned, inside the provider.
3. **`login()` does NOT keep a same-person org (§E4 dropped).** `lib/roles.js` records a deliberate rule —
   typing your password starts you at your home, so "signed out then signed in" and "expired then signed in"
   land in the same place. With §E5 (the page-load prompt in place), a run-out never reaches `login()`:
   `reauthenticate()` continues the session and leaves the org alone, like a reload. The remaining path (a
   person deliberately using the sign-in page while another tab holds edits behind its prompt) keeps the
   recorded rule.
4. **Web password changes don't sign themselves out.** Not in the plan: while `changePassword()` is in
   flight, `AuthContext` ignores `password_changed` answers for the token being replaced — the web had the
   same race the phone's `rotateToken` closes.
5. **Later only on the field screens.** "Later" appears after a sign-in attempt fails for lack of signal
   AND only on the map, books and building screens, where it collapses into the notice; on any other
   screen the full password screen stays (those screens need the network anyway).
6. **"Last password login" everywhere the field shows.** Also on the super-admin screens (web user list and
   detail, phone super-admin users), not only the org-facing ones in §A.
7. **The public app page (B6)** gained an "Asked to sign in again?" section in `client/public/app.html`.

**Added after code review round 1 (three reviewers on the diff; every finding checked first):**

8. **The web's active org is per tab.** `getActiveOrgId()` reads localStorage once, then the tab owns it.
   A password reset finishing in another tab (its sign-out clears the stored org) or a sign-in there
   (which resets it for a multi-org person) used to strip the org from a tab holding edits behind its
   prompt, so its saves failed after the password. It also ends an older oddity: an org switch in one tab
   used to re-point every other tab's requests underneath its page.
9. **Held requests on the web.** A request answered with a run-out — or, while the prompt is up, a
   password change or another tab's sign-out — waits for the password and is retried once (the 401 came
   from the sign-in check, so it never ran). A failed poll used to swap some pages' forms for an error
   and lose what was typed; a Save clicked at the wrong moment now completes after the password. Polls
   pause while the prompt is up.
10. **B2 has a half-hour window, on both clients.** A password change while the prompt is up keeps it in
    place only if the prompt came up or was last used in the last 30 minutes — the person's own "Forgot
    password?" (round 2 added the last use; see 16). A device left untouched at the prompt longer is
    treated as lost: signed out, and a phone deletes its saved houses. The lost-device copy says so.
11. **Another tab signing out never closes a prompt that is up** (the reset page signs its own tab out),
    and **tabs loading together** on a day-old sign-in all stay signed in.
12. **Failed refreshes keep the screen.** The phone's books screen joins the map: a full-screen error only
    with nothing to show or a final answer from the server (refined in round 2, see 18); otherwise a
    *Couldn't refresh… Try again* row, and while the password is pending Retry and Refresh bring the
    password screen back. A disk fallback reads "password needed" only for a coded session end, never for
    an older server's plain 401.
13. **Phone details.** After a sign-in fails for lack of signal, a non-field screen offers **Go back** when
    there is a screen to go back to (Android Back does the same; renamed in round 2 from "Back to the
    map", which sent admins and leads to their admin home); the collapsed screen re-expands only on a real
    return from the background, a tap on its notice, Refresh or Retry, or another ended-session answer
    30+ minutes after Later while off a door; the store-update soft
    banner steps aside while the password is pending and during Signing out, and the OTA restart offer
    waits while the password is pending; the navigator's accessibility wrapper is
    `collapsable={false}` so a cover never re-mounts the navigator; a failed SecureStore delete at
    sign-out falls back to an empty token; the different-account path confirms first when work is
    waiting; error text uses the readable `dangerFg`.
14. **Tests strengthened** (server): the staff rule, the `kind` refusal and every old-app text are now
    pinned (each test was shown to fail with its rule removed), and the sign-out test no longer races
    login's background write.

**Added after code review round 2 (three reviewers: the new mechanisms, regressions, and every changed
sentence in the docs; every finding checked first):**

15. **A web prompt never outlives its token.** Every change to the prompt goes through one setter that
    updates the ref the listeners read at once (a storage event landing between raising the prompt and
    the next render used to be dropped) and tells `api/client.js` whether the prompt is up — requests are
    held on that flag, not on a leftover promise from an aborted request. The storage listener follows the
    same person's new token on any page (a prompt left behind on the landing page used to stick: polls
    paused, renewal off, a later sign-out in another tab ignored and its request held forever), and a
    backstop on every prompt or page change settles a different stored token the same way. Every path
    that clears the prompt settles held requests: a sign-in on the sign-in page fails them, a sign-out
    fails them, a continue runs them. The browser run proves each of the two fixes on its own.
16. **The half-hour window runs from the later of when the password screen came up and its last use**
    (`activeAt`, stamped by a sign-in attempt, Forgot password?, Later, Go back and the notice), on both
    clients. Measured only from when the screen went up, a canvasser who tapped Later in a dead zone and
    reset the password an hour later was signed out and lost the houses; so was one who took longer than
    half an hour to fetch the new password. (Round 3 bounded the new-password screen too; see 23.)
17. **A password change reruns what failed meanwhile** (web and phone): a 401 is no longer retried, so a
    query that left with the old token while the change was in flight stayed in error. The web also
    ignores every password-changed answer while its own change is in flight (a request the prompt held
    and sent again carries a token the old guard didn't know), and `reauthenticate()` continues when
    another tab signed out during the sign-in and writes the tab's org back to storage. (Round 3 narrowed
    both: an answer while the prompt still holds the change is handled as usual, see 25; the org is
    written back only when the tab has one, see 26.)
18. **The phone never shows another campaign's houses.** `['bootstrap']` is one cache entry for every
    campaign and some ways of seating a campaign leave it alone; with failed refreshes no longer
    replacing the screen, a failed fetch for a newly seated campaign showed the previous campaign's
    houses. A roster for another campaign now counts as nothing loaded and the screen fetches its own
    (refined in round 3, see 22). Any 4xx except 401 and 429 is the server's final answer and keeps the
    full-screen error (`rosterErrorIsFinal`; round 3: only when it carries Doorline's own JSON error, see
    26), so "Not assigned to this campaign" keeps its way out. The
    books screen gained the refresh row (`RefreshFailedRow`) and the map's Refresh guard.
19. **Phone details, round 2.** The sign-in clear keeps the store-update check (the banner blinked off
    and was fetched again at every sign-in); the password screen's account check falls back to the
    account id in the held token when the cached user can't be read (it used to sign the right person
    out), its saves after adopting the session are best-effort, and its button never stays spinning.
20. **Server and web details.** `User.endedSessionIds` is `select: false`, read only by `requireAuth`, so
    up to 200 ids never ride along on member lists. The Team page's "Last password login" header stays on
    one line (round 3: it doesn't wrap, and runs into the empty space above the row chevrons, after a
    wider column was measured taking 40px from the names at every screen size).
21. **Docs corrected** against the build: the lost-phone claim now says "the next time it connects" (an
    offline phone keeps working until then), "Forgot password?" says the half hour runs from tapping it,
    old apps now sign out on every run-out (PRIVACY gap 29 (c)), the privacy record's inventories count
    the new field, and privacy.html:94 ("until a connection is available") is listed for the owner.
    Review round 3 (docs) added: the refresh-failed row in Part 1 and the offline help guide, per-tab org
    in Part 1 (USERS.md, ROLES.md) and the roles help guide, ROLES.md's ProtectedRoute description (its
    two non-redirect branches), and the same-site rule for the Bull Board link in the runbook.

**Added after code review round 3 (three reviewers: the round-2 mechanisms, regressions, and the docs;
every finding checked first and replayed in the reviewers' own harnesses after the fix):**

22. **One owner for what the field screens show from the shared roster cache.** Round 2's foreign-roster
    check could spin forever: a download still running for the previous campaign was joined, landed
    still foreign, and nothing fetched the seated campaign's roster. It also showed the previous
    campaign's failure as the new one's, and a refresh cancelled by a door write as *Couldn't refresh…
    CancelledError*. Now `bootstrapQueryFn` tags every failure with its campaign, and both screens read
    the cache through `useSeatedRoster` (`lib/bootstrapQuery.js`) over the plain, tested rules in
    `lib/seatedRoster.js`: another campaign's roster or failure never shows, the loader stays up and this
    campaign's roster is fetched again whenever the cached roster or failure changes, and only this
    campaign's own failure ends the wait (no fetch loop: one retry, then the error screen).
23. **The new-password screen is bounded too** (both clients). Round 2 kept a screen already asking for
    the new password in place forever, so a lost phone whose screen someone touched before the owner's
    change never deleted its houses. The half hour now also runs from when the screen first switched to
    asking for the new password (`changeHeardAt`, stamped once; a repeat answer about the same change
    doesn't move it), so the person who just reset has half an hour to type it, and an untouched screen
    signs out at the first answer after that.
24. **A web tab never shows one person under another's token.** A different person's sign-in stored
    while a tab sat on a public page used to be ignored, and a link into the console then showed the
    last person with the new person's token. Now `reconcileStoredToken` runs on every storage event,
    prompt, user or page change and right after this tab stores a token itself: off a public page a
    different person reloads into the stored sign-in; on a public page the tab forgets the last person
    at once (`forgetPerson`) and reloads as soon as it leaves the page. Calling it after this tab's own
    password change or extension also settles a prompt raised for the old token at the same instant.
25. **A password change held behind the web prompt no longer mutes real answers.** The change can't
    have happened while the prompt holds it, so a password-changed answer then is a change made
    elsewhere and is handled as usual (the upgrade, then the window).
26. **Round-3 regression fixes.** Only the focused field screen fetches for its campaign: two field
    screens left mounted on different campaigns took turns replacing each other's roster (28 fetches in
    five seconds in the harness; 2 with the gate). No navigation path does that today. A "final" roster
    answer must carry Doorline's own JSON error, so a captive portal's 4xx page no longer blanks a
    working map. The Team header keeps its 7.5rem column and doesn't wrap, instead of a wider column that
    took 40px from the names at every width. `reauthenticate()` writes the tab's org back only when the
    tab has one, so a prompt answered on the org picker never erases another tab's org.

**Added after review round 4 (three reviewers: the round-3 fixes, regressions, and the docs; older
problems found and fixed in 27 and 28, and round 3's header `nowrap` narrowed to the one label that
needs it in 29, each replayed in the reviewers' harnesses):**

27. **A web sign-in clears the query cache first.** Most console query keys name neither the person nor
    the org, so after a sign-out (or in a tab that forgot its person) the next person to sign in on that
    tab saw the last person's cached pages until their own fetches landed — or kept seeing them if their
    fetch was refused. Older than this work; closed here because round 3's "nothing of theirs keeps
    rendering" depended on it. `logout()` in a tab that forgot its person no longer ends the other
    person's session (the reset page signs out this way). PROPOSAL_LEAD_CAMPAIGN_LANDING.md plans the
    same clear in `login()` plus one in `logout()` (its §A.7 "never cleared on sign-out or sign-in"
    describes HEAD `b1e0b0d`); whichever ships second rebases, as §J.2 says.
28. **The roster's one retry runs inside `bootstrapQueryFn`.** react-query re-reads a query's options for
    each of its own retries, and the door screens subscribe to `['bootstrap']` without a query function,
    so a retry that ran while one was open had none: *Couldn't refresh the houses: Missing queryFn*. Both
    screens now set `retry: false`; the function retries once itself, never for a 401, Doorline's final
    answer, a changed person, or a campaign that is no longer seated (so a failed download for the
    previous campaign is not tried again while the new one waits). A 404 skips the saved-copy fallback
    only when it carries Doorline's JSON error, so a captive portal's 404 page shows the saved houses
    instead of "archived".
29. **The Team header's `nowrap` applies to "Last password login" only;** the one-word labels wrap their
    sort arrow as before.

**Added after review round 5 (two reviewers: the round-4 code and the docs; no blocker or major, each fix
replayed in the reviewers' harnesses):**

30. **The roster's own retry stops when react-query lets go of the fetch:** a door write or a Refresh
    cancelled it, a newer fetch replaced it, or the query was removed. Before, the retry still downloaded
    the whole roster after a cancel and could save an older copy over a newer one.
31. **Sign-out ends the stored session only in a tab that holds a person.** A reset link opened in a fresh
    tab that never had one used to end the session of someone who signed in elsewhere meanwhile.
32. **Every final answer from Doorline skips the saved-copy fallback,** not only a 404: on a cold start a
    "Not assigned to this campaign" 403 used to show the saved houses labelled offline, and knocks there
    were later dropped. Older than this work; a captive portal's page still falls back.

**Verified**

- Server: `npm test` (509 pass) and `npm run test:int` for `sessionLifetime.int.test.js` (16/16, the whole
  HTTP contract, old tokens, the race, the cap, sign-out, bull board). After round 2, the eleven suites
  that touch accounts and sign-in (session lifetime and invalidation, account deletion, user management,
  mail, support access, static pages and the rest): 142 pass, 0 fail. The full integration marathon after
  round 1: 1,446 pass, 1 fail — `fbtimeDoorRoutes.int.test.js` "two first connects at once", which fails
  on unchanged HEAD too (1 in 6 runs there): it relies on a unique index that the test never waits to be
  built. Pre-existing and unrelated. Round 2's regression reviewer ran it again before the round-2 fixes:
  1,447 pass, 0 fail; round 3's ran it on the round-2 state, and round 4's on the round-3 state: 1,446
  pass and the same known flake each time. Rounds 3 and 4 changed no server code.
- Phone: `npm run test:mobile` (232 pass, including the session-store and session-end cases: every race
  the reviews reproduced, the bounded window, and the roster rules in `seatedRoster.test.js`). Every
  changed file parses with the project's Babel config (30 files); every local import names a real export.
  After round 4, the review harnesses replayed round 4's scenarios too: a retry with a door screen open
  fetches the map's campaign; a retry that fails again shows the real error; a download that failed after
  the person moved on is not retried, and the new campaign's houses show at once. The review harnesses
  (real React and react-query 5.100.6, the real roster module, network and storage stubbed) replayed every
  round-3 roster scenario on the fix: a download still running for the previous campaign is followed by
  this campaign's; this campaign's own failure shows after one retry with no loop; the previous campaign's
  failure never shows; a cancelled refresh shows no row; two mounted screens make 2 fetches, not a loop.
  After round 5, its scenarios too: no stray download after a door write, a Refresh or a newer fetch
  cancels the one waiting to retry; on a cold start Doorline's 404 and 403 show their error while no
  signal, an expired sign-in and a captive portal's page show the saved houses.
- Web: `npm test` (614 pass, including the parity test, which now also compares the window rule) and a
  full `vite build`. The review harness (the real provider, request layer and prompt under jsdom) replayed
  every web scenario of rounds 2, 3 and 4 on the fix, including the next person seeing none of the last
  person's cached pages after a sign-in on the same tab.
- **Real browser runs** (headless Chrome against a throwaway API and database, `JWT_EXPIRES_IN` per case):
  65 of 65 checks after review round 5, as after rounds 3 and 4. Round 3's new ones: a different person signing in elsewhere while
  a tab sits on the landing page — the tab forgets the first person at once (a build without the fix
  keeps showing "Go to dashboard" for them), and going into the console loads the person actually
  signed in; and the Team header stays one line inside its row without touching "Last door". 59 of 59
  after review round 2. The new ones then: a prompt left behind on the landing page while the
  same person signs in elsewhere settles, so a later sign-out in another tab still signs this tab out —
  that check fails on a build without the round-2 fixes and passes with either fix alone; and the Team
  header is one line at the new width (two lines at the old one). After review round 1, 48 of 48 —
  including a password reset finishing in another tab while the prompt is up (the prompt stays, the edit
  survives, and every org request afterwards carries the tab's own org), three tabs loading together on a
  day-old sign-in (all stay signed in), and a Save made with a dead token completing after the password.
  Earlier, 35 of 35 — a cold-opened expired tab asks in place and keeps its deep link and org; Escape
  can't close the prompt and the page underneath is inert; a wrong password shows inline; unsaved edits
  survive a mid-session expiry; a password changed elsewhere lands on the sign-in page with its note; an
  old token in a used tab is extended with the same session and sign-in time; a second tab opened on the
  same expired sign-in doesn't sign out the first, and signing in there continues both, edits intact; a
  database outage at page load shows "Couldn't reach Doorline." and keeps the sign-in.
- **Not verified on a phone.** The phone code is unit-tested, parse-checked and import-checked, but no device
  or simulator run was made in this session. §H's phone runs (mid-survey expiry, Later in airplane mode,
  Android Back, an admin sheet open at expiry, extension after a minute) are owed before
  `npm run ota:production`, plus round 2's: Forgot password? after a long Later keeps the houses, and a
  campaign opened from the admin side shows its own houses when its first fetch fails.
- **Owner check before the deploy:** in the Heroku dashboard, **Settings → Config Vars**, confirm
  `JWT_EXPIRES_IN` is unset or `30d`. Every "30 days idle" sentence in the docs assumes it; a value without
  a unit is read as milliseconds.

