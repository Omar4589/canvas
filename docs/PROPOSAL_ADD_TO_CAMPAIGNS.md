# Proposal: Pick campaigns when you add someone from All campaigns, and change them from their profile

> **Status: BUILT 2026-10-30 (uncommitted), to this plan after the owner's "build it" the same day; two code
> review rounds follow (§N). Deploy and the phone update pending (§I). Where the build differs from the plan is in
> [§M As built](#m-as-built-2026-10-30).**
>
> - **Owner rulings** (four, 2026-10-30, all recorded in §K):
>   1. Choosing campaigns is optional. You can still add someone to the organization only.
>   2. Each campaign you check gets its own coordinator.
>   3. A person's profile can add them to campaigns and take them off one.
>   4. The web console works the same way, and the phone's + New offers Team lead.
> - **Choices this plan makes on its own** are listed in §L, so any of them can be overruled.
> - **Scope:** the server, the web console, and the phone through an over-the-air update (no new
>   build). No new personal data, recipients, exports or links. Three new routes answer with a named person,
>   to org admins only; the lookup shares the Team page's hourly limits (§H).
> - **Line references:** HEAD `7f64b89`.

Related: [USERS.md](USERS.md) (adding people, the campaign team, crews), [ADMIN_APP.md](ADMIN_APP.md)
(the phone's Users hub), [ROLES.md](ROLES.md) (who may do what), [EMAIL.md](EMAIL.md) (the invite and
"added to" emails), [PROPOSAL_PEOPLE_PAGES.md](PROPOSAL_PEOPLE_PAGES.md) (the add-by-email steps and the
"doors follow the person" rule this builds on).

# Part 1 — For everyone

## Why this is changing

On the phone, **More → Users** opens with a row of campaign pills. **+ New** does two different things
depending on the pill:

- **On a campaign's pill**, + New asks for the email first, says whether that person already works with
  you, and adds them to that campaign with the coordinator you pick. This works well and stays as it is.
- **On All campaigns**, + New adds the person to your organization **and to no campaign**. There is
  nowhere to pick one.

The person is then stuck until you do more:

- **Their profile doesn't help.** It lists the campaigns they're on, but you can't add them to one there.
  (A team lead's profile has a list of campaigns they run. A canvasser's has nothing like it.)
- **So you switch to a campaign's pill and add the same email again**, once for every campaign.
- **Until then, the canvasser's app looks empty.** They sign in to "No active campaigns yet. Ask your
  admin to create one." Your campaigns exist; the person just isn't on any of them.

The web console is a step ahead but has the same gap. Its **Add member** lets you pick **one** campaign
for a new canvasser, and a person's panel says "Add them to one from that campaign's Team page."

## What changes, in short

- **+ New on All campaigns asks for the email first**, the same way a campaign's pill does, then lets
  you **check the campaigns** to put them on. Nothing is checked to start, and it never means "every
  campaign."
- **Each campaign you check gets its own coordinator picker**, starting at No coordinator.
- **Checking campaigns is optional.** Leave them all unchecked and the person joins your organization
  only, as today.
- **The phone's + New offers Team lead**, with the list of campaigns they run, like the web.
- **A person's profile gets Add to campaigns and Remove.** Add uses the same list and coordinator
  choice. Remove asks first, because their books on that campaign go back to the pool (every door they
  knocked still counts).
- **The web console works the same way.** Its Add member and a person's panel get the same steps and the
  same list.
- **One email per add.** Someone added to three campaigns gets one email naming all three.
- **+ New on a campaign's pill doesn't change.**

## Adding someone from All campaigns

### Step 1: the email

You type their email address and tap **Continue**. Doorline checks who it belongs to in your
organization. It's the same check a campaign's pill makes, and it counts toward the same hourly limits
(60 checks an hour that find nobody, 30 that name someone).

```
 Add someone
 Start with their email address. If they already work
 with you, we'll show you who it is.

 Email
 [ jane@example.com                          ]

                              Cancel   [ Continue ]
```

### Step 2: what the email turned out to be

**Nobody in your organization uses it.** You fill in their name, an optional phone and an optional
temporary password (leave it blank to email an invite, as today), and pick a role:

- **Canvasser:** the campaign list, with a coordinator for each campaign you check.
- **Team lead:** the list of campaigns they run. A team lead can run only the campaigns checked. With
  none checked they can't manage anything yet, and the step says so, as the profile does.
- **Admin:** no list. Admins already see and run every campaign.

```
 New person
 No one in your organization uses jane@example.com.

 First name              Last name
 [ Jane            ]     [ Doe             ]
 Phone (optional)
 [ (555) 123-4567                            ]
 Temporary password (optional)
 [ Leave blank to email an invite            ]

 Role
 [ Canvasser ]  [ Team lead ]  [ Admin ]

 Campaigns (optional)
 [x] Fall Canvass
       Coordinator   Dana Cruz             v
 [x] Riverside Turnout
       Coordinator   No coordinator        v
 [ ] Lit Drop North
 Leave them all unchecked to add Jane to your
 organization only.

                 Back   [ Create & add to 2 campaigns ]
```

With **Team lead** picked, the bottom of the same step reads:

```
 Role
 [ Canvasser ]  [ Team lead ]  [ Admin ]

 Campaigns they run
 [x] Fall Canvass
 [ ] Riverside Turnout
 [ ] Lit Drop North
 A team lead can run only the campaigns checked.

                                  Back   [ Create ]
```

With **Admin** picked, there is no list, only "Admins see and run every campaign."

**It's someone already in your organization.** You see their name and the campaign list. The campaigns
they're already on are checked and marked **on it**. Check more to add them. If they have doors from
before on a campaign you check, the step says how many and on which teams, and picks their old
coordinator for you when that person can still run a crew, exactly as a campaign's pill does today.
Adding them doesn't change their role (that's on their profile).

```
 Add Pat Rivera to campaigns?
 Pat Rivera is already in your organization.

 Campaigns
 [x] Fall Canvass                            on it
 [x] Riverside Turnout
       Pat has 120 doors here from before, on
       Dana Cruz's team.
       Coordinator   Dana Cruz (their crew before)  v
       All 120 doors here already count for Dana
       Cruz's team.
 [ ] Lit Drop North
 Adding them doesn't change their role.

        Back   Open Pat   [ Add to 1 campaign ]
```

**Their account is switched off.** You're offered **Switch on**, or **Switch on & add to 2 campaigns**
with campaigns checked. The step says that switching an account on restores their access to every
campaign they were on.

**The address has a Doorline account at another organization.** You see the same form as for a new
person, on purpose: Doorline never says whether an address has an account somewhere else. When you
finish, that existing person is added, what you typed isn't used, and the result says who was added.
A campaign's pill already works this way.

### Step 3: what happened

The result names the person and the campaigns they're now on. It also lists any earlier doors that moved
to the coordinator you picked, and any campaign that couldn't be added, with **Try again**. (A campaign
archived while the step was open stops the add before anything happens, with a line saying which one to
uncheck.) The buttons are **Add another**, **Open {name}** (their profile) and **Done**.

```
 Added
 Jane Doe is in your organization, on Fall Canvass
 and Riverside Turnout.
 They've been emailed a link to set their own
 password.

            Add another   Open Jane   [ Done ]
```

When you checked no campaigns for a canvasser, it adds: "Jane isn't on any campaign yet, so the app
won't show them one. You can add them to one later from Users."

## Changing someone's campaigns from their profile

```
 CAMPAIGNS
 Fall Canvass                            Remove
 NE · Survey                                  >
 Riverside Turnout                       Remove
 NE · Survey                                  >

 + Add to campaigns
```

- **Add to campaigns** opens the campaign list with the campaigns they aren't on yet, a coordinator for
  each one you check, and the same doors-from-before lines. One tap adds them to all of them, and they
  get one email.
- **Remove** asks first: "Remove Pat from Riverside Turnout? Any books they hold here go back to the
  pool. Their work is kept — every door they knocked still counts toward this campaign." If they run a
  crew there, it adds how many people will be left with no coordinator. This is the same question
  Remove asks on a campaign's pill.
- **Tapping a campaign** still opens Users on that campaign, where the rest of their details for that
  campaign live.
- **Only org admins see this card**, as today. A switched-off account gets no Add to campaigns until it's
  switched back on. A deleted account gets neither button.

## The web console

- **Add member** opens a window with the same three steps: the email, then what it turned out to be
  (the role and campaign list with a crew for each, or the campaigns a team lead runs), then what
  happened. The **Existing user (by email)** checkbox goes away on the web and on the phone, because the
  email check answers that for you.
- **A person's panel**, under **Everywhere in your organization**, gets **Add to campaigns**, and
  **Remove** on each active campaign, with the same steps and the same question first. On a campaign's
  Team page, that campaign's own row keeps using the panel's existing **Remove from campaign**.

## The emails

One email per add, never one per campaign:

- **A new person** gets the set-password invite, naming every campaign they were added to.
- **Someone already in your organization** gets one "You've been added to …" email listing the
  campaigns.
- **Someone who hasn't set their password yet** gets nothing new, as today. Their invite is still their
  way in, and the app shows their campaigns once they sign in.
- **A new team lead's** invite stays as it is today.

## Also fixed on the way

- **A canvasser who isn't on any campaign** now reads "You're not on a campaign yet. Ask your admin to
  add you to one." instead of "No active campaigns yet. Ask your admin to create one." Admins still see
  the old line, because for an admin it means there really are no campaigns.

## What doesn't change

- **+ New on a campaign's pill**, and **Add people** on the web Team page.
- **Team leads.** They don't get the All campaigns pill or the profile's Campaigns card, so none of this
  reaches them.
- **Who can be a coordinator** (any active admin or team lead), and the rule that a returning person's
  earlier doors on a campaign move to the crew they join.
- **Phones that haven't taken the update** keep today's + New until they do.

## What you'll do after it's built

1. Commit (your usual routine).
2. Deploy the server from the Heroku dashboard. The web console comes with it.
3. Try it on the web in an internal (Doorline-owned) organization.
4. In `mobile/`, check nothing else is waiting there, publish to staging (`npm run ota:staging`), and walk
   through it on a staging phone. Staging talks to production, so use the internal organization.
5. In `mobile/`, publish to production (`npm run ota:production`), then a small server deploy that removes
   this feature's "(with an app update)" notes from the Help Center.

The exact steps are in [OPERATIONS.md](OPERATIONS.md) → *Release: pick campaigns when you add someone from All
campaigns*.

No index build, no client-version bump and no app-store build.

# Part 2 — Technical reference

## A. What the design rests on (checked at `7f64b89`)

| Fact | Where |
|---|---|
| The phone's + New on All campaigns opens `CreateUserForm`: name, email, phone, password, role Canvasser or Admin (no Team lead), an "Existing user" checkbox, then `POST /admin/memberships`. No campaign. | [users.jsx:248-254, 785-814, 819-1025](<../mobile/app/(app)/admin/users.jsx>) (roles at 954-957) |
| On a campaign's pill, + New opens `CreateCanvasserSheet`: `POST …/crew/resolve`, the confirm step, `POST …/crew`. | [users.jsx:655-675](<../mobile/app/(app)/admin/users.jsx>), [CreateCanvasserSheet.jsx](../mobile/components/CreateCanvasserSheet.jsx) |
| A team lead gets no All campaigns pill and lands on their first managed campaign. | [users.jsx:166-170, 402-404](<../mobile/app/(app)/admin/users.jsx>) |
| The profile's Campaigns card is read-only on purpose ("an Assign here would join them with no crew and move a returning person's doors unseen") and admin-only. | [users/[id].jsx:286-288, 990-1032](<../mobile/app/(app)/admin/users/[id].jsx>) |
| `POST /admin/memberships` creates or links with a role, grants a lead's `managedCampaignIds`, puts nobody on a campaign, and keeps the old `linkExisting` contract (409 `EMAIL_EXISTS_USE_LINK`, 404 `EMAIL_NOT_FOUND`). | [memberships.js:374-456](../server/src/routes/admin/memberships.js), [createMember.js:97-163](../server/src/services/memberships/createMember.js) |
| `POST …/crew/resolve` answers `outside` (byte-identical for every address), `in-org`, `in-org-inactive` or `on-campaign`, with that campaign's `history`. It is limited per actor (60 lookups an hour that find nobody, 30 that name someone) and adds audit subjects when it names someone. | [leadCrew.js:189-246](../server/src/routes/admin/leadCrew.js), [crewResolveLimit.js:59-63](../server/src/middleware/crewResolveLimit.js) |
| `POST …/crew` resolves, then branches: create, blind attach, claim, or inline switch-on for an admin; then `joinCampaignCrew`; then exactly one email. | [leadCrew.js:248-408](../server/src/routes/admin/leadCrew.js) |
| `POST …/assignments` adds existing members by id with one crew per call, skips anyone already on, and emails each newly added person unless `mustChangePassword`. | [assignments.js:121-241](../server/src/routes/admin/assignments.js) |
| `DELETE …/assignments/:userId` releases their books on that campaign (`releaseAssignedWork`) and never touches knocks. An archived campaign is read-only (`requireActiveCampaign`). | [assignments.js:24, 243-279](../server/src/routes/admin/assignments.js) |
| A coordinator is an org-level fact: any active admin or lead (`resolveCoordinatorId`). | [createMember.js:169-186](../server/src/services/memberships/createMember.js), [leadCrew.js:143-155](../server/src/routes/admin/leadCrew.js) |
| Per-campaign history is `historyByTeam`, hinted to the person index `{ userId: 1, timestamp: -1 }`. | [restampCoordinator.js:32, 241-253](../server/src/services/memberships/restampCoordinator.js) |
| The web Users page hands Canvasser plus one Campaign to `AddPeopleDialog`; Team lead gets "Campaigns this lead manages". | [UsersPage.jsx:269-310, 387-442, 776-794](../client/src/pages/UsersPage.jsx) |
| The web panel's org section lists crews read-only: "Not on any campaign yet. Add them to one from that campaign's Team page." | [PersonOrgSection.jsx:111-140](../client/src/components/people/PersonOrgSection.jsx) |
| The templates name one campaign (`campaignName`). | [templates.js:186-270](../server/src/services/mail/templates.js) |
| A canvasser with no roster row gets no campaigns and the picker's empty line. | [bootstrap.js:257-268](../server/src/routes/mobile/bootstrap.js), [index.jsx:94](../mobile/app/index.jsx), [campaigns.jsx:199-205](<../mobile/app/(app)/campaigns.jsx>) |
| Writes under `/admin` pass the billing gate. | [routes/index.js:94](../server/src/routes/index.js) |
| `GET /admin/memberships/:userId/crews` lists the person's campaigns and crew, with no crew size. | [memberships.js:466-528](../server/src/routes/admin/memberships.js) |
| Roster indexes: `{ campaignId, userId }` unique, `{ userId, organizationId }`, `{ campaignId, coordinatorId }`. | [CampaignAssignment.js:89-92](../server/src/models/CampaignAssignment.js) |

## B. The rules (one model)

1. **One add flow for the org view.** The email, then what it turned out to be, then the result. It is
   used by the phone's All campaigns pill and the web Users page. The campaign-pill sheet and the web
   Team page's Add people don't change.
2. **Campaign picks** are `[{ campaignId, coordinatorId }]`: active campaigns of this organization only,
   no duplicates, every coordinator checked by `resolveCoordinatorId`, never the person themself. **All
   of them are checked before anything is written.** One bad pick refuses the whole request.
3. **Zero picks is valid** for every role (ruling 1).
4. **Joining** is `joinCampaignCrew` once per pick: the crew-write choke point, so the "doors follow the
   person" move and its crew job happen exactly as on a campaign's pill. Someone already on a campaign is
   skipped, and their crew never changes.
5. **The role** applies only when the add creates or attaches a membership. A colleague's role never
   changes here.
6. **A new team lead** gets `managedCampaignIds` grants, as `POST /admin/memberships` gives today. Their
   picks list is not shown (§L.4).
7. **Emails:** exactly one per request, naming the campaigns this request actually joined; none when an
   existing member joined nothing; colleagues still on `mustChangePassword` are skipped, as today.
8. **Org admins only.** Every new route is `requireAdminRole`. Doorline staff go through the same gate
   and the existing access log.
9. **Remove** is the existing `DELETE …/assignments/:userId`, unchanged.

## C. Server

### C.1 `server/src/services/memberships/joinCampaigns.js` (new)

One home for what the org-level add and the profile's Add to campaigns share:

- **`campaignPicksSchema`**: zod array of `{ campaignId: string, coordinatorId: string | null }`, at most
  100, `campaignId` unique.
- **`checkCampaignPicks({ orgId, picks, memberUserId })`**: loads the campaigns
  (`{ _id: $in, organizationId, ...NOT_DELETING }`). It returns `400` naming any campaign not in the
  organization, `409 CAMPAIGN_ARCHIVED` naming an archived one, and `400` from `resolveCoordinatorId` per
  pick. `memberUserId` is passed only for a named person, the same rule `/crew` applies at
  [leadCrew.js:285-291](../server/src/routes/admin/leadCrew.js): an `outside` address has no member to
  compare against, and checking its account would be a cross-tenant oracle.
- **`joinCampaigns({ orgId, userId, picks, actorUserId })`**: reads the person's roster rows once
  (`{ userId, organizationId }` index), skips the ones already there (`already-on`), and runs
  `joinCampaignCrew` for the rest through `mapWithLimit(…, CREW_JOB.sideBySide)` with
  `source: 'campaign_join'`. Per pick it returns `{ campaignId, campaignName, result: 'joined' |
  'already-on' | 'error', restamp, error }`. A thrown join becomes `error`; a `restampError` stays
  `joined`, with `restamp.error` set so the result can say Finish it.
- **`campaignHistories({ orgId, userId })`**: the campaigns this person has knocks on (one `$group` on
  `campaignId`, hinted to `PERSON_ACTIVITY_HINT`) plus the ones they're on, kept to active campaigns. Each
  campaign gets **the same `campaignHistory` function `/crew/resolve` uses**, moved here from leadCrew.js,
  through `mapWithLimit(…, 4)`, so a campaign's numbers match the campaign pill's to the door. Returns
  `[{ campaignId, onCampaign, history: { doors, sources } }]`.
- **`namedSources`**, moved here from [leadCrew.js:263-271](../server/src/routes/admin/leadCrew.js); leadCrew
  imports it.
- **`coordinatorChoices(orgId)`**: the `coordinators` list exactly as `GET …/crew` builds it
  ([leadCrew.js:143-182](../server/src/routes/admin/leadCrew.js)), moved here so both share one rule.
- **`sendJoinedEmail(...)`**: picks the one template for the outcome (§C.3) and sends it best-effort,
  never awaited.

### C.2 Routes (all in [memberships.js](../server/src/routes/admin/memberships.js), all `requireAdminRole`)

**`POST /admin/memberships/resolve`** `{ email }`, mounted with **the same `crewResolveLimiters`
instances** as `/crew/resolve`, so both lookups draw on one pair of hourly counters per person.

- It sets `res.locals.lookup` and calls `addAuditSubjects` when it names someone, as
  [leadCrew.js:225-246](../server/src/routes/admin/leadCrew.js) does.
- `outside`: `{ outcome: 'outside', person: null, campaigns: [], coordinators }`. That is byte-identical
  for every address in the organization at a given moment (the coordinators list doesn't depend on the
  address).
- `in-org` and `in-org-inactive`: `{ outcome, person, campaigns: campaignHistories(...), coordinators }`.
  There is no `on-campaign` at org level: the campaigns someone is on come back as `onCampaign: true`.

**`POST /admin/memberships/by-email`**: the org-level add. The body is `memberIdentityShape` plus
`role` (`canvasser` | `lead` | `admin`, default `canvasser`), `campaigns` (picks, default `[]`) and
`managedCampaignIds` (leads). `linkExisting` is accepted and ignored, as on `/crew`.

1. `ensureOrgScoped`, parse, `refuseVendorStaffTarget({ email })`.
2. `resolveEmailInOrg({ orgId, email })` with no campaign.
3. `checkCampaignPicks` (§C.1), then, for a new or attached lead, `resolveManagedCampaigns`. Both run
   **before any write**.
4. Branch, mirroring [leadCrew.js:294-354](../server/src/routes/admin/leadCrew.js):
   - **`in-org-inactive`**: set `isActive: true` (the route is admin-only, so always allowed).
   - **`outside`**: `createOrgMember({ data: { ...data, linkExisting: !!found.user }, role,
     mustChangePassword: true })`. An attached account discards what was typed. A lead gets
     `reconcileManagedCampaigns`.
   - **`in-org`**: no membership write.
5. `joinCampaigns`.
6. `convergeIfDeleted` after the last write: `409 ACCOUNT_DELETED`.
7. `sendJoinedEmail`.
8. `201 { user, outcome: 'created' | 'attached' | 'in-org' | 'in-org-inactive', attached, role,
   campaigns: [...] }`, where `role` is the membership's real role (a colleague's stays theirs).
9. `11000` → `409 Conflict`, zod → `400`, as the neighbors do.

A second tap on Create is harmless: the address now resolves `in-org`, every pick is `already-on`, and
no email goes out.

**`GET /admin/memberships/:userId/campaign-history`** → `{ campaigns: campaignHistories(...),
coordinators }` for an active member of this organization (`404` otherwise). Loaded only when the
profile's Add to campaigns opens. It is not rate-limited, because it names nobody new: the admin opened
this person's profile from a list that already shows them.

**`POST /admin/memberships/:userId/campaigns`** `{ campaigns: picks (min 1) }`: the profile's Add.

- The membership must exist in this organization (`404`).
- A switched-off membership gets `409 MEMBER_DEACTIVATED` ("Switch their account on first."), and a
  deleted account gets `409 ACCOUNT_DELETED`.
- Then `checkCampaignPicks` (with `memberUserId`), `joinCampaigns`, `convergeIfDeleted` and
  `sendJoinedEmail` (colleague template), and the answer is `201 { campaigns: [...] }`.

**`GET /admin/memberships/:userId/crews`** gains `crewSize` on each row a reader may see: how many
roster rows on that campaign name this person as coordinator. That is one `$group` over
`{ campaignId: $in, coordinatorId }` on the `{ campaignId, coordinatorId }` index. Rows hidden from a
lead get `null`. This is additive; the profile's Remove question reads it.

### C.3 Emails ([templates.js](../server/src/services/mail/templates.js))

`inviteSetPassword`, `addedToOrg` and `addedToCampaign` accept `campaignNames` (an array) beside today's
`campaignName`, normalized to one list, so every existing caller is unchanged.

| Names | Line in the invite and the "added to the org" email | "Added to" subject |
|---|---|---|
| none | (no line) | (not sent) |
| one | "You've also been added to the **Fall Canvass** campaign." (today's line) | "You've been added to Fall Canvass" (today's) |
| several | "You've also been added to these campaigns: **Fall Canvass**, **Riverside Turnout** and **Lit Drop North**." | "You've been added to 3 campaigns" |

`sendJoinedEmail` chooses the template:

- **created**: the invite, with the joined names, or with no names for a team lead.
- **attached**: the "added to the org" email, with the joined names.
- **a colleague who joined at least one campaign** and isn't on `mustChangePassword`: the "added to"
  email.
- **anything else**: no email.

### C.4 What stays

- **`POST /admin/memberships`** stays as it is, for phones without the update. The new screens stop
  calling it (§H).
- **`/crew`, `/crew/resolve` and `/assignments`** keep their behavior. leadCrew only imports the moved
  helpers.

## D. Phone (over the air)

### D.1 `mobile/components/CampaignPicks.jsx` (new)

The campaign list, used by the add sheet and the profile.

- **Props:** `campaigns` (active, from `['admin','campaigns']`), `lockedIds` (on it), `histories` (by
  campaign id), `coordinators`, `person`, `picks` (a `Map` from campaign id to coordinator id or `''`),
  `onChange`, `disabled`.
- **A row** is a checkbox with the campaign name, and **on it** when locked. Checking a row that isn't
  locked shows its coordinator dropdown, the same inline dropdown `CreateCanvasserSheet` uses (one open at
  a time), pre-picked by `prePick(history)`. Under it go `historyLine` and `joinLine` from
  [lib/addByEmail.js](../mobile/lib/addByEmail.js).
- The person is never offered as their own coordinator. With no active campaigns the list reads "No
  active campaigns yet."

### D.2 `mobile/components/AddPersonSheet.jsx` (new)

The org-level add.

- **Steps:** it reuses `addReducer` and `backAction` (Android Back on step 2 returns to step 1 with the
  email kept).
- **Step 1** calls `POST /admin/memberships/resolve`; a 429 shows its wait through `errorOf`.
- **Step 2** uses `orgConfirmKind(found)`, which gives `new`, `colleague` or `switched-off`.
  - **new:** names, phone, password, then the role segmented control (Canvasser, Team lead, Admin), then
    `CampaignPicks`, the lead checklist (the profile's, [users/[id].jsx:919-966](<../mobile/app/(app)/admin/users/[id].jsx>)),
    or the admin line.
  - **colleague** and **switched-off:** the name line, `CampaignPicks` with `lockedIds` from `campaigns`,
    and **Open {name}**, which pushes their profile.
- **Submit** sends `POST /admin/memberships/by-email`. The labels come from `submitLabel(kind, n)`.
- **Step 3** is `orgDoneView(result, { crewNameById })`, with Add another, Open {name} and Done.
- **The safe-area bottom inset** is applied, as on every sheet.

### D.3 [users.jsx](<../mobile/app/(app)/admin/users.jsx>)

- On All campaigns, + New opens `AddPersonSheet`, passing `activeCampaigns`.
- `CreateUserForm`, its modal and the `createUser` mutation are deleted.
- After an add it refreshes `['admin','memberships']` and the roster and crew queries of every campaign
  joined.
- On a campaign's pill, nothing changes.

### D.4 Profile ([users/[id].jsx](<../mobile/app/(app)/admin/users/[id].jsx>))

- **Campaigns card:** each row keeps its tap to Users on that campaign. A separate **Remove** target on
  the right opens the member sheet's question (the text of [MemberSheet.jsx:396-410](../mobile/components/MemberSheet.jsx),
  with the crew line built from `crewSize` on the existing `crewsQ`), then calls
  `DELETE …/assignments/:userId`.
- **+ Add to campaigns** under the rows opens `AddToCampaignsSheet` (new, small). It loads
  `campaign-history`, shows `CampaignPicks` without the campaigns they're on, posts to
  `…/:userId/campaigns`, and shows `orgDoneView`'s per-campaign lines.
- **Hidden** for a switched-off or deleted account, and when they're on every active campaign.
- **After a change** it refreshes `['admin','membership-campaigns',id]`, `['admin','member-crews',id]`,
  `['admin','memberships']` and the touched campaigns' roster queries.
- The footer "Assign or unassign from Users on that campaign." goes; the code comment at 286-288 is
  rewritten to say why adding here is now safe (the crew choice and the doors line come with it).

### D.5 [lib/addByEmail.js](../mobile/lib/addByEmail.js)

New pure helpers, tested in `addByEmail.test.js`:

- `orgConfirmKind`
- `picksBody(picks)` builds `[{ campaignId, coordinatorId | null }]`
- `submitLabel`
- `campaignsLine(names)`: "Fall Canvass and Riverside Turnout"
- `orgDoneView`

Each one has a web twin (§E.4).

### D.6 [campaigns.jsx](<../mobile/app/(app)/campaigns.jsx>)

The empty line depends on the viewer. An org admin or super admin keeps today's text. Everyone else reads
"You're not on a campaign yet. Ask your admin to add you to one."

### D.7 Fingerprint

No `app.json`, `eas.json`, native dependency or icon change, so it ships over the air.

## E. Web

### E.1 `client/src/components/people/CampaignPicks.jsx` (new)

The D.1 list in the web's grammar. A checkbox row reveals a `CrewSelect` ([team/CrewSelect.jsx](../client/src/components/team/CrewSelect.jsx))
and the two sentences from [lib/addPeople.js](../client/src/lib/addPeople.js).

### E.2 `client/src/components/people/AddPersonDialog.jsx` (new)

The D.2 steps as a dialog, styled like [AddPeopleDialog.jsx](../client/src/components/team/AddPeopleDialog.jsx).

### E.3 [UsersPage.jsx](../client/src/pages/UsersPage.jsx)

- **Add member** opens `AddPersonDialog`.
- The inline form, `EMPTY_FORM`, the `emailLookup` checkbox, the `addMember` mutation and the
  `handover` to `AddPeopleDialog` are deleted.
- After an add it invalidates `['memberships']` and the joined campaigns' roster, crew and history
  queries.

### E.4 [PersonOrgSection.jsx](../client/src/components/people/PersonOrgSection.jsx)

- **The Crews list:** a **Remove** button on each active campaign's row (not on `currentCampaignId`'s
  row; the panel already offers that one). It opens a confirm with the phone's text and calls `DELETE`.
- **Add to campaigns** under the list opens a small dialog: `campaign-history`, then `CampaignPicks`,
  then the post, then the result.
- **The empty line** becomes "Not on any campaign yet." with the button beside it.

### E.5 [lib/addPeople.js](../client/src/lib/addPeople.js)

The twins of D.5, pinned to the phone's by a new `addPeopleOrg.parity.test.js`, following the repo's
`*.parity.test.js` pattern.

## F. Design notes

- **Why email first for every role.** The campaign list can't be honest without knowing who the address
  belongs to. "On it", the doors from before, and the old crew picked for you all need the lookup. Doing
  it for admins and leads too retires the guess-the-checkbox step on both clients.
- **Why one list per campaign instead of one coordinator for all** (ruling 2): a coordinator on one
  campaign is often not the right one on another, and a returning person's old crew differs per
  campaign.
- **Why validate every pick before writing.** A refusal halfway through would leave someone on some of
  the campaigns you checked, and the result would have to explain a partial add the person never asked
  for. Joins that fail after validation are reported per campaign. They come from the ledger move,
  which already has Finish it.
- **Why the profile's Remove doesn't move to a checklist.** Unchecking a campaign takes books away. A
  per-row Remove with its own question keeps that cost in front of the person tapping it; a mixed
  add-and-remove Save would bury it.
- **Wording.** The phone says **Coordinator** and the web says **Crew**, as each does today; the
  Coordinator → Crew relabel waits for the terms sweep.

## G. Docs and Help Center (same change)

- **[USERS.md](USERS.md):** Part 1 "Adding someone to your org" is rewritten for the email-first add
  with campaigns. "The campaign team" gains the profile's Add to campaigns and Remove as ways on and off
  a campaign. Part 2 gets the four routes, `crewSize`, and the shared service.
- **[ADMIN_APP.md](ADMIN_APP.md):** the Users hub's + New, and the profile's Campaigns card.
- **[ROLES.md](ROLES.md):** the four routes are admin-only, plus a power-matrix line.
- **[EMAIL.md](EMAIL.md):** several campaign names in one email.
- **[CANVASSER_APP.md](CANVASSER_APP.md):** the empty line for a canvasser on no campaign.
- **[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md):** item 46 (§H).
- **[README.md](README.md):** this plan's row.
- **Help Center** ([server/src/content/help/](../server/src/content/help/)):
  - [faq/add-a-canvasser-account.md](../server/src/content/help/faq/add-a-canvasser-account.md): the
    Users page and the phone's All campaigns add, with several campaigns.
  - [faq/assign-canvasser-to-campaign.md](../server/src/content/help/faq/assign-canvasser-to-campaign.md)
    and [guides/assigning-canvassers.md](../server/src/content/help/guides/assigning-canvassers.md): adding
    from Users or the profile is now a third way on.
  - A new FAQ, `faq/add-to-several-campaigns.md` (audience `admin`): "Can I add someone to several
    campaigns at once?"
  - Phone-only sentences carry "(on the phone, with an app update)" until the production OTA, then a
    small deploy removes them, as with the people pages.

## H. Privacy

**This change touches one trigger in CLAUDE.md: "a route that returns PII".** Three new routes answer with a
named person — `resolve` and `campaign-history` with their door history per campaign, and `by-email` with the
person added or found (even when it adds them to nothing) — and `/crews` gains `crewSize`. Reconciled:

- **Audience: org admins only** (`requireAdminRole`). They already see the same facts campaign by
  campaign through `/crew/resolve` and the Team page, and every member through `/admin/memberships`. No
  team lead reaches any new route, so the "a lead may be the client" rule
  ([PROPOSAL_PEOPLE_PAGES.md](PROPOSAL_PEOPLE_PAGES.md), item 41) is untouched. The one new field a lead
  sees is `crewSize` on `/crews` rows of campaigns they manage — a count that campaign's roster already
  shows them.
- **Limits:** the org lookup shares `/crew/resolve`'s counters, and an `outside` answer stays the same
  for every address.
- **No new data, retention, recipients, subprocessors, exports or links.** Emails go to the same person
  through the same provider (Resend), fewer of them.
- **Removing from the profile** is the existing campaign action (`DELETE …/assignments/:userId`), shown on
  these screens to org admins only; the route's own rules are unchanged (a team lead may remove canvassers
  and themselves on campaigns they manage, from the Team page).
- **Unchanged and worth recording:** the old `POST /admin/memberships` still answers "No account exists
  with that email" (404 `EMAIL_NOT_FOUND`) to an org admin who ticks Existing user. That tells them
  whether an address has a Doorline account anywhere. The new screens stop using it; phones without the
  update still do. It is admin-only and predates this plan.

**Record:** PRIVACY_VERIFICATION item 46, written at build time. **No Privacy Policy, Terms of Service
or DPA text needs to change.**

## I. Release

1. **Server and web deploy.** The routes are additive and phones without the update are unaffected.
   `npm run audit:mobile-api` will flag `memberships.js`. Read that diff: new routes and the additive
   `crewSize` field. Nothing is removed or renamed, so there's no client-version bump.
2. **No index build.** The reads use existing indexes: `PERSON_ACTIVITY_HINT` and `PERSON_SURVEY_HINT`,
   which the people pages already rely on, and the roster's `{ userId, organizationId }` and
   `{ campaignId, coordinatorId }`. The build-indexes dry run should report nothing new.
3. **Web walkthrough** in an internal organization (§J.5).
4. **In `mobile/`: `git status --short .` must print nothing, and check what else under `mobile/` on `main`
   hasn't reached production (this update carries it: the people pages' phone code, 50e1082, which this
   builds on, and any other pending phone work), then `npm run ota:staging`**, a staging phone walkthrough
   (staging talks to production), then **`npm run ota:production`** from `main`.
5. **A small server deploy** that removes this feature's "(with an app update)" Help Center notes (four
   articles, listed in OPERATIONS.md).
6. **Stamp the dates** in PRIVACY_VERIFICATION item 46. The steps as run: [OPERATIONS.md](OPERATIONS.md) →
   *Release: pick campaigns when you add someone from All campaigns*.

## J. Tests

1. **Server integration test** `server/test/addToCampaigns.int.test.js`, on a throwaway mongod against
   the real app, in the style of `teamLead.int.test.js`:
   - **resolve:**
     - `outside` is byte-identical for no account, an account at another organization, and a deleted
       account's old address;
     - `in-org` gives per-campaign history and `onCampaign`, and `in-org-inactive` works the same;
     - a lead gets 403;
     - the limit is shared: named lookups across `/crew/resolve` and `/resolve` together reach the
       31st, which gets 429.
   - **by-email:**
     - a new canvasser with two picks and different coordinators: one membership, two roster rows with
       the right crews, and one email naming both;
     - an attached account: the typed name is not applied, and `attached` is true;
     - a colleague: their role is unchanged, picks join, and an `already-on` pick keeps its crew;
     - switched-off: switched on;
     - a lead: grants;
     - an admin with no picks, and any role with zero picks (organization only);
     - refusals with nothing written: an archived pick (409), another organization's campaign (400),
       the person as their own coordinator (400), an invalid coordinator (400);
     - a double submit: the second answer is all `already-on` and sends no email;
     - billing read-only: 402;
     - a deletion that races the add: converged, 409.
   - **profile add:** joins with one email; `mustChangePassword` means no email; switched-off gets
     409; a lead gets 403; a returning person's doors move to the picked crew on each campaign.
   - **campaign-history:** equals `/crew/resolve`'s `history` for the same campaign and person.
   - **crews:** `crewSize` is counted, and is `null` on rows hidden from a lead.
2. **The crew choke-point test** still passes: the new path writes only through `joinCampaignCrew`.
3. **Emails:** template tests for zero, one and several names. Existing `campaignName` callers produce
   byte-identical mail.
4. **Phone:** `addByEmail.test.js` covers the new helpers. **Web:** `addPeople.test.js`, plus the new
   parity test.
5. **Walkthroughs** (web, then a staging phone):
   - a new canvasser on two campaigns;
   - a returning colleague with doors on one campaign, checking that the old crew is pre-picked and the
     doors line is right;
   - a team lead;
   - an admin;
   - zero campaigns, then the canvasser's empty line on their phone;
   - the profile's Add, and Remove on a campaign where they run a crew;
   - the email received in each case.

## K. Owner rulings (2026-10-30)

1. **Optional.** Choosing campaigns is optional; you can still save with none checked and add them
   later.
2. **One coordinator per campaign.** Each checked campaign gets its own coordinator picker, starting at
   No coordinator.
3. **Add and remove on the profile.** Add them to more campaigns with the same list and coordinator
   choice, and take them off one, with a question first.
4. **The web works the same, and Team lead goes on the phone.** The web console's Add member gets the
   same list for several campaigns, and the phone's + New offers Team lead with the campaigns they run.

## L. Choices made in this plan (say if any is wrong)

1. **Email first for every role** on the org add, which retires the "Existing user" checkbox on both
   clients (§F).
2. **The web person panel** gets Add to campaigns and Remove as well, to match the phone's profile.
3. **One email per add**, naming all the campaigns.
4. **A new team lead** gets only the "campaigns they run" list. They're put on a campaign's team when
   they take a book there, as today.
5. **A new admin** gets no campaign list.
6. **Only active campaigns** are offered.
7. **The canvasser's empty line** is fixed on the way.

## M. As built (2026-10-30)

Built to the plan, with these differences:

1. **The shared sentences are one new twin module, not additions to the old ones.** The phone's
   `lib/addByEmail.js` and the web's `lib/addPeople.js` already differ (signatures, apostrophes), so the
   org view's steps, button labels, request body, result lines and Remove question live in
   [mobile/lib/addToCampaigns.js](../mobile/lib/addToCampaigns.js) and
   [client/src/lib/addToCampaigns.js](../client/src/lib/addToCampaigns.js) — the SAME file, pinned by
   `addToCampaigns.parity.test.js` (identical text and identical answers). The doors lines still come from
   each tree's own `historyLine`/`joinLine`, the campaign pill's words.
2. **`crewSize` is left off a row hidden from a lead**, not `null`: `leadUserManagement.int.test.js` pins
   item 40's name-only shape for those rows, and a key carrying nothing still changed it.
3. **`campaign-history` answers for any member of the organization** (404 otherwise), switched off or not;
   only the write refuses a switched-off account.
4. **The web's Team lead list in Add member offers active campaigns only** (the old inline form listed
   archived ones too), per §L.6.
5. **`convergeIfDeleted` takes `campaignIds`** beside `campaignId`
   ([deleteAccount.js](../server/src/services/users/deleteAccount.js)), so one convergence undoes every
   roster row an add wrote.
6. **`campaignHistory`, `namedSources` and the coordinator list moved** to
   [joinCampaigns.js](../server/src/services/memberships/joinCampaigns.js); leadCrew.js imports them, and
   its answers are unchanged (its suites pass untouched).
7. **Small red text uses `dangerFg`** on the phone (the raw `danger` tint is 3.08:1).
8. **A web render smoke test** (`client/src/lib/addToCampaignsRender.smoke.test.js`) renders Add member's
   first step, the campaign list, the panel's Add to campaigns and the panel's Remove/Add buttons.
9. **Help Center:** the three lead-audience articles mention the org view's add and the profile without
   linking to the new admin FAQ, which a lead can't open (`helpLinks.test.js`).

10. **Round-1 review changes** (§N): a deleted member is refused before any write on both adds by email; the
    org view's add checks the new-account fields for every outside address first (`newAccountProblem`); one
    person's history on every campaign is ONE pass per ledger (`historiesByCampaign`, with `historyByTeam` as its
    one-campaign case); own-coordinator checks ignore the id's case; a join whose door-source names fail to
    load still reads `joined`; the phone sheet is bounded by the keyboard; the web add window holds the person
    panel open (its `dialogRef`) and its write waits the panel; the shared Remove question carries the Team
    panel's shared-books line; `AddPeopleDialog`'s dead Users-page handover is gone.

**Verified on the built tree (after both rounds):** `addToCampaigns.int.test.js` 25/25, and the suites the change
touches — crewResolve, teamLead, leadUserManagement, crewJob, crewJobEdges, crewConsoleTools, mailTriggers,
orgAccountDeletion, accountDeletion, clientReportTeamParity, campaignRemoval, help — all pass;
`coordinatorChokePoint` and `mailTemplates` (8, one new) pass; the server's full `node --test` run passes
except one Excel-reader timing test (`readIdColumn.resources.test.js`) that tripped under the run's load and
passes alone, twice, in a file this change doesn't touch; phone `npm run test:mobile` 417/417 (15 new); web
`node --test src/` 1194/1194 with the parity and render tests, and `vite build` succeeds. `npm run
audit:mobile-api` flags `memberships.js`, `leadCrew.js` and `assignments.js`: additions, moved code with
unchanged answers, and stricter checks — no client-version bump. The phone screens were checked by parsing
and bundling every changed file (all relative imports resolve); they have not been run on a device yet —
that is the staging walkthrough (§I.4, §J.5).

## N. Code review (2026-10-30)

The owner asked for two review rounds after the build.

**Round 1** — three reviewers in parallel, read-only on the repo: server correctness (driving the real routes
on a throwaway database), the phone and web screens (an owner walkthrough, with a scratch render harness), and
consistency (privacy, release, docs and Help Center against the code). No blocker. Fixed:

- **Server:** an add aimed at a deleted member's tombstone address switched them on and moved their earlier
  doors before refusing (reproduced; both adds by email now refuse first); the org view's add refused a missing
  name only when the address had no account (reproduced; now the same refusal for every outside address); the
  org lookup read the person's whole history once per campaign (measured 2.5M documents for an 80k-knock person
  over 15 campaigns; now three passes in all); an upper-case id passed the own-coordinator check (reproduced;
  fixed in `resolveCoordinatorId`; a change to `/assignments` was dropped in round 2 — an upper-case id is
  refused there earlier, as not a member); a failed name lookup could report a join as an error.
- **Screens:** on the phone the keyboard pushed the New person step's name fields off the top (the card is now
  bounded by the keyboard); on the web one Escape in the panel's Add to campaigns closed the whole panel, even
  mid-add (reproduced in a harness); Open {name} after an add could show a stale Campaigns card or flash "User
  not found"; a failed Remove's error carried to the next campaign's confirm; low-contrast amber; "Added" over
  "Nothing changed"; no Open {name} on the switched-off step; the web and phone lead lines differed.
- **Docs and Help:** older passages in USERS.md, EMAIL.md and ROLES.md still described the replaced flow; a
  Help FAQ called the profile's list read-only; phone-only sentences lacked the app-update note; "one email"
  dropped its caveat; item 46 had inaccurate sentences (Remove is admin-only on these screens, not on its
  route; `by-email` also names a person; `crewSize` reaches a lead); the release lacked an OPERATIONS.md entry.
- **Tests added:** the email wording for zero, one and several campaigns; a switched-off lookup; the address a
  deleted account gave up; each campaign's doors moving on a profile add; and a test for each server fix.

**Left for the owner (item 46(h)):** the Team page's `/crew` add still answers a request with no name
differently when the address has no account. Requiring a name there would break the "link existing" button
in the July store builds and the legacy app, so it needs the client-version gate.

**Round 2** — three reviewers again, aimed at what round 1 changed: server (proving the one-pass history
gives the old numbers; a pre-mortem for Election Day week), screens (re-checking each fix; an end-to-end owner
walkthrough), and docs, privacy and release (every rewritten claim; a rehearsal of the owner's commit,
deploy and publish steps). Fixed from the docs review: the release's phone check (`git status --short mobile/`
run inside `mobile/` looks for `mobile/mobile/` and always prints nothing — now `git status --short .`, also
in three older release entries), and naming the earlier phone work an update carries; the counsel brief now
points at item 46(h); item 46(b)–(c) said `by-email` names a person only after an add, and named the wrong
helper; two more places still said the Users page "doesn't set crews"; Help wording on the email and on
shared books; the no-op `/assignments` change was reverted. From the server review: no blocker — the one-pass
history matched the old per-campaign numbers across 1,380 comparisons (only teams tied to the same second can
swap order, which was already random), `/resolve` now reads 160k documents where it read 2.48M (80k knocks, 15
campaigns), and two admins adding the same new address at once now get "Someone else just added this
address" (`ADDED_MEANWHILE`) instead of an error naming the removed checkbox. From the screens review: no
blocker — all round-1 screen fixes confirmed; the web panel no longer flashes "Not in your organization"
when Open {name} beats the refreshed list; two Part 1 sentences now match the screens.

**Left for the owner after round 2:**
1. **The hourly lookup limit on the Users page add.** The org view's add shares the Team page's limit (60
   lookups an hour that find nobody, 30 that name someone, the owner's 2026-10-26 numbers), so one admin
   adding a 61st new person within an hour is refused on both screens until the hour turns. The old Users
   form had no limit. For an org admin the limit protects little (they list every member, and the old route
   answers "no account" without one); lifting it for org admins would also lift it for them on the Team page.
2. **Item 46(h)** (above): the Team page's no-name gap, which needs the client-version gate.
3. **Known costs, not defects:** adding one very busy canvasser to many campaigns at once re-reads their
   history per campaign (40 campaigns at 180k knocks took 8.7 s, inside Heroku's 30 s); an account deleted
   within the same few milliseconds as an add can still have its doors moved, as on the Team page today.

