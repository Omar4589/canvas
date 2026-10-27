# Proposal: Delete a member's account — for org admins and super admins

> **Status: BUILT 2026-10-24 (uncommitted), from revision 7 of this plan. Not yet deployed.** The server,
> the web profile, the phone's admin profile, the eight name lookups, the email-log scrub and its backfill,
> the 15-minute sweep, docs, Help Center and PRIVACY_VERIFICATION item 37 are in the working tree. §E2 (the
> phone clean-up of a deleted account's unsent doors) is not built and ships after Election Day. Release
> steps: §I2.
>
> **Later (2026-10-27, [PROPOSAL_PEOPLE_PAGES.md](PROPOSAL_PEOPLE_PAGES.md)):** on the web, the profile
> (`UserProfileModal.jsx`) was replaced by the person panel the Users and Team pages share. **More
> options ▸** now sits at the end of the panel's state buttons, and Delete account… is inside it, with the
> same reminder and the same two confirmations (`DeleteMemberDialog`). The phone's path is unchanged. Where
> this plan says *Account → More options* on the web, read *More options ▸* in the panel.
>
> **As built, where it differs from the text below:**
> - Desk marks (`via: 'bulk'`) are left out of the ledger orgs that widen the name record (step 6) and out
>   of `fieldRecordsHere`, the same rule as `orgCarriesUser`: their `userId` is whoever pressed the button.
> - The sweep also stamps a pre-lock record of a deleted account as finished, which makes it unclaimable
>   for good, and it reads recent deletions for the email re-scrub from the name records, not by scanning users.
> - A gate write that errors but landed finishes the deletion at once instead of leaving it to the sweep.
> - The 15-minute job writes no `RetentionRun` of its own; the nightly purge runs the same sweep first and
>   records its counts and failures on its run.
> - `hydrateCanvassers` restores no name at all when handed no org (fail closed).
> - The leak fix and the staff-roster fix (§I1) were committed in `aa01027`.
> - **Web Escape:** the profile's Escape listener sits on `document` in the capture phase. The passive-
>   cleanup ref alone (§D) failed in React 18: React clears it before a bubbling `window` listener runs,
>   so Escape in the dialog closed the profile too (reproduced in Chrome). The ref and pending guards stay.
> - **Phone success:** `InteractionManager.runAfterInteractions` is a stub in React Native 0.81, so the
>   queries are invalidated right after `router.back()`; the frozen member ref is what keeps the screen
>   from drawing "User not found" mid-pop.
> - **A refusal at the final delete** (`BLOCKED` or `USAGE_CHANGED`) sends both clients back to a
>   reloaded review, which then lists any reasons with only Close.
> - **The no-work review of a USED account** (signed in, or a crew coordinator who never knocked) says
>   "Their email, phone and password are erased … Doorline keeps their name privately for 180 days." The
>   mockup's "Their name, email, phone and password are erased" is kept for an unused account only,
>   which is the one whose name really goes. The sync-first line shows for any used account (§D), not an
>   unused one, which has no phone to ask about.
> - Web and phone build the review from `client/src/lib/memberDeletion.js` and
>   `mobile/lib/memberDeletion.js`; `client/src/lib/memberDeletion.parity.test.js` holds them word for word.
> - **Code review (2026-10-24), every finding fixed and pinned by a test that fails on the code before it:**
>   - a gate write that landed but errored, followed by a failed re-read, released the lock and stranded a
>     half-finished deletion: the undo now re-reads FIRST and finishes a dead account instead;
>   - the sweep could act on a stale snapshot of a lock a fresh attempt had since claimed (re-activating a
>     deleted account's membership, or stranding an org): it now takes the lock by token before acting;
>   - a takeover of a crashed attempt reset its list of switched-off memberships before restoring them: the
>     list now stays on the record until they are back on;
>   - the org door's recount could add another org's LAST_ADMIN beside OTHER_ORGANIZATION: the cross-org
>     refusal now comes alone, before any recount;
>   - a record with no userId would have scrubbed every evidence row with no userId: the scrub and the
>     sweep refuse anything without a valid id;
>   - one malformed record failed the whole nightly purge: ids are filtered and the sweep is wrapped;
>   - Remove from org, a demotion or Deactivate racing a deletion could still reach zero admins: all three
>     re-count LIVE admins after their write (`LAST_ADMIN`), like the billing backstop;
>   - the late-mail re-scrub now reads only rows sent from an hour before the deletion (the sentAt index).
> - **Client review (2026-10-24), fixed the same way:** the web's first "Delete account…" could hang on
>   "Checking…" (react-query re-rendered the profile only for result props it had read; the dialog now owns
>   its stats subscription); a double click or Enter-plus-click could send two DELETEs or close mid-delete
>   (a synchronous ref on both); a lost answer left a live-looking row (ALREADY_DELETED and NOT_A_MEMBER now
>   close as after a success; no answer reloads the review); a BLOCKED whose cause had cleared came back
>   unexplained (its reasons are the note); the phone notice re-cased names and its search matched deleted
>   rows on "Deleted user".
> - **Remove from org on the phone (owner request, 2026-10-24):** the phone's profile now has it under
>   Deactivate, on the web's rule and words (`mayOfferRemove`, `removeConfirm`), so the review's "Usually you
>   want Remove from org instead" points at something the phone has. A deleted row offers it too, as on the web.
>
> **Earlier status (revision 7, 2026-10-24), before the build:**
>
> - **The cross-organization leak this review found is FIXED** (owner decision 2026-10-24). It is
>   uncommitted and ready to ship on its own (§I1), recorded as PRIVACY_VERIFICATION item 35. Round 4
>   widened it to cover team leads inside their own organization too, the same wall the Users list
>   keeps.
> - **The staff-roster gap round 4 found (R4B-3) is FIXED too** (owner go-ahead 2026-10-24): a
>   customer's admin or lead could put a Doorline staff account on a book or a crew and read its
>   contact details back. It ships in the same patch (§I1), recorded as PRIVACY_VERIFICATION item 36.
> - **The phone clean-up of a deleted account's unsent doors (§E2) ships after Election Day** (owner
>   decision 2026-10-24).
> - **Round 4** (three reviewers): the leak fix's code review found no blocker. The deletion model held
>   under every race and crash the reviewers built, except one narrow interleaving (R4A-1), now fixed.
>   The plan's own staging recipe and the leak fix's commit route were fixed (§L round 4).
> - **Open owner decisions (§K):** 2 (email-log scope), 3 (switched-off memberships elsewhere), 5 (ship
>   timing relative to Election Day), and the DPA §5 notice question from 4, for counsel. **All
>   decided 2026-10-24:** the email log is scrubbed by account only; switched-off memberships elsewhere
>   block; admin deletion may ship before Election Day, with §E2 after it; no counsel referral and no
>   DPA §5 notice (§K).
>
> **Earlier status (revision 5, 2026-10-23): three review rounds are done.** Nine
> reviewers, most of them running the real code on a throwaway database, filed 118 findings between
> them. Every one is listed with what was done about it in [§L](#l-review-log).
>
> - Round 3 still found 4 distinct blockers. Two were in revision 4's new pieces: an email scrub that
>   could rewrite other people's rows, and a race that could still delete an org's last admin. One was
>   the phone ordering, found by three reviewers independently. The fourth is an **existing
>   cross-organization leak of personal data** (§C8, §K decision 4), found while checking the lookups
>   this plan edits.
> - Revision 5 fixes all four and simplifies the two areas where complexity kept producing bugs. Four
>   decisions are the owner's to make (§K).
> - Checked against HEAD `48be323`; no code has changed. This build will also edit
>   `docs/PRIVACY_VERIFICATION.md`, `docs/PLATFORM.md`, `docs/SURVEYS.md` and `docs/README.md`, which
>   hold other sessions' uncommitted changes (§I).

Related: [USERS.md](USERS.md) (*When someone leaves*, *Deleting an account from the console*, Part 2
*Account deletion*), [ROLES.md](ROLES.md), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (§A,
account deletion), [ADMIN_APP.md](ADMIN_APP.md), [CANVASSER_APP.md](CANVASSER_APP.md),
[PLATFORM.md](PLATFORM.md), [EMAIL.md](EMAIL.md), [BILLING.md](BILLING.md), [AUDIT.md](AUDIT.md).

# Part 1 — For everyone

## What's true today

- **An org admin can't delete an account.**
  - On the web, a person's profile has Set temporary password, Resend invite (only if they never
    signed in), Deactivate and Remove from org.
  - On the phone, it has Set temporary password, Resend invite, Deactivate, and the profile, role and
    campaign editors. It has no Remove from org.
  - Nothing deletes the account itself.
- **A super admin can, but only from the platform console, and only with break-glass authority:**
  Super admin → All users → the person → **Delete account…**, then type their email.
- **People can delete their own account** from the phone (Profile → Delete account). That needs them
  to sign in, so it doesn't help with an account nobody used, or with someone who has left.

Removing someone from your organization isn't deleting them. The account stays in Doorline with
their name, email and phone. An unused invite keeps working until it expires (72 hours), and the
email stays taken, so adding it again later re-links the same old account.

## What changes

A **Delete account** option on a person's profile, on the web and on the phone, for **admins**.
Doorline super admins get it in some cases (see *Super admins* below). **Team leads never get it.**

### It's hard to do by accident

1. **It's tucked away.** Open the person's profile, then **More options** at the bottom of the
   Account section. **Delete account** is in there, next to a reminder that **Remove from org** is
   usually what you want.
   - On the phone: Users → the person (from a campaign's list, tap **Manage profile ›** first) →
     Account → More options.
2. **First confirmation: a review.** It names the person (name, role, email) and spells out what
   deleting them means, worked out from their own records:
   - how many door results and surveys stay on your reports;
   - which books come back and which stay with the other canvassers on them;
   - whether they lead a crew;
   - what to do about doors still on their phone.

   Choose **Continue** or **Cancel**.
3. **Second confirmation: type their email.** **Delete permanently** stays grey until the email you
   type matches theirs. Going back a step clears what you typed.

### Which accounts you can delete

Any account that **belongs only to your organization**:

- **It's not your own.** To delete yourself, use Profile → Delete account on the phone.
- **It's not a Doorline staff account.**
- **They're not in any other organization**, active or switched off. "Switched off" counting too is
  the owner's decision (§K decision 3). If they are, the review says so without
  naming the organization, and points you to **Remove from org**. An organization they *used to* work
  for doesn't stop you. It keeps their name on its records for 180 days, the same as yours (below).
- **People with billing access are protected.** Only an admin who also has billing access can delete
  them, or remove them from the organization. Today, any admin can remove them. If you don't have
  billing access, the options don't show on their profile.
- **The demo's app-review logins can't delete anyone.**
- **The existing rules still apply:** not the only admin, not the only billing admin, not a protected
  app-review account.

### What deleting does

**For everyone:**

- **Their login and contact details are erased now:** email, phone, password, and the name on the
  account itself. They can never sign in again, and nobody can restore the account.
- Any invite or password link we emailed stops working.
- They come off every campaign, effort crew and team-lead grant. Books only they were on go back to
  unassigned; shared books stay with the other canvassers on them.
- Their email address is freed. If they come back, they get a **new** account, and their past work
  stays with the deleted one.
- The emails we sent them personally (invites, password resets, added-to notices) no longer show
  their address in Doorline's send log. Deletion warnings and staff-access notices that went to them
  as a billing admin keep it, as evidence: the warnings for good, the staff-access notices for a year.
  That is the owner's decision (§K decision 2).

**If they did work here** (door results, surveys, FbTime hours):

- **Nothing on your reports or your bill changes.** Every door result and survey stays.
- **Doorline keeps their name privately for 180 days**, so it still shows on these screens, then
  they show as **Deleted user**:
  - canvasser reports on the web and the phone;
  - team labels and by-team totals;
  - the GPS audit;
  - Survey Results downloads and every other export.

  This holds even if you deactivated them first. Any organization where they recorded doors or
  surveys before gets the same.
- **Other screens show "Deleted user" right away:** the map, a door's history, survey details, and
  other detail screens. They read the account directly, and a separate fix will bring them in line.
- **If they lead a crew**, those people have no crew coordinator until you pick one. The team keeps
  its numbers, and its name for the same 180 days. If you'll keep reporting by that team to a client,
  use **Remove from org** instead: it keeps the name for good.
- **Doors still on their phone.** The review always asks you to have them open the app with signal
  first, so their phone sends everything it's holding. It warns more strongly if their phone sent
  doors in the last week. Until the phone fix lands after Election Day, anything left on the phone
  goes up under whoever signs in on it next. If they're switched off (deactivated), their phone can't
  send anything: whatever it already tried to send while switched off was refused and thrown away.
  Switch them back on first if the doors it still holds matter (once billing is sorted, if it's
  paused).
- **Their row stays in your Users list** as **Deleted account**, with who deleted it and when
  ("Deleted Oct 23, 2026 by Alex Kim"). On the web it keeps one action, **Remove from org**, which
  tidies the row away without changing anything on your reports.

**If nobody used it** (never signed in, nothing on your records under their name, never a crew
coordinator): they disappear from your Users list completely. Accounts made before mid-May 2026
always keep a **Deleted account** row, because Doorline only started recording sign-ins then.

### Most of the time, "Remove from org" is what you want

Remove from org ends a person's access and keeps everything your records need, including their name
on reports and on a team. Delete when the person asked to be deleted, or when the account shouldn't
exist at all: a test account, a duplicate, one made with the wrong email, or someone hired who never
started.

## Billing paused

While your organization is read-only (billing paused, ended, or a trial that ran out), you can still
delete an account and switch someone's access off with **Deactivate** or **Remove from org**. Today
all three are refused with every other change. Turning access back on still waits for billing.

## Super admins

**Inside an organization** (the web Users page, or the phone's admin Users screen), it depends on how
the super admin is there:

| How the super admin is there | What they can delete |
|---|---|
| As one of the organization's own admins | The same as any admin. |
| As a member in some other role | Nothing; the review says why. |
| In Doorline's own organizations (the demo), without a membership | Like any admin. |
| Under a support grant, support level | Unused accounts only. |
| Under a support grant, break-glass | Any account the rules allow. |

Every deletion under a grant is recorded in the support-access log, naming the account.

**The platform page** (All users → the person → Delete account…) works as it does now: break-glass
only, and it can delete any account, including one in several organizations. Its warnings now name
the person, instead of "You are the only admin of…", which was written for people deleting
themselves.

## What you'll see

**Web: the person's profile → Account → More options**

```
 ACCOUNT
 [Set temporary password] [Deactivate membership] [Remove from org]
 More options ▸

 ── after "More options" ──────────────────────────────────────────────────
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Delete account                                                       │
 │ Permanently deletes Sam's Doorline account. Usually you want         │
 │ Remove from org instead: it ends their access and keeps their name   │
 │ on your records.                                  [ Delete account… ] │
 └──────────────────────────────────────────────────────────────────────┘
```

**First confirmation: the review (someone who did work here)**

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Delete Sam Rivera's account?            Canvasser · sam@example.com  │
 │                                                                      │
 │ ┌ Sam's phone sent doors 2 hours ago. Ask them to open the app with ┐│
 │ │ signal first, so it sends everything it's still holding.          ││
 │ └───────────────────────────────────────────────────────────────────┘│
 │  · Their 1,284 door results and 312 surveys stay. Nothing on your    │
 │    reports or your bill changes.                                     │
 │  · Their login and contact details are erased now. Doorline keeps    │
 │    their name privately for 180 days, so it still shows on canvasser │
 │    reports, team labels, the GPS audit and exports; then it shows    │
 │    "Deleted user". The map and door history show "Deleted user"      │
 │    right away.                                                       │
 │  · They coordinate a crew of 6 on 2 campaigns. Those people will     │
 │    have no coordinator until you set one.                            │
 │  · 2 books go back to unassigned; 1 stays with the other canvassers  │
 │    on it. They come off 2 campaigns.                                 │
 │  · If they come back, they'll need a new account.                    │
 │                                                                      │
 │ Usually you want Remove from org instead.                            │
 │ [ Continue ]  [ Cancel ]                                             │
 └──────────────────────────────────────────────────────────────────────┘
```

**First confirmation: the review (no work here)**

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Delete Jordan Lee's account?          Canvasser · jordan@example.com │
 │ Jordan has no door results or surveys on your records.               │
 │  · Their name, email, phone and password are erased, and any invite  │
 │    we emailed stops working.                                         │
 │  · They come off 1 campaign; 2 books go back to unassigned.          │
 │  · jordan@example.com is freed, so you can add it again as a new     │
 │    account.                                                          │
 │  · They disappear from your Users list.                              │
 │ [ Continue ]  [ Cancel ]                                             │
 └──────────────────────────────────────────────────────────────────────┘
```

Two lines change with circumstances:

- If they have signed in, coordinate a crew, or the account is from before mid-May 2026, the last
  line reads "Their row stays as Deleted account".
- For a crew coordinator, the crew line replaces "no door results or surveys".

**Second confirmation**

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Delete Sam Rivera's account permanently?                             │
 │ This can't be undone.                                                │
 │ Type sam@example.com to confirm                                      │
 │ [                                      ]                             │
 │ [ Delete permanently ]  [ Back ]                                     │
 └──────────────────────────────────────────────────────────────────────┘
```

**When it can't be deleted**, the review lists the reasons instead and offers only **Close**. Each
reason says what to do:

- another organization → Remove from org;
- billing access → ask an admin who has billing access;
- the only admin → make someone else an admin first.

# Part 2 — Technical reference

## A. What the design rests on (checked at `48be323`)

Rows marked **[run]** were reproduced on a throwaway mongod (MongoDB 7.0.2, Mongoose 8.23.1) by a
reviewer in rounds 1 to 3; **[http]** ones ran against the real app over HTTP.

| # | Fact | Where |
|---|---|---|
| 1 | No admin route deletes an account. `deleteAccount()` has three callers: self, break-glass staff, the CLI. Tokens are minted only at login (`auth.js:155`) and by two routes that need a session already. | [auth.js:155, :257, :315, :430](../server/src/routes/auth.js), [superAdmin/users.js:363](../server/src/routes/superAdmin/users.js), [deleteAccountByEmail.js:86](../server/src/utils/deleteAccountByEmail.js) |
| 2 | **[run]** Today two deletions of one user both succeed, and concurrent deletions can leave an org with no admin. `deleteAccount` has no post-write recount. `strandsBilling` is true for any org with no billing admin, a legitimate state, so callers first check that the touched row was a billing admin. | [deleteAccount.js:179-269](../server/src/services/users/deleteAccount.js), [billingGuards.js:51-73](../server/src/services/memberships/billingGuards.js), [leadCrew.js:509-513](../server/src/routes/admin/leadCrew.js) |
| 3 | **[run]** `checkDeletionBlockers` names other orgs, with name and id, where the person would be the last admin or last billing admin. | [deleteAccount.js:108-146](../server/src/services/users/deleteAccount.js) |
| 4 | The profile's `GET /:userId/stats` gives this org's counts, and both clients load it. `doorsKnocked` includes lit drops and excludes restricted doors (returned separately) and admin bulk marks; it is not the billable figure. `lastActivityAt` is the newest row the **server** has. | [memberships.js:832-940](../server/src/routes/admin/memberships.js) |
| 5 | **[run]** The name record's `organizationIds` holds only orgs where the membership was active at deletion, on every path. The privacy record, FBTIME_INTEGRATION.md:1032 and `purgePairing.js:19` all state this. | [deleteAccount.js:108, :190](../server/src/services/users/deleteAccount.js) |
| 6 | **[run]** About 30 callers restore a deleted person's name (`hydrateCanvassers`). Eight lookups on promised screens don't: `flagDetection.js:78`; `reports.js:290`, `:2223`, `:2373`, `:3674`/`:3869-3873`, `:3111`, `:1660` and `:324`. About 45 more lookups (`.populate()` and plain `User.find`) do the same, among them `reports.js:1368`, `:1587`, `:1880`, `:1932`, `:2994` and `:4977`, plus the map and door history. | [flagDetection.js](../server/src/services/audit/flagDetection.js), [reports.js](../server/src/routes/admin/reports.js) |
| 7 | **The offline queue is not tied to a person.** After any sign-in it sends every item under whoever signed in (`login.jsx:100`). A 401 holds items; another 4xx drops them. `api()` reports a session end synchronously, before the failed save is queued, and the phone defers sign-out while on door screens. | [offlineQueue.js:79-124, :186-199](../mobile/lib/offlineQueue.js), [api.js:136-160](../mobile/lib/api.js), [SessionGate.jsx:16-24, :115](../mobile/components/SessionGate.jsx) |
| 8 | **[run]** Eleven writes can land on a deleted account, because they read `deletedAt` and then write, or never check it: `PATCH /admin/memberships/:userId` (revives a membership); `/reactivate`; the crew `/reactivate`; the crew add's inline reactivation; `createOrgMember`'s link; `PATCH /:userId/user`; `PATCH /:userId/password`; `PATCH /auth/me`; `POST /auth/change-password`; `issuePasswordResetToken`; and the login and `lastSeenAt` stamps. | [memberships.js](../server/src/routes/admin/memberships.js), [leadCrew.js:231-245, :544-562](../server/src/routes/admin/leadCrew.js), [createMember.js:141](../server/src/services/memberships/createMember.js), [auth.js](../server/src/routes/auth.js), [passwordReset.js:31](../server/src/services/auth/passwordReset.js), [middleware/auth.js:96-101](../server/src/middleware/auth.js) |
| 9 | **[run]** A `$ne` org probe picked the `organizationId_1` index and read 100,000 other-org docs; a filter on `{ userId }` alone uses a `userId` index. A hint naming a missing index throws. No index on `CanvassActivity.coordinatorId`, `EmailLog.to` or `EmailLog.userId`. | the models |
| 10 | `lastLoginAt` (commit 2026-05-07) is the "Last password login" admins already see. `lastSeenAt` is **super-admin-only by locked decision**. | [User.js:68-91](../server/src/models/User.js) |
| 11 | `isOrgAdmin` is true for every super admin. `orgContext` resolves membership, then the internal-org carve-out (non-members), then a support grant. **[http]** A non-billing admin can clear a billing admin's flag by Remove from org, then re-add. | [campaignManagement.js:13-15](../server/src/services/authz/campaignManagement.js), [orgContext.js:77-100](../server/src/middleware/orgContext.js), [memberships.js:312, :466-469, :548-583](../server/src/routes/admin/memberships.js) |
| 12 | A deleted account's memberships stay, deactivated, and keep `billingAccess`; the list returns them with `user.isDeleted`. Both clients still offer actions on those rows. | [deleteAccount.js:231](../server/src/services/users/deleteAccount.js), [memberships.js:301](../server/src/routes/admin/memberships.js) |
| 13 | **[run]** `EmailLog` rows for personal mail store the recipient's `userId`. Warning and support-notice rows don't, and the two warning kinds are kept forever as evidence. Addresses get reused (re-adding someone after deletion, an email fix), so **matching rows by address rewrites other people's rows**. | [EmailLog.js:9-12, :27, :51](../server/src/models/EmailLog.js), [mailer.js:39, :162-190](../server/src/services/mail/mailer.js), [resendWebhook.js:95-109](../server/src/routes/public/resendWebhook.js) |
| 14 | **[run]** In a read-only org, Deactivate, Remove and crew Deactivate return 402. Only export creation is carved out, and that is pinned in the privacy record and BILLING.md. | [entitlement.js:6, :45-81](../server/src/middleware/entitlement.js) |
| 15 | The demo org holds both stores' review logins (admins, `deletionLocked`) and the disposable review canvassers. **Staging builds talk to production.** | [seedDemoOrg.js:906-922](../server/src/services/platform/seedDemoOrg.js), [eas.json:33-36](../mobile/eas.json) |
| 16 | **[run]** The nightly purge picks name records by `retentionUntil` only. It then de-pairs FbTime, deleting links and de-personing shifts, and never checks that the account was deleted. | [purgeDeletedIdentities.js:47-58](../server/src/services/retention/purgeDeletedIdentities.js), [purgePairing.js:38-42](../server/src/services/fbtime/purgePairing.js) |
| 17 | **[http] Existing cross-organization leak (fixed separately 2026-10-24; HEAD line numbers).** `GET /admin/reports/canvassers/:userId/summary` returned any account's name, email, phone, active flag and last sign-in, and `/responses` its name and email, for any valid id, to any admin **or team lead** of any org. A lead could also open anyone in their own org. The canvasser CSV's `?coordinatorId=` printed any account's name. | [reports.js:320-327, :345-352, :3086-3133, :3659-3676, :3867-3876](../server/src/routes/admin/reports.js) at HEAD |

## B. The owner's answers (2026-10-23)

| # | Question | Answer | In this plan |
|---|---|---|---|
| 1 | Unused accounts only, or used ones too? | **Used ones too, if they belong only to the org**, "but make sure it's not easy to mistakenly do it: dig in to get to the option, then confirm like twice." | Part 1; §C, §D, §E |
| 2 | Support staff under a grant? | **Yes.** | Unused accounts at support level; used ones need break-glass, matching the platform page's rule, "Deleting one person should not be easier than deleting their org" (`superAdmin/users.js:340-341`). |
| 3 | Scrub the email send log? | **Yes.** | §C6. Round 3 changed how; see §K decision 2. |
| 4 | Allow while billing is paused? | **Yes.** | Read as also covering switching access off (§C5) |
| 5 | Optional privacy.html sentence? | **No.** | No legal text changes (§G) |

## C. Server

### C1. The deletion model — `services/users/deleteAccount.js`

The rule: **one deletion at a time per account; only membership changes before the account dies,
and those are undone on refusal; everything else afterwards, idempotent, keyed by `userId`, and
finished by a sweep if a crash interrupts it.**

**Before the gate:**

1. **Blockers.** The org path runs `reviewOrgDeletion` (§C2); the other paths run
   `checkDeletionBlockers(userId, { subject })`.
   - Both use one definition of "last admin" and "last billing admin": live accounts only, with the
     user's `deletedAt` checked (row 2).
   - Every refusal is thrown as `BLOCKED` with a `blockers` array, so all three routes answer 409 the
     same way.
2. **Take the account's deletion lock: the pending name record.**
   - **Insert** `DeletedUserRecord { userId, pendingAt, pendingToken, name, reason, deletedBy,
     unusedOrgId, touchedMemberships: [], finishedAt: null, organizationIds: [], deletedAt,
     retentionUntil }` with `$setOnInsert`.
     - The name is blank for an unused account.
     - `unusedOrgId` is set on the org path for an unused account.
     - `pendingAt`, `pendingToken`, `unusedOrgId`, `touchedMemberships` and `finishedAt` are schema
       fields. If they weren't, `strictQuery` would drop them from every filter, which would then
       match every record (reproduced).
   - **If a record already exists**, claim it only when it is **not finished**, and not pending or gone
     stale: `findOneAndUpdate({ userId, finishedAt: null, $or: [{ pendingAt: null }, { pendingAt: {
     $lt: now − 10 min } }] }, { $set: <the insert's shape, fresh: pendingAt, pendingToken, name, reason,
     deletedBy, unusedOrgId, touchedMemberships: [], organizationIds: [], deletedAt, retentionUntil,
     purgedAt: null> })`.
     - That covers a legacy record on a live account and a crashed earlier attempt.
     - The reset matters: a claimed legacy record would otherwise keep old `organizationIds`, and an
       organization's deletion could pull the lock out from under the attempt.
     - A finished record is never claimable. Round 4 reproduced a second attempt, which had read the
       account before the first one's gate, taking over the first one's *finished* record and then
       deleting it on refusal: the name record and the evidence of the deletion were lost.
   - **Otherwise** answer 409 `DELETION_IN_PROGRESS` (on all three routes, with copy on both clients:
     "A deletion of this account is already under way. Try again in a few minutes."). A second
     deletion of the same person, a duplicate submit or a racing self-delete can no longer run at once.
   - **Every refusal from here on** deletes the record by its `pendingToken`. Since a finished record
     can't be claimed, a refusal can only ever remove a lock its own attempt holds.
   - **Steps 2 to 5 run inside one try/catch.** Any error that isn't a refusal (a transient database
     error, say) restores the touched memberships and releases the lock before rethrowing, so a retry
     isn't locked out for ten minutes.
3. **Precompute the burned password hash** (bcrypt, about 75 ms). The window from the final re-check
   to the gate is then a single write.
4. **Memberships off, one row at a time.**
   `Membership.findOneAndUpdate({ _id, isActive: true }, { isActive: false }, { new: false })`, keeping
   the pre-images. Each touched membership's id is written onto the lock (`touchedMemberships`) as it is
   switched off, so a process that dies before the gate leaves the sweep enough to switch them back on.
   Without that, a crash mid-way through two admins deleting each other could leave both switched off.
   Then, per touched org:
   - if a touched row was an active billing admin, count the live billing admins left;
   - if a touched row was an active admin, count the live active admins left;
   - on the org path, re-check `OTHER_ORGANIZATION`.

   If any count is zero or the re-check fires, restore those rows by id, re-read `deletedAt`, release
   the lock, and refuse. Mutual deletions over-refuse about half the time (tested). They never strand
   an org: with the lock, 0 strands in 120 races.
   - **The only side effect** that can outlive a refusal: a live phone that syncs in this ~100 ms
     window gets 403 and drops what it sent (row 7). This is recorded as a residual risk (§I).

**The gate:**

5. `User.findOneAndUpdate({ _id, deletedAt: null, …(support-tier unused-only ? { lastLoginAt: null } :
   {}) }, { $set: <today's 14-field scrub, with the precomputed hash> }, { new: false })`.
   - It returns the pre-image.
   - On no match, re-read the account.
     - If it is deleted, another deletion finished first: answer `ALREADY_DELETED`.
     - Otherwise (a support-tier delete whose target just signed in), restore the memberships, release
       the lock, and answer `USAGE_CHANGED`.
   - From this write on, login, `requireAuth`, `reset-password` and every write in row 8 refuse the
     account (§C3, §C7).

**After the gate — `finishDeletion(userId, { pendingToken, preImage })`.** It is idempotent, and the
sweep calls it too.

6. **`organizationIds`:** every org with a membership in any status, plus the orgs of the person's
   own ledger rows. Those come from `aggregate([{ $match: { userId } }, { $group: { _id:
   '$organizationId' } }])` over `CanvassActivity` and `SurveyResponse`. The filter is on `userId`
   only, so no hint is needed.
7. **Memberships:** `updateMany({ userId }, { isActive: false, billingAccess: false })`, which catches
   any reactivation that slipped in and keeps tombstone rows removable (§C3). If the record has an
   `unusedOrgId`, also `deleteMany({ userId, organizationId: unusedOrgId })`.
8. `releaseAssignedWork(userId)`.
9. `FbTimePersonLink.updateMany({ userId }, { fbtimeEmail: null })`.
10. The email log for this account (§C6).
11. **The record:** `updateOne({ userId }, …, { upsert: true })` with:
    - `$set`: `finishedAt: now`; the name from the pre-image when known, but blank when the record
      carries `unusedOrgId` (read before the `$unset` below), as Part 1 promises for an unused account;
      `organizationIds`; `deletedAt` equal to `User.deletedAt`; `retentionUntil`; `purgedAt: null`.
    - `$setOnInsert`: `reason` and `deletedBy`, so that if the lock vanished, the record can never come
      back attributed to `self`.
    - `$unset`: `email`, `phone`, `pendingAt`, `pendingToken`, `unusedOrgId`, `touchedMemberships`.

    Attribution was already written by this attempt's lock claim in step 2.

**The sweep** runs every 15 minutes as its own repeatable job, and again as the first step of the
nightly `purge-deleted-identities` job (03:17 UTC).
- **Registration.** The 15-minute job goes in `MAINTENANCE_JOBS`, not `REPEATABLE_JOBS`, which must
  stay retention-only for the retention health banner.
- **Per record**, a try/catch.
- **Counts** (finished, released, live records deleted, skipped) are recorded on `RetentionRun` as
  fields declared in `RetentionRun.js`, since strict mode drops undeclared ones. Failures fold into
  `failed`, so retention health sees them.
- **Dry run.** With `apply: false` (the console dry run), it only counts.

"Deleted" here means `deletedAt` is set **or the User document doesn't exist**. Existing purge fixtures
make records with no User document, and no code hard-deletes users.

- For each record pending for more than ten minutes, re-read the account:
  - **Deleted:** run `finishDeletion`. It keeps the record's name, attribution and `unusedOrgId`.
  - **Not deleted** (the attempt died before the gate): switch back on the memberships listed in
    `touchedMemberships` that are still off, then delete the record by the `pendingToken` it read.
- It deletes any record on a live account that is neither pending nor finished (a legacy anomaly),
  conditioned on `{ _id, pendingAt: null, finishedAt: null }` so it can't race a fresh claim, and
  counts it.
- It re-runs step 10 for accounts deleted in the last seven days. That catches mail logged late:
  `mailer.js` writes the log row after the provider call, which can take seconds.

The purge itself skips, and counts, any record whose account isn't deleted.

**`reason`** is fixed by the lock claim in step 2:

| Who deleted | `reason` |
|---|---|
| The person themselves | `self` |
| The CLI | `operator` |
| The platform page; staff under a grant; staff in an internal org without a membership | `super_admin` |
| A customer admin, or a staffer acting as this org's own admin member | `org_admin` |

### C2. The org review — `reviewOrgDeletion({ userId, req })`

One function serves both the preflight and the DELETE. `usage` is computed first. The checks then
run in this order, the first refusal ends them, and each refusal is returned **as a blocker** (200,
`canDelete: false`) in the preflight.

1. **Membership here**, else 404 `NOT_A_MEMBER`. An unknown id gets the same 404. Already deleted is
   409.
2. **Who's asking.** Leads were already refused by `requireAdminRole`. Staff are resolved in
   `orgContext` order:
   - **A membership:** with role `admin`, they are this org's admin; with any other role,
     `ADMIN_ONLY`.
   - **No membership, in an internal org:** allowed.
   - **A support grant:** at support tier, unused only (`BREAK_GLASS_REQUIRED`); at break-glass, any
     account.

   A non-staff actor with `deletionLocked` gets `REVIEW_LOGIN`.
3. **`SELF`**, then **`STAFF_ACCOUNT`**.
4. **`OTHER_ORGANIZATION`.** `Membership.exists({ userId, organizationId: { $ne } })`, any status.
   When it fires, the response is that one blocker alone.
5. **`BILLING_TARGET`.** The target's membership here has `billingAccess`, and the actor is a
   customer admin without it. Copy: "Only an admin with billing access can delete this account."
6. **`checkDeletionBlockers`, restricted to this org**, phrased `'other'`. No blocker carries an
   `organizationId`.

**`usage`** (this org only):

- `signedIn` = `!!lastLoginAt`.
- `fieldRecordsHere`: this org appears in step 6's ledger aggregate.
- `fbtimeHours`: `FbTimeShift.exists({ organizationId, userId })`.
- `crew`: `{ people, campaigns }` from `CampaignAssignment` (`coordinatorId` over the org's campaign
  ids).
- `wasCoordinator`: `crew.people > 0`, or `CoordinatorChange.exists({ organizationId, fromCoordinatorId
  })`, or `CoordinatorChange.exists({ organizationId, toCoordinatorId })`, or `Membership.exists({
  organizationId, coordinatorId })`. Each is a separate query.

**`kind`** is `'unused'` only when the account was created on or after `CLOCKS_RELIABLE_FROM`
(2026-05-15, a week after `lastLoginAt`'s commit; the build confirms in the Heroku dashboard →
Activity that the release carrying `95f6b9d` was live by then) and every `usage` value is false/zero.
Otherwise it is `'used'`.

**`holding`** counts what the person holds here:

- campaigns;
- active-round books, split into those only they are on and those shared;
- effort crews;
- lead grants;
- `membershipActive`;
- `retained: { days }`.

### C3. Routes and guards

```
GET    /admin/memberships/:userId/deletion-check   requireAdminRole
DELETE /admin/memberships/:userId/account          requireAdminRole   body { confirmEmail, expectKind }
```

**Guard order.** `requireAdminRole`, then `ensureOrgScoped`, `isValidObjectId`,
`refuseVendorStaffTarget`, then `reviewOrgDeletion`. Both routes call `addAuditSubjects(res, 'user',
userId)`.

**GET** returns `{ canDelete, blockers, confirmEmail, kind, usage, holding }`, or blockers only when
`OTHER_ORGANIZATION` fires.

**DELETE** checks, in order:

1. Any blocker → 409 `BLOCKED`.
2. `confirmEmail` must match, case-insensitive (400).
3. `kind !== expectKind` → 409 `USAGE_CHANGED`.
4. Then `deleteAccount` → 200 `{ deletedAt, kind, released }`.

**Tombstone rows in `GET /admin/memberships`** carry `deletion: { at, how, byName }`, read lean:

| `reason` | `how` | Shown as |
|---|---|---|
| `self` | `self` | "Deleted their own account" |
| `org_admin` | `admin` | "Deleted by Alex Kim", but only when that admin has a membership (any status) in the organization viewing the row. Otherwise, as for a link that raced the deletion into another org, "Deleted by an admin". |
| `super_admin`, `operator` | `support` | "Deleted through Doorline support" |
| missing | `unknown` | "Deleted on <date>" |
| no record, or still pending | — | "Deleted account" |

**No write lands on a deleted account.** Each of the eleven writers in row 8 is made safe one of
three ways:

- **Conditional on `deletedAt: null`:** the login and `lastSeenAt` stamps, `PATCH /auth/me`,
  `POST /auth/change-password` and `issuePasswordResetToken`. On no match, the self routes answer 401
  (reason `deleted`).
- **Conditional, answering 409 `ACCOUNT_DELETED`:** `PATCH /:userId/user` and `/:userId/password`.
- **Re-read `deletedAt` after the route's LAST write and, if it is set, converge (409):** `PATCH
  /admin/memberships/:userId`, `/reactivate`, the crew `/reactivate`, the crew add's reactivation and
  roster upsert, and `createOrgMember`'s link insert. `PATCH /admin/memberships/:userId` also gains a
  deleted-account 409 before any billing or role logic.
  - **"Converge" means:** `Membership.updateOne({ _id }, { $set: { isActive: false, billingAccess:
    false } })`, plus `CampaignManager.deleteMany({ userId, organizationId })` and the roster row the
    write added. Never restore the pre-write snapshot: round 4 reproduced a snapshot restore bringing
    back exactly the active admin and billing flag that the deletion's step 7 had just removed.
  - **"After the LAST write"** includes `PATCH`'s grant reconciliation, which runs after its save.

The lock and the precomputed hash keep the window these re-checks cover to milliseconds.

**Remove from org** of a membership with `billingAccess` needs billing access (or staff): 403
`BILLING_ACCESS_REQUIRED`. Without this, Remove followed by re-add clears the flag.

- A **deleted** account's row is exempt. Accounts deleted before this ships never had the flag
  cleared, and anyone should be able to tidy a tombstone row.
- The web hides Remove and Delete on live billing-access rows for viewers without billing access.
- The existing assertion at `billingAccess.int.test.js:261-263`, where a non-billing admin removes the
  last billing admin and expects 409, is rewritten with a staff actor. That actor needs a
  `SupportAccessGrant` fixture or a staff admin membership in that org; without one, `orgContext`
  answers 403 `SUPPORT_ACCESS_REQUIRED` first.

### C4. Platform route — `routes/superAdmin/users.js`

- `'other'` phrasing.
- Ids instead of the email in the `[user-delete]` log line.
- The platform page shows a name record only when the account is deleted, never a pending one
  (`userOversight.js:56`).
- Otherwise unchanged.

### C5. Paused organizations — `middleware/entitlement.js`

**Carve-outs.** Method-and-path exact, anchored at both ends, with 24-hex ids:

- `^/api/admin/memberships/<id>/account$` (DELETE)
- `^/api/admin/memberships/<id>$` (DELETE)
- `^/api/admin/memberships/<id>/deactivate$` (PATCH)
- `^/api/admin/campaigns/<id>/crew/<id>/deactivate$` (PATCH)

Everything else stays 402, including `PATCH /:userId`, both `/reactivate`s and `/api/mobile/...`
lookalikes.

**Stamps:**

- The three privacy-record passages that pin "exports only".
- The `entitlement.js` comment.
- BILLING.md rule 4.

### C6. The email send log

**Decided (§K decision 2, 2026-10-24): this account's own rows only, by account id.** In step 10 and in the
backfill:

- Rows whose `userId` is this account get `to: [<tombstone address>]`, and `error` and
  `deliveryDetail` set to null.
- Every personal mail (invite, reset, welcome, added-to notices) stores the recipient's `userId`, and
  has that one recipient. So this is exact: it covers an earlier address after an email fix, and it
  never touches anyone else's row.
- The resend webhook stores `deliveryDetail: null` when a row's `to` holds a
  `@deleted.doorline.invalid` address, so a late bounce doesn't write it back.
- **Residual, stated in §G:** deletion-warning and support-grant notice rows (no `userId`) keep the
  recipient's address. They are the evidence that warnings went out.

**The alternative (not chosen)**, also scrubbing those rows by address, needs every guard round 3 found:

- only rows whose `userId` is null or this account;
- never an address a live account now holds;
- in the backfill, only rows sent before the account's deletion;
- the backfill processed in `deletedAt` order;
- and it can't be undone.

**The backfill, `npm run migrate:scrub-deleted-email-log`** (proxied in the root `package.json` with
a trailing `--`):

- A dry run by default, which reports counts per category; `-- --apply` writes.
- One pass over the deleted accounts' rows.

### C7. Session stamps

The login and `lastSeenAt` stamps move into one small exported helper, filtered on `{ _id, deletedAt:
null }`. The race test calls it directly, since both stamps are fire-and-forget.

### C8. Names, and the existing cross-organization leak

**The leak fix (row 17) is DONE (2026-10-24), uncommitted, and ready to ship on its own.** It was
built ahead of the rest, per §K decision 4, recorded as PRIVACY_VERIFICATION item 35 and in ROLES.md,
and reviewed in round 4 (§L). It must be committed before this feature is built, because the build
edits the same files. As built:

- **Checked on the report router's `:userId` param**, not per route. All ten `/canvassers/:userId/*`
  drills (and any future one) answer anyone the request may not see with the same 404 as an id that
  doesn't exist. The other eight leaked nothing beyond an empty result, but the param-level check
  makes the rule impossible to miss on the next drill.
- **An org admin** (super admins included): `orgCarriesUser(userId, orgId)` in
  `services/reports/canvasserIdentity.js`.
  - It passes on a membership here in any status, or the person's own knocks (desk marks excluded) or
    surveys on this org's ledger.
  - The ledger half runs `distinct('organizationId', { userId, …NOT_BULK })` and compares the org in
    code, so only a userId-prefixed index fits.
  - Desk marks are excluded because their `userId` is whoever pressed the button, which can be
    Doorline staff under a grant.
- **A team lead**: `campaignsCarryUser(userId, managedCampaignIds)`. It passes for someone rostered on,
  granted, coordinating, or with their own work on any campaign the lead manages: the Users list's
  wall. Round 4 found leads could otherwise open anyone in their org, admins included, against the
  Help Center's description of the role.
- **The crew stamp.** `crewStampLabel(raw, req)` names a coordinator only when the same check passes,
  or when they are stamped on this export's scope, so a departed crew lead still prints as a person.
  Otherwise it prints "unknown coordinator".
- **`/summary` returns `lastLoginAt` only for a current member.**
- **Pinned by** `server/test/reportsUserScope.int.test.js` (6 tests; 5 fail on the old code). It and
  15 related report, crew and lead suites (211 tests) pass on the working tree and on HEAD plus only
  this fix.
- **Shipping it alone** (the patch route, §I): commit only these five files, leaving the other
  sessions' unfinished work unstaged.

**Names on the promised screens.** The eight lookups in row 6 switch to `hydrateCanvassers`. It
restores names from the record, scoped by `organizationIds`, and blanks a deleted person's email.

- `ledgerCoordinatorLabels` gains the org parameter at its call sites (`reports.js:1136`, `:2686`).
- There is no cross-org option. The export builders already resolve coordinator names org-scoped, so
  screens and exports agree.
- **Residual:** a coordinator removed from an org where they never knocked reads "Deleted user" on
  that org's team labels.

The other ~45 lookups are left for a follow-up proposal. It would add round 1's structural test: walk
the org routes for a deleted user whose record is live, and fail on any "Deleted user" or tombstone
address.

## D. Web

**`UserProfileModal.jsx`**

- **The toggle.** **More options ▸** is visible when `isOrgAdmin && !isSelf && !user.isDeleted &&
  !user.isSuperAdmin && !(membership.billingAccess && !viewerHasBillingAccess)`. It is closed on
  every open.
- **Escape.** The dialog uses `ui/Modal.jsx`. The profile's existing window keydown handler returns
  early when either of these holds:
  - `deleteFlowRef.current`, which the dialog sets in a `useEffect` on mount and clears in that
    effect's cleanup. A passive cleanup, so it is still set during the same keydown that closes the
    dialog.
  - A delete is pending.

  While pending, the dialog's `onClose` does nothing and its close button is hidden (a `closable`
  prop on `Modal`). The by-hand check covers three cases:
  - Escape right after a row click closes the profile;
  - Escape in the dialog closes only the dialog;
  - nothing closes mid-delete.
- **Step 1, the review.**
  - It refetches `statsQ` and fetches the preflight (`useQuery` with an abort signal, `retry:
    false`).
  - The header shows name, role and email.
  - Door results are `doorsKnocked + restricted`; also surveys.
  - The "open the app with signal" line is shown for any used canvasser, stronger when
    `lastActivityAt` is within 7 days.
  - Two variants, a deactivated line, the crew line, `retained.days`.
  - Blockers render with their remedy.
  - **Continue** waits for both queries.
- **Step 2, the confirmation.**
  - `<input type="text" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true">`,
    with no placeholder email, cleared and focused on every open.
  - Enter does nothing until the email matches. It sends `{ confirmEmail, expectKind }`.
  - On `USAGE_CHANGED` it goes back to step 1.
- **On success.** Close; invalidate; `UsersPage` shows a page-level notice (`onDeleted` prop, the
  `restampNotice` pattern).
- **Tombstone rows.** Header, deletion line, Remove from org (its confirm doesn't print the tombstone
  email); nothing else.

**`UsersPage.jsx`.** **Deleted** pill, deletion line, no email, no billing toggle.

**`SuperAdminUserDetailPage.jsx`.** Phrasing; pending records hidden.

Naming: "Deleted account" is the Users-list label; "Deleted user" is what reports show after the
window.

## E. Phone

### E1. The delete flow

- **`users/[id].jsx`.** **More options** under Deactivate.
  - It shows when `(viewerRole === 'admin' || viewerRole === 'super') && !isSelf && !user.isDeleted &&
    !user.isSuperAdmin`, with the same billing-access rule as the web. This is a display gate; the
    server decides.
  - It reveals **Delete account**, collapsed again when the screen is left.
- **New `components/DeleteMemberSheet.jsx`** (arrow function; the `DeleteAccountSheet.jsx` pattern
  with the `colors.backdrop` token and an abort signal):
  - the same two steps and the same copy;
  - a `TextInput` with `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="off"`,
    `textContentType="none"` and `keyboardType="email-address"`, cleared and given accessibility focus
    on every open;
  - while the DELETE is pending, nothing closes the sheet, Android Back included.
- **On success.**
  - Freeze the screen's render with a ref.
  - Call `router.back()`.
  - Invalidate after `InteractionManager.runAfterInteractions`.
  - The list shows the notice from a small module store it reads on focus.
- **Tombstone rows.**
  - `users.jsx` threads `isDeleted` into the user object it builds for `MemberSheet` (`:508`).
  - `MemberSheet` hides temp password, Resend invite, Assign and Reactivate.
  - `[id].jsx` shows only the header and the deletion line.

### E2. A deleted account's unsent doors (designed; ships after Election Day, per the owner 2026-10-24)

This section is the design to carry into the post-Election queue plan. **It is not part of this
build.** Until it ships, the review's sync-first line is the protection.

**What it fixes.** After an admin deletes an account, any doors still on that person's phone go up
under whoever signs in on that phone next. Round 3 showed the ordering is subtle: the phone learns of
the deletion from inside the request whose save is queued afterwards, and it defers sign-out on door
screens. So the design is:

1. **Stamp the recorder at the start.** `optimisticSubmit` takes `recordedBy =
   tokenSub(getCurrentToken())` at entry (beside `inFlightPaths.add`, `recordAction.js:332`), before
   the door-change confirm and the GPS gate, and passes it through `submitOrQueue(path, body, {
   recordedBy })`. A null `recordedBy` never matches anything.
2. **Never queue a save the server refused as deleted.** A pure `shouldQueue(err)` in `sessionEnd.js`
   returns false for 401 reason `deleted`. The save then takes the existing hard-fail path: the pin
   reverts and the canvasser sees "This account was deleted. This door wasn't saved."
3. **Clean up at sign-out, not in the handler.**
   - `authState.js` gains `setDeletedAccountCleanup(fn)`, the `setServerSignOutNotifier` pattern;
     `authState.js` can't import the queue itself.
   - `_layout.jsx` sets it to remove the queued items whose `recordedBy` is the ended token's `sub`,
     and to clear the pending colours (a new `clearAllPending()` in `recordAction.js`).
   - `sessionStore.js` `signOutSteps` runs it for reason `deleted`, after SessionGate has let in-flight
     saves settle. It writes `deletedSub` and the count into the notice.
4. **One more pass before the next sign-in sends anything.** `login.jsx` removes items recorded by
   `notice.deletedSub` just before `flushQueue()`. That catches a save that was still in flight after
   the sign-out.
5. **The notice.** A new `discardedLine(n)`: "3 saved items from this deleted account were removed
   from the phone." `signedOutNote` is unchanged, so `client/src/lib/sessionEnd.parity.test.js` still
   passes.
6. **A kill switch, if shipped before Election Day.** A `MOBILE_DELETED_QUEUE_CLEANUP` flag on
   `/api/build-status`, on by default, persisted on the phone as `MOBILE_ERROR_RECOVERY` is. "off"
   brings back today's behavior.
7. **Tests:**
   - `shouldQueue` and the notice in `sessionEnd.test.js`;
   - the cleanup decision (only reason `deleted`, only the matching `sub`) in `sessionStore.test.js`;
   - a queue-level ordering test like round 3's simulation: a save made after the first 401 is gone
     after sign-out, and nothing is sent under the next account.

**The trade this makes (the owner's call).** These doors are field work that happened. With E2 they
are thrown away: not counted, not billed. Without it, they go up counted and billed, but under the
wrong person. Shared phones are where it bites; on a personal phone, the next person to sign in is
usually the same human with a new account.

**What doesn't change:**

- items saved before the update;
- a deactivated person's refused items (dropped);
- shared-phone leftovers from an ordinary sign-out (they go up under the next sign-in).

The general fix for those, never sending under a different account, is part of the post-Election
queue plan.

## F. Docs and Help Center (same change)

**Help Center** (`server/src/content/help/`):

| File | Change |
|---|---|
| `faq/delete-an-account.md` | **New.** All frontmatter fields, `audience: admin`. Where the option is (including the phone's Manage profile step); Remove from org vs Delete; which accounts qualify; what happens to work, names (exactly which screens), teams, books and unsent doors. |
| `faq/canvasser-deleted-their-account.md` | **Rewrite**, keeping the slug, and widen to "by themselves or by an admin", with the exact list of screens. |
| `faq/delete-my-account.md` | **Rewrite** `:22`. "Deleted user on reports and the map from then on" is already false, and the name now stays on more screens and for former orgs too. |
| `faq/add-a-canvasser-account.md` | Lead audience. An **admin** can delete an account just created with a mistyped email; never do that to an existing person linked by mistake. |
| `faq/canvasser-left-the-team.md` | Add "or an admin deleted it". |
| `faq/team-door-counts.md`, `faq/move-a-canvasser-to-another-team.md` | A deleted coordinator's team. |
| `faq/who-sees-billing.md` | Billing access protects against delete and remove. |
| `guides/billing.md` | What a read-only org can still do. |
| `guides/fbtime-hours.md`, `pages/page-integrations.md` | "Deleted" now includes an admin's deletion. |
| `guides/canvasser-offline.md`, `faq/signed-out-sign-in-again.md` | With E2, after Election Day: a deleted account's unsent items are removed. |
| `faq/doorline-staff-access.md` | Optional: "Deleted through Doorline support". |

**Docs** (`docs/`):

| File | Change |
|---|---|
| `USERS.md` | Including `:1239`. |
| `ROLES.md` | Admin-only list, the staff table, the Remove rule. |
| `ADMIN_APP.md` | The phone screens. |
| `CANVASSER_APP.md` | With E2, after Election Day. |
| `AUDIT.md` | GPS audit names. |
| `METRICS.md` | Team labels. |
| `NOTES.md` | Notes by a deleted person. |
| `SURVEYS.md` | The CSV. |
| `FBTIME_INTEGRATION.md` | `:1032`; the purge guard. |
| `OPERATIONS.md` | Backfill, sweep, the staging recipe. |
| `PLATFORM.md` | The platform page. |
| `BILLING.md` | Rule 4. |
| `EMAIL.md` | The scrub. |
| `PRIVACY_VERIFICATION.md` | The stamps in §G. |
| `README.md` | This proposal's row. |

## G. Privacy (CLAUDE.md, second invariant)

**This change is privacy-affecting.** It adds a way to trigger account deletion, and it changes what
any deletion leaves behind. (The cross-organization leak this review found is fixed separately and
shipped on its own: PRIVACY_VERIFICATION item 35.)

**What changes:**

- **A fourth deletion path**, with attribution fixed by the lock claim: org admins, and staff inside
  the org per §C2.
- **An unused account's membership row is removed** (org path).
- **The name record covers more organizations, on every path:** deactivated memberships, and the orgs
  where the person recorded doors or surveys. This changes the recorded A4 claim, FBTIME_INTEGRATION.md
  and `purgePairing.js:19`. It is new name exposure, but only inside the window `privacy.html:128`
  describes, and only to organizations whose records carry the person.
- **Eight more lookups restore the name for the window**, org-scoped. Team labels are lead-visible,
  and a lead can be the client.
- **One more bit to Org A's admin:** deactivated memberships elsewhere count (§K decision 3). It sits
  against `privacy.html:105`; no name, id or count crosses.
- **`signedIn` uses `lastLoginAt` only.** `lastSeenAt` stays super-admin-only.
- **The email log no longer keeps a deleted person's address on their own mail.** Under §K decision 2
  (decided 2026-10-24), two kinds of rows keep it, on different bases:
  - the deletion-warning rows, kept forever as the evidence that warnings went out, under DPA §9's
    "records documenting deletions" and `privacy.html:122`'s "records that document the deletion
    itself";
  - the staff-access (support-grant) notices, ordinary rows that expire after a year
    (`EMAIL_LOG_RETENTION_DAYS`), under DPA §9's staff-access records.
- **A paused org can switch access off and delete.**
- **The org's admins see who deleted an account and when.**
- **A grant-holder's deletion names the account** in the access log.
- **People with billing access can't be removed by an admin without it.**
- **When E2 ships (after Election Day)**, a deleted account's undeliverable phone items are removed (the protective reading
  of `privacy.html:94`). This needs stamps on the privacy record's on-device queue entries (item 6,
  item 12).

**Existing gaps closed:**

- `privacy.html:127` ("your email address … removed"), for a person's own mail.
- `privacy.html:115` ("disable access promptly"), now also for paused orgs.
- **Personal data written back onto a deleted account** by eleven racing writes.

**Existing gaps still open**, recorded for the owner:

- The address in `Subscription.billingContact.email`, `SubscriptionEvent` and
  `OrgDeletionRequest.requestedByEmail`, and in the 12-month backups.
- The ~45 screens (§C8).

**Published text.** No sentence becomes false, and by answer 5 nothing is added.

- `privacy.html:118` keeps information "as otherwise instructed by the customer organization".
- DPA §2 counts the customer's "use and configuration of the Service's features" as instructions.
- DPA §9's 180-day sentence describes self-deletion; the admin path rests on §2.

**`PRIVACY_VERIFICATION.md`:**

- This build's items start at 36: other sessions hold 33 and 34, and the leak fix holds 35.
- Stamps on §A1–A4, the `isMultiOrg` entry, the three export-only passages, the `EmailLog` notes,
  (f) sessions, "Not every surface restores it", and (with E2, after Election Day) the queue items 6 and 12.
- New watchlist lines, all test-pinned:
  - "an org admin can delete only an account with no other membership";
  - "billing-access accounts can't be deleted or removed without billing access";
  - "support staff need break-glass for a used account";
  - "no deletion leaves an org without a live admin";
  - "the eleven writers can't write to a deleted account".

  (The report-route rule already has its own 2026-10-24 watchlist bullet, from item 35.)

## H. Tests

**New `server/test/orgAccountDeletion.int.test.js`** (house harness: a throwaway mongod and the real
app over HTTP).

**The deletion:**

- A used single-org canvasser:
  - the scrub; the membership deactivated with `billingAccess` cleared; every row released; shared
    books kept;
  - the crew loses this coordinator, and the ledger is unchanged;
  - billable knocks and campaign stats equal before and after;
  - names on all eight lookups (deactivated first; a former org); email blank; no other org gets the
    name;
  - the record matches the call that got the 200, and the deletion line is right for every `how`.
- Re-adding the same email gives a new user id, and **none of that new account's mail rows are
  touched**.
- An unused account: only this org's membership is removed, and `RESET_INVALID`. An account created
  before `CLOCKS_RELIABLE_FROM` reads as `used`.

**Refusals:**

- **404 and leaks:** an unknown id and a member elsewhere get the same 404.
- **`OTHER_ORGANIZATION`:** it fires for an active and for a deactivated membership elsewhere, and
  the body carries nothing of org B, even when the person is B's sole admin. Past work elsewhere
  doesn't block.
- **Billing access:** `BILLING_TARGET`, including after a demotion; Remove-then-re-add refused with
  403; both allowed with billing access.
- **Billing-less orgs:** deleting an admin without billing access succeeds, by the org path and by
  self-deletion.
- **Staff, every `orgContext` case:**
  - an admin member: allowed;
  - a canvasser or lead member, including of an internal org: `ADMIN_ONLY`, returned as a blocker;
  - a member who also holds a grant: the member rule;
  - support under a grant: unused only, with the gate refusing a mid-flight sign-in;
  - break-glass: allowed;
  - an internal org without a membership: allowed.
- **The rest:** `REVIEW_LOGIN`, `SELF`, `STAFF_ACCOUNT`, `STAFF_SELF_MINT`, `DELETION_LOCKED`,
  `LAST_ADMIN`, `LAST_BILLING_ADMIN`, `DELETION_IN_PROGRESS`, a confirm mismatch, `ALREADY_DELETED`,
  and `USAGE_CHANGED` both ways.

**Races, forced interleavings:**

- The same account twice, including a racing self-delete.
- The round-4 shape: attempt B reads the account, A runs to the end, then B claims. B is refused
  `ALREADY_DELETED`, and A's finished record is intact.
- Two admins deleting each other, plus a duplicate submit: never zero live admins.
- Every writer in row 8, before and after the gate: nothing written back. A `PATCH` paused after its
  save, raced with a whole deletion, ends switched off with no billing flag and no grants.
- Another org's link mid-deletion: refused, or it ends inactive.

**Crashes and the sweep:**

- Inject a crash after every step:
  - before the gate: the sweep switches the touched memberships back on and removes the record, and
    the purge never touches a live account's FbTime. Two admins deleting each other, with a crash
    between "off" and "restore", end with both admins active again after the sweep.
  - after the gate: the sweep finishes, with the name (blank for an unused account), the attribution
    and `unusedOrgId`.
- An error between the lock and the gate restores the memberships and releases the lock; a retry
  isn't blocked.
- A retry after a stale crash isn't deleted by the sweep mid-flight.
- With a malformed record, the sweep counts it and the purge still runs.
- The sweep's filter leaves finished and purged records alone (the `strictQuery` trap).
- The console dry run (`apply: false`) writes nothing, and the sweep's counts land on `RetentionRun`.

**The leak fix** is already pinned by its own `test/reportsUserScope.int.test.js` (§C8). It is not
repeated here; the build must keep it green.

**Other routes:**

- `PATCH /:userId` on a tombstone: 409.
- A paused org: exactly the six writes pass.
- The email log: this account's rows, an earlier address, and a late bounce are scrubbed; another
  account's rows at a reused address are untouched; the backfill's dry run and `--apply`.

**Updated suites:**

- `accountDeletion.int.test.js`: the new model, self-deletion green.
- `superAdminUsers.int.test.js`.
- `billing.int.test.js` and `billingAccess.int.test.js`: the carve-outs, the Remove rule, and the
  `:261-263` rewrite.
- `accessLogCoverage.int.test.js`.
- `retention.int.test.js` and `fbtimeDeletionGaps.int.test.js`. Their fixtures make records with no
  User document, which the purge guard treats as deleted.

**Phone (with E2, after Election Day):** `sessionEnd.test.js`, `sessionStore.test.js`, the queue ordering test.

**Run every suite CI runs:**

- `npm --prefix server run test:int`;
- `npm --prefix server test`;
- `npm run test:mobile`;
- `npm --prefix client test`;
- `npm --prefix client run build`;
- `npx expo export` for iOS and Android, from `mobile/`.

**By hand:**

- In a browser: the three Escape cases (§D).
- On a staging phone: the §I recipe.

## I. Release, risks, and what's left

### I1. The two security fixes ship first, on their own (built 2026-10-24)

The working tree also holds work that isn't ready: 19 files of other sessions' unfinished work
(platform stats, deletion counters, the client-reports audit), their items 33 and 34 in the shared
privacy record, a shared README row, and this plan. A plain `git add -A` would ship all of it. Two
ways:

- **Ship the fixes alone now (recommended; both gaps are live).** One prepared patch stages exactly the
  11 files of the two fixes:
  - the leak fix (item 35): `reports.js`, `canvasserIdentity.js`, `reportsUserScope.int.test.js`;
  - the staff-roster fix (item 36): `campaignRoster.js`, `useCampaignTeam.js`,
    `staffRosterScope.int.test.js`, `partitionAssignable.int.test.js`;
  - the docs: `ROLES.md`, `USERS.md`, `PASSES_AND_TURF.md`, and only items 35 and 36 with their stamps
    in the shared privacy record.

  Everything else stays in the folder, unstaged, for the other sessions' own commit.
- **Or wait** and ship them with everyone's work in the next combined `git add -A` commit, once those
  sessions are done.

The patch is `security-fixes.patch` in the session scratchpad. It replaces `leakfix-only.patch`. It
was:

- checked in both directions: every file except the privacy record matches the working tree exactly,
  and the privacy record leaves out only the other sessions' items 33 and 34 and their stamp;
- dry-run against the real index (applies cleanly);
- tested on HEAD plus only the patch: 33 suites, 443 tests pass. On the old code the leak test fails 5
  of 6, and the staff tests fail 5 of 10 (the refusals; the 5 that pin kept behavior pass).

**The owner's steps** (Terminal at the repo root; Heroku dashboard only):

0. Heroku dashboard → the app → Activity: note the commit that's live. If it isn't `48be323`, the Door
   Outcomes progress work (`12b56fa`, `48be323`) ships too. It adds no index, so there is no extra
   step.
1. `git diff --cached --stat` must print nothing.
2. `git apply --cached <patch path>`, then `git diff --cached --stat`: exactly 11 files, 882
   insertions, 47 deletions.
3. Commit with the prepared message, without `-a` or `git add -A`.
4. `npm run audit:mobile-api -- HEAD~1` compares exactly this commit. It must flag `reports.js`, and
   list `campaignRoster.js` and `canvasserIdentity.js` to check by hand. Nothing is removed or renamed,
   no parameter becomes required, and a refused staff id gets the existing `409 not-on-team` the phone
   already handles, so the client-version gate stays where it is.
5. `git push origin main`, then `git status --short`: the other sessions' files are still there,
   unstaged. Of the patch's files, only `PRIVACY_VERIFICATION.md` still shows, because it still holds
   their items 33 and 34.
6. Heroku dashboard → Deploy → Manual deploy from `main` (server and web). There is no Run console
   step, no index build and no phone update.
7. Spot-check:
   - a current canvasser's report and a removed canvasser who knocked, on the web and the phone;
   - the canvasser CSV with a crew filter, which still names the coordinator;
   - as staff in the demo org, assign yourself a book on the web: it still works;
   - optional, since it needs a support grant: as staff in a customer org where you hold no
     membership, the web book picker no longer offers you.
8. In the next commit, stamp the deploy date into items 35 and 36.

### I2. This feature, in the owner's real order

**Precondition:** the security-fixes patch is committed (§I1), because this build edits the same report
files.

1. **On the combined, still-uncommitted tree** (this build plus every other session's work):
   - `npm run audit:mobile-api` (it reads uncommitted files, so it must run before the commit), and
     read its flagged diffs plus the `entitlement.js` and `middleware/auth.js` diffs by hand;
   - every suite in §H.
2. The owner's single `git add -A` and commit, with the messages combined.
3. Heroku dashboard → Deploy → Manual deploy from `main` (server and web).
4. Heroku dashboard → More → Run console: `npm run migrate:scrub-deleted-email-log`, then `-- --apply`
   after reading the dry run. Run any other session's console steps in their order.
5. **The phone** (the sheet only; E2 waits for the post-Election queue plan):
   1. From `mobile/`, check that `git status --short mobile/` prints nothing.
   2. `npm run ota:staging`.
   3. The staging recipe below.
   4. Check `git status --short mobile/` again.
   5. `npm run ota:production`.

**The staging recipe (the delete sheet only; §E2's phone clean-up is not in this build).** Staging
talks to production, so this is a real deletion: never delete the review or background canvassers
(if one is deleted, re-run `npm run seed:demo -- --apply`).

1. As a break-glass super admin in the internal demo org, add a throwaway canvasser to a demo
   campaign. Don't sign in as it on any phone.
2. On a staging phone, as a demo-org admin who isn't a review login (they get `REVIEW_LOGIN`):
   Users → the throwaway (from a campaign list: Manage profile) → Account → More options → Delete
   account.
3. The review names the person and reads "no work here". An account nobody used shows no sync-first
   line (there is no phone to ask about); it says the person disappears from the Users list.
4. Continue, type a wrong email (Delete permanently stays grey), go Back (the field clears), then type
   it right and delete.
5. The row is gone on the phone and the web. A second delete of the same id answers 404 (the unused
   account's row went with it); a used account's second delete answers `ALREADY_DELETED`.
6. On BOTH an iPhone and an Android staging phone: after the delete, the profile closes and the Users list
   comes back without flashing "User not found", and the list shows the deleted notice. (The sheet closes
   and the screen pops in the same tick; review couldn't check that on a device.)
7. Remove from org on the phone: a second throwaway's profile → Account → Remove from org → Remove. The
   profile closes, the list says they're no longer in the organization, and a double tap asks only once.

The leftover-doors behaviour belongs to the post-Election queue plan's own recipe. Don't reproduce it
here: in production it would put a door under the wrong account.

There is no client-version gate and no native build. The sweep rides the existing 03:17 job. Help
ships with the server, ahead of the phone update. The owner runs every shipping command.

**Residual risks, stated plainly:**

- **Until E2 ships after Election Day:** a deleted account's unsent doors go up under whoever signs in
  next on that phone. The review's sync-first line is the protection.
- **About 45 screens** show "Deleted user" at once (§C8).
- **Deletion-warning and support-notice email rows** keep the recipient's address (§C6).
- **A refused deletion still drops a live phone's sync** if it lands in the ~100 ms step-4 window
  (row 7).
- **A coordinator removed from an org where they never knocked** reads "Deleted user" on that org's
  team labels.

## J. Files

| File | Change |
|---|---|
| `server/src/services/users/deleteAccount.js` | the model, the lock, `finishDeletion`, `reviewOrgDeletion`, the email-log step, phrasing |
| `server/src/models/DeletedUserRecord.js` | `reason` + `org_admin`; `pendingAt`, `pendingToken`, `unusedOrgId` |
| `server/src/services/memberships/billingGuards.js` | live-account counts |
| `server/src/services/retention/purgeDeletedIdentities.js` | the sweep, the guard, the counts |
| `server/src/models/RetentionRun.js`, `server/src/services/retention/scheduler.js` | the sweep's declared counts; the 15-minute job in `MAINTENANCE_JOBS` |
| `server/src/services/fbtime/purgePairing.js` | the `:19` comment |
| `server/src/routes/admin/memberships.js` | two routes, the tombstone line, the guards in §C3, the Remove rule |
| `server/src/routes/admin/leadCrew.js` | the crew re-checks |
| `server/src/services/memberships/createMember.js` | the link re-check |
| `server/src/routes/auth.js`, `server/src/middleware/auth.js`, `server/src/services/auth/passwordReset.js` | conditional writes, the stamp helper |
| `server/src/routes/public/resendWebhook.js` | the bounce text |
| `server/src/routes/superAdmin/users.js`, `server/src/services/platform/userOversight.js` | phrasing, the log line, pending records hidden |
| `server/src/middleware/entitlement.js` | carve-outs |
| `server/src/services/reports/canvasserIdentity.js`, `server/src/routes/admin/reports.js`, `server/src/services/audit/flagDetection.js` | the eight lookups (`orgCarriesUser`, `campaignsCarryUser` and the crew stamp already shipped with the leak fix, §I1) |
| `server/src/migrations/scrubDeletedEmailLog.js` (new), `server/package.json`, root `package.json` | the backfill |
| `client/src/components/UserProfileModal.jsx`, `client/src/components/ui/Modal.jsx`, `client/src/pages/UsersPage.jsx`, `client/src/pages/SuperAdminUserDetailPage.jsx` | §D |
| `mobile/app/(app)/admin/users/[id].jsx`, `mobile/app/(app)/admin/users.jsx`, `mobile/components/DeleteMemberSheet.jsx` (new), `mobile/components/MemberSheet.jsx` | §E1 |
| After Election Day (E2): `mobile/lib/recordAction.js`, `mobile/lib/offlineQueue.js`, `mobile/lib/sessionEnd.js` (+ test), `mobile/lib/sessionStore.js` (+ test), `mobile/lib/authState.js`, `mobile/app/_layout.jsx`, `mobile/app/login.jsx`, `mobile/lib/buildStatus.js` | §E2 |
| Tests, docs, Help Center | §F, §H |

## K. Decisions for the owner, and calls made on the owner's behalf

### Decisions (the owner's to make; recommendation first)

1. **The phone part (§E2): DECIDED 2026-10-24, after Election Day.** It ships with the
   post-Election queue plan. That plan still has to settle the trade underneath: thrown away (not
   counted, not billed) versus sent under the wrong person (counted and billed). Until then, the
   review tells the admin to let the phone sync first.
2. **The email send log (§C6): DECIDED 2026-10-24, by account only** (the recommendation). You said
   yes to scrubbing; round 3 showed that matching rows by
   address rewrites other people's rows, keep-forever evidence included, and the backfill can't be
   undone.
   - **Recommended: scrub only the person's own emails, by account** (invites, password resets,
     added-to notices). It is exact and simple. Two kinds of rows that reached them as a billing admin
     keep the address:
     - deletion warnings, kept forever as the evidence that warnings went out;
     - staff-access (support-grant) notices, ordinary rows that expire after a year.
   - **Alternatively: also scrub those rows by address**, with the four guards in §C6.
3. **Switched-off memberships in other organizations: DECIDED 2026-10-24, they block too** (the
   recommendation).
   - **Recommended: they block too.**
     - What it costs: Org A's admin learns one more thing, that this person still has an account
       somewhere else.
     - In practice: Org A can never delete someone whose only other tie is a switched-off membership
       in an organization it can't see or contact. It is left with Remove from org, which keeps their
       name, email and phone. Only the person themselves, or Doorline at break-glass, can then delete
       the account.
   - **Alternatively: only active ones block.** Nothing new is revealed, but Org A could then delete
     an account Org B only switched off, and Org B could never switch it back on.
4. **The existing cross-organization leak (§C8, row 17): DECIDED and FIXED 2026-10-24**, uncommitted,
   ready to ship alone (§I1). In round 4 the fix grew to cover leads inside their own org too, the
   same wall the Users list keeps. One follow-up was the owner's: **whether any notice is owed under
   DPA §5**, to decide with counsel. Item 35 sets out what the records can and can't show; the leak
   also made DPA §4's tenant-isolation sentence untrue for these fields. **DECIDED 2026-10-24: not
   referred to counsel, no notice** (recorded in item 35).
5. **When this feature ships, relative to Election Day (2026-11-03): DECIDED 2026-10-24, admin deletion
   may ship before Election Day; §E2 waits until after it.** With §E2 after Election Day,
   the leftover-doors gap (a deleted account's unsent doors go up under the next person on that
   phone) is open from the day admin deletion ships until §E2 lands. This build also edits sign-in,
   password reset and the billing gate.
   - **Ship before Election Day**, accepting that gap. The review tells the admin to let the phone
     sync first, and it bites only with a shared phone.
   - **Or hold admin deletion until after Election Day**, with §E2. The real gates are the build and
     its verification, not the calendar.

### Calls made on the owner's behalf (each can be dropped)

- **Who:** the staff rules in §C2; billing access protecting its holder, including the change to
  Remove from org; former organizations don't block; the review logins can't delete.
- **What's left behind:** the name record covers deactivated memberships and former orgs on every
  path, including self-deletion; unused accounts lose their row (accounts made before mid-May 2026
  always count as used); the deletion line shows the org's admins who deleted whom.
- **Scope:** the paused-org carve-out also covers Deactivate and Remove; names restored on eight
  lookups now, ~45 in a follow-up; one deletion at a time per account (`DELETION_IN_PROGRESS`).

## L. Review log

### Round 1 (2026-10-23): server mechanics (reproduced), authorization and privacy (reproduced), the owner's walkthrough

41 findings: 13, 13 and 15. Six pairs were found twice (B3/C1, A1/C2, A7/B9, B5/C9, A11/B7,
A9/B13). Five were rated blockers, four of them distinct.

| # | Finding | Severity | Revision 3 | Revisions 4–5 |
|---|---|---|---|---|
| 1 | The preflight would show another org's name and id | Blocker | This-org-only blockers | Kept |
| 2 | The billing rule was bypassable by demoting first | Blocker | Keyed on `billingAccess` | Remove-then-re-add closed (R2A-2) |
| 3 | "Unsent doors can never be sent" was false | Blocker | General hold | Narrow E2 (r4), ordering fixed (r5), ships after Election Day (§K 1, decided) |
| 4 | "Name on every screen" can't hold | Blocker | Narrowed | Eight lookups, exact copy |
| 5 | Two admin deletions can strand an org | Major | Memberships-first recount | Billing guard (r4), per-account lock (r5) |
| 6 | The losing call overwrote the record | Major | Insert + winner `$set` | Pending record (r4), the record as the lock (r5) |
| 7 | `organizationIds` missed deactivated memberships | Major | Widened | `CoordinatorChange` cut |
| 8 | Cross-org disclosure; usage leaked | Major | Blocker alone | `lastLoginAt` only; the bit is §K 3 |
| 9 | Wrong index on `$ne` probes | Major | Hints | `userId`-only filters |
| 10 | "Doorline" had no mechanism | Major | `reason` at write | By entry path |
| 11 | Authorship in another org | Major | Only memberships block | Kept |
| 12 | Demo reviewers could delete each other's accounts | Major | `REVIEW_LOGIN` | Kept |
| 13 | Records pin "exports only" | Major | Stamps | Kept |
| 14 | Tombstone UI; `PATCH /:userId` | Major | Hidden; 409 | Plus re-checks; flag cleared |
| 15 | Shared books; archived rounds | Major | Split, active | Kept |
| 16 | Counts misstated the bill | Major | Copy | Restricted included |
| 17 | OTA from the shared tree; `audit:mobile-api` | Major | §I | Audit before the commit (R3B-2) |
| 18 | Email scrub for future deletions only | Major | Backfill | Per account (r5) |
| 19 | Docs and Help gaps | Major | §F | Extended each round |
| 20–30 | Eleven minor rows (staff paths, scrub fields, crash order, old accounts, stamps, the log line, platform `kind`, probe order, DPA citations, six UI minors, §A accuracy) | Minor | Fixed | Kept or replaced as noted in rounds 2–3 |

### Round 2 (2026-10-23): fix audit + new mechanisms (reproduced), the phone queue and UI (simulated), simplicity + privacy + consistency

39 findings: 14, 12 and 13. R2A-1 and R2C-3, R2A-4 and R2C-4 were duplicates; R2B-3 and R2C-2
overlapped.

| Finding | Severity | Done |
|---|---|---|
| R2A-1 / R2C-3: the recount refused deletions in billing-less orgs | Blocker | Guarded; live counts |
| R2A-2: Remove + re-add bypassed `BILLING_TARGET` | Blocker | The Remove rule |
| R2B-1: "held" items can't be stepped past | Blocker | General hold dropped |
| R2C-1: four more lookups on promised screens | Blocker | Eight lookups |
| R2C-2 / R2B-3: queue readers; deleted items kept | Blocker | Narrow E2 |
| R2A-3: races leave active memberships on a tombstone | Major | Post-gate re-deactivation; post-write re-checks; scoped delete |
| R2A-4 / R2C-4: a crash leaves a record on a live account | Major | Sweep, purge guard, `purgedAt: null` |
| R2B-2, 4, 5, 6, 7; R2C-5, 6, 7 | Major | Token `sub`; no Discard; kill switch (if E2 ships now); Escape; deactivated copy; `lastLoginAt` only; cutoff and variants; §K |
| Nineteen minors (R2A-5…14, R2B-8…12, R2C-8…13) | Minor | Fixed; listed in revision 4's log |

### Round 3 (2026-10-23): the new model (reproduced, plus a pre-mortem), the phone and release (simulated), a fresh-eyes cold read

38 findings: 10, 14 and 14. The phone ordering was found by all three; the email scrub, the leak
and the tombstone Remove dead end were each found by two.

| Finding | Severity | Done in revision 5 |
|---|---|---|
| R3A-1 / R3C-3 / R3C-5: the edited lookups show any user's identity to any org; `anyOrg` would add deleted people | Blocker | `orgCarriesUser`, crew-stamp check, `anyOrg` dropped; the existing leak is §K 4 |
| R3A-2 / R3C-2: scrubbing by address rewrites other live accounts' rows, warning evidence included | Blocker | Per account by default; the guarded variant is §K 2 |
| R3A-3: a call that switches nothing off skips the recount, and the last admin is deleted (40/120) | Blocker | Per-account lock (0/120) |
| R3A-5 / R3B-1 / R3C-1: the knock that learns of the deletion is queued after the discard | Blocker | `shouldQueue`, cleanup at sign-out, the pre-flush pass, the stamp at entry |
| R3B-2: `audit:mobile-api` after the commit checks nothing | Blocker | Run before the commit |
| R3A-4: the pending record could vanish, miss legacy records, or misname | Major | Lock claim refreshes, upsert, token-scoped sweep, `unusedOrgId` |
| R3B-3: the removed-items notice had no path; parity test | Major | Injected cleanup, `discardedLine` |
| R3B-4: stamp too late; late saves | Major | Stamp at `optimisticSubmit`; the login pass |
| R3B-5 / R3C-4: the Escape guard broke Escape on the profile | Major | Mount-set ref + pending guard; three by-hand cases |
| R3B-6: the staging check would delete real production accounts | Major | The recipe |
| R3C-6: §K was missing the billable-doors trade and the evidence rows | Major | §K 1 and 2 |
| R3A-6: two more writers revive a tombstone's roster | Minor | Re-checks; one-write window |
| R3A-7: late log rows keep the address | Minor | Webhook rule; seven-day re-scrub |
| R3A-8: the Remove rule breaks an existing test | Minor | Rewrite named; UI hides |
| R3A-9: sweep and purge edges | Minor | Counts, live records deleted, the schema trap, pending hidden, per-record catch |
| R3A-10 / R3B-13: the pre-gate deactivation can drop a live phone's sync | Minor | One-write window; residual stated |
| R3B-7 / R3C-7: a tombstone billing admin's row can't be removed | Minor | Flag cleared at step 7 |
| R3B-8: the phone path goes through MemberSheet | Minor | Part 1 and Help |
| R3B-9: dead ends in the review | Minor | Blockers with remedies |
| R3B-10: wrong and missing verification commands | Minor | Every CI suite by name |
| R3B-11: OTA bundles what's on disk | Minor | `git status --short mobile/` clean, twice |
| R3B-12: the reason decision untestable | Minor | In `sessionStore.test.js` |
| R3B-14 / R3C-10: cascade gaps | Minor | `delete-my-account` rewrite, `add-a-canvasser` scope, queue stamps, files |
| R3C-8: sweep claims too strong | Minor | Claims softened; `unusedOrgId` |
| R3C-9: the 7-day warning reads server rows only | Minor | Always-on sync line |
| R3C-11: the phone sheet could close mid-delete | Minor | Blocked |
| R3C-12: a kill switch or defer E2 | Minor | §K 1 |
| R3C-13, R3C-14: wording; precision | Minor | Fixed (including §A row 3 and `issuePasswordResetToken`) |

**Reviewer fixes changed rather than taken:**

- R3A-2's guarded address scrub became the recommended per-account scrub, with the guarded version
  kept as the alternative.
- R3C-3's `anyOrg` for ids from the org's own rows was dropped altogether; the residual is stated.

### Round 4 (2026-10-24): the revision-5/6 server model (reproduced), a code review of the leak fix (reproduced), coherence and the leak-fix release (rehearsed)

**Leak-fix code review:** no blocker. Every legitimate flow resolves, and 8 suites were green on the
reviewed version.

| Finding | Severity | Done |
|---|---|---|
| R4B-1: a team lead could still open anyone in their own org (the Users list walls leads; reports didn't) | Major | Fixed in the leak fix: `campaignsCarryUser`, the Users-list wall, any managed campaign |
| R4B-2: Doorline staff became "carried" through desk marks they made under a grant | Minor | Desk marks excluded from the ledger half (`NOT_BULK`) |
| R4B-3: `partitionAssignable` admits any staff id onto rosters and books without a membership; the lists then show the staffer's name and email, and 201 vs 409 reveals staff ids | Minor | Fixed 2026-10-24 on the owner's go-ahead (`internalStaffIdSet`: staff skip the membership check only in an internal org); ships with the leak fix (§I1); PRIVACY_VERIFICATION item 36 |
| R4B-4: the `distinct` fetches all of a person's rows; timing differs for a heavy foreign id | Minor | Kept: about 31 ms worst case, correct, and safe without a hint on an index that may be missing in production |
| R4B-5: test gaps (surveys-only, deactivated, deleted and lead cases on one drill only) | Minor | Test rewritten: 6 tests, every case over all ten drills |
| R4B-6: docs (the request log does record drill paths; overstated test claims; ROLES.md wording) | Minor | Item 35 and ROLES.md rewritten |
| R4B-7: `/summary` showed a removed person's platform-wide last sign-in | Minor | `lastLoginAt` only for current members |

**Coherence and release:**

| Finding | Severity | Done |
|---|---|---|
| R4C-1: the staging recipe still tested §E2, and would write a wrong-person door into production | Blocker | Replaced with a delete-sheet-only recipe |
| R4C-2: no way to commit the leak fix alone; `git add -A` would ship 21 files of other sessions' work | Blocker | §I1: the frozen, two-way-checked, tested patch route |
| R4C-3: deploying `main` also ships anything committed since the last deploy | Major | §I1 step 0 |
| R4C-4: Part 1 stated open decisions as settled; the email-log and switched-off lines were inaccurate | Major | Part 1 reworded and tagged to §K 2 and 3 |
| R4C-5: the counsel question was under-informed (DPA §4, privacy.html:115, the request log, neutral wording) | Major | Item 35, two counsel-brief stamps, §K 4 |
| R4C-6: the lead-scope gap was framed as small | Major | Fixed (R4B-1) |
| R4C-7: decisions 2 and 3 gave one side only | Major | Both rewritten with the costs |
| R4C-8: ship timing relative to Election Day wasn't an owner call | Major | §K decision 5 |
| R4C-9 to R4C-11: stale lines, numbering, overstated test claim, plan leftovers | Minor | Fixed |

**The revision-5/6 server model.** It was run on a transcription over the real models, with forced
interleavings and crashes. What held:

- 0 orgs left without a live admin in 360 races;
- exactly one success per account in 180 concurrent deletions;
- 0 duplicate-key errors in 1,200 concurrent lock writes;
- stale-lock timing correct;
- every crash after the gate finished by the sweep.

| Finding | Severity | Done in revision 7 |
|---|---|---|
| R4A-1: the lock claim could take over a just-FINISHED record, and the attempt's refusal then deleted it (name record and deletion evidence lost; reproduced with a forced pause) | Blocker | `finishedAt` declared and required null to claim; the claim resets the record's shape; a gate miss re-reads and answers `ALREADY_DELETED` |
| R4A-2: undoing a racing `PATCH` by restoring its snapshot revived the active admin and billing flag | Major | Converge to off, no billing, no grants; re-check after the route's last write |
| R4A-3: the sweep's live-record delete could remove a freshly claimed lock; an upsert then wrote `self` | Minor | Conditioned delete; `$setOnInsert` attribution |
| R4A-4: the sweep's counts would be dropped (undeclared `RetentionRun` fields) | Minor | Declared; failures fold into `failed` |
| R4A-5: purge-guard semantics broke two existing suites; the dry run would write | Minor | "Deleted" includes a missing User doc; the dry run only counts; both suites added |
| R4A-6: legacy tombstones keep `billingAccess`, so Remove would dead-end; the `:261-263` rewrite needs a grant fixture | Minor | Deleted targets exempt; fixture named |
| R4A-7: step 11 wrote the name back for an unused account | Minor | Blank when `unusedOrgId` |
| R4A-8: a link racing the deletion showed another org's admin by name | Minor | `byName` only for an admin of the viewing org |
| R4A-9: errors between the lock and the gate left a 10-minute lockout; the self route mapped the code to 400 | Minor | try/catch restore and release; 409 and copy |
| R4A-10: crash recovery waited for 03:17, and a crash mid-mutual-race could leave both admins off | Minor | 15-minute sweep job; `touchedMemberships` restored by the sweep |

**Round 4 in sum:**

- 3 blockers. One was in the model (R4A-1). Two were in the release and the plan's own coherence
  (R4C-1, R4C-2), and the leak fix's code review found none.
- The model's pieces now hold under every race and crash the reviewers could construct. The last
  blocker was a narrow interleaving, not a design gap.
