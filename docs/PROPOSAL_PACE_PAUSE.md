# Proposal: Automatic pause — stop a canvasser whose doors come in faster than anyone could knock them

> **Status: server deployed 2026-10-25 (`d1d12ac`); the phone's production update and switch-on are pending
> (§N). What the build changed from this plan — including the preview's crash and removal on 2026-10-25 — is
> in [As built](#as-built-2026-10-24).** Design
> revision 4 (2026-10-24). The owner's decisions are in
> [Decisions](#decisions-owner-2026-10-24) (1 to 19). Two review rounds ran against the code: round 1
> (three reviewers: server correctness; an owner walkthrough with a simplicity audit; privacy, release
> and consistency) found 6 blockers and 28 majors, and produced revision 2 ([§Q](#q-review-round-1));
> the owner's answers to its questions made revision 3 ([§P](#p-round-1-questions-answered)); round 2 (two
> reviewers: the new mechanisms with simulations; a walkthrough with a rehearsal of the ship steps) found 1
> blocker (found by both) and 9 majors, all in what revision 2 added, and produced this revision
> ([§R](#r-review-round-2)). The rule was replayed on two real activity exports and on simulated days;
> results are in [Tested on real data](#tested-on-real-data) and §K. Line references are to HEAD `aa01027`.
> Files that other sessions have uncommitted edits in today are cited by function name, not line:
> `server.js`, `worker.js`, `routes/index.js`, `routes/auth.js`, `routes/admin/memberships.js`,
> `services/audit/flagDetection.js`, `services/reports/campaignSummaries.js`,
> `services/campaigns/deleteCampaign.js`, `services/platform/deleteOrganization.js`,
> `services/platform/lateWriteSweep.js`, `services/users/deleteAccount.js`, both `package.json` files,
> `client/src/pages/UsersPage.jsx`, `client/src/components/UserProfileModal.jsx`,
> `mobile/app/(app)/admin/users.jsx`, `mobile/app/(app)/admin/users/[id].jsx`, the Help Center inbox and
> most of `docs/`.
>
> **Later (2026-10-27, [PROPOSAL_PEOPLE_PAGES.md](PROPOSAL_PEOPLE_PAGES.md)):** the settings card moved off
> the Users page to a new org **Settings** page (`/settings`, org admins; `components/settings/`). *Who gets
> the email* became a search box with an **Also email** list, and anyone no longer an admin or team lead
> shows as *Not emailed* (`GET /settings` gained `chosen`) instead of silently failing every Save. The
> alert email's last line now names the Settings page. Unpause moved to the person panel's state buttons
> and asks first, like the Audit page's. Where this plan says *Users page* for the card, read *Settings
> page*.

Related: [AUDIT.md](AUDIT.md) (the GPS audit and its `rapid` flag, which this builds on),
[CANVASSER_APP.md](CANVASSER_APP.md), [ADMIN_APP.md](ADMIN_APP.md), [EMAIL.md](EMAIL.md),
[ROLES.md](ROLES.md), [MAPS.md](MAPS.md), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md),
[OPERATIONS.md](OPERATIONS.md).

# Part 1 — For everyone

## Why this exists

Over two shifts in October a canvasser logged doors from a moving car instead of knocking them:
not-homes, refusals and surveys, often 5 to 20 seconds apart while the phone moved at 8 to 34 mph.
Doorline's existing **rapid** flag marked 129 of those entries, but flags only show up when someone opens
the Audit page, and in peak season nobody did. It ran for two days, and a client's results had to be
cleaned by hand.

Automatic pause makes Doorline act on its own: once a canvasser's doors stop being physically possible,
recording pauses, the right people get an email, and the doors behind it are laid out for review. **It
pauses recording only. It never deactivates anyone, signs anyone out, removes a door or hides a number.**

## What it does

Every time a canvasser saves a door, Doorline compares it with the last thing they saved **at a
different house**: how many seconds apart the two were, and how far apart the phone was (a straight
line between the two GPS readings).

A door **fails** when there wasn't enough time to drive from the last house at 25 mph and still spend
15 seconds at this door. A survey needs 45 seconds at the door. In numbers, a door fails when

> seconds since the last house  <  meters between the two readings ÷ 11.2  +  15 (45 for a survey)

Two houses 60 meters apart need at least 60 ÷ 11.2 + 15 = **20.4 seconds**. An honest canvasser who
knocks, waits the 30 seconds you ask for, and walks to the next house takes 50 seconds or more, so the
rule catches what can't be done on foot, not people who were a little quick.

**Each visit to a door is judged once.** Everything saved at one house within 10 minutes is one visit: a
second person surveyed, a change of result, or a Not home followed by a survey when someone finally
answers. The visit is judged at the first thing saved there, and a survey in the visit must also come
45 seconds or more after the last house. Coming back later (a callback) is a new visit. Saving a door
again, any number of times, can't hide it from the rule.

When **8 of any 20 judged visits in a row that day** have failed, Doorline pauses the canvasser.

## What gets judged, and what doesn't

**Judged:** visits whose result is Not home, Refused, Surveyed, or Not a target voter (someone answered,
so it is judged like Refused).

**Not judged** (they still count as "the last thing you saved" for the next door's timing):

- **Wrong address, No soliciting, and Restricted access.** Canvassers often log these quickly from the
  street at gated or no-soliciting communities, sometimes several at once.
- **Any address with an apartment or unit number, or a home in a condo complex.** Doors there are steps
  apart.
- **Lit drops.**
- **Admins and team leads.** They are the people who review and unpause, and they are the ones who enter
  paper results door by door from a stack of packets, which would otherwise pause them every few minutes.
  Their doors still appear in the GPS audit flags like everyone's.

Admin desk entries are not field visits and play no part in the timing.

> **An accepted gap.** Wrong address and No soliciting are billed as knocks. Someone who fakes those two
> buttons from a car will not be paused. The owner accepted this on 2026-10-24: watch for it on the Audit
> page and Door Outcomes. The canvasser's Help article never lists what isn't judged.

## Tested on real data

The rule was replayed over two real activity exports on 2026-10-24, both from the owner's own
organization. Canvasser A logged doors from a car on Oct 22 and Oct 23; Oct 17 was an honest day.
Canvasser B is an honest canvasser on another campaign.

| Day | Entries | Result |
|---|---|---|
| A, Oct 22 (started 1:01 PM) | 91 | **Paused at 1:10:03 PM**, on entry 17 — nine minutes in |
| A, Oct 23 (started 2:50 PM) | 164 | **Paused at 5:07:58 PM**, on entry 42 |
| A, Oct 17 (honest day) | 74 | Never paused — at most 1 fail in any 20 |
| B, Oct 18–21 (four days) | 519 | Never paused — at most 1 fail in any 20 |

- On Oct 22, 6 of the 8 fails behind the pause were at **vehicle speed** (7 to 11 mph between doors), 1
  was saved from one spot and 1 was at walking pace.
- Oct 23 was slower to catch: the houses were far apart, and she rolled slowly between them, stopping
  every one to four minutes, so most stops passed as possible. A 30-second door time would have paused
  her at entry 18 (3:08 PM). The owner kept 15 seconds so honest canvassers who drive fast between
  far-apart rural houses are safe.
- Her phone was a median 27 to 29 meters from each house on the car days, against 4 to 14 meters on
  honest days: the street, not the porch. That is under the 75-meter Far flag, which is why Far never
  fired. The review screen shows this as evidence; it never decides a pause.
- Simulated days (§K.3): honest canvassers who tap Not home and then survey whoever answers were never
  paused; a car cheat was always paused, including one who adds fake surveys seconds later and one who
  re-saves every door twice ten minutes later to try to erase it.

## What the canvasser sees

- When the door that tips it is saved, that door is kept, and one alert follows: **"That door was saved.
  Recording is now paused for review. Call your team lead."**
- A red banner on the map, the door, building and survey screens with the same words, a **Check again**
  button, and a link to the Help article that explains it.
- The outcome buttons are greyed out and **Add person** is hidden, the same way they are when a billing
  pause stops canvassing. A survey opened while paused shows a wall instead of the form; a survey already
  being typed when the pause arrives keeps its answers on screen, and Save says recording is paused.
- They can still open the map, their books, their stats and the Help Center.
- Doors they saved before the pause, including ones waiting to upload from a dead zone, still upload.
  Doors saved in a dead zone before the phone hears about the pause are kept too. Nothing they recorded is
  deleted.
- After their lead unpauses them, **Check again** picks it up at once; otherwise the phone notices within
  30 seconds. The phone needs signal once to hear about an unpause; with no signal it says it can't check
  right now.
- On an older version of the app, a door they try to save online is refused with the same words in an
  alert titled "Action not saved" (or "Survey not saved", "Person not added"), and its pin turns back.
  Doors saved offline on an old app are still accepted when they upload. Both end once the app updates.

## What admins and leads see

- **An email** to the people chosen (below), one email per person: subject *A canvasser was paused for
  review*; body *A canvasser on {campaign} ({organization}) was paused on {date} at {time} for saving
  doors faster than is possible. They can't record until someone on your team unpauses them. Nothing has
  been removed: their doors stay in your numbers unless you change them on Door Outcomes.* and a **Review
  the pause** button. It names no one and lists no addresses; the details are behind sign-in.
- **A red badge** on the Audit link inside that campaign, and a banner on the campaign's home page.
- **A Paused chip** next to the canvasser on the web Users page (org admins) and in their profile.
- **The review screen** (the campaign's Audit page on the web):
  - who, when, and on which campaign; whether the email went out;
  - the 20 visits behind the pause, with the failing ones highlighted: time, address, result, seconds
    since the last house, distance, speed, and the seconds the rule needed;
  - a plain sentence, for example *"6 of the 8 too-fast doors were at vehicle speed (7–11 mph), 1 was
    saved from one spot — usually several doors saved at once — and 1 at walking pace"*;
  - how far the phone was from each house that day;
  - every door they saved that day, marked: part of the pause, saved after it, or not judged and why;
  - buttons: **Unpause**, **Open these doors in Door Outcomes**, **See the day on the map**.
  - If the hops are impossible for one person even on foot, two phones may be signed in to one account;
    the screen says so.
- **On the phone**, the GPS audit screen has a **Paused** section across every campaign you manage. Each
  card opens a summary with **Unpause** and a link to the canvasser's day; fixing doors is done on the web
  Door Outcomes page.
- **A team lead sees only their own campaign's doors.** If the same canvasser also saved doors on another
  campaign that day, those show only as "a door on another campaign", with no address, result or distance.
  A lead whose canvasser was paused on a campaign they don't manage sees that canvasser as *Paused for
  review — an org admin can unpause*, nothing more.

## Unpausing, and fixing the doors

- **Who can unpause:** org admins, and the leads who manage the campaign where the pause happened.
- **One tap.** After an unpause the count starts over, so the next door can't re-pause them on old fails.
- **Nothing is removed automatically.** Entries stay in every number, export, report and invoice until
  someone changes them. Fix them on **Door Outcomes** (web, org admins): **Unknock** the fake ones so they
  stop counting and billing and can be knocked for real in the same round, or change a result or an
  answer. If it was an honest mistake, coach, fix what needs fixing, and unpause.
- **A record of a pause that was a false alarm** can be deleted by an org admin once it is resolved.
  Deleting it doesn't bring the old count back.

## Who gets the email

By default, the organization's **billing admins**. A billing admin can add others on the Users page: any
org admin, and any team lead (a lead only gets alerts for campaigns they manage — and a lead can be your
client). **Billing admins (always)** stays a choice of its own, so a billing admin added later is
included. The paused person is never emailed about their own pause. If nobody can be emailed, the review
screen says the email didn't go out.

## Turning it off

Automatic pause is **on for every customer organization by default**. A billing admin can turn it off on
the Users page. Turning it off unpauses anyone who is paused; turning it back on starts everyone's count
fresh. Doorline's own internal organizations (the demo the app stores review) are never paused.

## Before it turns on

1. **A preview for your organization:** on each campaign's Audit page, org admins can open **What
   automatic pause would have done**: every time the rule *would have* paused someone this season — who,
   which day, when, and which doors — without anyone being paused. Doorline also counts, across all
   customers, how often it would have fired, without names.
2. **The owner tells both customer organizations first**, since it can stop their canvassers mid-shift,
   and how to turn it off (§J has the text).
3. **Doorline switches it on** early in the morning before shifts start. One switch also turns it off
   again if anything misbehaves; phones stop blocking on their next check.

## What it doesn't do

- It doesn't hold, hide or remove anything. Billing, exports, client reports and FbTime are unchanged.
- It doesn't track anyone between doors. It uses only the GPS reading every saved door already carries.
  A 10-second location trail was considered and dropped: the Privacy Policy promises no continuous
  tracking, and a locked phone can't record one without new app builds.
- It doesn't use how long a survey was open. That measures typing on the sidewalk, not the conversation.
- It doesn't judge admins, team leads, lit drops, desk entries, or doors in apartment buildings.
- It doesn't tell canvassers the numbers. Their Help article explains what to do (save each door at the
  door, right after knocking) without the thresholds.

## Privacy in plain words

- Nothing new is collected from phones.
- Doorline keeps one new record per pause: who, when, the doors, the times and distances between them,
  how many people were emailed, and who unpaused. No raw GPS coordinates, no email addresses, no notes.
  It lives and is deleted with the campaign and the organization, like door records. Like door records,
  it stays with the organization if the canvasser deletes their account, so the work can still be
  checked; their name comes off on the same schedule.
- When a canvasser saves the same door again, the door record now keeps the earlier saves' times and GPS
  readings with it (it already kept the last one), so a re-save can't erase a visit. They live and go
  with the door record.
- The alert email names no one and lists no addresses, so what Resend receives is unchanged.
- Your organization's preview is in the console, for org admins. Doorline staff see only counts for other
  customers.
- Canvassers are told, in their Help Center, that their doors are checked for pace and that only a person
  on their team can lift a pause. Until now the audit was explained only to leads and admins.
- The owner ruled on 2026-10-24 that the Privacy Policy, the Terms and the account-deletion text need no
  change for this; the privacy record checks every sentence it touches (§M).

## Decisions (owner, 2026-10-24)

1. Every customer, on by default; an org can turn it off.
2. **No hold.** Entries stay counted; reviewers fix them on Door Outcomes. Flag reviews stay bookkeeping
   only.
3. Alerts go to billing admins by default; billing admins choose recipients in a setting.
4. Judged: Not home, Refused, Surveyed. Skipped: Wrong address, No soliciting, Restricted, units. The
   billable gap for Wrong address and No soliciting is accepted.
5. Batch entry (saving several doors at once) **should** pause: it needs coaching. The review says why.
6. 15 seconds at the door (45 for a survey), 25 mph, 8 of 20 — all in config. 15 rather than 30 for rural
   safety.
7. The email names no one and lists no addresses.
8. Unpause: org admins and the campaign's leads.
9. Customers are told before it switches on; each org gets an Off switch from day one.
10. The pause record lives with the campaign's records; after account deletion the name follows the same
    rule as door records.
11. The test fixtures are both real exports with names, IDs, addresses, answers and notes stripped and
    the GPS points moved to a made-up place with the same distances between them.
12. Dropped: the 10-second GPS trail and survey-open time.
13. Admins and team leads are never judged; only members whose role is canvasser can be paused.
14. Not a target voter is judged like Refused.
15. The message is *"Recording is paused for review. Call your team lead."*
16. There are two customer organizations; the owner tells them personally, so there is no notice command.
17. An org admin can delete a resolved pause record.
18. Built in the shared folder and shipped with the other sessions' work in one combined commit (no
    separate branch).
19. No change to the Privacy Policy, the Terms or the account-deletion text.

# Part 2 — Technical reference

## A. Shape of the feature

| New | What it is |
|---|---|
| `server/src/services/audit/paceRule.js` | The ONE rule: pure functions, no DB (§B). Used by the live check, the review screens, the preview and the replay. |
| `server/src/services/audit/pacePause.js` | `paceBlocks`, the live check, pause creation, unpause, recipients, alert dispatch, `syncPacePauseIndexes` (§C, §F, §G). |
| `server/src/models/PacePause.js` | One row per pause, with its frozen evidence (§D). |
| `server/src/routes/admin/pacePauses.js` | List, detail, unpause, delete, preview, settings (§G, §H, §I). Mounted at `/admin/pace-pauses`. |
| `server/src/migrations/replayPacePause.js` | Platform counts, read-only (§I.2). `npm run replay:pace-pause`. |
| `server/src/migrations/resolveOpenPacePauses.js` | Rollback companion (§N). `npm run pace:resolve-open`. |
| `client/src/pages/PauseLinkPage.jsx` | The email link's landing route `/pause/:orgId/:campaignId/:pauseId` (§F.3). |
| `client/src/components/audit/PacePausePanel.jsx`, `PacePausePreview.jsx` | Web review and preview (Audit page). |
| `client/src/components/users/PacePauseSettingsCard.jsx` | Web settings (Users page). |
| `mobile/lib/pace.js` | Phone: the one `setPace`, the message, the gate decision (pure parts `node --test`). |
| `mobile/components/PausedBanner.jsx` | Phone: the canvasser banner with its own poll. |
| `mobile/app/(app)/admin/pause/[id].jsx` | Phone: the admin/lead pause summary. |
| `server/test/fixtures/pace/pace-fixture-a.json`, `pace-fixture-b.json` | The two exports, anonymized (§K.2). |
| `server/test/paceRule.test.js`, `pacePause.int.test.js`, `replayPacePause.int.test.js`, `resolveOpenPacePauses.int.test.js`; `mobile/lib/pace.test.js`; client smoke tests | §K. |

| Changed | Why |
|---|---|
| `server/src/routes/mobile/canvass.js` | The gate on every recording path, the after-write check on door results and surveys, `replaced.history` in `buildReplacedSnapshot`, `createdAt wasOfflineSubmission` in the `pairRows` projection (§B.2, §C). |
| `server/src/models/CanvassActivity.js` | `replaced.history` (§B.2). |
| `server/src/models/Membership.js` | `paceRestartAt` (§B.5). |
| `server/src/models/Organization.js` | `pacePause` setting (§H). |
| `server/src/routes/mobile/bootstrap.js` | `pace` on `/mobile/bootstrap` and `/mobile/changes`; `GET /mobile/pace` (§E.1). |
| `server/src/routes/admin/memberships.js` | A role change moves `paceRestartAt` (§B.5). |
| `server/src/services/authz/campaignManagement.js` | `userManagesCampaign(userId, orgId, campaignId)` (§F.1). |
| `server/src/services/mail/recipients.js` | `billingNotifyRecipients` → `[{ email, userId }]`; `billingNotifyEmails` maps over it, unchanged for its callers (§F.1). |
| `server/src/services/mail/templates.js`, `server/src/models/EmailLog.js` | `pacePauseAlert`, and the new kind in EmailLog's kind comment (§F.2). |
| `server/src/services/reports/campaignSummaries.js` | `openPacePauses` per campaign (§F.5). |
| `server/src/services/campaigns/deleteCampaign.js`, `server/src/services/platform/deleteOrganization.js`, `server/src/services/platform/lateWriteSweep.js` | `PacePause` in `CAMPAIGN_SCOPED`, `ORG_SCOPED` and `LATE_WRITE_MODELS` (§D.4). |
| `server/src/services/users/deleteAccount.js` | `PacePause` orgs in the name-keeping list (§D.4). |
| `server/src/server.js`, `server/src/worker.js` | `syncPacePauseIndexes` at boot, the client-report collections' pattern (§D.2). |
| `server/src/webRoutes.js` | `'pause'` in `WEB_SEGMENTS`. |
| `server/src/routes/index.js` | Mount the admin router. |
| `package.json`, `server/package.json` | The two console scripts, root-proxied. |
| `mobile/lib/recordAction.js` | The gate after the in-flight lock; the tipping alert; `PACE_PAUSED` handling (§E.3). |
| `mobile/lib/offlineQueue.js` | `doFlush` hands each response's `pace` to `pace.js`, for the active org only (§E.2). |
| `mobile/lib/deltaFold.js`, `mobile/app/(app)/map.jsx` | Fold `pace` from `/changes` outside the rows guard; the banner; the quick buttons greyed (§E). |
| `mobile/app/(app)/household/[id].jsx`, `building.jsx`, `voter/[id]/survey.jsx` | `canRecord`, the banner, the survey wall, Add person (§E.4). |
| `mobile/app/(app)/admin/audit.jsx`, `admin/_layout.jsx`, `admin/index.jsx`, `admin/more.jsx`, `admin/users.jsx`, `admin/users/[id].jsx`, `mobile/components/CampaignHome.jsx` | The Paused section, the hidden `pause/[id]` route, badges, chip, profile (§F.5, §G.3, §G.4). |
| `client/src/App.jsx`, `pages/LoginPage.jsx`, `pages/AuditPage.jsx`, `pages/DashboardPage.jsx`, `pages/UsersPage.jsx`, `components/Layout.jsx`, `components/BottomNav.jsx`, `components/UserProfileModal.jsx` | Routes, the link restore, panel, preview, banner, chip, badge, settings, profile. |

Untouched on purpose: `flagDetection.js` and the `rapid` flag, `FlagReview` (still bookkeeping only),
every count, export, report, billing and FbTime pipeline.

## B. The rule (`paceRule.js`)

### B.1 Config

```js
// Every number in config, overridable per environment; the replay takes the same values as flags.
PACE_DOOR_SEC         = 15    // seconds at a door
PACE_SURVEY_SEC       = 45    // seconds at a door for a survey
PACE_TRAVEL_MPS       = 11.2  // 25 mph
PACE_WINDOW           = 20    // judged visits per window
PACE_FAILS_TO_PAUSE   = 8
PACE_SAME_VISIT_SEC   = 600   // entries at one door no more than this far apart are one visit
PACE_STILL_M          = 20    // labels only: moved less than this = "saved from one spot"
PACE_VEHICLE_MPH      = 5     // labels only: at or above = "vehicle speed"
```

Read once at module load (`paceConfig()`); a value that isn't a positive finite number falls back to the
default with one console warning. The two label values never affect a verdict.

### B.2 Entries, and what the ledger keeps

An **entry** is one save by a canvasser at a door: its time, GPS stamp, result, door, and when the server
received it. The ledger keeps only the latest entry per canvasser, door and round: "latest wins" deletes
the earlier ones before creating the new row (`canvass.js` `recordHouseholdAction` and the survey route).
So the standing row carries the earlier entries itself. The existing `replaced` snapshot gains:

```js
history: [{ at, lat, lng, accuracy, actionType, createdAt, offline }]   // ≤ 20, oldest first
```

built in `buildReplacedSnapshot` from the pre-delete prior row, never accepted from the request body:

```js
history = [...(prior.replaced?.history ?? legacyEntry(prior.replaced)), entryOf(prior)].slice(-20)
entryOf(r) = { at: r.timestamp, lat, lng, accuracy, actionType: r.reclassified?.from ?? r.actionType,
               createdAt: r.createdAt, offline: r.wasOfflineSubmission }
legacyEntry(s) = s ? [{ at: s.timestamp, ...s.location, actionType: s.actionType, createdAt: null, offline: null }] : []
```

The `pairRows` projection in both routes gains `createdAt wasOfflineSubmission`. The existing `replaced`
fields keep their meaning for the far downgrade. Rows written before this ships carry at most their one
legacy snapshot, so the replay over older data can miss an entry of a door saved three times or more.

The rule's entries are every standing row's own entry plus its `history`, minus `note_added` rows and
`via: 'bulk'` rows (the `rapid` flag's exclusions, `flagDetection.js` `computeReasons`), sorted by time and
then row order. The time is when the phone submitted: taken after the door-change confirm and the GPS gate
(`recordAction.js:347-395`, usually within a few seconds of the tap); for a survey it is the Save time. The
stamp can be a reused fix up to 15 seconds old, or up to 2 minutes on the fallback path (`location.js`
`acquire`), so a hop can be measured a little long or short; subtracting both accuracies absorbs ordinary
drift.

### B.3 Visits

Per door, entries no more than `PACE_SAME_VISIT_SEC` apart form one **visit**: a second voter, a
correction, a Not home followed by a survey when someone answers. A longer gap starts a new visit (a
callback). A visit's **result** is its last entry's. Visits are formed from times alone, with no link
between rows, so two writes to one door that raced each other on different endpoints are still one visit.

### B.4 Judging

- **A visit is judged** when its result is `not_home`, `refused`, `survey_submitted` or `not_target`; its
  door is not a unit (`isUnitAddress(household)`, [streetName.js:180](../server/src/utils/streetName.js#L180),
  the Remove-apartments rule, or the row's `knockPin === 'complex'`); and the member's role in the org is
  `canvasser` (decision 13).
- **Its predecessor** is the latest entry before the visit's first entry at a **different** door, of any
  result.
- **Two checks, from that one predecessor.** Distance is `haversineMeters` between the two stamps minus
  both accuracies, floored at 0 (`effectiveMeters` applied twice, as the far rule does).
  1. The visit's first entry fails when `gap < effective / PACE_TRAVEL_MPS + PACE_DOOR_SEC`, or
     `+ PACE_SURVEY_SEC` when that first entry is itself a survey.
  2. When a later entry in the visit is a survey, its gap from the same predecessor fails when it is under
     `effective' / PACE_TRAVEL_MPS + PACE_SURVEY_SEC`, `effective'` being the distance to that entry.
  The visit fails when either check fails. A Not home tapped after the knock and a survey saved minutes
  later when the person answers both pass; a Not home tapped from a car followed seconds later by a survey
  fails check 2.
- **Pattern** (evidence only), from the first entry's hop: raw distance < `PACE_STILL_M` → `still` ("saved
  from one spot — usually several doors saved at once"); else raw mph ≥ `PACE_VEHICLE_MPH` → `vehicle`;
  else `walking`.
- The replay reads results as originally recorded (`reclassified.from ?? actionType`), so an admin's later
  change can't rewrite history.

### B.5 Restarts, counting and the window

- **The day** is the calendar day of the visit's first entry, by its tap time, in the campaign's
  `timeZone` (`utils/timezone.js` `zonedDayRange`).
- **Restart points** live outside the pause records, so deleting a record changes nothing:
  - `Membership.paceRestartAt` (server time), moved forward with `$max` on every resolve (unpause, setting
    off, the rollback command) and on any role change (`memberships.js`);
  - `Organization.pacePause.enabledAt` (server time), stamped only when the setting turns from off to on.
- **A visit counts** when its first entry falls after the latest restart point: an entry saved live is
  compared by its `createdAt` (server time); a replay by its tap time. Fresh writes are refused while
  blocked, so anything created live after an unpause is post-unpause work, and a phone clock set wrong
  can't move entries across the restart.
- **A pause fires** when any run of `PACE_WINDOW` consecutive counted visits that day holds
  `PACE_FAILS_TO_PAUSE` fails or more (not only the latest 20, so a late batch from a stuck offline queue is
  still seen). Fewer than 20 visits is fine: 8 fails is itself the sample minimum.
- **The preview and the replay** replay restarts too: each would-be pause is treated as lifted at once.

### B.6 Exports

```js
export const paceConfig = (env = process.env) => ({ ... });
export const entriesOf = (rows) => [...];                                   // §B.2
export const visitsOf = (entries, config) => [...];                         // §B.3
export const judge = (visits, { households, judgedMember, config }) => [...];   // §B.4
export const findPause = (verdicts, { restartAt, config }) => null | { window, fails, trigger };   // §B.5
export const replayPauses = (verdicts, config) => [...];                    // §B.5, preview and replay
export const summarize = (window) => ({ fails, vehicle, still, walking, minMph, maxMph });
```

One implementation for the live check (§C), the review screens (§G), the preview and the replay (§I).

## C. The live check

### C.1 One predicate

```js
paceBlocks(org, membership) =
  switchCovers(org)                     // PACE_PAUSE === 'on' && !org.isInternal, or 'orgs:<slug,…>' naming it
  && org.pacePause?.enabled !== false
  && membership?.role === 'canvasser'
  && openPauseExists(org._id, membership.userId)   // one indexed findOne
```

It is the only answer to "is this person blocked": the gate (§C.2), `pace` on every phone response
(§E.1), the badges (§F.5) and the review screens, where each **open** pause shows *blocking* or *not
blocking — automatic pause is switched off*. With the switch off, every phone hears `paused: false` on its
next check, so the kill switch reaches updated phones as well as the server. A canvasser promoted to lead
stops being blocked at once.

- `PACE_PAUSE` (Heroku dashboard → Settings → Config Vars): unset or `off` → nothing runs and nothing
  blocks; `on` → every customer org; `orgs:<slug,…>` → only those orgs (internal ones allowed), for device
  checks. Any other value counts as off and logs one warning at boot.
- Pauses are created only when `switchCovers(org)`, the org is enabled, and the member is a canvasser.

### C.2 The gate (before any write)

```js
const PACE_PAUSED = {
  status: 403,
  code: 'PACE_PAUSED',
  message: 'Recording is paused for review. Call your team lead.',   // decision 15
};
```

Placed in `recordHouseholdAction` (after the outcome gate, before `missingLocation`), in the survey route
(after the do-not-contact block) and in the walk-up add (after the door-add policy check, before the first
`Voter` write). Everything before those points is read-only, and the 404/403 access checks still win.
Voter notes (written from the admin voter profile) and pin fixes are not gated. It refuses only when
`paceBlocks(...)` is true **and** the request is not a replay (`body.wasOfflineSubmission !== true`).

**Replays are always accepted**, blocked or not. The phone's queue deletes any queued submission a 4xx
answers ([offlineQueue.js:120](../mobile/lib/offlineQueue.js#L120)); refusing a replay would destroy an
honest canvasser's work and a cheat's evidence alike. Same trust posture as `OUTCOME_DISABLED`
([canvass.js:387](../server/src/routes/mobile/canvass.js#L387)): the flag is client-asserted, so this is
policy, not security.

### C.3 The after-write check

Runs after a successful write of a door result or a survey (the walk-up add writes no CanvassActivity row,
so it has nothing to judge); never on a superseded or struck replay (those return before any write); and
not while the member is blocked. Steps:

1. Load the canvasser's rows standing that day: `CanvassActivity.find({ organizationId, userId, timestamp:
   dayRange })`, projection `_id householdId campaignId actionType timestamp createdAt location replaced
   wasOfflineSubmission via knockPin reclassified`, served by `{ userId: 1, timestamp: -1 }`. Every entry of
   the day is on one of them: a standing row is always a door's latest entry. About 300 rows on a heavy day.
2. Unit facts for the judged doors: one `Household.find({ _id: { $in } }, 'addressLine1 addressLine2')`.
3. The restart point: `req.activeMembership.paceRestartAt` and `req.activeOrg.pacePause.enabledAt`, both
   already loaded.
4. `entriesOf` → `visitsOf` → `judge` → `findPause`. If a pause is found, create it (§D) and dispatch the
   alert (§F); the write's response carries `pace: { paused: true, tipped: true, at }`.

The check is **awaited inside a try/catch** after the write has committed: an error is logged and the door
is saved either way. Only the alert dispatch is detached, and it is called as
`dispatchPauseAlert(pause).catch(log)` with its own try/catch inside: the web process has no
`unhandledRejection` handler (only `worker.js` has one), so a rejected promise from a database blip would
otherwise take the dyno down. A unique-index race (two tipping writes at once) is caught as "already
paused".

Recomputing from the ledger on every judged write, instead of keeping a running count, means
out-of-order offline arrivals, corrections and unknocks are always seen as they now stand. The preview
reads Unknock-frozen rows as well (§I.1), so after a mid-day unknock it can show a pause the live check
never fired; it says so. Cost per door: one point read for the gate, and two bounded reads for the check.

## D. `PacePause`

### D.1 Schema

```js
{
  organizationId,                 // required, ObjectId
  campaignId,                     // required — the campaign of the visit that tipped it
  userId,                         // required — the canvasser
  status: 'paused' | 'resolved',
  firedAt,                        // server time the pause began
  triggerActivityId, triggerAt,   // the standing row of the visit that tipped it, and the visit's first time
  day, timeZone,                  // 'YYYY-MM-DD' in the campaign's zone, and the zone
  config: { doorSec, surveySec, travelMps, window, failsToPause, sameVisitSec },   // the numbers in force
  window: [{                      // the visits behind it, frozen at firedAt
    activityId,                   // the visit's standing row
    householdId, campaignId, result, at,
    prevHouseholdId, prevCampaignId, prevResult, prevAt,
    gapSec, meters, effectiveMeters, neededSec, fail, pattern,
    surveyCheck,                  // null, or { at, gapSec, meters, neededSec, fail } (§B.4 check 2)
  }],
  alert: { status: 'pending' | 'done', sent, failed, at },
  resolvedAt, resolvedBy, resolvedVia: 'unpause' | 'setting_off' | 'switch_off',
}
```

No coordinates, no addresses, no email addresses, no free text. Addresses and names are read live
(Household, `hydrateCanvassers`) when a review screen opens; the summary is computed on read. The window
is frozen because Unknock removes rows from the ledger and the evidence must survive the fix.

### D.2 Indexes

- `{ organizationId: 1, userId: 1 }` unique, partial `{ status: 'paused' }`: at most one open pause per
  canvasser per org.
- `{ organizationId: 1, userId: 1, firedAt: -1 }`: the gate and the profile history.
- `{ campaignId: 1, status: 1 }`: the badge counts and the Audit list.

Built at boot by `syncPacePauseIndexes()`, awaited before the web dyno listens and run by the worker, the
pattern the client-report collections use (`services/reports/clientReportIndexes.js`): production
autoIndex is off, and the unique index must exist before the first pause can be written.
`npm run migrate:build-indexes` lists them too.

### D.3 Lifecycle

- `paused` → `resolved` by Unpause (exactly the addressed pause: `updateOne({ _id, organizationId, status:
  'paused' })`, 409 when it isn't open), by the org turning the setting off (`setting_off`, every open pause
  in the org), or by the rollback command (`switch_off`). Every resolve also moves the member's
  `paceRestartAt`.
- Delete (decision 17): an org admin can delete a **resolved** pause. A true hard delete; the restart
  point lives on the membership, so nothing is re-armed.
- Badges and lists count only pauses whose member is active in the org; a deactivated or removed member's
  open pause shows under Resolved as *member no longer active* and stops counting.

### D.4 Retention

- Campaign delete: `CAMPAIGN_SCOPED`. Org delete: `ORG_SCOPED`. Late writers: `LATE_WRITE_MODELS`, so a
  check finishing after the sweep is swept again. The model declares real `organizationId` and `campaignId`
  paths, so under the global `strictQuery` the cascade filters can never widen to every tenant.
- Account deletion leaves it, like CanvassActivity and FlagReview (`deleteAccount.js`). The reason is fraud
  attribution, not counts: nothing reads `PacePause` for a number. The org list that keeps the deleted
  person's name for the retention window gains `PacePause.distinct('organizationId', { userId })`
  (`deleteAccount.js`, step 6), so a canvasser whose doors were all unknocked and whose membership was
  removed still has their pauses attributed. Names resolve through `hydrateCanvassers`.
- `replaced.history` lives on the CanvassActivity row and goes wherever the row goes: unknock chunks,
  cascades, the rest.

## E. The phone

### E.1 Contract (server)

- **Fresh write while blocked:** 403 `PACE_PAUSED` with the message. Today's app already shows the
  server's text: `api.js:108` builds the error from `data.error` and `recordAction.js:449` alerts it.
- **Every recording response** (201, and 200 superseded) carries `pace: { paused, at }` from `paceBlocks`,
  with `at` the server time; the write that created a pause adds `tipped: true`.
- **`/mobile/bootstrap`** and **`/mobile/changes`**: `pace: { paused, at }` on every response.
- **`GET /mobile/pace`**: `{ paused, at }` and nothing else; one indexed read.

All additive: no `MIN_CLIENT_API_VERSION` bump.

### E.2 One owner of the state

`mobile/lib/pace.js` keeps the state inside the cached bootstrap (file-backed, so it survives restarts and
dead zones) and exposes one `setPace(qc, pace)`, which ignores any answer older than the one it holds (by
`at`). Every input calls it: the bootstrap, the `/changes` fold (placed **outside** the `households.length
|| voters.length` guard in `map.jsx`, because an unpause arrives on an otherwise empty delta), every
recording response, a `PACE_PAUSED` refusal, the banner's poll (from inside its `queryFn`, so a cached
answer is never re-applied), and the offline queue. `doFlush` today discards response bodies; it gains a
registered setter (the `setRosterWriteGuard` pattern in `cache.js`) and passes each response's `pace` to
it only when the item's pinned `orgId` is the active org.

The map's `/changes` poll stops whenever the map is covered (`useFocusedPoll`, `map.jsx:541-560`; the map
stays mounted under the door and survey screens), so the banner runs **its own** poll: `useQuery(['mobile',
'pace'], GET /mobile/pace, { enabled: paused, refetchInterval: 30_000, ...useFocusedPoll() })`. **Check
again** calls its `refetch()`; if the request fails it says *Can't check right now — move to where you have
signal and tap Check again.*

### E.3 The local block

Inside `optimisticSubmit`, right after the in-flight lock and before the door-change `confirm`
(`recordAction.js:331-350`), so a blocked canvasser never sees "Change result?" followed by "Paused": when
the cached state says paused, it alerts the message and returns `{ ok: false, blocked: 'PACE_PAUSED' }`,
leaving no trace (nothing recolored, queued or sent). There is no network recheck here: the buttons are
already greyed (§E.4), the banner's poll and **Check again** clear a stale state, and a fresh tap the server
refuses still alerts correctly. Door results, surveys and the walk-up add (`recordAddVoter`) all ride
`optimisticSubmit`; pin fixes ride it too (the `requireFix: false` branch) and are exempt.

**The tipping moment:** a response with `pace.tipped` shows one alert through `alertWhenActive`
(`recordAction.js:217`, so it isn't lost if the phone was pocketed): *"That door was saved. Recording is
now paused for review. Call your team lead."*

### E.4 The screens

- `canRecord = canCanvass && !paused` greys the outcome buttons on the household screen and the map's
  quick buttons (the door list's quick Not home, `map.jsx`), following the billing-pause precedent
  (`household/[id].jsx` `canCanvass`). `building.jsx` has no `canCanvass` today and gains the same gate.
- **Add person:** its links are hidden while paused; a modal already open stays open with what was typed,
  and its Save is refused locally (folding `paused` into `canAddPerson` would unmount the open modal and
  lose the name).
- **Survey:** a wall shows only when the screen mounts while paused (the do-not-contact wall is the
  precedent) and lifts when the pause clears; it never replaces a form already showing. The mount-time
  re-survey and "Take a survey instead?" prompts skip a paused canvasser, as they skip a do-not-contact
  voter.
- `PausedBanner` (the semantic danger tokens) on the map, household, building and survey screens: the
  message, **Check again**, and a link to the canvasser Help article. Same placement rules as
  `LocationBlockedBanner` (`map.jsx:1122`).
- One-button alerts only, so the Android button-order trap (`androidAlertOrder`) doesn't arise.

### E.5 Older apps

They ignore `pace`. A fresh online tap gets the server's refusal in the caller's own alert ("Action not
saved", "Survey not saved", "Person not added"); the pin recolors and turns back; a survey screen has
already closed, so its answers are lost. Offline taps queue and are accepted later as replays; the review
screen marks them *saved after the pause*. This ends once the OTA reaches them (§N leaves time for it).

OTA only: no native module, no `app.json` change, both fingerprints unchanged.

## F. Alerts

### F.1 Recipients (`pauseRecipients(pause)` → `[{ email, userId }]`)

- The setting holds `billingAdmins` (default true) and `alertUserIds` (§H).
- From `alertUserIds`: each user who is an active member with a live account and is either an org admin or
  a lead who manages `pause.campaignId`, checked with a new `userManagesCampaign(userId, orgId,
  campaignId)` next to `canManageCampaign` (that one answers for whoever made the request — during the
  tipping write, the canvasser).
- Plus, when `billingAdmins` is on, `billingNotifyRecipients(orgId)`: a new export in
  [recipients.js](../server/src/services/mail/recipients.js) returning `{ email, userId }` for billing
  admins, or `{ email, userId: null }` for the billing-contact fallback; `billingNotifyEmails` becomes a map
  over it, unchanged for its callers.
- De-duplicated by address; minus the paused person by id and by address. If the list is empty, fall back
  to `billingNotifyRecipients` once more; still empty → the alert finishes with `sent: 0`.

### F.2 The email (`pacePauseAlert`)

- **One email per recipient**, with `meta.userId` when the recipient is a Doorline user, so no recipient
  sees another's address and EmailLog's by-account scrub covers every row it can. The billing-contact
  fallback has no account; its log row keeps the address for EmailLog's retention, as existing billing
  notices do (§M). Sends are spaced about 600 ms apart, inside Resend's default of 2 requests a second.
- Subject *A canvasser was paused for review*: neutral, because EmailLog copies subjects verbatim and the
  super-admin Emails page shows them without a grant (EMAIL.md).
- Body as in Part 1, times in the campaign's zone with its abbreviation (`tzAbbrev`). Never the canvasser's
  name, a voter, or an address (privacy.html:106).
- `kind: 'pacePauseAlert'`; EMAIL.md's catalog, template count and send-site list are updated.

### F.3 The link

`${WEB_ORIGIN}/pause/{orgId}/{campaignId}/{pauseId}`, ids in the path because login and the org picker
keep only a path. `PauseLinkPage`:

- is mounted with `requireActiveOrg={false}` (console access still required), so a reader with no active
  org — a multi-org admin just signed in, a super admin — reaches it instead of the picker;
- `LoginPage` restores a stashed `/pause/` path whatever its destination would have been (today it
  restores a deep link only when landing on a console home, `LoginPage.jsx:48-50`);
- switches the active org with `switchOrg` when the reader has a console role (admin or lead) in `orgId`;
  otherwise *You don't have access to this organization*;
- replaces the URL with `/campaigns/{campaignId}/audit/pauses/{pauseId}`, whose panel handles a deleted
  pause or campaign (*This pause is no longer here*) and a lost grant (*You no longer manage this
  campaign*).

`'pause'` joins `WEB_SEGMENTS` (`server/test/webRoutes.test.js` enforces it).

### F.4 Dispatch

`dispatchPauseAlert(pause).catch(log)` after the pause row exists with `alert.status: 'pending'`. It sends,
then sets `{ status: 'done', sent, failed, at }`. The review screen shows *Sending the email…*, *Emailed 2
people at 1:10 PM*, or *The email didn't go out*.

### F.5 Badges

- `campaignSummaries.js` gains `openPacePauses` per campaign: blocking pauses of active members, one
  aggregate over `{ organizationId, status: 'paused' }` grouped by `campaignId`, checked against active
  memberships and `paceBlocks`. It rides the existing `GET /admin/campaigns` and `campaign-rollup`
  responses, which already pre-filter campaigns for leads, so no new poll.
- Web: the Audit nav badge (`Layout.jsx`, `BottomNav.jsx`) shows paused canvassers first (title *1
  canvasser paused*), mock-GPS flags otherwise; a danger `NextStepBanner` on the campaign home above the
  mock-GPS one, riding the rollup's 30-second poll.
- Phone admin: the campaign overview pill, the GPS-audit tile badge and the More-row badge, the three
  places the mock-GPS nudge uses (`admin/index.jsx`, `CampaignHome.jsx`, `more.jsx`).

## G. Review and unpause

### G.1 Endpoints (`/admin/pace-pauses`, `requireOrgRole('admin', 'lead')`)

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/` | admins, leads | `?status=paused\|resolved\|all&campaignId=&userId=`. Admins: the org. Leads: pauses on campaigns they manage, plus `{ userId, name, paused: true, elsewhere: true }` for a canvasser on their roster blocked by a pause on another campaign. Each open pause carries `blocking`. The response carries the org's `enabled`. |
| GET | `/:id` | admins; leads managing its campaign | The pause, its frozen window, names and addresses, the summary, that day's median distance from each house, the day's saved doors with their marks, `blocking`. |
| POST | `/:id/unpause` | same | Resolves exactly that pause; 409 when it isn't open. |
| DELETE | `/:id` | org admins | A resolved pause only. |
| GET | `/preview` | org admins | §I.1. |
| GET, PATCH | `/settings` | org admins; PATCH needs `role === 'admin'` **and** `billingAccess` (or a super admin) | §H. |

- **Every lookup is org-scoped:** `PacePause.findOne({ _id, organizationId: req.activeOrg._id })`, lists
  filtered the same way. `canManageCampaign` passes any org admin without checking which org a campaign is
  in, so the org filter is what keeps one org's pauses away from another's admins.
- **Lead redaction.** For a viewer who isn't an org admin, a row on a campaign they don't manage (in the
  window, the day list, or as a predecessor) comes back as `{ at, fail, otherCampaign: true }`; a hop with
  a redacted end keeps only `gapSec` and `fail`, never meters, needed seconds or speed (two hops from known
  houses would otherwise locate the hidden door); the summary and the distance figure use managed rows
  only. A lead can be the paying client (ROLES.md), and leads are walled per campaign everywhere else
  (`reports.js:103-106`, `memberships.js`).
- **The roster line.** "On their roster" means a CampaignAssignment on a campaign the lead manages, the
  same set `memberships.js` `leadVisibleUserIds` shows them. The line names the canvasser (a name the lead
  already sees on their roster) and nothing about the other campaign. It does tell the lead that this
  canvasser can't record, and so that the block came from elsewhere; that minimal disclosure is recorded in
  §M.
- `addAuditSubjects(res, 'user', pause.userId)` on the detail, as the `:userId` param does in `reports.js`.
  Vendor (support-grant) requests are logged by the fail-closed access log with no change.

### G.2 Web review (Audit page)

- A **Paused canvassers** panel above the flag summary lists the campaign's pauses and the roster lines (a
  **Show resolved** toggle adds the rest). It polls on its own, whatever the page's date range, and joins
  the page's `liveStatusProps` so the live pill can't call it fresh when it isn't.
- Each opens `PacePausePanel` at the nested route `/campaigns/:campaignId/audit/pauses/:pauseId`, read with
  `useParams` (the page reads its other URL filters only once at mount).
- The panel: the facts, *blocking* or not, the alert line, the summary sentence, the window table with the
  failing rows highlighted, the distance figure, the day's doors with their marks, and the actions:
  - **Unpause** on an open pause, which invalidates `['admin','campaigns']`, the campaign rollup,
    `['memberships']` and the pause queries, the same set a flag review refreshes;
  - **Open in Door Outcomes** → `/campaigns/{campaignId}/outcomes?userId={id}&dateFrom={day}&dateTo={day}`
    (the page seeds these from the URL, `DoorOutcomesPage.jsx:101-117`; org admins only, like Door
    Outcomes);
  - **See the day on the map** → the existing flag deep link with `userId`, `from`, `to`;
  - **Delete record** on a resolved pause (org admins).
- **What automatic pause would have done** (§I.1): org admins only, hidden for leads, loaded when opened.

### G.3 Phone review

- `admin/audit.jsx` gains a **Paused** section at the top listing pauses across every campaign the viewer
  manages (not filtered by the campaign chip, which the More-row badge also ignores), naming the campaign,
  plus the roster lines. Live poll.
- Cards open `admin/pause/[id].jsx`, registered in `admin/_layout.jsx` as `<Tabs.Screen name="pause/[id]"
  options={{ href: null }} />`: the facts, the summary sentence, the window, **Unpause** on an open pause, a
  link to the canvasser's day (`admin/canvasser/[id]/day/[date]`, with `pause.campaignId`), and *An org
  admin fixes doors on the web Door Outcomes page.*

### G.4 People surfaces

No change to the member list endpoint. The web Users page (org admins only) and the profile read
`GET /admin/pace-pauses?status=paused` and `?userId=`: a **Paused for review** chip, and in the profile
*Paused for review on {campaign} since {time}* with **Review** and **Unpause**, plus past pauses. On the
phone Users list the badge order is deleted, then inactive, then paused, one badge per row.

## H. Settings

```js
// Organization
pacePause: {
  enabled: { type: Boolean, default: true },
  billingAdmins: { type: Boolean, default: true },
  alertUserIds: { type: [ObjectId], default: undefined },   // undefined = none chosen
  enabledAt: { type: Date, default: null },                  // set only by an off → on change
  changedAt: { type: Date, default: null },                  // any change, for the record
  changedBy: { type: ObjectId, ref: 'User', default: null },
}
```

- `default: undefined` on the array is load-bearing (the Mongoose default-writing trap). PATCH writes
  dotted paths only, because assigning the object would wipe the sibling fields; `[]` unsets the list; ids
  are validated against eligible members and capped at 25. `enabledAt` is stamped by a conditional update
  (`enabled: false` → `true`), so saving recipients never restarts anyone's count.
- `GET /settings` returns the setting, the eligible people for the picker, and `live` (whether the switch
  covers this org). Org admins only: the picker lists every admin and lead, which leads must not see. Leads
  see `enabled` on the pause list.
- The web Users page card, **Automatic pause**: On/Off, *Who gets the email* (**Billing admins (always)**
  plus a picker of org admins and leads, with a note that a lead may be your client). Billing admins edit;
  other admins read it. While `live` is false it reads *Automatic pause isn't running yet* before go-live,
  and *Doorline has switched automatic pause off for now* after it.
- Turning it Off asks first when someone is paused (*This unpauses 1 canvasser*) and resolves those pauses
  (`setting_off`). Turning it On stamps `enabledAt`, which restarts every count (§B.5).
- Web only; the phone shows nothing about the setting.

## I. The preview and the replay

### I.1 The preview (in the product, org admins)

`GET /admin/pace-pauses/preview?campaignId=&from=YYYY-MM-DD&to=YYYY-MM-DD` finds the canvassers with rows on
that campaign in the range (`{ campaignId, timestamp }`), then for each one loads their rows in the org
from the range's start to now (`{ userId, timestamp }`, one canvasser at a time), so a door re-saved on a
later day keeps its earlier visit. Unknock-frozen rows come from an aggregation (`$unwind` on
`UnknockRunChunk.rows`, `$match` on `rows.userId` and the range, projected to the fields the rule reads),
merged with live rows and de-duplicated by `_id`, the live row winning (an Unknock undo re-inserts the
frozen rows with their ids and keeps the chunks; a visit struck twice sits in two runs). Visits are
bucketed by their first entry's day; `replayPauses` runs with each would-be pause lifted at once. It
returns the would-be pauses whose tipping visit is on that campaign: canvasser, day, local time, entry
number, the window and its summary. At most 120 days; rows (chunk rows included) are counted against a cap
before anything is loaded, refusing rather than truncating. The page labels it *Includes doors since
unknocked; the live check reads only the doors still recorded*, and shows it before and after go-live.

### I.2 The replay (console, counts only)

```
npm run replay:pace-pause                                     # every customer org
npm run replay:pace-pause -- --since=2026-08-01 --door=20      # a window; any PACE_* value as a flag
```

Read-only. The same loader and rule as the preview, per org and per canvasser; skips internal and deleting
orgs; prints per org: canvassers and days scanned, days and canvassers that would have paused, pauses in
total, the pattern mix of the fails, fails on long hops (400 m or more, the rural-driving check), and
visits that began with a Not home and ended surveyed (how often check 2 applies). Counts under 3 print as
*fewer than 3*: staff can see an org's member list, so a 1 would point at a person. No names, ids,
addresses or coordinates, matching the console precedent (`audit:gps-stamps`). Root-proxied with the
trailing `--`, run from the Heroku dashboard (More → Run console), late in the evening: it is a full scan.

## J. Telling customers

There are two customer organizations, so the owner sends this personally (decision 16); there is no notice
command. The same facts go on the Users-page card and in the lead and admin Help article, so an
organization created later learns them too:

> **Subject:** A change to how Doorline handles impossible door pace
>
> Starting {date}, Doorline will automatically pause a canvasser's recording when their doors come in
> faster than anyone could knock them — for example, doors saved from a moving car, or several doors saved
> at once from one spot. A paused canvasser sees *"Recording is paused for review. Call your team lead."*
> and can't record until someone on your team unpauses them. Nothing they recorded is removed or hidden:
> you review the doors and fix any on Door Outcomes. Org admins and the team leads on that campaign —
> including any client you've given lead access — can see and lift a pause. You'll get an email when it
> happens; you can choose who gets these emails, or turn automatic pause off, on the Users page. You may
> want to let your canvassers know.

## K. Tests

### K.1 Suites

- **`server/test/paceRule.test.js` (pure).** Against the fixtures (dates shifted, §K.2): A pauses on its
  first car day within its first 20 entries, first at entry 17 (13:10:03 local); A pauses on its second car
  day, first at entry 42; A never pauses on its honest day (worst window 1); B never pauses on any of its
  four days (worst window 1). Cases:
  - visits: two voters at a door; a correction within 10 minutes; tap-twice (judged at the first tap); a
    callback after 10 minutes, then a correction within 10 minutes of the callback (the first visit
    survives); Wrong address corrected to Not home (judged at the first tap); two racing rows at one door
    with no snapshot link (one visit);
  - check 2: Not home then a survey minutes later passes; Not home then a survey seconds later fails;
  - a unit and a complex pin; skipped results as predecessors; notes and desk rows ignored; Not a target
    voter judged; `reclassified.from`;
  - restarts: after an unpause, after deleting the resolved record (no re-arm), an overnight unpause
    followed by late uploads of the paused day, a re-enable mid-day, a phone clock set a day ahead or back;
  - a window that isn't the latest 20; the time-then-row-order tie-break; bad config falling back.
- **`server/test/pacePause.int.test.js`** (throwaway mongod, the real app over http; the boot index sync
  awaited first):
  - the 8th fail pauses, and the tipping 201 carries `pace` with `tipped`; an admin or a lead canvassing
    is never paused; a canvasser promoted to lead is no longer blocked;
  - `replaced.history` is built server-side across three re-saves and one sent in the body is ignored;
  - a fresh write while blocked gets 403 `PACE_PAUSED` with the exact message and writes nothing, on every
    gated path; pin fixes and voter notes are never gated;
  - a replay while blocked is accepted and carries `pace`; superseded replays never evaluate;
  - two racing tipping writes leave one pause;
  - unpause: org admin yes, managing lead yes, other lead 403; a lead of A posting to a resolved A pause
    while an open B pause exists → 409 and B stays open; the restart; delete then the next door → no pause;
  - `PACE_PAUSE` unset → nothing blocks and `pace.paused` is false everywhere; `orgs:<slug>` covers only
    that org; internal orgs never pause; org off → nothing, turning it off resolves open pauses, turning it
    on restarts counts, and a recipients-only PATCH doesn't;
  - recipients: billing admins by default, the setting, ineligible ids skipped, the paused person excluded,
    the fallback;
  - **one email per recipient, a neutral subject, and no canvasser name, voter name or address in any
    message** (outbox, `RESEND_API_KEY=test:accept`); **no `@` anywhere in a PacePause document**;
  - a failing recipients query still returns 201 and the process stays up;
  - `/changes`, `/bootstrap` and `GET /mobile/pace` carry `pace`; `openPacePauses` on both campaign
    endpoints, ignoring inactive members;
  - org X's admin gets 404 on org Y's pause; campaign A's lead never receives a campaign-B household,
    address, result, campaign id, distance or needed seconds; the roster line carries a name and nothing
    else; leads get 403 on `/settings` and `/preview`; PATCH needs admin plus billing access, and a
    dotted-path PATCH keeps the sibling fields;
  - campaign and org deletes remove pauses, the late-write sweep catches one written after the sweep,
    account deletion keeps them and keeps the name's org;
  - the preview: org admins only, range and row caps, a later-day re-save keeps the earlier visit,
    unknock-then-undo leaves it unchanged.
- **`server/test/replayPacePause.int.test.js`:** no writes (collection counts before and after), small
  counts suppressed, internal and deleting orgs skipped, chunk rows de-duplicated.
- **`server/test/resolveOpenPacePauses.int.test.js`:** the dry run changes nothing; `--apply` resolves
  every open pause with `switch_off` and moves each member's restart point.
- **Phone:** `mobile/lib/pace.test.js` — `setPace` from every input (including a queued upload's response,
  and one pinned to another org, ignored), older answers ignored, the gate decision, the `tipped` alert.
  **Web:** smoke renders of the panel, the preview and the settings card, and `PauseLinkPage` for a
  signed-out multi-org admin and a super admin.
- Then every suite on the combined tree (client, mobile, server unit and `test:int`) and `npm run
  audit:mobile-api` (§N.3).

### K.2 Fixtures

`pace-fixture-a.json` and `pace-fixture-b.json`: only tap time, result, an opaque door number, unit and
offline flags, the replaced entry's time and result (the export carries no replaced location), accuracy and
distance from house. Coordinates are converted to east/north meters from the file's first reading and
re-placed around a made-up point in open ocean, so every distance between readings survives (worst
difference 3 cm, verified 2026-10-24). Dates are shifted back 56 days (same weekday, same daylight time);
clock times are kept. The replay on the anonymized files reproduces the table above. Generated by a
scratchpad script that is never committed; the raw exports never enter the repo. Residual: anyone with
production database access could match the clock times back to the original rows, but that person can
already read the originals.

### K.3 Simulated days

`paceRule.test.js` also generates days with a seeded random walk (120 doors 15 to 45 m apart at walking
pace, GPS jitter, accuracy 5 to 10 m): an honest canvasser who taps Not home after waiting 10 or 20 seconds
and surveys 25 or 40 percent of doors a few minutes later is never paused; a car cheat at 8 to 15 mph is
always paused, with or without fake surveys seconds after each Not home, and when every door is re-saved
twice ten minutes later. A scratch prototype of this rule gave exactly those results over 200 days each on
2026-10-24.

## L. Docs and Help Center

- **AUDIT.md:** Part 1 *Automatic pause* and Part 2 sections (rule, visits, model, endpoints, invariants);
  this proposal is the design record. **CANVASSER_APP.md** (what a paused canvasser sees), **ADMIN_APP.md**
  (the phone review), **MAPS.md** (the door-write gates, `replaced.history` and the `/changes` payload),
  **VOTERS.md** (the walk-up add gate), **CAMPAIGNS.md** (recording-time refusals), **EMAIL.md** (the kind,
  the template count, the send sites), **OPERATIONS.md** (the two console commands, the `PACE_*` config
  vars, the device-check org), **ROLES.md** (who can unpause, who is never judged), **USERS.md** (chip and
  settings).
- **Help Center** — every new sentence ships with the server deploy, before the phones update and before
  the switch is on, and is read in organizations that turned it off and in the demo: it is written to be
  true in all of those (*When automatic pause is on…*), never with a date.
  - New canvasser FAQ `why-is-recording-paused` (what happened, what to do, save each door at the door, no
    numbers, nothing about what isn't judged), linked from the banner.
  - New lead FAQ `a-canvasser-was-paused`, read by leads and admins (the email, the review, unpausing, who
    gets alerts, turning it off); admin-only steps are named, not linked (admin articles answer *not found*
    to leads, `loadHelp.js`).
  - Updates: `guides/audit.md`, `pages/page-audit.md`, `faq/faked-surveys-cleanup.md`,
    `faq/team-lead-vs-admin.md` (who can unpause; it is read by canvassers too, so it doesn't link the lead
    FAQ), `guides/canvasser-offline.md`, `guides/canvasser-map.md` (a second red notice besides the
    location one), `getting-started/canvasser-first-day.md`.
  - `faq/paper-canvass-and-your-reports.md`: enter paper results from a lead or admin account, which is
    never judged; it names `record-a-missed-survey` without linking it (that article is admin-only).
  - An `_INBOX.md` entry.

## M. Privacy record — item 39 (item 38 is the client reports upgrade)

**This affects what the Privacy Policy claims about canvassing records, location use and what stays after
account deletion.** Drafted in the house shape of items 37 and 38 at build time:

- **Header stamp:** status, and the verdict that no published sentence becomes false once §D, §F and §G
  ship as designed.
- **What is new:**
  - the first automated adverse action about a named worker (recording paused pending a person) and the
    first stored machine verdict (`PacePause`): ids, times, seconds, meters, speeds, recipient counts and
    who resolved it; no coordinates, addresses, email addresses or free text;
  - `CanvassActivity.replaced.history`: the earlier saves' times and GPS stamps at the same door by the same
    canvasser in the same round (the snapshot already held the last one); same row, same retention;
  - `Membership.paceRestartAt` and the organization setting.
- **Access:** org admins; leads on the pause's campaign, with other campaigns' doors redacted to time and
  verdict; a lead also learns, through the roster line, that a canvasser on their roster is blocked by a
  pause they can't see (the one fact `memberships.js` otherwise withholds, here disclosed because the
  canvasser can't work the lead's campaign).
- **Retention:** with the campaign and the org, swept for late writes; survives account deletion for fraud
  attribution, the name per the DeletedUserRecord window; deletable by an org admin once resolved (decision
  17).
- **Claims checked** (each with its line): privacy.html:90, :94, :101, :105, :106, :112, :122, :127, :128,
  :133, :137, :143; delete-account.html:100-101; the in-app deletion sheet (`auth.js`, the deletion summary
  route); terms.html:98 and §13/§15; DPA §2 (on by default rests on the customer's "use and configuration"
  plus the notice and the Off switch), §6 (no new subprocessor, no notice event), §7 and §9.
- **EmailLog:** a neutral subject; one row per recipient with `meta.userId`; the billing-contact fallback
  keeps its address for EmailLog's retention, as existing billing notices do; rows outlive org deletion as
  today.
- **Inline stamps:** §H16(c) (narrowed in disclosure — canvassers are now told about pace checks and that
  only a person can lift a pause — but widened in kind: a stored automated finding; the far, rapid, one-spot
  and weak-GPS flags are still explained only to leads and admins; its "no notification capability" line is
  stale), C10 (a new enforcement use of the stamps, and the stamps' history), A4 (beside FlagReview), E12
  (the preview stays in the product; the console prints counts), and the EmailLog entry.
- **Owner ruling (decision 19, 2026-10-24): no wording change.** The record states where the published text
  is silent rather than false, so the ruling is on file with its reasons: privacy.html §Canvassing activity
  and §Location don't mention that location stamps may automatically pause a canvasser's recording pending
  a person's review (the use falls under "to operate the canvass", privacy.html:90, and the customer's "use
  and configuration of the Service's features", DPA §2); and privacy.html:128, delete-account.html:100, the
  in-app deletion sheet and the delete-my-account FAQ don't mention that a review of a person's work, such as
  a pause record, stays with the organization after account deletion, the same silence FlagReview has today
  (§H16(c)).

## N. Ship order and gates

1. **Owner decisions:** made (decisions 1 to 19).
2. **The shared folder** (decision 18). HEAD `aa01027`, committed but not yet pushed, already holds the
   security fixes for items 35 and 36; their deploy is pending, and privacy.html :105/:115 and DPA §4 stay
   untrue until it ships. To ship those alone, push and deploy `main` now, before the combined commit
   lands. The combined commit then carries automatic pause together with the client reports upgrade (not
   to be deployed until its stages land; two code-review rounds and the owner's walkthrough remain) and the
   admin account deletion. **So automatic pause goes live when the slowest of them is ready**; with
   Election Day on 2026-11-03, the owner decides at hand-off whether to wait or ship it alone. The hand-off
   lists every session's work, combines their commit messages and lists every session's deploy and console
   steps in order.
3. **Before committing:** every suite on the combined tree; `npm run audit:mobile-api` with no argument
   (it flags other sessions' files too; read the flagged diffs of all of them); a scan of untracked files
   for scratch artifacts. `-- main` is a no-op once everything is on `main`.
4. **Deploy:** Heroku dashboard → Deploy → Manual deploy (`main`), with `PACE_PAUSE` unset. Nothing blocks,
   the screens exist and stay empty, the preview works, the settings card reads *Automatic pause isn't
   running yet*. The new collections' indexes build at boot.
5. **Indexes:** `npm run migrate:build-indexes` (Heroku dashboard → More → Run console; PacePause's three
   show as already built, plus whatever the other works add), then `npm run migrate:build-indexes --
   --apply`. Run every other session's console steps in the order the hand-off lists.
6. **Look:** open the preview on your own campaigns' Audit pages; run `npm run replay:pace-pause` for the
   counts across customers. Tune `PACE_*` config vars only if the owner decides to.
7. **Phone**, on the owner's machine in `mobile/`: check `git status --short mobile/` is clean, run `npm run
   ota:staging`, and check again afterwards. The same publish carries the account deletion's phone screens,
   so their staging check runs too. The device check needs a test organization:
   - as super admin, create one from the web console's **New organization** dialog (a trial org; any slug
     works with `orgs:`), with a survey campaign of made-up single-family addresses (units are never
     judged), a published book assigned to a test canvasser account, and a test admin to unpause;
   - set `PACE_PAUSE=orgs:<that slug>` (Config Vars; it restarts the dynos, so pick a quiet hour) and check
     that org's Users-page card reads *on*, since a mistyped slug does nothing;
   - on a staging phone as the test canvasser: save eight different doors seconds apart from one spot; check
     the tipping alert, the greyed buttons, the banner and Check again, a survey wall, an unpause reaching
     the door screen, and an offline upload; on a production-lane phone still on the old bundle, check the
     refusal;
   - unset the var, delete the test org, then `npm run ota:production`.
   Publishing is never run by an agent; every other command in this list is run from the repo root before
   hand-over.
8. **Wording:** none (decision 19).
9. **Tell customers:** the owner sends §J's text to both customer organizations.
10. **Leave time** after the production OTA for phones to update (the owner picks how long; old apps let
    offline doors through while paused).
11. **Switch on:** `PACE_PAUSE=on` in Config Vars, early in the morning before shifts start, since doors
    saved earlier that day would count. No deploy.

**Rollback:** set `PACE_PAUSE=off`. Nothing blocks on the server at once, and phones clear on their next
check (the banner's poll, Check again, the map's delta). Turning it back on has no restart of its own, so
do it before shifts start too; before then, decide about the pauses left open, which block again when it is
back on. If they were false alarms, run `npm run pace:resolve-open` (dry: how many, per org, no names), then
`npm run pace:resolve-open -- --apply` (`resolvedVia: 'switch_off'`, which also moves each member's restart
point).

## O. Invariants and traps

1. Never refuse a replay. The queue deletes what a 4xx answers.
2. One rule (`paceRule.js`) for the live check, the review screens, the preview and the replay.
3. One predicate (`paceBlocks`) for the gate, every phone answer, the badges and the screens, and it
   includes the canvasser role.
4. A visit is judged once, at its first entry, and again at its first survey, both from the same
   predecessor; visits come from times at a door, never from links between rows.
5. `replaced.history` is built server-side from the pre-delete row, never read from the request.
6. Compare with the last **different** door.
7. Restart points live on the membership and the org setting, never on a deletable record; live entries
   are compared by `createdAt`, replays by tap time.
8. Every pause lookup filters `organizationId`; the day query always does.
9. A lead never receives a household, address, result, campaign, distance or needed seconds from a campaign
   they don't manage.
10. Unpause resolves exactly the addressed open pause.
11. The email names no one, lists no addresses, goes one per recipient, and has a neutral subject.
12. `PacePause` stores no coordinates, addresses, email addresses or free text.
13. At most one open pause per member per org; its index is built at boot.
14. The check is awaited in a try/catch after the write commits; only the alert dispatch is detached, and
    it always ends in `.catch`.
15. `alertUserIds` defaults to `undefined`; settings are written by dotted path; only an off → on change
    stamps `enabledAt`.
16. Internal orgs are never paused unless named in `PACE_PAUSE=orgs:…`.
17. Nothing reads `PacePause` to change a count, an export, a report, a bill or FbTime.

## P. Round 1 questions, answered

Round 1 raised seven questions; the owner answered them on 2026-10-24 (decisions 13 to 19):

- **Who is judged:** canvassers only. Org admins and team leads review and unpause, and they enter paper
  results door by door, which is batch entry by definition; judging them would have needed self-unpause
  rules with dead ends (a lead who can't clear their own pause). Their doors still show in the GPS audit
  flags.
- **Not a target voter:** judged like Refused (someone answered, and it bills).
- **The message:** *"Recording is paused for review. Call your team lead."* The first wording, *"Your
  account is paused for review. Call your field lead."*, collided with the billing pause's *"This account is
  paused — canvassing is disabled"* (`EntitlementBanner.jsx`), overstated what stops (only recording), and
  used "field lead", which the product doesn't.
- **Telling customers:** two customer organizations, told by the owner personally; no notice command.
- **Deleting a pause record:** org admins can delete a resolved pause, so a false alarm doesn't follow an
  honest canvasser (privacy.html:133 offers correction and deletion).
- **Where it is built:** the shared folder, in one combined commit with the other sessions' work (§N.2).
- **Policy and Terms wording:** no change (§M).

## Q. Review round 1

Three reviewers, 2026-10-24, each against the code: server correctness (1 blocker, 9 major, 8 minor),
owner walkthrough and simplicity (2 blocker, 8 major, 10 minor), privacy, release and consistency (3
blocker, 11 major, 8 minor). Every finding was checked against the code before it was accepted. What
changed in revision 2:

- **Kill switch:** one predicate (`paceBlocks`) decides every answer, so turning it off reaches updated
  phones; re-enabling and the rollback command are defined (all three reviewers).
- **Leads:** other campaigns' doors are redacted, the settings routes are org-admin only, the member-list
  field is gone (two reviewers).
- **Visits:** the delete-then-create ledger meant a door saved twice was never judged, so saving each door
  twice would have dodged the rule.
- **Restart:** an overnight unpause followed by late uploads would have re-paused on old fails. Any window
  is checked, not only the latest 20.
- **Phone:** the map's poll stops under the door and survey screens, so unpausing never reached them; the
  banner got its own poll. Queued uploads tell the phone. The tipping moment, the greyed buttons and the
  survey wall are specified.
- **Email:** one per recipient (the mailer sends one message to everyone in `to`), a neutral subject
  (subjects are logged and shown to staff), no addresses stored, the paused person excluded, recipients
  checked with a new user-based helper.
- **Safety:** the alert dispatch can't crash the web process; lookups are org-scoped; PATCH needs admin
  plus billing access; late writes are swept; account deletion keeps the name's org.
- **Internal orgs** are exempt; a scoped switch value allows device checks before go-live (staging phones
  talk to the production server).
- **Replay:** the detail moved into the product as the preview; the console prints counts only, suppresses
  small counts, skips internal and deleting orgs, and de-duplicates Unknock-frozen rows.
- **Link:** the email link carries its ids in the path, because login and the org picker drop query
  strings.
- **Cut:** the unpause note, the stored summary, the 30-day distance baseline, the member-list field, the
  phone's read-only setting.

## R. Review round 2

Two reviewers, 2026-10-24: the new mechanisms, with simulations against the fixtures and a write-path
model (1 blocker, 6 major, 11 minor); a walkthrough with a rehearsal of the ship steps across every
session's pending work (1 blocker, 4 major, 14 minor). Both found the same blocker independently. Every
finding was checked against the code, and the revised rule was prototyped against the fixtures and
simulated days before this revision. What changed in revision 4:

- **Deleting a resolved pause re-armed it** (both reviewers): the restart point was the record's
  `resolvedAt`. Restart points now live on the membership (`paceRestartAt`) and the org setting
  (`enabledAt`).
- **The visit rule, rebuilt.** Revision 2's survey allowance was applied at a visit's first tap, which
  would have paused honest canvassers who tap Not home and then survey whoever answers (simulated: up to
  every day at a 40 percent answer rate); it is now a second check at the first survey, from the same
  predecessor. Revision 2's `replaced.visit` was one level deep, so a callback followed by a correction
  erased the first visit; the standing row now keeps the whole history (`replaced.history`, up to 20), and
  visits are formed from times at a door rather than from links, which also covers racing writes with no
  snapshot. A later-day re-save no longer drops the earlier visit from the preview.
- **Clocks:** restarts were compared with phone time, so a phone clock set a day ahead or back dodged them;
  live entries are now compared by server receive time.
- **Unpause** resolves exactly the addressed open pause (a lead could lift another campaign's pause), and
  *blocking* is shown per open pause.
- **Redaction** dropped distance and needed seconds from hops to hidden doors (two hops located the door);
  the roster line is defined, named, and recorded in §M.
- **Roles:** `paceBlocks` includes the canvasser role; a role change moves the restart point.
- **Phone:** one gate after the in-flight lock with no network recheck (the greyed buttons made it
  unreachable), `pace` stamped with server time and applied in order, queued uploads applied only for the
  active org, `tipped` for the alert, an offline wording, and Add person and the survey wall that don't
  discard what is on screen.
- **Email:** recipients with user ids (`billingNotifyRecipients`), sends spaced for Resend's rate limit, a
  pending state written first.
- **Link:** reachable for multi-org admins and super admins (`requireActiveOrg={false}` and the login
  restore), switching org only into a console role, campaign id in the path.
- **Indexes** build at boot, the client-report collections' pattern, which removed the index gate.
- **Ship:** the security fixes already in HEAD, the consequence of one combined commit for go-live, the
  test organization and its setup, publishing from `mobile/` on a clean folder, switching back on before
  shifts.
- **Cut:** the after-write check on the walk-up add (it writes no door row), the phone's network recheck,
  three alert states.

## As built (2026-10-24)

Built in the shared folder (decision 18), uncommitted; the combined commit carries the other sessions'
work too. Doc of record: [AUDIT.md](AUDIT.md) → *Automatic pause* and §G; the phone in
[CANVASSER_APP.md](CANVASSER_APP.md) and [ADMIN_APP.md](ADMIN_APP.md); release steps in
[OPERATIONS.md](OPERATIONS.md); privacy item 39 in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).
Everything in §B–§I shipped as designed, except:

- **The refusal carries the state.** The 403 `PACE_PAUSED` body also carries `pace: { paused: true, at }`
  stamped by the server (`sendRouteError` copies it), so the phone orders a refusal against its other
  answers on one clock instead of its own. Additive.
- **`GET /:id`** names the day's marked list `dayEntries`; `day` stays the pause's date string. A settings
  save by an admin without billing access is 403 `billing-access-required`.
- **The web card's off line** reads *Automatic pause isn't running for your organization right now.* (§N
  step 4 said *…isn't running yet*): an organization sees the same line after Doorline switches it off.
- **Phone — where the state lives.** `setPace` sits in `lib/recordAction.js` beside `writeBootstrap`, the
  bootstrap's writer; the rules are pure in `lib/pace.js` (`newerPace`, `withPace`, `isPaused`,
  `blocksRecording`, `flushAnswerApplies`, `pausedUserIds`, the messages) so node tests them. A recording
  reply's `pace` folds into the same cache write as its `reconcile`, and the roster fetch keeps the newer of
  the held and the fetched answer (`bootstrapQuery.js`).
- **Phone — the quick buttons.** The door list's one-tap Not home and the building's unit buttons grey on
  `canRecord = canCanvass && !paused` (§E.4's formula), so they now also grey during a billing pause, which
  they didn't before; the door screen's disabled buttons now dim too.
- **Phone — the survey screen.** `SurveyForm` gained a `banner` slot and `SurveyWall` a body, for the banner.
  The wall is latched at mount (`pauseWall`) and never comes back once lifted.
- **Phone — the admin side.** One list query (`lib/pacePauses.js`, with `invalidatePaceCaches`); the GPS
  audit's section folds at three with **Show all** (`components/PausedCanvassersSection.jsx`); the pause
  screen (`app/(app)/admin/pause/[id].jsx`) has no Delete and no day list — **See their day** opens the
  canvasser's day screen; the wording is `lib/pacePauseText.js`, a MIRROR of the web's that its test
  compares sentence by sentence.
- **Email.** `pacePauseAlert` added to `npm run mail:preview` and to `EmailLog`'s kind comment.
- **Tests beyond §K.** `pacePause.int.test.js` also pins the refusal's `pace` and a stored record holding no
  email address, coordinate, street address, name or note; `mobile/lib/pace.test.js` (7) and
  `pacePauseText.test.js` (2).
- **Help Center.** The canvasser articles leave out that doors saved offline after a pause are still
  accepted, which would teach a way around it; the lead article lists what isn't judged, so the review's
  *Not judged* marks read clearly.
- **After release (2026-10-25): the preview crashed the web dyno.** A 22-day preview of a busy campaign
  worked out every door's day once per day of the range, with a new date formatter each time; the 1 GB web
  dyno reached about 4 GB. Fixed by sharing formatters in `utils/timezone.js` and grouping rows by day in one
  pass (22.9 s and 1,955 MB → 2.4 s and 214 MB on the same data), and the size limit's default dropped to
  150,000 rows with `PACE_PREVIEW_ROW_CAP` = `1` as the preview's off switch. Details in
  [OPERATIONS.md](OPERATIONS.md) → *If the preview takes the web server down*.
- **The preview removed (owner, 2026-10-25).** Once the test pause on the demo had worked, the owner had *What
  automatic pause would have done* (§I.1) taken out: the `GET /admin/pace-pauses/preview` route, its Audit-page
  panel, its size limit (`PACE_PREVIEW_ROW_CAP`) and its tests. The console replay (§I.2) stays, and so do the
  shared timezone formatters from the crash fix. §I.1 above is kept as the design record.
