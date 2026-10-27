# Proposal: The people pages — one person panel, a Team page for logins, crews and staffing, and an org Settings page

> **Status: BUILT 2026-10-27 (uncommitted), from plan v7; deploy and the phone update pending (§M).**
> What the build changed from this plan is in [As built](#as-built-2026-10-27) at the end. Plan v7 came
> after review rounds 1-6 (fifteen reviewers; §Q).
>
> - **Rounds 4 to 6** rebuilt crew changes on a test copy of the database and tried to break them,
>   with crashes and two people changing one person at once. None left anyone's doors split between
>   teams. v7 folds in round 6's findings and the owner's rulings (N.1.19, N.1.21).
> - **Shipping first, on its own:** the team-lead privacy fixes, privacy record items 40 and 41. They
>   were handed to the owner 2026-10-25 as a 16-file ship-alone patch; deploy pending (§B.1).
> - **Line references:** HEAD `24d25e5` plus that patch.
> - **Scope:** the server, the web console, and the phone through an over-the-air update (no new
>   build). No new data, recipients, exports or links.

Related: [USERS.md](USERS.md) (accounts, crews, the campaign team), [ROLES.md](ROLES.md) (what a team
lead may do), [AUDIT.md](AUDIT.md) (automatic pause), [PROPOSAL_PACE_PAUSE.md](PROPOSAL_PACE_PAUSE.md)
§H (the setting this moves), [ADMIN_APP.md](ADMIN_APP.md) (the phone's Users hub),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) items 40 and 41.

# Part 1 — For everyone

## What changes, in short

- **Automatic pause moves to a new Settings page** in the org sidebar. "Who gets the email" shows
  only the people chosen, with a search box to add someone, instead of a checkbox for every admin and
  team lead.
- **Clicking a person opens the same side panel** on the Users page and on every campaign's Team
  page. It slides in from the right over a dimmed list, with arrows to step to the next person. The
  buttons that fix a login sit at the top and change with the person's state.
- **Recent activity shows the newest 5 doors**, with **Show more**.
- **The Team page is rebuilt around three jobs**: fixing logins, organizing crews and staffing the
  campaign.
  - Everyone's crew is always on screen.
  - Quick filters find who never signed in, who is deactivated and who is paused.
  - You can tick up to 500 people and move them to a crew, resend their invites, or take them off
    the campaign.
- **You choose the crew while you add someone**, on the Team page and on the Users page.
- **Long lists come 25 to a page** on the web: the Users page, the Team page and the list of people
  in your organization. The phone shows 50 at a time.
- **The phone matches** in what you do there: the same filters, "do this to all shown" actions, the
  same buttons on a person, 5 recent doors, and the same add steps.
- **When someone who worked a campaign before is put back on it**, by any add or by a book, their
  earlier doors there count for the crew they join, or No team if none. That goes for every role.
  Today only some ways of coming back do this.
- **If a crew change stops partway** (say the server restarts while saving), the person shows
  **Finish it**. If two people change one person's crew at once, the second is told, instead of
  silently winning.
- **Adding people by email**: in Add people, each person can check up to 60 emails an hour for people
  new to your organization (today: 30 for every email), plus 30 an hour for people already in it.
  Every email typed counts, even if you don't add them. Once either limit is reached, no email can be
  checked until the wait Doorline shows is over.
- **Already done, shipping first** (items 40 and 41):
  - a team lead sees a person's work on the lead's own campaigns only;
  - a lead adds anyone but themselves only by typing their email;
  - a lead can remove only canvassers and themselves.

## The Settings page

**Settings** is a new item at the end of the org sidebar, after Billing. Org admins see it. Team
leads don't, which is how it was before: the card lived on the Users page, which leads can't open.

It holds **Automatic pause**. Any later switch that covers every campaign can go here too.

What stays the same:

- What automatic pause does.
- Only a billing admin can change it; other org admins see it read-only.
- The warning that turning it off unpauses anyone paused right away.
- The email itself, which names no one.
- A team lead is only emailed about campaigns they manage.

What changes is **Who gets the email**:

- **Billing admins (always)** stays a checkbox and says what it means: everyone with billing access,
  including a billing admin added later.
- **Also email** lists only the people you added, each with **Remove**.
- **Add a person** is a search box. Type part of a name and pick from the matches. Only org admins
  and team leads can be picked, as before, and the limit is still 25 people.
- **Someone you picked who is no longer an admin or team lead** shows by name with "Not emailed: no
  longer an admin or team lead". A billing admin's Save drops them. Today such a person is invisible,
  and their stale entry makes every Save fail, even turning the switch off.

The alert email's last line now says the setting is on the **Settings page in the web console** (it
said the Users page). The Help Center's automatic pause articles say the same. The setting is on the
web only, as it always was.

## The person panel

Clicking a person opens one panel, the same on the Users page and on a Team page. On a Team page it
adds a section about that campaign.

The list stays behind it, dimmed. Clicking the dimmed list closes the panel; the arrows move between
people.

From top to bottom:

1. **Who they are**: name, email, phone, role, and their state: **Deactivated**, **Paused for
   review**, **Never signed in**, **No sign-in recorded**, or **No longer in the org**. Then when they
   joined and when they last typed their password.
2. **The buttons for their state**:

   | Their state | Buttons at the top |
   |---|---|
   | Deactivated | Reactivate account |
   | Never signed in | Resend invite, Set temporary password |
   | No sign-in recorded (an account older than May 15, 2026) | Set temporary password; Resend invite under More options |
   | Paused for review | Unpause (asks first: their count starts over) |
   | No longer in the org | none (Remove from this campaign under More options) |
   | Otherwise | Set temporary password |

   On your own row there is no Set temporary password: it would lock you out of the console until
   you choose a new one.
3. **More options ▸**, a fold-out at the end of the row, not a pop-up menu:
   - Deactivate account.
   - Remove from this campaign (on a Team page).
   - Remove from org and Delete account (org admins). Delete stays behind this fold-out, after the
     reminder that Remove from org is usually what you want, and then two confirmations, as today.
4. **Paused for review** (only when it applies): since when, on which campaign, and **Review**.
   Someone paused on a campaign the viewer doesn't manage shows the line used today: "Paused for
   review — an org admin can unpause." Nothing about that campaign is shown.
5. On a Team page, **This campaign**: their crew, with the same "this many doors move" check before
   a change, and their numbers on this campaign.
   - If an earlier crew change for them didn't finish, or they're on a crew and some of their doors
     here still count for another team, a line says so with **Finish it**. Like any crew change, it
     shows how many doors move before you confirm.
6. **Recent doors**: the newest 5. **Show more** adds 10 at a time. On a Team page only that
   campaign's doors.
7. **Profile**: name, email and phone.
8. **Role** (org admins only).
9. **Everywhere in your organization** (org admins only; folded away on a Team page until you open
   it, and it stays open as you step): totals across all campaigns, miles walked, the FbTime link, and
   their crew on each campaign. Each campaign links to that campaign's Team page with this person
   open.

**Stepping.** The arrows (**‹ ›**, "3 of 45") step through the list as it was when you opened the
panel. Someone opened from a link is placed where they belong in that list.

- Fixing someone doesn't knock you out of the list, for example giving them a crew while the No crew
  filter is on.
- The list behind turns its page so the person you're on stays visible.
- While a change for this person is still saving, the arrows and the close button wait.
- Its result stays on screen with the person's name ("Password set for Sam"), even after you step
  on.
- If you have typed into the profile, typed a password, or staged a crew change, it asks before
  moving on or closing.

**Its own web address.** Opening a person adds them to the address, so you can bookmark or send the
link.

- Back leaves the page, and anything typed and not saved is lost. The pause view on the Audit page is
  different: Back closes it there, as today.
- The list's filters and page are in the address too. So when the panel takes you somewhere else,
  for example Review, coming Back reopens the list and the person as they were.
- This replaces the Team page's old "Manage this person's account →" link, which opened the Users
  list and left you to search for the person again.

**What a team lead can do** is what they can do today, plus one power the owner granted on
2026-10-25:

- **Today's powers.** On their campaigns, for canvassers, they can set a temporary password, resend
  an invite, deactivate or reactivate the account, and fix the name, email and phone. They can set
  the crew of anyone on their campaign's team. Admins and other leads are otherwise read-only to them.
- **New on the phone: removing people.** Leads can already remove canvassers and themselves on the
  web, and now on the phone too. They can also remove someone who is no longer in the organization.
  Doorline won't let them remove anyone else (item 41).
- **Never.** A lead never sees Role, Remove from org, Delete account or the "Everywhere" section.

## The Team page

The Team page is for three jobs: **fixing logins**, **organizing crews** and **staffing the
campaign**.

**Quick filters** sit along the top, each with a count:

- **Current team** (where it opens)
- **Never signed in**
- **Deactivated**
- **Paused**

The counts follow the search and the other filters, so a count always equals the rows it shows.

Under them: a **search box**, a **crew** filter (every coordinator with a count, and **No crew**) and
a **role** filter.

The columns are **Member** (with a Lead or Admin badge), **Crew**, **Last password login**, **Doors**
and **Last door**. The crew is always on screen now; today it only appears as headings when the list
is sorted by crew. The Surveys column moves into the person panel.

"Never signed in" means the account was made on or after May 15, 2026, and no password has ever
been typed. Before that date Doorline didn't record sign-ins, so an older account with no recorded
sign-in reads **No sign-in recorded** instead. It isn't highlighted like Never signed in, and it is
left out of that filter and of Resend invites.

**Sorting**: click a column heading. Sorting by **Crew**, which is how the page opens, groups people
under their coordinator with a count.

**Select several.** Tick rows, or use **Select all N that match**, up to 500 at a time. The selection
only ever covers people in the current filter: it clears when you change a filter or the search, and
after an action finishes. Then:

- **Move to crew…**: pick a coordinator. Before you confirm you see:
  - exactly how many doors move;
  - which client-report teams that changes;
  - a warning for anyone who runs a crew of their own.

  It's the same check one person gets today.
- **Resend invites**: goes only to the selected people who are active and never signed in (for a
  team lead, canvassers only), and says how many emails it will send. Each new link replaces any
  earlier one for that person.
- **Remove from campaign**: hands back the books they hold here. Their work stays counted. For a
  team lead it covers canvassers and themselves.
  - If one of them runs a crew here, it says so first: "Dana runs a crew here: 12 people will have
    no crew. Their past doors stay on Dana's team."

**If something goes wrong partway**:

- A bulk action stops only if your account is read-only for billing, or the action is refused for
  everyone.
- Otherwise anyone who couldn't be changed is listed with the reason, and the rest go ahead.
- **Retry failed** tries just those people again, and finishes a move that was cut off.
- Anyone a stopped run never reached is listed, with **Continue**.

**Add people** opens one window with two ways in.

**By email** (everyone): today's steps, with a **Crew** choice on each confirmation: a new account, a
colleague in your organization, or (for org admins) a switched-off account.

- **For someone who worked this campaign before**, it says how many doors they have here and which
  team or teams those are counted on. It pre-picks their crew, if that coordinator can still run one.
  Under the crew it always says how many of their doors move, and which client-report teams change.
- **For someone coming back to the organization itself** (they left it and are being added again),
  Doorline can't say who they are before the add. That would tell anyone typing an address whether
  it has an account.
  - So the result screen says what happened instead, for example "Pat's 120 earlier doors moved from
    Dana's team to No team".
  - It offers **Open Pat**, where picking their crew moves the doors back, with the usual count
    first.
- **Someone already on this campaign whose account is switched off**: the step offers only **Switch
  on** (org admins; a team lead is told to ask one, as today). Their crew stays as it is.
- **Done** offers **Add another**; "Already here" offers to open that person.
- **If you typed details for someone who already has an account**, the step says "Pat already has
  an account, so what you typed wasn't used."

**From your organization** (org admins only):

- Search and tick the people you want, up to 500 at a time; it shows 25 per page.
- Pick one crew for all of them, see who worked here before and what their doors will do, and add.
- It never changes the crew of someone who was added in the meantime by someone else.
- It replaces the folded list at the bottom of today's page, and the **Assign** buttons in the
  Campaigns page's Assignments window.

Lists show 25 people per page. On a narrow window the crew moves to each row's second line.

On an archived campaign the page is read-only, as today. While the organization's account is
read-only for billing, an action that can't go through says so the first time and stops.

## The Users page

- People come **25 to a page**.
- Filters: role, **status** (Active, Deactivated, Paused, Never signed in, Deleted) and
  **campaign**. "Active" keeps today's meaning: the account is on, whatever else is true.
- The filters and page are in the address, like the Team page's.
- Clicking a person opens the same side panel.
- **Add member** gets an optional **Campaign** for a canvasser. Picking one hands what you typed to
  the same By-email steps the Team page uses, with the Crew choice and the confirmations. Adding an
  admin or a team lead works as today.

## The phone

The phone gets the same changes, over the air.

- **Users** (More → Users):
  - the new status filters (Paused, Never signed in) and a **Crew** picker when a campaign is
    chosen;
  - 50 people at a time, with **Show 50 more**.
- **"All shown" actions** under the current filter, for the rows actually on screen:
  - **Move all shown to a crew…**, with the door-count check;
  - **Resend invites to all shown**, counting only those who never signed in (for a team lead,
    canvassers only);
  - **Assign all shown** (admins), which gains a crew choice and the same check.

  There is no bulk remove on the phone: removing is one person at a time there.
- **Add a canvasser** first asks who the email belongs to, then shows the same confirmations as the
  web. Today it adds them straight away. That can reactivate someone without telling you, or add an
  existing account without saying whose. Adding by email on the phone now counts toward the same
  hourly limits as the web.
- **The member sheet** (tap someone on a campaign):
  - the buttons for their state at the top;
  - Unpause asks first;
  - the pause notice has Review;
  - **Finish it** for a change that didn't finish, or for someone on a crew whose doors here still
    count for another team;
  - **Assign to this campaign** gains the crew choice and the check;
  - team leads get **Remove from this campaign** for canvassers and themselves;
  - its recent doors stop listing notes as doors.
- **The profile page**:
  - 5 recent doors with **Show more**;
  - its Campaigns list becomes read-only. Assigning and unassigning are done from Users on that
    campaign;
  - for a team lead, the totals read **On your campaigns** and leave out miles. Miles join one
    campaign's doors to the next in a straight line, which reads wrong once other campaigns are left
    out.
- **What the phone won't show**: the client-report team names in the door-count check. The phone
  doesn't load client reports today. The count itself is there.

## Adding someone back to a campaign

Doors follow the person. Changing someone's crew moves all their doors on that campaign to the new
crew; that is the July 2026 rule. Coming back to a campaign now works the same way, by the owner's
rulings on 2026-10-25 and 2026-10-26: **their earlier doors there move to the crew they rejoin, or to
No team if none is picked, whatever their role.** Someone removed from a campaign keeps their doors
where they are until they come back.

Today it depends on how they come back (we tried each one on test data):

| How they come back, with no crew picked | Their earlier doors today | After this change |
|---|---|---|
| Added by email (web Team page, phone) | move to No team | move to No team |
| Added from the organization list, the phone's Assign all shown or member sheet | stay on their old team | move to No team |
| An admin or a team lead given a book, or taking one | stay on their old team | move to No team |
| Someone **already on the campaign** whose email is typed in again (the phone's Add a canvasser, or the web's Switch on & add for a switched-off account) | **their crew is cleared** and their doors move to No team | nothing changes; a switched-off account is switched back on |

**Books.** A removed canvasser can't come back through a book or a walk list: both turn away anyone
who isn't on the team. Only admins, team leads and Doorline staff join a team through a book, by
taking one or being handed one. The rule applies to them too ("that applies no matter the role").
A book puts them on the team with no crew, so their earlier doors there move to No team. The book
screens have no crew choice, so no count is shown first; their crew can be set from their panel
afterwards.

**The last row was a bug**: someone who never left lost their crew because their email was typed.
Someone already on the campaign isn't coming back, so an add changes nothing for them and says
they're already on it. Their crew is changed from their panel, with the count first.

**Until a phone updates**, its Assign buttons move a returning person's doors to No team without
showing the count first, and its crew picker can still undo a change someone made seconds earlier.
(Book screens never show a count, before or after the update.)

**The add screens pre-pick the crew a returning person's doors are counted on**, if that coordinator
can still run a crew. They show what changes if you pick otherwise (an open question for you,
N.2.2). Someone coming back to the organization itself is the exception: Doorline can't recognize
them before the add, so their result screen says what moved and links to them.

**Team totals.** A team's totals, and its client-report team numbers, can change whenever someone
who worked here before is put back, with or without a crew. That is the same trade the owner
accepted in July for crew changes. People added back before this change keep their doors where they
are.

**History** shows every crew change. An add, or a book, shows there only when it moved some of the
person's earlier work (doors, surveys or notes), so hiring someone new adds nothing to it.

## Crew changes that can't be left half-done

Found by running the real code:

- A crew change cut off halfway couldn't be finished by doing it again.
- Two changes to the same person close together could leave their doors split across two teams.
- Two admins changing the same person a few seconds apart: the second one silently overrode the
  first, even though both had seen the same "this many doors move" check.

After this change, a crew change can't be left half-done without a way to finish it:

- **If a change is cut off**, Finish it on the person's panel completes it. If the person, or the
  coordinator they were moving to, leaves the campaign before anyone finishes it, their doors stay
  where they were at that point.
- **Saving a crew change takes about two seconds.** That way doors saved on a phone at that moment
  are moved too.
- **It only goes through if the crew is still what you saw** in the check. If someone else changed it
  in between, yours stops and says so.
- **While one change is moving someone's doors**, another change to that person is turned away: "Another
  change for Sam is still finishing — try again in a minute or two".

**Once, after the server update**, you run two commands in the Heroku dashboard's Run console.
- **The team-count check** lists people whose doors don't all count for their crew, and any change
  that didn't finish. For someone on a crew, Finish it fixes them. Each fix can change published team
  numbers, so each one is your call.
- **The old repair tool** now only lists any organization whose team pages are switched off. It was
  built before crews belonged to campaigns and can wrongly report that nothing needs fixing, so its
  crew checks moved into the team-count check.

People listed with no crew have usually left the campaign, or their coordinator did. Their doors
stay on the old team on purpose, so the check suggests no fix.

## What doesn't change

- **Who can do what**, except the narrower lead powers already shipping (items 40 and 41) and leads
  removing canvassers and themselves on the phone.
- **Crews are still per campaign**, and a crew change still asks first.
- **Typing an email still never shows** whether that person has a Doorline account with another
  organization.
- **How doors, surveys and miles are counted.** Team totals change only through crew changes and the
  coming-back rule above.

## Decisions

The owner's answers are in §N.1 and the open calls in §N.2.

# Part 2 — Technical reference

## A. What the design rests on (checked at `24d25e5` plus the ship-alone patch)

| Fact | Where |
|---|---|
| The pause card renders above the member list and lists one checkbox per active org admin and lead | [UsersPage.jsx:268](../client/src/pages/UsersPage.jsx), [PacePauseSettingsCard.jsx:47-75](../client/src/components/users/PacePauseSettingsCard.jsx) |
| `GET /admin/pace-pauses/settings` is org-admin-only; `PATCH` refuses the whole save when any stored recipient is no longer an active admin or lead; `settingsOf` names only eligible people | [pacePauses.js:190-251](../server/src/routes/admin/pacePauses.js) |
| Every top-level web path must be on `WEB_SEGMENTS` or a reload answers 404; there is no `settings` entry | [webRoutes.js:19-50](../server/src/webRoutes.js) |
| The alert email's footer names the Users page | [templates.js:418, 427](../server/src/services/mail/templates.js) |
| The Users page renders every member as `<tr onClick>` rows and opens a hand-rolled overlay profile | [UsersPage.jsx:495-640](../client/src/pages/UsersPage.jsx) |
| The profile asks for 20 recent rows; so does the phone profile | [UserProfileModal.jsx:227-231](../client/src/components/UserProfileModal.jsx), [users/[id].jsx:179-183](<../mobile/app/(app)/admin/users/[id].jsx>) |
| The moved profile closes itself from a hook-level `onSuccess`, which TanStack v5 runs after unmount | [UserProfileModal.jsx:312-317](../client/src/components/UserProfileModal.jsx) |
| `RowMenu` lands off-screen inside the Drawer's transformed panel; every `Overlay` has its own Escape listener; the app runs a plain `BrowserRouter` | [RowMenu.jsx:65-72](../client/src/components/RowMenu.jsx), [Overlay.jsx:38-60](../client/src/components/ui/Overlay.jsx), [main.jsx:32-36](../client/src/main.jsx) |
| `lastLoginAt` is trustworthy only for accounts made on or after 2026-05-15 (`CLOCKS_RELIABLE_FROM`) | [deleteAccount.js:63-66](../server/src/services/users/deleteAccount.js) |
| The Team panel deactivates through the campaign crew route, which refuses every non-canvasser for every caller, so an org admin can't deactivate a lead from a Team page today; `/admin/memberships/:id/deactivate` is the org route, allowed for admins and (for canvassers) leads | [leadCrew.js:490-497](../server/src/routes/admin/leadCrew.js), [CampaignTeamPage.jsx:494-501](../client/src/pages/CampaignTeamPage.jsx) |
| Ways onto a roster: `POST /crew` (re-stamps on join to the picked crew or none), `POST /assignments` (no re-stamp), `ensureCampaignAssignments` from book assignment and assign-bulk (no re-stamp; after item 41 a lead can put only themselves on this way) | [leadCrew.js:258-305](../server/src/routes/admin/leadCrew.js), [assignments.js](../server/src/routes/admin/assignments.js), [campaignRoster.js](../server/src/services/campaignRoster.js) |
| `POST /crew` turns an omitted `coordinatorId` into `null`, re-stamps to it and `$set`s it on the roster, including for someone already on the campaign; it accepts the person as their own coordinator, after the roster write; it sends "added" mail on the resolver's answer | [leadCrew.js:230, 258-330](../server/src/routes/admin/leadCrew.js) |
| A former org member resolves as `outside` (byte-identical, pinned); a never-seen address costs one query less than an account at another customer, and the code names the limiter and an audit line as the defense. The audit line is written only for Doorline staff under a support grant, so for a customer's own staff the limiter is the only one | [createMember.js:55-68](../server/src/services/memberships/createMember.js), [teamLead.int.test.js:711-712](../server/test/teamLead.int.test.js), [accessLog.js:94](../server/src/middleware/accessLog.js) |
| `crewResolveLimit`: 30 lookups an hour per actor, every answer counted, in memory per dyno. express-rate-limit counts a request when it arrives; `skipSuccessfulRequests` gives it back when it finishes | [crewResolveLimit.js](../server/src/middleware/crewResolveLimit.js); review round 4 |
| `setMemberCoordinator`: roster first, ledger second, silent on a same-value pick; a torn change can't be finished by repeating it; two changes milliseconds apart tear; two admins seconds apart both succeed | [setCoordinator.js:18-61](../server/src/services/memberships/setCoordinator.js); review rounds 2-3 |
| Today a crew change always writes a `CoordinatorChange`, and a join writes one only when rows moved. Three things read every row: the History feed (capped at 200); the team client-report build fence, where a second change during a build fails it (`CHANGED_DURING_BUILD`) and ledger rows changed in place are seen through `updatedAt`; and `earlierTotalsReason`, which matches from and to against a report's crews | [setCoordinator.js:63-74](../server/src/services/memberships/setCoordinator.js), [createMember.js:104](../server/src/services/memberships/createMember.js), [campaigns.js:340-348, 470-517](../server/src/routes/admin/campaigns.js), [clientReportBuilds.js:390-421, 827-841](../server/src/services/reports/clientReportBuilds.js), [clientReportChecks.js, `earlierTotalsReason`](../server/src/services/reports/clientReportChecks.js) |
| When a coordinator leaves a campaign or the org, `releaseAssignedWork` clears their crew's roster crew in one write and never touches the ledger; it is the choke point's sanctioned exception | [deleteAccount.js:914-917](../server/src/services/users/deleteAccount.js), [coordinatorChokePoint.test.js](../server/test/coordinatorChokePoint.test.js) |
| The driver's socket timeout is 120 s; mongod keeps executing an `updateMany` after its client gives up | [config/db.js:13](../server/src/config/db.js); review round 3 |
| Production sets `strictQuery: true`, and the pool's `waitQueueTimeoutMS` is unset, so a write can wait for a connection without limit; `maxTimeMS` bounds only the time mongod spends on it | [config/db.js:8-26](../server/src/config/db.js); review round 4 |
| Mongoose stamps one `updatedAt` on every row of an `updateMany`, at the moment it is sent. The build fence's in-place check compares that time to the fence, and `sourcesNear` reads `CoordinatorChange` by `createdAt` | [clientReportBuilds.js:390-424](../server/src/services/reports/clientReportBuilds.js); review round 4 |
| `restampFilter` always carries `organizationId`, and an org-scoped ledger filter can make the planner pick the `organizationId` index and read the whole organization; the code already documents this trap | [restampCoordinator.js:48-73](../server/src/services/memberships/restampCoordinator.js), [deleteAccount.js:237-238](../server/src/services/users/deleteAccount.js); review round 4 |
| `sourceBreakdown` counts doors (knocks only) by source team; surveys, notes and restricted marks move too but aren't in it | [repairTeamStamps.js:72-87](../server/src/migrations/repairTeamStamps.js) |
| Both phone book screens add the person to the campaign first with `POST /assignments` and no crew, then assign the book | [books.jsx:376, 386](<../mobile/app/(app)/admin/books.jsx>), [book/[turfId].jsx:232](<../mobile/app/(app)/admin/book/[turfId].jsx>) |
| A knock reads the person's crew, then writes its row a few milliseconds later, so a knock saved during a crew change can keep the old crew | [canvass.js:70-92, 511-522](../server/src/routes/mobile/canvass.js); review round 4 |
| Only org admins and Doorline staff can save a door on a campaign without a roster row there; anyone else is refused | [canvass.js:110-119](../server/src/routes/mobile/canvass.js) |
| The resolver answers `in-org-inactive` before it checks the campaign roster, so a switched-off person already on the campaign reads as switched off | [createMember.js:76-83](../server/src/services/memberships/createMember.js) |
| Re-adding someone already on the campaign through `POST /crew` answers 201 `on-campaign`, pinned as idempotent, though the route still rewrites their crew today | [teamLead.int.test.js:732-735](../server/test/teamLead.int.test.js), [leadCrew.js:293-308](../server/src/routes/admin/leadCrew.js) |
| Switching a coordinator off or changing their role leaves their crews in place, and `resolveCoordinatorId` refuses anyone who isn't an active admin or lead | [memberships.js](../server/src/routes/admin/memberships.js), [createMember.js:225-242](../server/src/services/memberships/createMember.js) |
| `otherChangeRunning` lives in answerEditRuns.js and also gates seven answer-edit routes; the report build calls it at two places | [answerEditRuns.js:201](../server/src/services/canvass/answerEditRuns.js), [clientReportBuilds.js:720, 820](../server/src/services/reports/clientReportBuilds.js) |
| The phone's `api()` gives up at 20 s, and Heroku's router at 30 s | [mobile/lib/api.js:25](../mobile/lib/api.js) |
| `repair:team-stamps` reads `Membership.coordinatorId` and reports "nothing to move" over per-campaign drift; with a legacy field it throws. Its `--apply` also switches on an org's team surfaces (`teamAttributionReadyAt`), now a schema default; `--ready-only` does only that. `audit:team-counts` is already per campaign and read-only, and lists each person's roster crew | [repairTeamStamps.js:18-22, 108-129, 236-244](../server/src/migrations/repairTeamStamps.js), [Organization.js:34](../server/src/models/Organization.js), [auditTeamCounts.js:230-264](../server/src/migrations/auditTeamCounts.js) |
| A hinted query fails when the index doesn't exist; Mongoose's background index build races the first query in a fresh test database; a hinted multi-person `$group` reads each person's whole ledger (1,030,000 rows vs 30,000 unhinted for 100 people) | review rounds 2-3 |
| The reports `/activities` read counts notes and restricted rows unless `actionType` is passed; the phone member sheet passes none | [reports.js:4129-4176](../server/src/routes/admin/reports.js), [MemberSheet.jsx:86-89](../mobile/components/MemberSheet.jsx) |
| The phone's admin screens don't load `['bootstrap']`; a lead's phone builds its coordinator choices from its own scoped member list | [map.jsx:301](<../mobile/app/(app)/map.jsx>), [users.jsx:200-206](<../mobile/app/(app)/admin/users.jsx>) |
| Three client suites import UserProfileModal.jsx, including the ones that pin Delete staying tucked away | `memberDeletionRender.smoke.test.js`, `memberDeletionFlow.smoke.test.js`, `integrationsRender.smoke.test.js` |
| Staging phones talk to the production API; `eas update` publishes whatever mobile code is on disk; Help ships with every server deploy | [eas.json](../mobile/eas.json), [mobile/package.json](../mobile/package.json), [loadHelp.js](../server/src/services/help/loadHelp.js) |

## B. Server

### B.1 Team-lead privacy — DONE, shipping alone (items 40 and 41)

Handed to the owner 2026-10-25 as a 16-file ship-alone patch, verified on a clean copy (634 server
unit, 964 web, 2,060 integration tests, 0 failures).

For a lead:

- a person's drills (`/stats`, `/recent-activity`, `/campaigns`, `/crews`) and `GET /`'s
  `managedCampaignIds` cover only the campaigns the lead manages;
- `POST /assignments` takes only their own id;
- books, assign-bulk and walk-list crews put only the lead themself on the team
  (`partitionAssignable` `selfOnlyFor`);
- `DELETE /assignments/:userId` reaches canvassers, people no longer in the org, and themselves,
  with no staff oracle.

The owner decided on no DPA §5 notice for any part. The rest of this plan builds on it unchanged.

### B.2 `/recent-activity` pages, and stops listing desk marks

- **New `skip`.** There is no `total`. Show more stops when a page is short or adds no new ids,
  because a server that predates `skip` returns page one again.
- **`via: { $ne: 'bulk' }`**, matching `/stats` and every report. Released phones stop seeing desk
  marks in this list too.
- **One shared action list**: the door outcomes plus restricted, never notes. The web panel and the
  phone member sheet pass the same list to the reports `/activities` read.
- **Hint**: the person's index (§B.6, Hints and tests).
- **Unchanged**: the default `limit` 20 and the cap 100.

`/stats` itself is not rewritten. It is read once per panel opening, as today.

### B.3 Move several people to a crew

Two new routes on the campaign crew router (`leadCrew.js`), gated like the single-person routes:

```
POST  /admin/campaigns/:campaignId/crew/coordinator-bulk/preview
      { userIds: [1..500 distinct ids], coordinatorId: string | null }
PATCH /admin/campaigns/:campaignId/crew/coordinator-bulk
      { people: [{ userId, from: string | null }] (1..10), coordinatorId: string | null }
```

**Preview.** One `$group` by `userId` over `{ campaignId, userId: { $in } }` on each ledger, hinted
to the campaign index (`{ campaignId: 1, timestamp: -1 }`, and `{ campaignId: 1, submittedAt: -1 }`
for surveys).
- The person index would read each person's whole ledger: 1,030,000 rows against 30,000 for 100
  people (round 3).
- Left unhinted, the planner can pick the `organizationId` index and read the whole organization,
  because the shared filter carries `organizationId`. Round 4 measured 1,196,000 rows read where the
  campaign has 396,000; it happens to an org's oldest campaign.

It answers per person:

```
{ userId, name, onCampaign, from, sources: [{ coordinatorId, name, doors }],
  doors, activities, surveys, subjectRunsCrew, unfinished, skip? }
```

It also answers `totals: { people, doors, activities, surveys }`.

- **What it models.** For someone on the roster it models the job in §B.6; for `onCampaign: false`
  it models joining (§B.7).
- **`totals.doors`** comes from one `knocksPipeline` over every mover, hinted the same way, exact
  and deduplicated. That is why the preview takes the whole selection (up to 500) in one call.
- **`unfinished`** is true when the person's roster row holds a crew job whose hold has passed
  (§B.6). A job still running makes them `busy`.
- **`sources`** list every team any of the person's moving rows come from, as in §B.6 step 1: doors
  for the screen, rows for the record.
- **Client-report teams.** The web calls `client-reports/series/affected` once with every source and
  target coordinator.
- **People not on the roster** are previewed for an org admin only, looked up through a Membership in
  this org. With no membership here an id is `skip: 'not-in-org'`, with no name.
- **For a lead**, an id not on this campaign's roster is `skip: 'not-on-campaign'`, checked before
  anything else. A lead learns nothing about it: no name, no counts, not whether it is staff.

**Skips**:

- `not-in-org`
- `not-on-campaign`
- `is-coordinator`
- `staff` (after the roster check, for a lead)
- `same-crew`: the roster crew already equals the pick, no job is on the row, and either the pick is
  No crew or nothing would move
- `changed-meanwhile` and `busy` (§B.6)

**Write.** Up to 10 people per request, each through the §B.6 job with the `from` the preview showed.
The request runs their jobs four at a time, so their waits overlap (§B.6 step 3). It answers per
person `{ userId, changed, finished, doors, activities, surveys, error, skip? }`. The counts are each
job's planned counts: a write cut off by `maxTimeMS` reports no count of its own. It is refused on an
archived campaign and validates the coordinator once, up front.

### B.4 Add people with a crew in one step

`POST /admin/campaigns/:campaignId/assignments` gains an optional `coordinatorId` (string or null),
on top of item 41's rule that a lead may name only themselves:

- It is validated with `resolveCoordinatorId` before any roster row is written.
- `userIds` stays uncapped, as today: a released phone's Assign all shown sends every id in one
  request.
- **Each id this call inserts** joins through §B.7, so their earlier doors on the campaign follow
  them: to the sent coordinator, or to No team when the key is `null` or absent. An absent key is what
  released phones and the phone's book self-assign send (§A), and the rule applies to every role
  (owner ruling, 2026-10-26).
- **The route reads the roster once.** Ids already on it are skipped (`already-on-campaign`), and
  their crew is never changed by an add. So a stale list can't re-crew someone another admin just
  added; re-crewing is what Move to crew is for.
- **Only the other ids go through `joinCampaignCrew`**, whose insert replaces the route's own upsert
  (assignments.js:151-169) and is the claim (§B.6 step 2). It still settles a race: if someone else
  inserted the row first, it moves nothing.
  - Their jobs run four at a time.
  - "Added" mail still goes only to inserted ids, after the inserts.
  - A ledger error is caught per person: the person stays added, the job stays on their row for
    Finish it, and `crew.skipped` names them.
  - **If a person's join throws before its insert**, for example in the plan's aggregations, the
    route falls back to today's plain insert for them: no move and no record. They are still added,
    and `crew.skipped` names them. Round 6 showed the alternative leaves someone the screen reported
    as added off the roster.
- **Response**: `crew: { set, skipped: [{ userId, reason }], doors, activities, surveys }`, for the
  no-crew join too. Clients treat a missing `crew` as "crew not set".

### B.5 Resolve: history, and two limits

`POST /crew/resolve`:

- **`history`** on the named outcomes only (`in-org`, `in-org-inactive`, `on-campaign`):
  `{ doors, sources: [{ coordinatorId, name, doors, canLead }] }`, this campaign only, hinted,
  newest team first (by each team's latest door), so the pre-pick takes the first.
- **`in-org-inactive` gains `onCampaign`.** The resolver answers "switched off" before it looks at the
  roster (§A), so this tells the add step that the person is already on this campaign. The step then
  offers only Switch on, with no Crew choice.
- **The `outside` answer stays byte-identical** (`teamLead.int.test.js:711-712`).
- **Two limits per person**, replacing today's one (30 an hour, every answer counted). Owner ruling
  N.1.21:
  - **new people** (`outside` answers): 60 an hour;
  - **people already in the organization** (`in-org`, `in-org-inactive`, `on-campaign`): 30 an hour.
- **How each counts only its own kind.**
  - Two express-rate-limit instances, keyed on the actor as today, each with
    `skipSuccessfulRequests`.
  - The route sets `res.locals.lookup` to `'outside'` or `'named'`. Each limiter's
    `requestWasSuccessful` is true unless the flag is its own kind, so a lookup stays counted only
    by the limiter it belongs to.
  - An error, such as a mistyped address (400), or a refusal (429) sets no flag and counts for
    neither. So the mount order doesn't matter.
- **When either runs out, every lookup waits** for that limiter's hour. express-rate-limit counts a
  lookup when it arrives, before the answer is known. That is also the safe behavior: refusing only
  the lookups that would name someone would make the refusal itself say who is in the organization.
- **The phone's add now goes through the lookup** (§G), so phone adds share both limits. Today they
  skip it.
- **The 429 answers `{ error, retryAfterSeconds }`**, from `req.rateLimit.resetTime` of the limiter
  that refused, so the add step can say how long to wait.
- **The resolver makes the same membership query whether or not an account exists** (with a zero id
  when there is none). That narrows the timing difference between "no account" and "an account at
  another customer" (round 3: 634 of 800 pairs slower before, 474 after). The 60-an-hour limit bounds
  what's left.

### B.6 Crew changes: one job per change, kept on the roster row

Every crew change is one **job**, run the same way whether it comes from the panel's crew picker, a
bulk move, an add or a book that joins someone with doors to move, or **Finish it**. The job is kept
on the person's roster row (`CampaignAssignment.crewJob`), beside the crew it changes. So changing
the crew and noting what is about to happen are one write, and there is never a note without a
change or a change without a note.

Rounds 4 and 5 built this on a scratch database and could not tear it. They tried every crash point,
a 300,000-row write killed from outside, a `maxTimeMS` timeout, and 50 races 2-25 ms apart. Round 5
added every v5 change and re-ran round 4's tests.

1. **Plan** (no writes):
   - read the roster row: crew and `crewJob`;
   - group the rows that would move by the team they are stamped with, on **both ledgers and every
     kind of row** (knocks, surveys, notes, restricted marks), using the same filter the write uses
     (`restampFilter`), hinted to the person's index. Each source team carries its rows, its doors
     (knocks only, deduplicated, the number on screen) and its latest row's time. Teams are listed
     newest first. These are the job's `sources`.

   Previews return this plan, plus `unfinished` (a job is on the row and its hold has passed) or
   `busy` (its hold hasn't passed).
2. **Claim**: one conditional `updateOne` on the roster row:
   `{ campaignId, userId, coordinatorId: from, 'crewJob.until': { $not: { $gte: now } } }` →
   `$set: { coordinatorId: to, crewJob: { token, run, until: now + 150 s, from, to, sources, activities, surveys, doors, byUserId, source } }`.
   - `token` names the job and is a new ObjectId per job; the job's record uses it as its `_id`
     (step 4). `run` names this attempt at it: the first run, and each Finish it, get a fresh `run`.
   - `$not: { $gte: now }` matches a row with no job, a row from before the field existed, and a job
     whose hold has passed.
   - `now` is the web server's clock. There is one web dyno, and a few seconds of clock difference
     can't matter against a 150-second hold, so no database-clock update pipeline is needed.
   - **For a join** the claim is the roster insert itself: an upsert whose `$setOnInsert` carries the
     crew and, only when the plan found rows to move, the job. A join with nothing to move is a plain
     insert with no job and no record. When two adds race, one insert wins; the other gets
     `upsertedCount: 0` and moves nothing.
   - **Finish it** claims by token:
     `{ campaignId, userId, 'crewJob.token': token, 'crewJob.until': { $lt: now } }` →
     `$set: { 'crewJob.run': <new>, 'crewJob.until': now + 150 s }`. The crew is not touched. The new
     `run` is what stops an earlier, stalled run of the same job from carrying on (step 3).
   - **A claim that replaces an expired job** first writes that job's record, marked as interrupted,
     with its planned counts. Otherwise a crash followed by a different pick would leave no record of
     the first change.
     - The write is an insert-only upsert on `{ _id: <old token> }`: `$setOnInsert`, with Mongoose
       timestamps off and `createdAt` and `updatedAt` set inside the `$setOnInsert` itself. So it
       never relabels a record that already exists and doesn't touch that record's `updatedAt`,
       which the report fence reads. A new record still gets both times; without them the next
       change's `finishedBy` close (by `createdAt`) never matches it (round 6).
   - If nothing matched, a re-read says why: a job's hold hasn't passed (`busy`, 409 with
     `retryAfterSeconds`), or the crew differs (`changed-meanwhile`, 409 on the single route).
     Nothing was written. For Finish it, a token no longer on the row means another change replaced
     the job, and the answer shows the row as it is now.
3. **Ledger**: the two `updateMany` calls in `restampLedgerCoordinator`, each with `maxTimeMS: 60000`
   and the person's hint.
   - **Before each write the run renews its hold**:
     `{ campaignId, userId, 'crewJob.token': token, 'crewJob.run': run, 'crewJob.until': { $gt: now } }` →
     `$set: { 'crewJob.until': now + 150 s }`.
     - The filter starts with `campaignId` and `userId`, so it uses the roster's unique index.
       Without them, round 6 measured a scan of all 100,000 roster rows for each renewal.
     - If it matches nothing, the hold was lost: to a pause longer than the hold, to a Finish it (new
       `run`), or to a different pick (new `token`). **A renewal that took more than 30 s to come
       back also counts as lost**, because its `until` was set before it waited.
     - The run stops with `lost-hold` and changes no more rows, so a late write can't undo a later
       change.
     - It writes the job's record only if none exists yet, insert-only as in step 2. Round 5 showed
       that letting it overwrite turned a finished change back into "didn't finish".
   - **Time limits.** `maxTimeMS` bounds only the time mongod spends on a write. The web dyno's
     connection pool also gets a `waitQueueTimeoutMS` of 30 s, so a write can't sit waiting for a
     connection past its hold.
     - The arithmetic: the renewal set `until` 150 s ahead and came back within 30 s. The write then
       waits at most 30 s for a connection and runs at most 60 s. That ends within 120 s, with 30 s
       to spare.
     - The 30 s wait matches Heroku's router, which gives up on a request at 30 s anyway.
     - It is set on the web server's own `connectDb` call (server.js:10), not in the shared
       `baseOptions`, which also reach the worker and the console scripts.
   - **Then a second pass**: about 2 seconds after the first, the run renews its hold and runs both
     writes again.
     - Why: a knock reads the crew and writes its row a few milliseconds later (§A), so a knock saved
       during the change can keep the old crew. The second pass moves it. Round 4 counted 20 such
       rows in 6 changes at about 50 knocks a second. Today's code has the same race and nothing
       that catches it.
     - **Joins skip it** unless the person joins a real crew and can save a door without a roster
       row, which only org admins and Doorline staff can (§A).
       - Nobody else can have a knock in flight.
       - An off-roster admin's knock already stamps No team, which is what a No-crew join stamps,
         so every book join skips it too.
       - Round 6: an admin handed a book took 2,043 ms with the second pass and 19 ms without.
     - **A request runs its jobs side by side, four at a time**, so their waits overlap.
       - Round 5 measured 10 jobs one after another at 21 s, past the phone's 20 s (§A).
       - Round 6 measured 10 at once filling all 20 database connections, and four at a time just as
         fast, with nothing else kept waiting.
4. **Record, then release**:
   - **renew the hold once more**, then write the job's `CoordinatorChange` as an upsert on
     `{ _id: token }`, so a finish that runs twice still writes one row.
     - The job **asserts its token is an ObjectId first**. Mongoose drops `_id: undefined` from a
       filter, and the upsert would then match something else.
     - **`_id` is unique already**, so two simultaneous upserts of one token can't make two rows.
       Round 5 saw two rows in about 9 tries in 10 when the key had no unique index. MongoDB retries
       an upsert that collides on its exact unique key itself, and the job's one retry stays as
       insurance. No new index is needed.
     - It carries `toCoordinatorId`, `sources` and `fromCoordinatorId`: the one team in `sources`, or
       the previous crew when `sources` is empty. With more than one team, History says "Several
       teams".
     - **Its counts are the job's planned counts**: rows on each ledger, and `doorsMoved`, the doors
       (knocks, deduplicated) the check showed. A write cut off by `maxTimeMS` reports no count of its
       own, so planned counts are the only honest number for an unfinished change.
     - A crew change (`from` ≠ `to`) is always recorded, as today. A join or a repeat that moved
       nothing writes no record.
   - mark this person's older open error records on this campaign as finished by this one
     (`finishedBy`);
   - clear the job: `$unset: { crewJob }`, only where `campaignId`, `userId`, `crewJob.token` **and
     `crewJob.run`** are still this run's.
     - Round 6 reproduced the alternative. A stalled run woke and, matching the token alone, cleared
       a live Finish it's job. A different pick then claimed, and the person's activities and surveys
       ended on two teams.

   **On an error** (a ledger write threw or timed out, or the record couldn't be written; a lost hold
   is step 3's case):
   - renew, then write the record with `restampError` and the job's planned counts, if it can be
     written. The activity write may have landed before the error, and a record saying nothing moved
     would read wrong once a later change closes it. If the renewal fails, the write is insert-only,
     as for a lost hold;
   - **keep the job on the row**. Its hold runs out by itself, so a write still running on mongod
     can't overlap a new one. After that the panel shows Finish it.
5. **Repeat and Finish it** (the pick equals the roster crew):
   - **A job on the row**: finish it (`busy` while its hold lasts).
     - Finishing re-runs the ledger toward the roster crew, which is the job's `to`, and moves only
       what is left.
     - Its record is the same row (same token). It carries the job's planned counts and sets
       `restampError: null`, so History shows the whole change once and stops showing it as
       incomplete.
   - **No job on the row**:
     - a real coordinator with rows still off their team runs a job that moves them (repairing
       drift), recorded like a join; with none off their team it is silent, as today;
     - **No crew is a silent no-op**. "Roster none, doors on a real team" is also what every
       departure leaves, and conforming it is the 104-door bug. A job on the row proves that a change,
       not a departure, set the crew to none. That is why Finish it may move doors to No team and a
       bare repeat may not.
   - A select can't re-pick the value it already shows, so the panel and the member sheet show
     **Finish it** in both cases: when `unfinished` is true, and when the crew is a real coordinator
     and rows are still off it. Finish it sends the current crew as both the pick and `from`.
   - **Finish it shows the count first**, through the same confirm as any crew change: the doors that
     move, and the client-report teams they change.
   - **Only a new pick is validated** with `resolveCoordinatorId`. Repeating the current crew (Finish
     it, the open-time preview) is not, because switching a coordinator off or changing their role
     leaves their crews in place (§A). Validating would refuse every member of that crew a panel and
     leave their unfinished jobs unfinishable.
     - When the route skips validation because the pick equals the crew it read, it passes that crew
       as the claim's `from`. Otherwise a released phone (which sends no `from`) could re-send a
       switched-off coordinator just as another admin moves the person. The claim would then make an
       unvalidated new pick. Round 6 reproduced it; with the read crew as `from`, the claim answers
       `changed-meanwhile`.
6. **A different pick while a job is on the row** is a normal change once the hold has passed.
   - Its claim writes the old job's record as interrupted (step 2), then replaces the job.
   - Its ledger step moves every row to the new crew, which also completes the old job's work.
   - Its finish closes the old job's record (`finishedBy`).
7. **Who starts a job and with what `from`**:
   - the web panel and the phone member sheet send the `coordinatorId` they previewed as
     `fromCoordinatorId` on the single PATCH. The route tells an absent key from `null` with
     `Object.hasOwn`: `null` is what a No-crew preview sends, and an absent key is a released client,
     for which the server uses the value it just read;
   - bulk sends each person's preview `from`;
   - a 409 makes the client re-preview and show the new check.
8. **Retry** re-previews the failed people before writing: it takes a fresh `from` and `unfinished`,
   so a torn change finishes instead of reading as a collision.

**Opening a person.** When the web panel or the phone member sheet opens someone on a campaign, it
previews their current crew (the single preview, with the current crew as the pick). The answer
carries `unfinished`, `busy` and the rows still off that crew, which decide whether Finish it shows.

**The departure rule** stays outside the job, as today.
- `releaseAssignedWork` (deleteAccount.js:914-917) clears a departed coordinator's crews on the
  roster and never re-stamps.
- That write now also clears `crewJob` on those rows. So a job on a row always names the row's
  current crew.
- A torn change toward someone who then leaves stays as the departure left it. So does a job running
  at that moment: its next renewal finds the job gone and it stops between its writes. Part 1 says
  so.
- **Every other crew write outside a job also clears `crewJob`.** That means the demo seeder's crew
  write (seedDemoOrg.js:1182-1185) and the per-campaign crew backfill (migrateCampaignCoordinators.js,
  which sets a crew wherever `coordinatorId` is null, exactly the row a No-crew job leaves). Round 5
  showed a leftover job offering a Finish it that moved a crew's doors to No team.

**Model changes, all additive:**

- `CampaignAssignment.crewJob { token, run, until, from, to, sources, activities, surveys, doors, byUserId, source }`,
  declared as **one nested subdocument (or `Mixed`) with `default: undefined`**.
  - Undeclared, Mongoose silently strips the hold from the claim's filter under the production
    setting (`strictQuery: true`). Then a second claim during the hold matches.
  - Declared as a plain nested object with a `sources` array, every roster create stores
    `crewJob: { sources: [] }`.
  - "A job is on the row" means `crewJob.token` is set. The §L job tests run with `strictQuery: true`,
    as production does.
- `sources` items are `{ coordinatorId, activities, surveys, doors, latest }`, declared on both
  schemas; strict mode strips undeclared subfields.
- `CoordinatorChange.sources`, `doorsMoved`, `run` and `finishedBy`; a new record's `_id` is its
  job's token
- the `campaign_join` source value

**No new index.** A record's `_id` is its job's token, and `_id` is unique already. "This person's
open error records" rides the existing `{ userId: 1, createdAt: -1 }`. (v6 had a unique partial index
instead; it could not have been built before the deploy, because the index script reads the deployed
models. Round 6.)

**Who reads `sources`**:
- deleteAccount's "was a coordinator" check;
- the History feed;
- `earlierTotalsReason` (clientReportChecks.js), which matches a record's from and to against a
  report's crews and gains `'sources.coordinatorId'`.

**The client-report build fence** (clientReportBuilds.js) needs two small changes. They are in
another session's area, so the hand-off names them:
- **`sourcesNear` reads and versions `CoordinatorChange` by `updatedAt`, not `createdAt`.**
  - Finish it updates its record in place, and Mongoose gives every row of an `updateMany` the time
    the write was sent (§A).
  - So a Finish it whose write straddles the fence is visible to neither check. Round 4 reproduced
    it: 56,819 of 300,000 rows had moved at the fence and all of them after, unseen. The `updatedAt`
    version caught it in the same run.
- **The build also waits for a held `crewJob` on the campaign's roster.**
  - The check wraps the build's two `otherChangeRunning` calls (clientReportBuilds.js:720 and 820).
  - It doesn't go inside `otherChangeRunning` (answerEditRuns.js:201), which seven answer-edit routes
    also use, so answer edits aren't held up by crew changes.
  - `waitingWords` gains "for a crew change on this campaign to finish", so the report owner isn't
    told a round is being re-cut.
  - It also closes a gap that exists today: a change killed mid-write leaves no record, and its rows
    carry a time from before the fence.

A Finish it after a crash that left no record writes a new row, which costs the build one needless
rebuild.

**History** (`GET /admin/campaigns/:id/history`, campaigns.js) sends `sources`, `source` and
`finishedBy`. Updated web and phone clients render "Several teams", "Didn't finish" and "Finished by
a later change". Released phones read existing fields, so the feed folds both in:

- `restampError: r.finishedBy ? null : r.restampError`, so a row a later change finished stops
  showing as incomplete;
- `fromCoordinator: { name: 'Several teams' }` when there is more than one source;
- `activitiesMoved: r.doorsMoved ?? r.activitiesMoved`, because both builders print that field as
  "doors moved".

Updated builders read `doorsMoved` for doors. They say surveys, or notes and marks, when no doors
moved (round 5 saw "3 doors moved" for three notes). An open error record says "didn't finish moving
N doors".

On released phones the fold still leaves two cosmetic oddities until the app update:
- a join that moved only notes reads "No recorded work moved with them";
- a repair that moved only surveys reads "0 doors moved to Yan".

**Hints and tests.**
- **Hints.** The person's index is hinted on single-person queries: the job's plan and writes, B.2,
  B.5's history, and the reports `/activities` read. The bulk preview hints the campaign index
  (§B.3).
- **A hint names an index that must exist**, so tests need it built first:
  - `test-int.sh` adds `--import` of a connection-level preload, on its two `node --test` lines only.
  - After connect and after any drop, the preload builds the ledger indexes with
    `mongoose.connection.db`, not the models (a model-based preload hangs the runner's `drop_db`).
- **Two suites the preload exposes** are fixed with it:
  - `auditGpsStamps`: its raw survey rows get distinct `voterId`/`passId`;
  - `clientReportDuplicates`: `ClientReport.createIndexes()` after its drop. That suite belongs to
    another session's area, so the hand-off names it.
- **New tests assert `error === null`**, so a swallowed hint failure can't pass.

### B.7 Coming back to a campaign: doors follow the person

The owner's ruling on 2026-10-25: joining a campaign is a crew assignment. **A person's earlier
doors on that campaign move to the crew they join: the one picked, or No team if none.** On
2026-10-26 the owner added: "that applies no matter the role". "Joining" means a roster row was
inserted by an add or by a book. Someone already on the roster isn't joining.

**`joinCampaignCrew({ organizationId, campaignId, userId, coordinatorId, actorUserId, source })`**
lives in `setCoordinator.js` and runs the §B.6 job with the insert as its claim. With no earlier
rows on the campaign it is just the insert: no job, no record. The source is `campaign_join`.

**`POST /crew`**, in this order:

1. Resolve the email.
2. `resolveCoordinatorId`, before anything is written.
   - **For a named answer only** (`in-org`, `in-org-inactive`, `on-campaign`), it gets `memberUserId`,
     so someone can't be their own coordinator.
   - For an `outside` answer it passes none, as today. Round 5 found the alternative leaks: with the
     email of an account at another customer, passing that account's id made the 400's wording say
     whether the email belongs to that account. That would break the identical answer for an
     outside address. An outside person can't be a coordinator anyway.
3. Then:
   - **An existing roster row: change nothing, crew included.** The answer is today's 201 with
     outcome `on-campaign` and no email, which teamLead.int.test.js:732-735 pins as idempotent.
     - For a switched-off account, an org admin's add still switches them back on (outcome
       `in-org-inactive`), and nothing else changes.
     - Apart from **Switch on**, which posts here by design (§E.6), the add screens stop at "Already
       here" before this. So it is otherwise reached only when two admins add the same person at
       once, or from a released phone's create sheet.
     - Round 4 showed that re-crewing here let the second of two simultaneous adds move the person
       again with no check.
   - Otherwise `joinCampaignCrew` with the pick, or No crew when none was sent.
4. Mail only when a row was inserted.
5. The answer's `restamp` gains `sources: [{ coordinatorId, name, doors }]`, the teams the earlier
   doors came from, newest first, so the result screen can say what moved.

**`createOrgMember`** stops taking a campaign or a crew (only leadCrew.js passed one).
`restampOnJoin` folds into `joinCampaignCrew`. leadCrew.js then no longer writes the crew field, so
it comes **off** the `coordinatorChokePoint.test.js` allowlist.

**Other ways onto a roster**:

- `POST /assignments`: §B.4.
- **`ensureCampaignAssignments`** (book assignment and assign-bulk) gains a `join` option.
  - The two book routes pass it (turfAssignments.js, turfs.js assign-bulk).
  - With `join`, it reads the roster once and sends only the ids not on it through
    `joinCampaignCrew(none)`, instead of the `bulkWrite`. `joinCampaignCrew`'s insert is the claim
    and still settles a race.
    - Round 5 showed both wrong shapes. Inserting first and joining afterwards moves nothing, because
      the join's insert finds the row. Joining every id runs the plan's aggregations for people
      already on the roster, most book holders: 640 ms for 20 people instead of 12.
  - A ledger error doesn't fail the book assignment. The job stays on the row for Finish it.
  - **A throw before the insert** (the plan's aggregations) falls back to today's plain upsert for
    that person, with no move and no record. Otherwise the route answers 201 and the book exists,
    but the holder has no roster row, so the phone hides the campaign. Round 6 reproduced it.
  - After item 41 only org admins, leads, and (in internal orgs) Doorline staff reach these routes
    for someone off the roster: by taking a book, or by an admin handing them one. No book screen
    has a crew choice, so no count is shown first, and History records any move.
- **The demo seeder** calls `ensureCampaignAssignments` without `join`. It builds a demo org and
  writes its own crews (the choke point's allowlist), and that crew write also clears `crewJob`
  (§B.6). Re-adding a missing demo crew member on a run without `--reset` must not move their staged
  doors; round 5 confirmed it doesn't.

**The departure rule still holds.** Removal never re-stamps. Joining is an assignment, so it does.

**Released clients** between the server deploy and the phone update:

- **The create sheet's crew-clearing bug** is fixed by the server deploy alone. Typing the email of
  someone already on the campaign gets today's `on-campaign` answer and now changes nothing.
- **Assign all shown, the member sheet's Assign, the profile's Campaigns Assign and the book
  self-assign** send no crew key. So they join people with No crew, and a returning person's earlier
  doors move to No team with no count shown first (§B.4). The app update adds the crew choice and the
  count to the Assign actions.
- **The member sheet's crew picker** sends no `from`, so a released phone can still override a crew
  change made seconds earlier. Round 4 reproduced it. The app update closes it.

### B.8 The crew checks move into `audit:team-counts`

`repair:team-stamps` was built for the old organization-wide crew, and today it prints a false
all-clear over per-campaign drift (§A). Rather than port it, its checks move into `audit:team-counts`,
which is already per campaign, read-only, run from the repo root, and lists each person's roster crew
(auditTeamCounts.js:230-264).

- **Two new lines per campaign**, under each person:
  - **Rows not on their crew**: counts by stamped team. With a real coordinator: "open Team →
    {person} → Finish it". With no crew: "possibly a departure; check before changing", never a fix.
  - **An unfinished crew job** on their roster row: "open Team → {person} → Finish it".
- **Not a failure.** These lines don't make the run exit non-zero; only a column that fails to
  reconcile does, as today.
- **`repair:team-stamps` keeps one job**: it reports any org whose team surfaces are switched off
  (`teamAttributionReadyAt` unset; new orgs get it by default, Organization.js:34). With
  `-- --apply --ready-only` it switches them on and touches no rows. With any other flag (`--apply`
  alone, `--preflight`) it prints that the crew checks are now in `npm run audit:team-counts`, and
  writes nothing.
  - Its old `--apply` took no hold and checked no `from`, so it could overwrite a change made while it
    ran. Fixes go through the Team page.
- **Tested from the repo root** on a throwaway database:
  - drift listed;
  - a departure listed but not offered a fix;
  - an unfinished job listed;
  - a legacy `Membership.coordinatorId` ignored;
  - `--ready-only` still sets the flag.
- Run after the deploy (§M.4).

### B.9 Smaller server pieces

- **Roster rows** (`GET /assignments`) gain the user's `createdAt`.
- **Settings**: the GET gains `chosen: [{ userId, name, role, eligible }]`, named for any stored id,
  including someone no longer in the org.
- **`WEB_SEGMENTS`** gains `'settings'`, and `webRoutes.test.js` covers it.
- **The alert email footer**, in both versions: "A billing admin can change who gets them, or turn
  automatic pause off, on the Settings page in the web console."
- **Model changes**: §B.6. No new index.

## C. Web: the Settings page

- **Route**: `/settings` inside the `RoleGate require="orgAdmin"` group in App.jsx, plus `'settings'`
  in `WEB_SEGMENTS`.
- **Nav**: after Billing in `ORG_NAV`, with a gear icon keyed `'/settings'` in navIcons.jsx.
- **Page**: `client/src/pages/SettingsPage.jsx`, with the header "Settings" and the line "Automatic
  pause, for every campaign in your organization." It shows a skeleton while loading and "Couldn't
  load — Retry" on error.
- **Card**: `PacePauseSettingsCard.jsx` moves to `client/src/components/settings/` as a plain file
  move. The card's "isn't running for your organization right now" line stays.
- **`RecipientPicker`**:
  - **Billing admins (always)**: "Everyone with billing access, including anyone given it later".
  - **Also email**: rows from `chosen`; `eligible: false` reads "Not emailed: no longer an admin or
    team lead", and a billing admin's Save drops it.
  - **Add a person**: a combobox over `eligible`, showing at most 8 matches; it disables at 25.
  - **Read-only**: the rows show without Remove, and there's no combobox.
  - **Save** sends only eligible ids.
- **Users page**: the card is removed.
  - Customers may have seen it since `d1d12ac`. The new nav item, the email footer and the Help
    Center articles point to Settings.
  - There's no Audit-page link and no phone row: the setting stays on the web, in one place.

## D. Web: the person panel

### D.1 Files

`client/src/components/people/`:

| File | What it is |
|---|---|
| `PersonPanel.jsx` | The container: Drawer, header row (‹ › "3 of 45", close), the stepping snapshot, the guarded close, the unsaved flag, the "Everywhere" fold state, the result line |
| `PersonBody.jsx` | Everything per person, rendered `key={userId}` |
| `PersonActions.jsx` | The state buttons, the temp-password form, **More options ▸** (the inline fold-out UserProfileModal.jsx:946-975 uses), the confirms, `DeleteMemberDialog` |
| `PersonCampaignSection.jsx` | Crew picker (sending `fromCoordinatorId`), **Finish it** (§B.6 step 5), `CoordinatorConfirm` and campaign KPIs, moved from CampaignTeamPage.jsx:699-773 |
| `PersonRecentDoors.jsx` | 5, then 10 per Show more, with the shared action list; stops on a short page or one with no new ids |
| `PersonProfileForm.jsx` | Name, email and phone, keeping the multi-org lock |
| `PersonRoleSection.jsx` | Role and a lead's managed campaigns, moved from UserProfileModal.jsx:571-646 |
| `PersonOrgSection.jsx` | Org totals, miles, FbTime line, crews per campaign, moved from UserProfileModal.jsx:648-783 |
| `personAccess.js` | Pure: the viewer × target gate and the state buttons, unit-tested |

UserProfileModal.jsx and the in-file `TeamMemberPanel` are deleted once their code has moved. Their
three test suites move with them, with every assertion kept.

In moved code:

- the recent-door dots use an action-to-status map plus `statusColorsForTheme`, in inline styles;
- `text-success-fg` replaces `text-green-800`;
- hand-rolled buttons become `Button`.

### D.2 Container

- **Drawer**: the shared Drawer, `side="right"`, `width="max-w-2xl"`, with two new optional props:
  `header` and `bodyRef` (scroll reset on each step).
- **One guarded close**: Escape, the scrim and the close button all go through one function, which
  Overlay reads through its ref.
  - It waits while a dialog inside the panel is open (`DeleteMemberDialog`, the only one, registers
    on a ref) and while a write for this person is in flight.
  - It asks the unsaved-changes confirm once.
  - A stack inside Overlay, which would make every nested dialog in the app behave, is wider than
    this plan and stays out of it.

### D.3 Writes, stepping and the address

- **Writes.**
  - Every person write carries `mutationKey: ['person', userId, …]`.
  - Anything that closes or navigates afterwards does it in `mutate(..., { onSuccess })`, never the
    hook's `onSuccess`.
  - While `useIsMutating({ mutationKey: ['person', userId] }) > 0`, the arrows and the close wait.
  - The unsaved flag clears at submit.
  - The result line, with the person's name, lives in PersonPanel outside the key.
- **Stepping.**
  - Opening snapshots the ordered ids of the filtered and sorted list. Someone opened from the
    address is inserted at their sort position, and ‹ › go to the nearest people still in the data.
    "Not in this list" is a note, never a dead end.
  - Stepping also replaces the list's `page`, so the current person's row is on screen. On close,
    focus goes to that row, in a page effect that runs after `person` turns null.
  - Every query in PersonBody passes TanStack's `signal`.
- **The address is replace-only.** Opening, stepping and closing replace `?person=`. The list's state
  lives in the address too, also by replace, guarded against no-op writes (the `deskParams` precedent
  in OrganizationsPage.jsx):
  - on the Team page, `chip`, `q`, `crew`, `role`, `sort` and `page`;
  - on the Users page, `role`, `status`, `campaign`, `q`, `sort` and `page`.

  Links inside the panel run the unsaved-changes confirm first.
- **A person not in the page's data**, checked only once the data has loaded:

| Case | What happens |
|---|---|
| Opened by link, filtered out of the list | The panel opens with the note "Not in this list"; ‹ › go to the nearest people in it |
| Opened by link, not on this campaign (or not in the org, on the Users page) | "Not on this campaign"; an org admin gets a link to the Users page panel |
| Removed while open | The panel stays on the last-seen record with "Removed from {campaign}"; ‹ › go to the nearest people still in the list |

- **The Users page** keeps `?return=` and its "‹ Back to setup" whenever `return` is present. The
  Team page stops passing it.

### D.4 Data

| | Users page (org) | Team page (campaign) |
|---|---|---|
| Who opens it | org admins | org admins and leads |
| Person record | the `['memberships']` row | the roster row; for admins also the `['memberships']` row |
| Recent doors | `/recent-activity?limit=5&skip=` | reports `/activities?campaignId=&actionType=<B.2 list>&limit=5&skip=` |
| Totals | `/stats` | the campaign summary; admins also `/stats` when "Everywhere" is open |
| Crews | `/crews` | `/crews`, for the deactivate warning and "Everywhere" |
| Pauses | `/admin/pace-pauses?userId=&status=all` | the same, plus the page's paused list for `rosterLines` |
| Unfinished change, rows off the crew | — | the current-crew preview on open (§B.6, Opening a person): `unfinished`, `busy`, rows still off the crew |

### D.5 Who sees and does what

`personAccess.js` mirrors the server:

| Section / action | Org admin viewer | Lead viewer (Team page only) |
|---|---|---|
| Identity, recent doors, campaign section, crew picker | yes | yes |
| Profile form, Set temporary password, Resend invite | anyone except a super admin and a deleted account; never yourself for temp password | canvassers only (`leadMayManageTarget`) |
| Deactivate / Reactivate | through `/admin/memberships/:id/deactivate|reactivate` on both pages, for anyone except a super admin, a deleted account and yourself | canvassers only (the same routes refuse anyone else) |
| Unpause | yes, with the Audit confirm | when the pause is blocking on a campaign they manage; never their own |
| Remove from this campaign | yes (hidden on an archived campaign) | canvassers, people no longer in the org, and themselves (item 41) |
| Role, Remove from org, Delete account, "Everywhere" | yes (billing and self rules: `billingLocked`, `canOfferDelete`) | never |

- **The state buttons** follow Part 1's table, from `rosterView.standing()`.
- **The pause section** keeps Review and past pauses and loses its own Unpause. A pause elsewhere
  shows the shipped line.
- **Removing someone who runs a crew** adds the crew-disband line. From this campaign it counts from
  the roster; from the org it counts from the deletion check's `crew: { people, campaigns }`.
- **A deleted account** keeps today's reduced view. A super-admin target shows "Managed by Doorline
  staff".

## E. Web: the Team page

### E.1 Data

- **Today's queries**: `crew`, `assignments` (with `createdAt`), the all-time leaderboard, and
  `['memberships']` for admins.
- **New**: the paused list, polled every 30 seconds. `client/src/lib/pacePause.js` gains
  `pausedUserIds(data)`, mirroring mobile/lib/pace.js:63-67.

### E.2 List logic: `client/src/lib/rosterView.js`

Pure and unit-tested:

- **`standing(row, pausedIds)`**, first match wins:
  1. `deleted`
  2. `left`
  3. `deactivated`
  4. `paused`
  5. `never-signed-in` (`!lastLoginAt` and `createdAt ≥ CLOCKS_RELIABLE_FROM`)
  6. `no-sign-in-recorded`
  7. `active`
- **`isAccountOn(row)`**: not deleted and not deactivated. This backs the Users page's "Active".
- **`quickCounts`**: counts after the other filters.
- **`filterRoster`**, **`sortRoster`**, **`crewHeadings`** and **`clampSkip`**.

`mobile/lib/rosterView.js` is a copy, checked by a mirror test.

### E.3 Components

`client/src/components/team/`:

- `TeamQuickFilters.jsx`
- `TeamToolbar.jsx`
- `TeamTable.jsx`: a checkbox plus a name button per row; the crew on the second line below md
- `TeamBulkBar.jsx`, above BottomNav on narrow windows
- `BulkCrewDialog.jsx`
- `BulkConfirmDialog.jsx`
- `AddPeopleDialog.jsx`: Segmented, hidden once the steps start and for leads
- `CrewSelect.jsx`: never lists the person being added; for a lead its choices come from the crew
  endpoint's `coordinators`, the same list the web uses. That list holds only active admins and leads
  (leadCrew.js:162-169). So when the person's current coordinator can't lead any more, the select
  shows them as a labelled option that can't be picked ("Dana Cruz, switched off"), not
  "No coordinator" beside a Finish it toward Dana.

Plus `client/src/lib/runInChunks.js`.

### E.4 Selection and bulk actions

- **Selection**: a `Set` of ids, up to 500.
  - It clears on a filter or search change and after every bulk run.
  - The bar acts on the selection still in the filter.
  - "Select all N that match" says "up to 500" when there are more.
- **Actions**:

| Action | Applies to | Mechanism |
|---|---|---|
| Move to crew… | everyone selected; the server skips per B.3 | one preview for the selection, then the bulk write 10 per request, one request at a time, each person with their `from` |
| Resend invites (n) | `standing === 'never-signed-in'`; for a lead, canvassers only | `POST /admin/memberships/:id/resend-invite` one at a time |
| Remove from campaign | everyone selected; for a lead, canvassers and themselves | `DELETE …/assignments/:id`, three at a time, with the crew-disband line |

### E.5 Running a bulk action

`runInChunks(items, { size, concurrency, signal }, fn)`:

- **While running**: progress, `closable={false}`, and Stop as the only exit.
- **Unmount** aborts the run.
- **Stops**: the run stops on a 402 (`subscription-inactive`), or on a refusal of the whole action (a
  role 403 on every person, an archived 409). One person's 403, 409 or 429 is listed and the run
  carries on.
- **The summary**: done, skipped (with reasons), failed, and **not started** (after a Stop), with
  **Continue**.
- **Retry failed** re-previews the failed people first (§B.6 step 8), then writes.
- **Caches** are invalidated once, in `finally`.

### E.6 The add flows

**By email**: `CrewSelect` on the `outside`, `in-org` and `in-org-inactive` steps. A lead on
`in-org-inactive` gets no select, only Close. An admin on `in-org-inactive` with `onCampaign` (§B.5)
gets **Switch on** only, with no select: their crew stays as it is.

- **A returning person** (`history.doors > 0`):
  - the step lists `history.sources`;
  - it pre-picks the newest source's coordinator when that source `canLead`, otherwise "No crew";
  - under the select it states what happens, with the client-report teams.
- **Sending**: the chosen coordinator as `coordinatorId`, or `null` for No crew.
- **After the add**, when `restamp` moved anything, Done says what moved and from which teams
  (`restamp.sources`), with **Open {name}** to change their crew with the usual check.
- **Typed details for someone who already has an account**: "Pat already has an account, so what you
  typed wasn't used."
- **Done** offers **Add another**. **Already here** offers **Open {name}**. A 429 shows inside the
  step with `retryAfterSeconds`.

**From your organization** (org admins):

- Active members not on the roster: search, role filter, 25 per page, up to 500 ticked.
- One `CrewSelect`, one preview for the ticked people, then `POST /assignments` with 25 ids per
  request. People added meanwhile by someone else are skipped (`already-on-campaign`).
- The summary counts the no-crew path too.

**Retired**: the bottom directory card, and the **Assign** branch of `CampaignAssignmentsModal.jsx`,
which becomes a link to Add people. Its remove branch stays, with item 41's rule.

### E.7 Paging

Client-side, 25 per page, with the shared `Pager`. The page is in the address (§D.3).

## F. Web: the Users page

- **Paging**: client-side over `['memberships']`, 25 per page, in the address with the filters.
- **Filters**:
  - role;
  - status: all, Active (`isAccountOn`), Deactivated, Paused, Never signed in, Deleted;
  - campaign.
- **Rows** become keyboard-reachable buttons.
- **Panel**: `?person=` replaces `selectedUserId`.
- **Add member**:
  - with role = canvasser and a **Campaign**, it hands email, names, phone and temporary password to
    the By-email steps, which run the lookup at once;
  - with admin or lead, unchanged.

## G. Phone (over the air; no native change)

- **Users hub** ([users.jsx](<../mobile/app/(app)/admin/users.jsx>)):
  - **Status pills** add Paused and Never signed in. The phone's "inactive" wording stays until the
    later terms sweep.
  - **Campaign scope**:
    - one **Crew** control (a sheet: this roster's coordinators, No crew), with coordinator choices
      for a lead from the crew endpoint;
    - the sort list adds Crew.
  - **Paging**: 50 rows per section, then **Show 50 more**.
  - **"All shown" rows** act on the rendered rows, and their labels carry that count:
    - **Move all shown to a crew… (n)**: a sheet with the preview (doors, sources, the runs-a-crew
      warning; no client-report teams, a stated gap);
    - **Resend invites to all shown (n)**: canvassers only for a lead;
    - **Assign all shown (n)** (admins): the crew choice and preview.

    How they run:
    - each confirms with an Alert, Cancel first;
    - runs go in chunks of 10, with progress;
    - Android back does nothing during a run;
    - a 402 stops the run with its message. The phone's admin screens have no billing state to hide
      the rows with in advance.
  - There is no bulk remove on the phone.
- **Add a canvasser**:
  - It calls `POST /crew/resolve` first, then the web's confirmations, with history, the pre-pick,
    and the after-add report.
  - Android back on step 2 returns to step 1, keeping the email.
  - A 429 shows its wait.
- **Member sheet**:
  - the state buttons; Unpause through an Alert, Cancel first; the pause notice with Review;
  - on open, the current-crew preview (§B.6, Opening a person), and **Finish it** when it says so;
  - the crew picker sends `fromCoordinatorId`;
  - **Assign to this campaign** (admins) gains the crew choice and a one-person preview;
  - **Remove from this campaign** for leads: canvassers, people no longer in the org, and themselves;
  - recent doors pass the shared action list.
- **Profile**:
  - recent activity shows 5, with Show more, as an inline `useInfiniteQuery` with a literal path;
  - for a lead, **On your campaigns** and no Miles;
  - the Campaigns section becomes read-only, with "Assign or unassign from Users on that campaign";
  - the state buttons move near the top.
- **Unchanged**: the book screens' self-assign (books.jsx, book/[turfId].jsx) still sends no crew
  key, so it joins with No crew, as the rule says.
- **Not on the phone**: Settings, as today. The Coordinator → Crew relabel waits for the terms sweep.
- **Fingerprint**: no `app.json`, `eas.json`, native dependency or icon change.

## H. Design sketches

Team page, desktop:

```
 Team                                                              [ Add people ]
 45 people on Fall Canvass                                           Org users >

 [Current team 45] [Never signed in 6] [Deactivated 2] [Paused 1]

 [ Search name or email...            ] [ All crews  v ] [ Everyone  v ]

  [ ] Member                         Crew        Last password login   Doors  Last door
  --- DANA CRUZ'S CREW . 12 ------------------------------------------------------------
  [ ] Sam Rivera  PAUSED             Dana Cruz   3 days ago              412  2h ago    >
      sam@example.com
  [ ] Alex Kim    NEVER SIGNED IN    Dana Cruz   -                         0  -         >
  --- NO CREW . 9 ----------------------------------------------------------------------
  ...
                                                         1-25 of 45   [ < Prev ] [ Next > ]
 +--------------------------------------------------------------------------------------+
 | 3 selected . Select all 45   [ Move to crew... ] [ Resend invites (1) ] [ Remove ]  |
 +--------------------------------------------------------------------------------------+
```

The person panel (Team page), with an unfinished change:

```
                                  | <  >   3 of 45                                    x
                                  | (SR) Sam Rivera
                                  |      sam@example.com . (555) 123-4567
                                  |      Canvasser . Active
                                  |      On this campaign since Oct 3 . Last password login 3d ago
                                  | [ Set temporary password ]   More options >
                                  | ---------------------------------------------------------
                                  | THIS CAMPAIGN
                                  | Crew [ Dana Cruz                       v ]
                                  | ! A crew change to Dana Cruz didn't finish.   [ Finish it ]
                                  | 412 doors . 96 survey doors . 9 days . 23% survey rate
                                  | RECENT DOORS
                                  |  . Not home    12 Oak St, Springfield          2h ago
                                  |  ...                                       [ Show more ]
                                  | PROFILE   [first] [last] [email] [phone]       [ Save ]
                                  | EVERYWHERE IN YOUR ORGANIZATION  >              admins
```

Add people, By email, for a returning person:

```
 Add them to Fall Canvass?                                                     x
 Pat Lee is already in your organization.
 Pat has 120 doors here from before: 100 on Dana Cruz's team, 20 on No team.

 Crew  [ Dana Cruz (their crew before)   v ]
       All 120 doors count for Dana Cruz's team. Client reports: Downtown team.
                                                [ Back ] [ Add to campaign ]
```

Settings:

```
 Settings
 Automatic pause, for every campaign in your organization.

 +- Automatic pause ----------------------------------------------- [ On | Off ] -+
 | Doorline pauses a canvasser's recording when their doors come in faster than   |
 | anyone could knock them ...                                                    |
 | WHO GETS THE EMAIL                                                             |
 | [x] Billing admins (always): everyone with billing access                      |
 | Also email                                                                     |
 |    Pat Lee . Org admin                                               Remove    |
 |    Jo Park . Not emailed: no longer an admin or team lead            Remove    |
 | [ Add a person: type a name...                     ]                           |
 | [ Save ]   Last changed by Riley Shaw                                          |
 +--------------------------------------------------------------------------------+
```

Phone, Users hub on a campaign:

```
 < Admin                 Users                 + New
 [ Search by name or email                       ]
 (All campaigns) (Fall Canvass *) ...
 (All) (Active) (Inactive) (Paused) (Never signed in)
 Crew: Dana Cruz  >                         Sort: Crew  >
 ON THIS CAMPAIGN . 12
  Sam Rivera        canvasser . Dana Cruz        paused  >
  Alex Kim          canvasser . Dana Cruz                >
  ...
  Move all shown to a crew... (12)
  Resend invites to all shown (3)
 NOT ON THIS CAMPAIGN . 212  >
```

## I. Terms

One word per thing, on the web people pages and their Help articles:

| Thing | Word |
|---|---|
| Account switched off | **Deactivated** (badge); **Deactivate account** / **Reactivate account**. The Users page's "Inactive", the profile's "Deactivate membership" and `leadCrew.js:241`'s message change to these |
| No password ever typed, account made on or after 2026-05-15 | **Never signed in** (amber) |
| No recorded sign-in, older account | **No sign-in recorded** (plain) |
| The last time a password was typed | **Last password login** |
| A coordinator's group | **Crew**; the value is the coordinator's name; none is **No crew** |
| Doors that count for no team (the report label) | **No team** |
| Paused by automatic pause | **Paused for review** (badge **Paused**) |
| A roster row without a membership | **No longer in the org** |
| The fold-out of rarer actions | **More options ▸** (web, and the phone's existing one) |
| Taking someone off a campaign | **Remove from this campaign** (the bulk button: **Remove from campaign**) |
| An unfinished crew change, or, for someone on a crew, doors still counted for another team | **Finish it** |
| The org-wide switches page | **Settings** |

**Out of scope, for a later sweep**:

- the crew filters' "No coordinator" on DashboardPage.jsx:527, TimelinePage.jsx:393 and
  SurveyExplorerPage.jsx:482;
- the phone's CampaignHome.jsx:360 and 760, and admin/timeline.jsx:653;
- the phone's "Coordinator" and "inactive" (users.jsx:333 and 437; users/[id].jsx:246 and 620;
  MemberSheet.jsx);
- the "No coordinator" in both `campaignHistory.js` and both `memberDeletion.js` libraries;
- CoordinatorConfirm's "No team";
- CanvasserSummaryTable.jsx:234's "Inactive".

## J. Edge cases

- **Self**: no temp password, no Deactivate, no role, no Remove from org.
- **Super-admin target**: "Managed by Doorline staff".
- **Deleted account**: today's reduced view.
- **A coordinator in a bulk move to themselves**: skipped as `is-coordinator`. Adding someone as their
  own coordinator is refused before any write.
- **Resend inside the 60-second cooldown** (429): reported per person; the run carries on.
- **Two changes to one person**: the second is turned away (`busy`, try again shortly) or stops
  (`changed-meanwhile`), and each says so.
- **Two admins add the same person at once**: one adds them; the other gets "already on this
  campaign", and nothing moves twice.
- **A server pause longer than the hold** between the claim and a ledger write: the run renews its
  hold before each write, finds it lost, and stops (`lost-hold`). It writes the job's record only if
  none exists.
- **A stalled run while Finish it runs the same job**: Finish it gave the job a new `run`, so the
  stalled run's renewal fails and it stops.
- **A coordinator switched off or given another role**: their crew keeps them. The panel opens, its
  crew select shows them as current but not pickable (§E.3), and Finish it works, because only new
  picks are validated (§B.6 step 5).
- **A stalled run that wakes during a Finish it**: its renewal fails (new `run`), and its release
  matches nothing, so it can't clear Finish it's job.
- **A departure while a job is moving doors**: the job stops between its writes, and the doors stay
  as the departure found them (Part 1's caveat).
- **A change interrupted by a crash or timeout**: the job stays on the person's row. Within 150
  seconds its hold passes and the person shows **Finish it**; until then a new change answers `busy`
  with the wait.
- **Removed and added back while a change for them is still moving doors** (seconds, inside the
  hold): the new roster row starts without the job, so the two writes can overlap and split their
  doors. If they have a crew, Finish it on their panel repairs it. If the crew is none, the team-count
  check lists them instead (§B.8). Accepted: it needs a remove and a re-add within the same few
  seconds.
- **A returning person whose old coordinator can no longer run a crew**: no pre-pick.
- **Someone who left the org and comes back**: reported after the add (E.6).
- **A Settings recipient removed from the org**: named by the server, dropped on a billing admin's
  Save.
- **A lead with no managed campaigns**: the profile drills answer 403, as today.
- **Archived campaign**: no Add people, no selection, the crew picker disabled.
- **The panel's "not in this list" cases**: the table in D.3.

## K. Privacy, mobile API, version gate

- **Done: items 40 and 41** (owner: no DPA notice for any part). The rest of the plan adds no
  lead-visible data:
  - the Paused badge comes from the lead-scoped list (item 39(d));
  - the bulk routes give no power the single routes don't, and the bulk preview answers a lead about
    this campaign's roster only, checked first;
  - the resolve `history` covers this campaign only, for answers that already name the person;
  - B.7 changes which in-tenant team a door counts for;
  - Settings shows org admins the names of their own admins and leads.
- **A control loosens a little, and the record says so** (owner ruling N.1.21).
  - **Today** every email lookup counts toward 30 an hour per person.
  - **The plan** gives new people (`outside` answers) their own 60 an hour and keeps 30 for lookups
    that name someone. Name-revealing lookups are capped as before.
  - **The cost.** Lookups that find no one can now be tried 60 times an hour instead of 30. They
    reveal at most the small timing difference createMember.js:55-58 names, which the equalized
    query narrows.
  - **The phone's add** now goes through the lookup, which caps phone adds for the first time.
  - **The record.** The privacy record's "30/hour" lines and ROLES.md get the new wording.
- **The identical answer for an outside address holds.** The self-coordinator check runs only for
  named answers (§B.7 step 2). Round 5 caught a v5 draft in which it would have said whether an
  email belongs to a given account at another customer.
- **A false sentence today, corrected by the build.** Five places say a lookup that names someone
  writes an `AccessLog` line:
  - ROLES.md:584-585;
  - PRIVACY_VERIFICATION.md (the resolve item, around lines 5070-5082);
  - crewResolveLimit.js:19-20;
  - createMember.js:57-58;
  - leadCrew.js:178-181.

  `AccessLog` records only Doorline staff working under a support grant (accessLog.js:94). Item 41
  already says so, so the record contradicts itself. No published Privacy Policy sentence depends on
  it. The build corrects all five; they can be corrected sooner, once the item 40-41 patch is
  committed, since PRIVACY_VERIFICATION.md is in that patch.
- **Record stamps when this plan ships**:
  - item 39(j) and 39's keep-true bullet: the setting now lives on the Settings page;
  - item 40's watchlist: re-verified against the person panel;
  - item 41's watchlist: re-verified against the bulk routes and the Add people flows.
- **The pending customer notice for automatic pause** (PROPOSAL_PACE_PAUSE.md decision 16) names the
  Settings page.
- **No published Privacy Policy, Terms or DPA change.**
- **Mobile API**: `npm run audit:mobile-api` will flag `memberships.js`, `assignments.js`,
  `leadCrew.js`, `pacePauses.js`, `reports.js`, `campaigns.js`, `turfs.js` and `turfAssignments.js`.
  Every change is additive or a server-side semantic. A released phone can meet two new refusals,
  and both land in its existing error alerts:
  - the single crew PATCH's 409 (`changed-meanwhile` / `busy`);
  - the create sheet's 400 for a self-coordinator.

  **No `CLIENT_API_VERSION` / `MIN_CLIENT_API_VERSION` bump.**

## L. Tests and verification

Server integration tests use the throwaway-mongod harness with the connection-level preload (§B.6).
Round 6's prototype and tests are the starting point: scratchpad review-r6/server/. It is round 5's
prototype (itself round 4's, t01-t11, with every v5 change and its r5_* tests) with every v6 change
built in and its r6_* tests.
- Round 6 re-ran rounds 4 and 5 and the 31 crew suites (401 tests, 0 failures) on it.
- One r5_t05 History request answered 404 once, on a machine swapping hard, and four reruns didn't
  reproduce it. The build's run of that test watches for it.

**B.6, the job:**

- preview equals write per person;
- `from` stale → `changed-meanwhile`; a running job → `busy` with the wait;
- two moves 2-25 ms apart over 20,000 rows end with one consistent crew;
- a no-crew join with doors to move and a crew pick overlapping: the pick waits;
- **crash tests**, a child process killed at each point:
  - before the claim: nothing changed, nothing recorded;
  - after the claim, and between the two ledger writes: once the hold passes, Finish it finishes,
    with one History row;
  - after the ledger writes, before the record: Finish it moves nothing and writes the one record;
  - after the record, before the release: Finish it writes no second record;
- a timed-out ledger write keeps the job until its hold passes;
- a different pick after a crash completes the old work and closes its error record;
- a departure clears the job and is never conformed; a bare No-crew repeat never moves doors;
- History rows: no "none → none", no "Yan → Yan", an error shown until a later change finishes it,
  several sources as "Several teams", with released-phone fields folded;
- a hire with no history writes no `CoordinatorChange`, and doesn't rebuild or fail a team report
  build;
- `earlierTotalsReason` sees a move from several teams;
- **the record's `from` comes from the rows that move**: a No-crew join whose only rows are notes,
  and a drift repair of one survey, write no "none → none" and no "Yan → Yan" row;
- **`crewJob` declared with `default: undefined`**: a plain roster create stores no `crewJob`, and the
  job tests run with `strictQuery: true`;
- **a runner paused past its hold** stops with `lost-hold`, moves nothing more, and writes the
  record only if none exists;
- **a stalled run during a Finish it of the same job** loses its renewal (new `run`) and stops;
- **two simultaneous upserts of one token** make one row (the record's `_id` is the token);
- **insert-only writes carry `createdAt` and `updatedAt`**, so the next change's `finishedBy` close
  matches them;
- **a stale run can't release a live Finish it**: the release matches the run, and a different pick
  then gets `busy`;
- **a renewal that takes more than 30 s to come back** stops the run;
- **renewals and the release** use the roster's unique index (`explain` examines one row);
- **jobs four at a time** leave connections for other requests;
- **a released phone re-sending a switched-off coordinator** while another admin moves the person
  gets `changed-meanwhile`, not an unvalidated pick;
- **a book join that throws before its insert** still leaves the holder on the roster;
- **the interrupted record** is insert-only with timestamps off: it never relabels a finished record
  and causes no report rebuild;
- **a request's jobs run side by side**: a bulk chunk of 10 returning people, and a `POST /assignments`
  of 25, each finish well inside the phone's 20 s;
- **joins skip the second pass** unless the person is an org admin or Doorline staff;
- **Finish it with a switched-off coordinator**: the panel opens and Finish it works;
- **the demo seeder's crew write clears `crewJob`**, so no stale Finish it appears;
- tests that shrink the hold also shrink the 2 s wait;
- **an expired job replaced by a different pick** leaves its own record, marked interrupted, then
  finished by the new one;
- **an error record carries the planned counts**; Finish it clears its `restampError`;
- **knocks saved during a change** with the old crew are moved by the second pass;
- **a job with no token** refuses to write a record;
- **the build fence**: a Finish it whose write straddles the fence is caught, a held job makes a
  build wait with the crew-change wording, and answer edits don't wait on crew jobs;
- **`fromCoordinatorId` absent and `null`** take different paths.

**B.3**:

- the 500-id preview's exact door total;
- the preview reads only the campaign's rows whatever the insert order (`explain`: documents
  examined no more than the campaign holds);
- `unfinished` flags;
- every skip reason and the order a lead sees them in;
- `not-in-org` names no one; archived refused; 501 ids refused.

**B.4**:

- an existing row is skipped (`already-on-campaign`), and the roster is read once;
- an explicit `null` and an absent key both move an inserted returning person's doors to No team;
- a ledger error leaves the person added, with the job on their row;
- staff skipped; a released phone's uncapped Assign all still works.

**B.5**:

- `outside` stays byte-identical;
- new-people lookups 60 an hour and named lookups 30 an hour, each counted only by its own limiter;
- a mistyped address (400) counts for neither; once either runs out, every lookup waits;
- the 429 carries `retryAfterSeconds` from the limiter that refused;
- the phone's resolve-first add counts;
- the equalized query.

**B.7, every way back, each through its route, asserting `error === null`**:

- by email with and without a crew;
- the self-coordinator refusal before any write, for named answers only: an `outside` answer gives the
  same 400 whatever coordinator id is sent;
- re-adding someone already on the campaign answers 201 `on-campaign` and changes nothing
  (teamLead.int.test.js:732-735 keeps passing);
- a switched-off person already on the campaign: an admin's add switches them on and keeps their
  crew;
- the org list with a crew, with `null`, and with no key;
- a released phone's Assign all, with no key: their earlier doors move to No team;
- two admins adding the same person by email: the second answers `on-campaign` and moves nothing;
- a book for an admin and a lead's own book, on the web (both book routes) and through the phone's
  self-assign: their earlier doors move to No team; book holders already on the roster cost no
  aggregation;
- the demo seeder re-adding a missing crew member without `--reset` moves nothing;
- the phone's create call for someone already on the campaign;
- the deactivated path;
- someone who left the org and came back.

**B.8**, from the repo root: `audit:team-counts` lists drift, a departure without a fix, and an
unfinished job, and still exits 0 when every column reconciles. `repair:team-stamps` prints where the
crew checks went, and `-- --apply --ready-only` still sets the flag.

**Also**:

- the choke point, with leadCrew.js off its allowlist;
- `webRoutes.test.js`;
- the email footer;
- the two suites the preload exposes, fixed;
- plain server `npm test` alongside.

Web:

- **Unit tests**: `rosterView`, `personAccess`, `runInChunks` (stops, carry-on, Continue, Retry
  re-preview), `RecipientPicker`, the selection rules, the stepping snapshot (address insertion,
  nearest neighbor, page follow), the history table, and both request bodies carrying
  `fromCoordinatorId`.
- **Smoke renders**: the ported three suites, the Settings card, the panel per viewer and state
  (Finish it included), the Team page with the bulk bar, and the add steps with history and the
  after-add report.
- **Build**: `npm --prefix client run build`.

Phone (`npm run test:mobile`, plain `node:test` over `mobile/lib`):

- the `rosterView` mirror;
- pure reducers for the 50-row paging, the "all shown" counts over rendered rows, and the
  resolve-first steps.

Android back, rendering and the Alerts are checked in the walkthrough. `npx expo export` for Android
succeeds.

**Owner walkthrough**: in the **internal demo org**, never a customer org. There is no staging
backend, and these actions are real:

- Demo accounts' addresses (`first.last@demo.doorline.app`) have no mail server, so their invites and
  "added" emails bounce. The store reviewers' accounts live in this org: leave them alone.
- **First** add two people at addresses the owner controls, and use only them for every step that
  sends email. Then remove one, so a re-add has history.
- **Web, after the server deploy**:
  - on Settings, change the recipients;
  - on a Team page:
    - filter Never signed in and resend to one of the two;
    - filter one crew, Select all, Move to crew;
    - add by email with a crew;
    - re-add the removed person and check the pre-pick;
    - add three people from the org with a crew;
    - step through five people with ‹ ›, open Review, press Back;
  - sign in as a lead: confirm the profile numbers and that Remove offers canvassers and
    themselves.
- **Phone, after `ota:staging`**: the same steps on a staging phone, plus the lead's Remove on the
  member sheet.
- **Afterwards**: move the demo crews back, or rebuild the demo day from the Control Room.

## M. Release

0. **The ship-alone privacy patch** (items 40 and 41) first, on its own.
1. **Before the deploy, in the Heroku dashboard (More → Run console)**: `npm run migrate:build-indexes`.
   - It is a read-only dry run.
   - Under `CanvassActivity (canvassactivities)` it must not list `{"userId":1,"timestamp":-1}` or
     `{"campaignId":1,"timestamp":-1}` as missing. Under `SurveyResponse (surveyresponses)` it must not
     list `{"userId":1}` or `{"campaignId":1,"submittedAt":-1}`. These are the indexes the new hints
     name. `{"userId":1}` appears under several models, so read it under the right heading.
   - The plan adds no index. If anything is listed as missing, read the whole list: `-- --apply`
     builds every missing index in every model, so stop and ask before running it.
2. **From the repo root**: `npm run audit:mobile-api`, then read the flagged diffs.
3. **One server + web deploy** from `main`. No config var.
4. **After the deploy, in the Run console**: `npm run audit:team-counts`.
   - It is read-only. Its new lines may list old drift that the old repair tool never saw.
   - Fixing a listed person moves published team numbers, so each fix is the owner's decision, made
     with Finish it on the Team page.
   - Then `npm run repair:team-stamps`, which now only reports any org whose team surfaces are
     switched off. If it lists one, `npm run repair:team-stamps -- --apply --ready-only` switches
     them on and touches no rows.
5. **The web walkthrough** in the internal demo org (§L).
6. **Phone**:
   - **Before each update**: `git status --porcelain mobile/` must show only this plan's files.
     `eas update` publishes whatever mobile code is on disk, another session's included.
   - `cd mobile && npm run ota:staging`, only after step 3. Staging phones talk to the production
     API.
   - The phone walkthrough.
   - `cd mobile && npm run ota:production`.

   The owner runs each command. Between the server deploy and the update, released phones' Assign
   actions and book self-assign join a returning person with No crew and show no count first. Their
   crew picker sends no `from`, so it can still override a change made seconds earlier (B.7).
7. **Help hedges.** Every phone-only line in the rewritten Help carries "…it comes with an app
   update":
   - the status pills, the Crew control, 50 at a time;
   - the all-shown rows;
   - the member sheet's state buttons, Unpause confirm, Review, Finish it and Assign crew choice;
   - the resolve-first add;
   - the lead's Remove on the phone;
   - the profile's read-only Campaigns, and "On your campaigns" with no Miles;
   - Show more.

   A small server deploy after `ota:production` removes them.
8. **Shared folder**: one combined `git add -A` once every suite passes on the combined tree, or a
   frozen patch if this must ship alone. Four changes land in the other session's client-reports
   files, so the hand-off names them all:
   - the `clientReportDuplicates` test fix;
   - the `earlierTotalsReason` `sources` clause;
   - `sourcesNear` by `updatedAt`;
   - the build's wait for a held crew job, at its two `otherChangeRunning` calls, with its
     `waitingWords` line.

## N. Owner answers and calls

### N.1 Answered by the owner, 2026-10-25

1. **The Team page's jobs**: fix logins, organize crews, staff the campaign.
2. **Where automatic pause lives**: a new org Settings page.
3. **How a person opens**: a side panel with ‹ ›.
4. **A lead's view of a person**: only their campaigns (item 40).
5. **Pagination.**
6. **Choose the coordinator while adding.**
7. **The phone should match.**
8. **Coming back**: doors follow the canvasser.
9. **Ship the lead privacy fix alone first.**
10. **No DPA notice for item 40.**
11. **Leads remove people from their own campaign**: canvassers and themselves.
12. **One patch for items 40 and 41.**
13. **A lead adds only themselves by id.**
14. **A lead removes canvassers and themselves.**
15. **No DPA notice for item 41's add.**
16. **No DPA notice for item 41's remove**, asked again with the corrected facts (on screen since
    2026-07-12).
17. **Close the book and walk-list path in code.**
18. **Run a fourth review** on the rewritten crew-change model.
19. **Doors follow the person, whatever their role** (2026-10-26): "if they are readded, doors move
    to wherever the new addition is at … that applies no matter the role". So an admin or team lead
    taking a book counts as coming back, and their earlier doors there move to No team.
20. **Run a fifth review** on the v5 changes (2026-10-26).
21. **Email checks: 60 an hour for new people, 30 for the rest** (2026-10-26). The owner first found
    150 an hour more than anyone needs, then ruled: "lets make the limit 60 an hr for new people and
    30 for the rest".

### N.2 Open calls (recommended defaults in bold)

1. **The phone gets no Settings row.** The setting never lived on the phone. Showing "On" there would
   misreport while it isn't running.
2. **The add screens pre-pick a returning person's old crew** when that coordinator can still lead.
3. **The Users page add takes a campaign for canvassers only.**
4. **25 per page on the web, 50 at a time on the phone, no page-size picker.**
5. **No bulk remove on the phone.**
6. **The phone's door-count check shows no client-report team names.**
7. **Back leaves the page** (the address is replace-only).
8. *(Decided by the owner: N.1.19. Taking a book counts as coming back.)*
9. **The team-repair tool's crew checks move into the team-count check** (`audit:team-counts`), and
   fixes are made with Finish it on the Team page. The repair tool keeps only its switch for an
   org's team surfaces.
10. *(Decided by the owner: N.1.21. 60 an hour for new people, 30 for people already in the
    organization.)*

## O. Files

**Server**:

- `routes/admin/memberships.js` (B.2)
- `routes/admin/leadCrew.js` (B.3; B.5: the two limits, `onCampaign`; B.6: the preview's `unfinished` and `busy`, `fromCoordinatorId`, the 409s, validating only new picks; B.7: `memberUserId` for named answers only, the unchanged re-add)
- `routes/admin/assignments.js` (B.4, B.9)
- `routes/admin/pacePauses.js` (B.9 `chosen`)
- `routes/admin/reports.js` (the hint on `/activities`)
- `routes/admin/campaigns.js` (the History feed's fields)
- `services/memberships/setCoordinator.js` (the §B.6 job, `joinCampaignCrew`)
- `services/memberships/restampCoordinator.js` (hints, `maxTimeMS`, the job's `sources` over both ledgers, the hold renewal and the second pass)
- `services/memberships/createMember.js` (no campaign or crew in `createOrgMember`, `restampOnJoin`
  folded, the equalized query)
- `services/campaignRoster.js` (`ensureCampaignAssignments` gains `join`: one roster read, joins only for ids not on it; on top of item 41's `selfOnlyFor`), and `routes/admin/turfAssignments.js` and `turfs.js` (pass it)
- `services/platform/seedDemoOrg.js` (its crew write also clears `crewJob`)
- `services/users/deleteAccount.js` (`sources` in the coordinator check; `releaseAssignedWork` also
  clears `crewJob`)
- `services/reports/clientReportChecks.js` (`earlierTotalsReason` matches `sources`) and
  `services/reports/clientReportBuilds.js` (`sourcesNear` by `updatedAt`; the wait for a held crew job
  at its two `otherChangeRunning` calls, and its `waitingWords` line). Both are in another session's
  area, so the hand-off names them. `services/canvass/answerEditRuns.js` (`otherChangeRunning`) is
  unchanged.
- `server.js` (`waitQueueTimeoutMS: 30000` on the web server's own `connectDb` call; `config/db.js`'s
  shared `baseOptions` is unchanged)
- `middleware/crewResolveLimit.js` (two limiters, 60 and 30; `retryAfterSeconds` in the 429)
- `models/CampaignAssignment.js` (`crewJob`, one subdocument with `default: undefined`, `sources` subfields declared), `models/CoordinatorChange.js` (additive fields; a new record's `_id` is its job's token)
- `migrations/migrateCampaignCoordinators.js` (its crew write also clears `crewJob`)
- `migrations/auditTeamCounts.js` (the two new lines) and `migrations/repairTeamStamps.js` (the team-surfaces switch only, and a pointer)
- `services/mail/templates.js`, `webRoutes.js` (B.9)
- `scripts/test-int.sh` and the preload; `test/auditGpsStamps.int.test.js` and
  `test/clientReportDuplicates.int.test.js` (the two preload fixes)
- `test/coordinatorChokePoint.test.js` (allowlist)
- Tests per §L

**Web, new**:

- `pages/SettingsPage.jsx`
- `components/settings/` (the moved card, `RecipientPicker.jsx`)
- `components/people/*`
- `components/team/*`
- `lib/rosterView.js`, `lib/runInChunks.js`, `lib/personAccess.js`
- the three ported suites

**Web, changed**:

- `App.jsx`, `navItems.js`, `navIcons.jsx`
- `ui/Drawer.jsx`
- `UsersPage.jsx`, `CampaignTeamPage.jsx`, `CampaignAssignmentsModal.jsx`
- `lib/pacePause.js`
- `lib/campaignHistory.js` and `components/CampaignHistoryDrawer.jsx` ("Didn't finish", "Finished by
  a later change", "Several teams", `doorsMoved`)
- `components/CoordinatorConfirm.jsx`: its client-report teams and its "from {X}'s team" wording come
  from `sources` when the doors came from several teams, and for Finish it, where from and to are the
  same crew (today it reads one from and one to, lines 22-26)

**Web, removed**: `UserProfileModal.jsx` (moved) and the in-file `TeamMemberPanel`.

**Phone**:

- `app/(app)/admin/users.jsx`, `users/[id].jsx`, `history.jsx`
- `components/MemberSheet.jsx`, `CreateCanvasserSheet.jsx`
- `lib/rosterView.js` (new), `lib/campaignHistory.js` (`doorsMoved`)

**Docs**:

- USERS.md: Part 1, including 181-183 and 527-529 ("add them back first, then set the crew"); Part 2
  lines 134, 215-217, 232, 352-356, 487-495, 567-572, 1057, 1137, 1164-1177 (the choke point, roster
  first, "a retry or repair:team-stamps closes"), 1182, 1239-1243 (the book roster-add now also moves
  a returning person's earlier doors), 1273-1277 and 1640.
- ROLES.md:588-590 and EMAIL.md:103-105 call re-adding someone already on the campaign an idempotent
  no-op. That becomes true again (today the route rewrites their crew), so they need no change.
- METRICS.md: lines 1117-1118 (re-add first) and 1268 (`repair:team-stamps` sets the gate).
- ROLES.md:
  - lines 144-146 and 176-181;
  - the `/crews` note;
  - 631-637 (the `createOrgMember` paragraph), and 766-767 and 779 (the CampaignTeamPage lines);
  - 580-585 (the lookup limit, and the `AccessLog` sentence §K corrects);
  - the bulk routes and Settings.
- AUDIT.md: lines 333-334 and 356-361, §G, and 955.
- ADMIN_APP.md: lines 548-551 and 766-772, the hub, the all-shown rows and the add flow.
- EMAIL.md: lines 25-28.
- FBTIME_INTEGRATION.md:450 and PERFORMANCE.md:390.
- PROPOSAL_PACE_PAUSE.md and PROPOSAL_ADMIN_ACCOUNT_DELETION.md: as-built notes.
- PRIVACY_VERIFICATION.md (§K: its "30/hour" lines, and the `AccessLog` sentence in the resolve item).
- Code comments:
  - MemberSheet.jsx:26 and 29-30;
  - users/[id].jsx:274-276 and 905-906;
  - coordinatorChokePoint.test.js:24-25 and 27-30;
  - createMember.js:55-58 and 198-216;
  - CoordinatorChange.js:7-8 and 37-39 ("re-running … or repair:team-stamps converges");
  - CampaignAssignment.js:33;
  - crewResolveLimit.js:9-20 (the limit's reasoning and the `AccessLog` sentence);
  - leadCrew.js:178-181 (the `AccessLog` sentence);
  - client/src/lib/dates.js:5;
  - mobile/lib/memberDeletion.js:289.

**Help Center**:

- `pages/page-team.md` (rewritten)
- a new `pages/page-settings.md` (audience `admin`; prose-only mentions elsewhere)
- `faq/a-canvasser-was-paused.md` lines 55 and 59
- `faq/team-lead-vs-admin.md` lines 25 and 29 (a lead's phone powers gain Remove)
- `faq/delete-an-account.md` lines 8, 21, 25, 44, 85 and 99-100
- `faq/canvasser-deleted-their-account.md` line 45
- `faq/add-a-canvasser-account.md` lines 12, 16, 20, 26 and 28
- `faq/assign-canvasser-to-campaign.md` line 14
- `guides/assigning-canvassers.md` lines 18, 20 and 28. Line 28 is false twice today: books don't put
  canvassers on the team, and neither does a walk-list pre-add.
- `getting-started/lead-getting-started.md` lines 37 and 43-50
- `guides/roles-and-team.md` lines 40, 59, 65 and 67
- `faq/team-door-counts.md` lines 26 ("until they're added back"), 28 ("the one thing that does"), 32 ("add them back first, then set it"), 36 and 42
- `faq/move-a-canvasser-to-another-team.md` lines 8, 14, 22, 31 (the phone line says "comes with an app update", but the phone never shows client-report team names, N.2.6), 44 ("only a coordinator change moves work"), 46, 52 and 54 (Finish it)
- `guides/assigning-canvassers.md` line 16 and `guides/turf-and-books.md` line 55: a book needs the person on the team first, and now taking one moves a returning person's earlier doors (N.1.19)
- `guides/roles-and-team.md` line 36 (a lead taking a book) and `getting-started/lead-getting-started.md` line 61 ("an admin adds you"): N.1.19's effect
- `faq/how-do-team-reports-work.md` line 42 (coming back moves doors; and the phone won't show the client-report line "yet", but N.2.6 says it never will) and `faq/report-totals-and-dates.md` line 30 (coming back moves doors). Both are in the other session's area, so the hand-off names them.
- `faq/who-changed-the-door-goal.md` lines 41 (only a coordinator change moves doors; coming back now does too) and 43 (a half-completed reassignment is fixed when "it's re-run"; under the plan it is Finish it, and History says Didn't finish or Finished by a later change)
- `faq/canvasser-left-the-team.md`
- `guides/metrics.md` line 135
- `pages/page-timeline.md` line 24
- `guides/audit.md` line 79
- `guides/billing.md` line 73
- `guides/campaigns-manage.md` line 143 (History)
- `faq/why-does-doors-per-hour-say-estimated.md` lines 32-34 and `guides/fbtime-hours.md` lines 73-75:
  "Team leads see this too" is false today, because the FbTime line shows only in the admins'
  Users-page profile. It stays admin-only, in the panel's "Everywhere" section.

New questions go to `faq/_INBOX.md`.

## P. What ships when

| Part | Vehicle | Depends on |
|---|---|---|
| Items 40 and 41 | ship-alone patch (handed over 2026-10-25) | nothing |
| B.2-B.9, the web | one server + web deploy | the index dry run and the mobile-API audit |
| The phone | `ota:staging` → `ota:production` | the server deploy, a clean `mobile/` |
| Help hedge removal | a small server deploy | `ota:production` |

## Q. Review rounds

### Round 1 (2026-10-25): three reviewers

The lenses were server correctness on a throwaway mongod, an owner walkthrough with a simplicity
audit, and privacy, release and docs. They found 4 blockers, 35 majors and 37 minors, plus 11
simplifications. v2 answered them, split out item 40, and adopted the owner's re-add rule.

### Round 2 (2026-10-25): three reviewers

The lenses were the server on a throwaway mongod, a real-browser web and phone walkthrough, and
consistency, coverage and release. They found 1 blocker, 18 majors and 50 minors, plus 9
simplifications. Two of the majors were live privacy gaps, now item 41. v3 answered the rest.

### Round 3 (2026-10-25): three reviewers

**Server pre-mortem**, with crash tests that killed a child process mid-change: no blockers, 6
major, 10 minor.

- The named-only limit made `outside` lookups unlimited (a timing gap was measured).
- A no-crew join took no lease.
- Every join wrote a record (History noise, team-report build failures).
- The intent record came after the roster write, so crash windows went unrecorded.
- Pending records never closed.
- Retry couldn't finish a torn change.

**End-to-end owner walkthrough** (real browser): no blockers, 2 major, 16 minor.

- The majors: History and report noise from joins, and Move to crew refusing more than 100 people.
- The minors included Back from Review reopening with dead arrows, the Users page's filters missing
  from the address, the deactivate route refusing leads for admins, the phone Settings row
  misreporting, and the demo walkthrough's bouncing email.

**Fresh-eyes consistency, coverage and the patch**:

- **The patch**: three false sentences in item 41, one of them the premise of the owner's decision
  (the remove had been on screen). The book and walk-list path was still open, there was a staff-id
  oracle on remove, and the Assignments window offered a refused Assign. All of it was fixed, and the
  owner was asked again, before the patch was handed over.
- **The plan**: 4 more majors (the limiter; joins writing records; the single-person path sending no
  `from`; no way to finish a move to No crew) and 13 minors.

What changed in v4:

- **Crew changes rewritten as one job** (§B.6), kept on the roster row.
  - One write changes the crew and notes the job.
  - The ledger writes are time-limited inside a 150-second hold.
  - The record is written at the end, keyed by the job.
  - Also: Finish it, `from` from every client, a Retry that re-previews, `busy` kept separate from
    `changed-meanwhile`, records for adds only when they move earlier work (doors, surveys or notes;
    every crew change is still recorded), and error records closed by a later change.
  - A first v4 draft wrote a pending record before the claim, as round 3 suggested. A crash between
    the two would have left a note nothing could finish, so the note moved onto the row.
- **Also new**:
  - the bulk preview taking up to 500 with an exact total;
  - two limits on the lookup;
  - the equalized resolver;
  - the History feed's fields;
  - the address-opened person placed in the stepping list;
  - Users page filters in the address;
  - the deactivate route;
  - the "No longer in the org" state;
  - the handover warning;
  - the repair tool as a read-only report (later folded into `audit:team-counts`, v5);
  - the preload fixes;
  - the demo walkthrough rewritten.
- **Dropped**: the `/stats` rewrite, the phone Settings row, the Audit-page link, the repair tool's
  crew `--apply` (its `--apply --ready-only` switch stays), and the phone's Coordinator → Crew
  relabel.
- **Changed recommendation** (later overruled by the owner, N.1.19): taking a book no longer counts as coming back (N.2.8), because no book
  screen can show the count first.
- **Not taken from round 3**:
  - keeping the checkbox list on Settings: it grows with the organization (34 names today), which is
    the scrolling the owner asked to fix;
  - retiring the repair tool outright: it prints a false all-clear today. (v5 then moved its crew
    checks into `audit:team-counts`, which already lists each person's crew per campaign.)

### Round 4 (2026-10-26): two reviewers

**Server, on a scratch database.** The reviewer built §B.6 as literally as v4 read, on HEAD plus the
ship-alone patch, and could not tear it. That covered every crash point, a 300,000-row write killed
from outside, a `maxTimeMS` timeout, 50 races 2-25 ms apart, and departures. No blockers; 2 majors,
10 minors.
- **The record's `from`** still wrote "none → none" and "Yan → Yan". `sourceBreakdown` counts only
  knocks, so a move of surveys or notes had no source team.
- **The unhinted bulk preview** read the whole organization on its oldest campaign (1,196,000 rows
  where the campaign has 396,000).
- **The minors:**
  - `crewJob` must be declared one way, or the hold silently disappears;
  - the build fence missed a Finish it that straddled it;
  - a runner paused past its hold could undo a later change;
  - a replaced crashed job left no record;
  - error records said nothing moved;
  - the limiters' mount order, and how a mistyped address counts;
  - two adds of the same person could move doors twice;
  - knocks saved during a change kept the old crew;
  - the drift step couldn't be done;
  - three spec gaps.
- **Simpler alternative considered:** one database transaction per change. It would remove the
  hold, Finish it, `unfinished` and `busy`. But the codebase uses no transactions, because the test
  harness runs a standalone mongod, and very large ledgers risk the transaction time limit. Not
  taken.

**Consistency and coverage.** 59 of round 3's 66 findings handled, 6 partly, 1 mishandled; 4 majors,
12 minors.
- **The mishandled one:** the phone's book self-assign goes through the add route with no crew, so
  under v4 it still moved doors.
- **The other majors:**
  - Part 1 said History shows only door moves;
  - the drift instruction couldn't be carried out;
  - the lookup-limit change was described backwards, resting on an audit line that is written only
    for Doorline staff.
- **Removals offered:** fold the repair report into `audit:team-counts`; drop "Put them back"; drop
  the released-phone caveat; drop the Users page handover.

What changed in v5:

- **§B.6**:
  - `sources` come from every row that moves, on both ledgers;
  - the hold is renewed before each write and the job stops if it lost it;
  - `waitQueueTimeoutMS` is set;
  - a second ledger pass catches knocks saved during the change;
  - a replaced job's record is written as interrupted;
  - error records carry the planned counts, and Finish it clears its error;
  - the token is asserted before the upsert;
  - `crewJob` is declared as one subdocument with `default: undefined`;
  - `Object.hasOwn` tells an absent `fromCoordinatorId` from `null`;
  - the panel previews the current crew on open, and Finish it also fixes rows off a real crew.
- **The build fence** gets `sourcesNear` by `updatedAt`, and a held job counts as a change in flight.
- **§B.3** hints the campaign index.
- **§B.4**: an absent crew key and `null` both mean No crew. (v5 first made an absent key move
  nothing; the owner's ruling below reversed that.)
- **§B.5**: the owner set the limits at 60 an hour for new people and 30 for people already in the
  organization (N.1.21). Each limiter counts only its own kind, and a mistyped address counts for
  neither.
- **§B.7**: `POST /crew` answers `already-on-campaign` for anyone already on the roster. (Superseded in v6: today's 201 `on-campaign` answer, changing nothing.)
- **§K**: the lookup change is described as the small loosening it is, at the owner's numbers
  (N.1.21), and the false `AccessLog` sentence is listed for correction.
- **Taken from the removals:** the crew checks fold into `audit:team-counts` (§B.8), and "Put them
  back" is gone. The released-phone caveat went too, then returned with the owner's ruling below.
- **Not taken:** dropping the Users page handover. The owner's words ("on the web, you can add a user
  but not choose their coordinator") describe that page's Add member.
- **§O** gains the Help lines and docs the review found, including two Help lines that are false
  today ("Team leads see this too" about FbTime).

**After round 4, the owner ruled** that the coming-back rule applies to every role (N.1.19). So taking
a book counts as coming back after all. The absent crew key on `POST /assignments` joins with No crew,
the book routes pass `join` to `ensureCampaignAssignments`, and the released-phone caveat returns. The
demo seeder is the one exception: it builds demo data and must not move staged doors. The owner then
asked for a fifth round.

### Round 5 (2026-10-26): two reviewers

**Server, on round 4's prototype with every v5 change built in.** Round 4's tests all passed again:
crashes 10/10, races 0 torn, departures, stragglers (0 left on the old crew, against 16 with today's
code), and History. No blockers; 2 majors, 11 minors.
- **The second pass made multi-person requests slow**: 10 jobs one after another took 21 s, past the
  phone's 20 s.
- **The book routes' `join` as written moved nothing**, and joining every id was 50 times slower for
  book holders already on the team.
- **The minors:**
  - a lost-hold run could overwrite a finished record, and a stalled run could carry on alongside
    Finish it of the same job;
  - two simultaneous upserts of one token made two rows;
  - the interrupted write relabelled records and tripped the report fence;
  - the self-coordinator check leaked whether an email belongs to an account at another customer;
  - the demo seeder left stale jobs;
  - `waitQueueTimeoutMS` of 10 s would fail ordinary slow requests;
  - the fence check belonged at the build's own calls;
  - History said "doors" for notes;
  - "partial counts" can't be had;
  - one pinned test contradicted the 409;
  - a departure mid-job now splits the ledger (accepted).

**Consistency, coverage and plain English.** Of round 4's 36 ids, all were handled or partly handled,
with none missing.
- **Its majors were the same two** (the book join, the second pass).
- **The minors:**
  - Finish it's scope, "waits" versus "is turned away", and the released-phone override, all in
    Part 1;
  - books left out of History;
  - a switched-off person already on the campaign;
  - a switched-off coordinator's crew;
  - Finish it shown without a count;
  - §O gaps, one of them the wrong file for `otherChangeRunning`;
  - Part 1 rewritten line by line for the owner.

What changed in v6:

- **§B.6:**
  - a `run` id per attempt, so Finish it stops a stalled earlier run;
  - a lost hold writes the record only if none exists;
  - the interrupted record is insert-only with timestamps off;
  - a unique partial index on `{ userId, campaignId, token }` (superseded in v7: the record's `_id` is the token, so no new index);
  - `doorsMoved` and planned counts;
  - only new picks are validated;
  - Finish it shows the count first;
  - `waitQueueTimeoutMS` on the web server only (60 s in v6; 30 s in v7, with the renewal's own wait counted);
  - a request's jobs run side by side, and joins skip the second pass unless the person is an org
    admin or Doorline staff;
  - the demo seeder clears `crewJob` too.
- **The fence:** the held-job wait sits at the build's two calls, with its own wording. Answer edits
  are untouched.
- **§B.4:**
  - the roster is read once, and only ids not on it join;
  - no cap, as today;
  - the "always send the key" sentences are gone, since an absent key and `null` now behave alike.
- **§B.5:** `in-org-inactive` gains `onCampaign`.
- **§B.7:**
  - the self-coordinator check runs for named answers only;
  - re-adding someone already on the campaign keeps today's 201 `on-campaign` answer and changes
    nothing, instead of the v5 409. That matches the pinned test and makes ROLES.md and EMAIL.md true
    again.
  - the book routes join only ids not on the roster.
- **§K:** five places carry the false `AccessLog` sentence; the mobile-API list adds `turfs.js` and
  `turfAssignments.js`; the released phone's refusals are back to two.
- **Part 1:** the reviewer's plain-English rewrites, line by line.
- **Not taken:**
  - dropping the open-time preview, because Finish it on the panel fixes a person in one step, with
    the count. Its cost is one read of the person's records each time a panel opens or steps;
  - cutting Part 1's "today" table, because it answers the owner's own question about the
    inconsistency;
  - letting each knock re-read its crew after saving and correct itself, instead of the second pass.
    A re-read can't tell a departure, which must not move the door, from a finished change to No
    crew, which must. And it adds a query to every door saved in the field.

### Round 6 (2026-10-26): two reviewers

**Server, on round 5's prototype with every v6 change built in.** Rounds 4 and 5 passed again, and so
did the 31 crew suites (401 tests, 0 failures; teamLead 21/21). No blockers or majors; 9 minors.
- **Timings:** a bulk chunk of 10 returning canvassers took 237 ms, a `POST /assignments` of 25
  returning people 313 ms, and a released phone's Assign all of 200 ids 234 ms. Round 5 measured
  21.1 s and 24.4 s.
- **The minors:**
  - the release matched the token only, so a stale run could free a live Finish it and split a
    ledger;
  - insert-only records were written without times;
  - a book join that threw before its insert left the holder off the roster;
  - a released phone could make an unvalidated pick;
  - 10 jobs at once filled the connection pool;
  - the renewal filter scanned the roster;
  - the hold arithmetic left out the renewal's own wait;
  - released-phone History wording;
  - §B.9's "No new index".
- **Simpler:** joins to No crew never need the second pass.
- **One unexplained flake:** an r5_t05 History request answered 404 once, on a machine swapping hard;
  four reruns didn't reproduce it.

**Consistency and plain English.** Every round-5 finding had a place. One major: the new index
couldn't be built before the deploy, because the index script reads the deployed models. 11 minors:
- the run id didn't cover step 4's writes;
- the hold arithmetic;
- book screens and the count;
- when step 3 is reached;
- History and earlier work;
- one unmarked v5 line;
- the crew picker can't show a switched-off coordinator;
- the crew backfill;
- fence line numbers;
- Help lines;
- released-phone History.

What changed in v7:

- **No new index:** a new record's `_id` is its job's token, so §M.1 needs no build step.
- **§B.6:**
  - the renewal before the record write;
  - the release matches the run;
  - renewals and the release filter on `campaignId` and `userId`;
  - a renewal slower than 30 s counts as lost, and `waitQueueTimeoutMS` is 30 s on the web server;
  - insert-only records carry their own times;
  - four jobs at a time;
  - joins skip the second pass unless they join a real crew and the person can save doors off the
    roster;
  - the route passes the crew it read as `from` when it skips validation;
  - the crew backfill clears `crewJob` too.
- **§B.4 and §B.7:** a join that throws before its insert falls back to today's plain insert;
  "Apart from Switch on".
- **§E.3:** a switched-off coordinator shows as current but not pickable.
- **§E.4:** bulk write requests go one at a time.
- **Part 1:** round 6's plain-English rewrites.
- **§O:** the crew backfill, CoordinatorConfirm's wording, and two Help files.

## As built (2026-10-27)

Built from v7 by the owner's "Build it", with the §N.2 defaults. The server was ported from round 6's
prototype with its fault-injection knobs taken out, then given its own code review; the web and the
phone were each built against the server contract and reviewed. Where the build differs from the text
above:

- **The bulk write never adds anyone** (§B.3). A person with no roster row at write time answers
  `not-on-campaign`, admins included: the review showed a stale preview could otherwise undo another
  admin's removal or put a deleted account back on the roster with its doors moved. No screen needed it:
  the add from the organization and the phone's Assign all shown preview through the bulk preview and
  add through `POST …/assignments`, which checks the membership. The preview gained two skips for an
  admin's off-roster ids, `deleted` and `switched-off`, and an optional `intent` (`'move'` or `'join'`)
  so its totals are exactly what the write after it does — a list that went stale while it was open
  could otherwise count someone the write then skips. Every client sends one.
- **Every crew change gets the second pass** (§B.6 step 3), people with no doors yet included; the
  prototype's first port skipped it when nothing was planned to move, which left a first door saved
  mid-change on the old crew.
- **A person's door counts are deduplicated across teams** in the bulk preview and the resolve
  `history.doors`, matching the one-person preview (a door re-knocked under two teams counted twice).
- **A No-crew repeat is skipped before the bulk plan**, so `totals.doors` is exactly what the write
  moves.
- **Crew records are swept with a tenant being deleted**: `CoordinatorChange` joined `LATE_WRITE_MODELS`
  and the job runs inside `sweptAfter` (privacy record item 42(h)).
- **Only team report builds wait on a crew change**; whole-campaign and walk-list builds don't.
- **Joins report the person added** even when a step after the insert fails (`unfinished`, Finish it to
  come), and a lost hold answers with the crew the row holds now and keeps a ledger error's own words.
- **Tests:** `crewJob.int.test.js` (23), `crewJobEdges.int.test.js` (18, the review's cases and the §L
  gaps; the ones for review findings fail on the pre-fix code), `crewJobCrash.int.test.js` (6, a child
  process SIGKILLed at each step through wrapped model methods, no hooks in the shipped code),
  `crewResolve.int.test.js` (6), `crewConsoleTools.int.test.js` (2), two report-fence tests in
  `clientReportTeamParity.int.test.js`, and the client and phone suites.
- **Web, beyond the text:** confirms are inline (no `window.confirm`); Remove from org leaves the panel
  open on the person, marked *No longer in your organization*; Retry and Continue both re-check first;
  the address also carries the sort direction, and `?add=` opens Add people (the Assignments window links
  to it); a deactivated person is offered no temporary password.
- **Phone, beyond the text:** Stop, Continue and Retry failed on the all-shown runs; at most 500 people per
  run; *Show 23 more* near the end; Resend invites to all shown also without a campaign; the member
  sheet's crew picker for anyone on the team; rows for people no longer in the organization on a
  campaign's list, so a lead can remove them.
