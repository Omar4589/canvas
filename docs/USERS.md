# Users, organizations & cross-org identity

How a person becomes a member of an organization, what it means that one account can belong to
several orgs at once, and the guardrails that stop one org from quietly affecting a user who also
belongs to another.

- **Part 1 — For everyone** is plain language: accounts vs memberships, roles, adding/linking
  people, passwords, and what's shared vs isolated across orgs.
- **Part 2 — Technical reference** is for developers (and Claude): the data model, the auth/password
  flow, the cross-org guards, and the one-time migration.

Related: [EFFORTS.md](EFFORTS.md) (crews are drawn from an org's canvassers), [CAMPAIGNS.md](CAMPAIGNS.md)
(the campaign a team belongs to), [METRICS.md](METRICS.md) (per-user, per-org stats).

---

# Part 1 — For everyone

## Accounts vs memberships (the key idea)

There is **one account per email address, shared across the whole platform.** A person signs in once
with their email + password — no organization is chosen at sign-in.

Belonging to an organization is a separate thing called a **membership**: it links your one account
to an org and gives you a **role** there (Admin, Team lead, or Canvasser). The same person can have
memberships in several orgs, each with its own role, and switch between them with the org switcher.

```
Account (one per email)
  ├─ Membership → Org A   (Admin)
  └─ Membership → Org B   (Canvasser)
```

So "what happens if two orgs have the same email?" → it's **the same person**, with two memberships.
You can't create two separate accounts on the same email.

## Signing in with mixed roles

The diagram above is a real, ordinary situation: **admin in one org, canvasser in another.** Where you
land depends on which surface you sign in to, because the two surfaces are for different jobs.

- **The web console** is for admins and team leads. It shows you Org A. Org B — where you're a canvasser
  — still appears on the org picker, greyed out under **No console access**, so you can see it's there;
  it just can't be opened, because there's nothing in the console for a canvasser to do.
- **If Org A is the only org you can run from the console, sign-in takes you straight there.** You'll
  only see the org picker when you have two or more orgs you can actually open.
- **The mobile app** is where Org B lives. Every role has a home there, so *all* your orgs are
  selectable — switching orgs in the app is how you move between running Org A and knocking doors for
  Org B. Same email, same password.

Switching orgs in the console always drops you on the new org's home page, never on a page that belonged
to the org you just left. Each browser tab keeps its own organization: switching in one tab doesn't move
your other open tabs.

## Adding someone to your org

On the Users page, "Add member" has two modes:

- **New user** (default) — you provide their name, email, optional phone, a role, and — **optionally**
  — a temporary password. This creates a brand-new account, and they get an **invitation email with a
  set-password link** either way. **Leave the password blank (recommended)**: they set their own via
  the emailed link, and no shared secret ever exists. Type one only when they can't reach their inbox
  (it can be simple — read it out loud; they're required to replace it with their own strong password
  the first time they sign in, on web or mobile).
- **Existing user (by email — link them to this org)** — check the box and enter just an email + role.
  This finds a person who *already has an account* (e.g. they canvass for another campaign) and adds
  a membership to your org, without creating a duplicate.

You can also add people **from a campaign's Team page** (**Add people** on the web console, **Add a
canvasser** in the mobile admin app). It creates or links the account and puts them on that campaign, **on
the crew you pick**, in one step. You type the email first, and Doorline says whether it belongs to a
colleague in your organization or needs a new account, so a returning canvasser is never duplicated. It is
available to **team leads** too (a lead owns onboarding). It only *creates* canvassers; use the Users page
for a new admin or lead. On the Users page, **Add member** with the Canvasser role has an optional
**Campaign**: picking one hands what you typed to the same Team-page steps, crew choice included. The
**phone** field is optional and **auto-formats to `(555) 123-4567`** as you type — it won't accept letters.

If you try to create a **new** user with an email that already exists anywhere, you'll get a clear
error telling you to use the "Existing user" box instead (and the box auto-checks for you).

When you add someone, **they're told.** The next time they sign in they see an in-app banner: "You've
been added to *{org}* as *{role}*." They dismiss it and it's gone. (There's no email system yet, so
the notice is in-app.)

## Roles: admin, team lead, canvasser

A membership's **role** decides what a person can do in that org:

- **Admin** — runs the whole organization: every campaign, plus the org-wide setup (the survey
  template library, tags, the voter directory, and Users administration).
- **Team lead** — a **campaign-scoped admin**. Within the specific campaigns they're *granted*, a lead
  does everything an admin does (import voters, build and attach a survey from their own library —
  templates they authored or already on their campaigns — build walk lists, cut turf, run passes,
  assign books, manage the crew, print walk packets, export the campaign, and see the reports / map /
  timeline). They **cannot** create, archive,
  or delete a campaign, archive/delete survey templates or touch the tag library, reach org Users
  administration, or see any campaign they weren't granted. Grant a lead their campaigns on the Users
  page (set role → Team lead, then check the campaigns).
- **Canvasser** — walks the doors in the mobile app for the campaigns they're on. No console access.

Team lead is how you hand a trusted person a campaign to run **without** making them a full org admin.
The full power matrix and enforcement details are in [ROLES.md](ROLES.md).

## Crews & coordinators (who oversees whom)

Anyone on a campaign's team can be put on a **crew** — given a **coordinator**, an admin or team lead
who oversees them **on that campaign**. Use it when one campaign has several people splitting the work
(e.g. two vendors, or a paid vs. volunteer crew): put each canvasser under whoever runs their group, so
you can see and report on "who reports to whom." A coordinator must be an **admin or team lead in this
org**; leaving someone on *no coordinator* is a real, ordinary answer, not a gap.

**A crew belongs to a campaign, not to the organization.** The same canvasser can work two races under
two different coordinators — Maria walks HD54 for Asa and HD64 for Frank — and each campaign keeps its
own answer. Changing her crew on one campaign moves nothing on the other. (This used to be one crew per
person per *org*, one slot. Two leads doing their jobs normally overwrote each other, and the re-stamp
below then dragged the first campaign's whole history onto the second lead's team.)

### Where you set it

**On the campaign.** In the web console: open the campaign → **Team** → click the person → pick their
crew in their panel. In the mobile admin app: **More → Users** on that campaign → tap the person. Before
anything commits, a confirmation tells you how many of **that campaign's** doors the change would move,
and what it will not touch; you can cancel. To set several people at once, tick them on the Team page and
choose **Move to crew…** (on the phone, **Move all shown to a crew…** under a filter): the same check,
totalled for everyone. You can also pick the crew while adding someone (above). Admins can do this on any
campaign; a team lead can on the campaigns they were granted.

The org **Users** page doesn't *set* a crew — it shows them. Open a member and the **Everywhere in your
organization** section of their panel lists their crew on **each campaign** they're on, each one linking
to that campaign's Team tab with them open. There is no crew dropdown there, no Coordinator column or
filter on the Users list, and no coordinator field on the Users page's own "Add member" form: one value on
a person's org profile cannot be true for somebody who is on two campaigns. (Add member's optional
Campaign hands off to the Team page's steps, which ask for the crew on that campaign.)

### A team's numbers follow the crew you have set today

This is the part that matters when you report a team's numbers to a client.

**Whoever someone's coordinator is right now, all of that person's doors *in that campaign* count for
that team** — including doors they knocked before you set the crew. Four consequences, all of them the
ones you want:

- **Forgetting to set a crew is fixable.** Add a canvasser, forget to put them on a crew, let them
  knock all day — then set their coordinator, and *every* door they knocked on that campaign moves onto
  that team. You are not stuck with a permanent pile in "No coordinator" because of a setup step you
  missed.
- **Moving someone between crews takes their history with them — inside that campaign.** Their old
  doors go to the new team too, all time; their work on your **other** campaigns is not touched.
  **This means a by-team figure you gave a client last month can change if you reassign someone
  afterwards** — that is the deliberate trade for the point above, and it is bounded to the one
  campaign. It is reversible: set the crew back and the numbers return exactly. Every change is
  recorded (who moved whom, on which campaign, from which crew to which, and how much moved), and the
  console shows you the door count before it commits. When either crew belongs to a client-report
  team that has reports, the web confirm also says so: "This also changes the numbers in the Paid team
  client report" (published reports keep their numbers until refreshed; [CLIENT_PORTAL.md](CLIENT_PORTAL.md)
  → *Team reports*). The phone shows the door count but never that line: it doesn't load client reports.
- **Someone who leaves keeps their doors on their team.** Deactivate them, take them off the campaign,
  remove them from the org, delete their account — their doors stay where they belong. **Losing a
  person never moves a number; a crew change does, and so does coming back.** (This used to be broken:
  the team was read from the campaign roster, so removing someone deleted the row the lookup depended on
  and their doors fell silently into "No coordinator" — the bucket admins deliberately *exclude*. On a
  live campaign that under-reported one team by **104 doors**.)
- **Someone who comes back brings their doors with them.** Add a person back to a campaign they worked
  before, or an admin or team lead joins it again through a book, and all their earlier doors **on that
  campaign** move to the crew they rejoin, or to "No team" if they rejoin without one. The doors follow
  the person, whatever their role (the owner's rule, 2026-10-26). The add step says how many doors they
  have there and which teams those count for, picks their old crew for you when that coordinator can
  still run one, and shows how many doors move before you confirm. Re-adding someone who is **already**
  on the campaign changes nothing, crew included: change a crew from their panel instead.
- **"No coordinator" stays meaningful.** A candidate knocking their own district genuinely has no team,
  and that bucket is theirs — not a dumping ground for anyone the system lost track of.

**What a crew change never touches:** the campaign's own totals, coverage, any rate, or your bill.
Billing counts doors, not teams. It only changes which *team row* the doors are counted under.

**Two things that surprise people:**

- If you give a coordinator to someone who *runs a crew* themselves, their **own** doors move onto
  their new coordinator's team, on that campaign. Their crew's doors stay with them. The confirmation
  says so before you commit.
- Because crews are per-campaign, so is "running a crew." Somebody who runs a crew on one campaign but
  knocks on **another** campaign *without* a crew there lands in that second campaign's "No team"
  bucket — they fold onto their own team row only where they actually run one.

### Changing a crew after someone is gone

Two different situations, and the difference is whether they're still on the campaign's team:

- **Deactivated, still on the campaign.** Their crew is still settable, and their doors still move —
  account state never gates the ledger. That matters more than it sounds: on one live org roughly
  **1,700 doors** sat in "No team" belonging to canvassers who had since been switched off, and every
  one of them is still fixable by setting the crew.
- **Removed from the campaign.** Their place on that campaign is deleted, so there is no crew there to
  set any more; their doors keep the team frozen on them (the 104-door rule above). If you need to move
  them, **add them back to the campaign on the crew you want**: their earlier doors there move to it as
  they rejoin (or to "No team" if you pick none).

The **Timeline** shows a **by-team breakdown**: every team's doors, survey doors, surveys taken and
connection rate, with a Campaign row that the teams add up to. See
[METRICS.md](METRICS.md#teams-coordinators--the-counting-contract) for exactly how a team's doors are
counted (and what happens in the rare case two teams knock the same house).

**Crews drive book assignment, within the campaign.** Wherever you assign work, people are grouped by
their crew **on that campaign**:

- The campaign **Team** page opens sorted by crew, with a heading per coordinator and "No crew" last,
  shows each person's crew in its own column, and filters by crew.
- The **book-assignment** picker (Turf Cutting) has a **crew filter** — pick "Paid Lead" and you see
  only that crew, so you can select the whole team and assign them to the chosen books in one action.
  Each person shows their crew, and a book that ends up with **two crews** flags a "mixed crews" note.

This lets you run, say, a paid team and a volunteer team in **one** walk list: put both crews on the
Team, set each person's crew, cut the books, then assign each crew to its books. **You get per-crew
totals for free** — the campaign **Timeline** has a by-team table showing each crew's doors, survey
doors, surveys taken and connection rate, with a Campaign row they add up to. Dividing the *doors* into
disjoint areas is still what separate walk lists do ([EFFORTS.md](EFFORTS.md)) — crews divide the
*people*, walk lists divide the *territory*; use whichever (or both) fits.

## The campaign team (who can work a campaign)

Being in the org isn't the same as being on a **campaign**. Each campaign has its own **team** — the
subset of org members who work it. The team is what:

- **gates the mobile app** — a canvasser only sees campaigns they're on (admins & super-admins see all); and
- **gates book assignment** — you can only assign books to people on the team.

Manage it on the campaign's **Team** page (rebuilt 2026-10-27 for three jobs: fixing logins,
organizing crews and staffing the campaign). Quick filters along the top — **Current team** (where it
opens), **Never signed in**, **Deactivated**, **Paused** — each carry a count that follows the search and
the crew and role filters, so a count always equals the rows it shows. The columns are **Member** (with a
Lead or Admin badge), **Crew**, **Last password login**, **Doors** and **Last door**, 25 people to a page.
Doors and last door are joined client-side from the all-time campaign leaderboard
(`GET /admin/reports/canvassers?campaignId=`, the same ledger-sourced rows the reports pages read), last
password login from the roster's own `lastLoginAt`. `lastSeenAt` stays super-admin-only by design and
must never be added here. **"Never signed in"** means the account was made on or after May 15, 2026 and
no password has ever been typed; Doorline didn't record sign-ins before then, so an older account with
none on record reads **No sign-in recorded** and is left out of that filter and of Resend invites.

Search, filters, sort and paging are all **client-side** over the roster the page already holds —
deliberately, unlike the super-admin tables which sort and page on the server: this list is one
campaign's people, and the page needs all of them anyway for the crew headings and the activity join.
The list logic is one pure module, `client/src/lib/rosterView.js`, copied to the phone and checked by a
parity test. **Crew grouping is a sort mode, not a separate layout** (sorting by Crew orders by
coordinator with No crew last, and the list puts a heading wherever the coordinator changes, including at
the top of a page). The page, filters, sort and the open person live in the page's address, so a link
reopens the list as it was.

**Click a team member** to open their **panel** (the same one the Users page opens): the buttons for
their state at the top (Reactivate account, Resend invite, Unpause, Set temporary password), rarer actions
under **More options ▸**, this campaign's crew and numbers, **Finish it** when an earlier crew change for
them didn't finish or some of their doors here still count for another team, their recent doors here, and
for org admins **Everywhere in your organization**. A team lead gets the login fixes for canvassers and
the crew of anyone on the team; admins, other leads and Doorline staff are read-only for a lead
(`leadMayManageTarget`). **Tick several** to **Move to crew…**, **Resend invites** (only to people who
never signed in) or **Remove from campaign** in one go; anyone a step couldn't change is listed with the
reason and **Retry failed**. A person joins a campaign's team these ways:

1. **Team page → Add people**, keyed on their **email address**. One door for every case: an address
   already belonging to a colleague puts that person on the campaign; an unused one opens a short form and
   creates the account; either way you pick their **crew** before they're added. An **org admin**
   additionally gets **From your organization** — search, tick up to 500, one crew for all — for staffing
   a new campaign; a **team lead** does not, because the Team page shows that campaign's people rather
   than the organization's (see [ROLES.md](ROLES.md)). Works on the web console **and** the mobile admin
   app's Users hub (**Add a canvasser**).

   **The surprise worth knowing:** if the address turns out to already have a Door Line account —
   including one belonging to another organization — that **existing person is added and anything you
   typed is discarded**. The name you guessed does not overwrite theirs, and a temporary password you
   typed is not applied to an account that is not yours to reset. The confirmation names who actually
   landed; if it is not who you meant, remove them and check the address. A colleague whose account is
   **switched off** cannot be added until an admin switches it back on, because that flag is org-wide; an
   org admin is offered **Switch on** right there.
2. **The Users page → Add member**, with the Canvasser role and a **Campaign** picked: it hands over to
   the same steps as 1.
3. **Taking a book**, for **org admins and team leads only** (taking one, or an admin handing them one):
   they are added to the team at that moment, and like any return their earlier doors on the campaign move
   to "No team" until their crew is set. A canvasser has to be on the team before they can be given a
   book. A walk-list pre-add (Walk Lists → Manage → Pre-add) never puts anyone on the team: a canvasser
   needs to be on it first.

Because assignment is now **team-only**, the everyday flow is: add people on the Team page first, then
assign their books. **Admins and a campaign's team leads are the exception** — they can be
assigned (including themselves) on the fly and are added to the team at that moment, so whoever is
running the campaign can always self-assign a book without a separate step. (A lead's exception is
scoped to the campaigns they were granted, and it is new: they used to be refused, so a lead cutting
turf had to ask an admin to roster them onto their own campaign.) Everyone appears in these lists,
including you — there's no "hide myself."

**Doorline staff can't be handed work in your organization unless they're a member of it.** Staff get
the on-the-fly exception only in Doorline's own internal demo organizations. In yours, a staff account
can be given a book or a walk-list place only if it holds a membership there, which shows on your
Users page, the same as anyone else.

## Passwords & lockouts

**Forgot your password? Reset it yourself by email.** The sign-in page has a **Forgot password?**
link (the mobile app opens the same page in the browser): enter your email, and if an account
exists we send a **single-use reset link** that's good for **1 hour**. The page never says whether
an account exists — the confirmation reads the same either way, on purpose. Opening the link lets
you set a new password (same strength rules and live checklist as everywhere else), then you sign
in normally. New accounts get the same kind of link in their **invitation email** (that one lasts
**72 hours**), so most people never see a typed temporary password at all. Emails never contain a
password — only a link.

**The typed temporary password is now an optional, manual fallback.** Whoever creates the account —
a super admin provisioning a client's first admin, an org admin adding a member, or a team lead
adding a canvasser — **may** type one, for someone who can't receive email (wrong address on file,
inbox unreachable in the field); left blank, a random throwaway is generated internally that nobody
ever sees, and the emailed link is the account's only way in. The same typed-password flow covers
*recovery* ("Set temporary password" on a profile). How the typed path works:

- The account is given a **temporary password** — set when it's created, or later when an admin clicks
  **"Set temporary password"** on the user's profile to rescue someone.
- The next time that person signs in, they're **required to choose a new password** before they can
  do anything (on web or mobile). The temporary one stops working the moment they set their own.
- A temporary password is only good for **72 hours**. After that, an admin can either set a new one or
  — better, if the person has a reachable inbox — click **"Resend invite"**, which emails them a fresh
  set-password link so no password ever has to be read aloud. This applies to a freshly created account
  too, so have new people sign in promptly.

### Staying signed in

**Using Doorline keeps you signed in.** A sign-in starts when you type your password. While you keep
using Doorline — opening the phone app, or using the web console — it is quietly extended about once a
day, so someone who works every day almost never sees a sign-in screen. Two limits still apply, for
security:

- **30 days without using Doorline** ends the sign-in.
- **90 days after you last typed your password**, Doorline asks for it again, however often you use it.
  Doorline staff accounts keep a plain 30 days from sign-in.

**When a sign-in runs out, Doorline asks for the password right where you are.** A screen covers the
app or the console page — *"Enter your password to keep going"* — with your email filled in. Type the
password and you're back exactly where you were: the same map or list on the phone, the same page and
unsaved edits on the web. Nothing is signed out and nothing is deleted while it waits. On the phone it
never interrupts a door or a survey: anything you save there is kept on the phone, and the screen
appears once you're back on the map or a list. If the signal is too weak to sign in, **Later** lets a
canvasser keep knocking; the map then shows how many items are waiting and that the team sees them once
the password is entered.

**Some sign-outs are deliberate, and those really sign you out:** a password change on another device,
a deleted account, or signing out in another browser tab (a tab already showing the password screen
waits for you instead). You land on the sign-in screen with a short note, saying why for a password
change or a deleted account. On the phone it waits until you're off a door, and the phone deletes its
saved houses, as every sign-out does.

**Signing out ends the sign-in on Doorline's servers too** (when you have signal), so a copy of it
can't be used afterwards. On the web console, **Sign out** always leaves you on a plain sign-in page: the
console no longer remembers the page you were on, so whoever signs in next on that computer starts at
their own home, not yours.

**Lost a signed-in phone, or left a shared computer signed in? Change your password yourself** — Forgot
password? on the sign-in page, or your profile. Every other device then needs the new password: the next
time it reaches Doorline it signs out (a phone deletes its saved houses as it does). The one exception
is a device whose password screen came up or was used in the half hour before it hears about the change,
which is what tapping **Forgot password?** there and coming straight back looks like: that one asks for
the new password in place instead, until it has been left untouched for half an hour. A phone with no
signal keeps working on its saved houses until it connects. A temporary password set by an admin or lead
does **not** sign other devices out.

**Saved work stays on the phone through a password prompt or a sign-out.** It is sent when you sign
back in **as yourself** — anything saved on a phone goes up under whoever signs in next. Doorline can
still turn an item down (for example, if you were taken off the campaign meanwhile), and those items
aren't kept.

**Apps that haven't updated** go straight to a plain sign-in screen when their sign-in runs out (no more
"Invalid token" with a Retry that never works) and, like any sign-out, that clears the houses saved on
the phone; they download again at the next sign-in. Those apps sign in again every 30 days.

**"Last password login"** on the Team and Users pages is the last time the person typed their password,
not the last time they used Doorline. For who's been out lately, look at the Team page's **Last door**
column.

### Resend invite

**Part 1 — For everyone.** An invitation is emailed once, when the account is created. If the person
never got it, or let the 72-hour link lapse, open them and click **Resend invite** — they get
a brand-new set-password link, good for another 72 hours. (For several at once: tick them on the Team page
and choose **Resend invites**, or on the phone **Resend invites to all shown**; each counts only the people
who never signed in, and says how many emails it will send.) The button appears **only for people who
have never signed in**, because that is the only situation it helps: anyone who has signed in already
has a working password and can use *Forgot password* themselves. Resending **replaces** any earlier
link, so if they were mid-signup on an old email, that one stops working — both clients warn you
before sending. **Admins** can resend for anyone in the org; a **team lead** can resend for canvassers
on the campaigns they manage.

**Part 2 — Technical reference.** `POST /admin/memberships/:userId/resend-invite`. Re-mints via
`issuePasswordResetToken(userId, { hours: INVITE_TOKEN_HOURS })` and re-sends the same
`inviteSetPassword` template the create path uses — one invite experience, not two that can drift.
Three things are load-bearing:

- **`role` comes from the Membership row**, never the request. `isFieldRole()` tests
  `role === 'canvasser'`, so a missing role silently renders the *console* email and a canvasser would
  get an invite with no app-store links and nothing looking wrong.
- **The send is awaited** and the response carries `{ sent }`, unlike the three fire-and-forget
  create-time sends — here the send *is* the request.
- **The 60s cooldown is measured off `passwordResetExpiresAt`, not off `EmailLog`.** `recordEmail()` is
  fire-and-forget inside `sendMail`, so an EmailLog-based check races the double-click it exists to
  stop; the token write is awaited, and a 72h invite window is unambiguously distinguishable from a 1h
  reset. The trade-off is that it throttles on *mint* rather than *delivery* — deliberate, since the
  mint is what invalidates the recipient's existing link.

Authorization reuses `leadMayManageTarget`, the same guard as the temp-password reset, so a lead may
act only on a canvasser rostered to a campaign they manage. `isOrgAdmin` covers org admins and super
admins. The router's blanket non-GET guard means a support-grant holder gets `VENDOR_READ_ONLY`.

### Staff resend, across orgs

**Part 1 — For everyone.** The button above needs you to be *in* the organization. Doorline staff
usually aren't — so when a client is provisioned, never signs in, and their 72-hour temp password
lapses, nobody inside the org can help and staff have no button either. The platform console fixes
that: **super-admin → All Users → the person → Memberships**, and each row they belong to has its own
**Resend invite**. The org is picked per row on purpose — the invite email names an organization, and
someone who belongs to two must never be sent a link naming the wrong company.

**Part 2 — Technical reference.** `POST /super-admin/users/:userId/resend-invite`, body
`{ organizationId }` — **required, never inferred**. Plain `requireSuperAdmin`, deliberately *not*
break-glass: the precedent is `POST /:userId/clear-lockout`, which is also plain super-admin, so
unsticking a locked-out user is already support-tier work. The line drawn is **recoverable help →
support tier; irreversible destruction → break-glass**.

Both routes call one implementation, `services/memberships/resendInvite.js` — a second invite path
drifting from the first is the exact failure this feature existed to prevent.

**This is not a `VENDOR_READ_ONLY` bypass**, and the distinction matters. That guard stops a
*grant-holder* writing through the customer-facing `/admin` router, up to and including minting
themselves a membership. This is one named capability on `/super-admin` that cannot change a role,
cannot create an account, and exposes no data. The asymmetry that makes it safe:

*(Superseded 2026-07-29: the table below described the interim state. The blanket vendor
write-block is now gone — under a support grant, staff may administer a customer's users
(create, temp password, resend, roles, deactivate), every write recorded in AccessLog. The one
refusal is a membership write targeting a staff account — `STAFF_SELF_MINT`, in
`services/memberships/vendorGuards.js` — because that write would end the logging. A customer's
own admin can still add staff as a member from their side.)*

| action | why |
|---|---|
| **Resend invite — safe for staff** | Emails the address already on the account; the *user* chooses the password. Staff never learn a credential and cannot sign in as them. |
| **Set temp password — allowed under a grant, logged** | The operator chooses the secret — accepted on the org-admin route's own reasoning (misuse is visible: the real user is locked out), now with an AccessLog row naming the staff actor. |

Attribution is free: `sendMail` writes an `EmailLog` row carrying kind, recipient, `organizationId`
and `userId`, visible at **super-admin → Emails**. No new audit model.

### Deleting an account from the console

**Part 1 — For everyone.** A super admin can delete someone's account from **All Users → the person →
Delete account…**. It shows what would break first (being the sole admin of an org blocks it), states
plainly that field work is *not* deleted, and makes you type the account's email to confirm. It cannot
be undone. Until this existed, the only staff route was a command-line script on the server.

**Part 2 — Technical reference.** `GET /super-admin/users/:userId/deletion-check` (preflight) and
`DELETE /super-admin/users/:userId` with `{ confirmEmail }` — both **break-glass**, matching
`DELETE /super-admin/organizations/:orgId`: deleting one person should not be easier than deleting
their whole org. `confirmEmail` is the analogue of that route's `confirmSlug` and is *the same string
`npm run delete:account` takes*, so this is a one-for-one replacement for the command it retires
rather than a looser second door. Every blocker is enforced and there is no force flag. Since
2026-10-24 its blockers are phrased about the person being deleted (`checkDeletionBlockers(…, { subject:
'other' })`: "This person is the only admin of …", not the self-deletion "You are…"), the `[user-delete]`
log line carries ids, never the deleted address, and the response is `{ deletedAt, retentionUntil,
organizationIds }`. A deletion already under way answers `409 DELETION_IN_PROGRESS` (see *Account
deletion* below).

`deleteAccount()` gained a real `deletedBy`, and its long-dead `reason` parameter — destructured and
then never referenced, so both callers passed a value into a void — is now persisted on
`DeletedUserRecord`. Neither field is touched by the 180-day purge, deliberately: they describe the
**actor**, not the subject, so a staff-ordered deletion stays answerable after the subject's name is
scrubbed. See `docs/PRIVACY_VERIFICATION.md` (v4 2026-07-29 stamps).
- When the person sets **their own** password, it has to be reasonably strong: at least 8 characters
  with an uppercase letter, a lowercase letter, a number, and a special character. A live checklist
  ticks each rule off as they type. (A *temporary* password isn't held to this — it only needs to be at
  least 8 characters with no stray spaces or control characters, since it's short-lived and replaced
  immediately anyway.)

This means an admin can always rescue someone, but the admin never ends up holding a working password
to the user's *other* orgs.

**Too many wrong passwords.** Separately, repeated failed logins are throttled: about **10 wrong
tries for one account (or 50 from one device) within 15 minutes** returns "Too many login attempts —
try again in a few minutes." That counter lives in server memory (it also clears on any redeploy) and
resets on its own once the window passes. Two safety valves for account managers:

- **You can't lock yourself out.** Add the owner/super-admin email(s) to the
  `LOGIN_RATELIMIT_ALLOWLIST` env var and those accounts skip the throttle entirely.
- **Unstick anyone.** A super-admin can clear a stuck user's lockout from **Super-admin ▸ All Users ▸
  Clear lockout**, so they retry immediately instead of waiting out the window.

## What's shared vs isolated across orgs

Because the account is shared, some things are global and some are per-org:

| Thing | Scope | Who can change it |
| --- | --- | --- |
| Name, phone | Shared (one profile) | Any admin of an org they belong to, or a super-admin — and, for a **canvasser**, a team lead who manages one of their campaigns (2026-08-09) |
| **Login email** | Shared (it's how they sign in everywhere) | The user or a super-admin only, **if** they're in 2+ orgs; otherwise like name/phone |
| Password | Shared | Any of their org's admins (as a *temporary* password), a lead managing one of a **canvasser's** campaigns, or the user |
| Role | Per-org | Each org's admin (admin / team lead / canvasser) — see [ROLES.md](ROLES.md) |
| Team-lead campaign grants | Per-org (`CampaignManager`) | Each org's admin — which campaigns a lead manages |
| Crew / coordinator | **Per-campaign** (the campaign roster) | An admin, or a team lead on that campaign — points to an admin or team lead in the same org |
| Active / inactive | Per-org (membership) | Each org's admin — or a lead, for a canvasser on their campaigns (the switch itself is org-wide, disclosed before confirm) |
| Removed from org | Per-org (membership) | Each org's admin — only removes *their* membership (a member with billing access only by an admin who has it too, since 2026-10-24) |
| **Account deleted** | Global (the one account) | The person themselves; an org admin, only when the account belongs to that org alone (see *Deleting a member's account*); Doorline |

The important one: for a person who belongs to **more than one org**, a regular admin **cannot change
their login email** (that would change how they sign into the *other* orgs). The email field is shown
**disabled with an explanation** in that case. Only the user themselves or a super-admin can change it.

## Paused for review (automatic pause)

When automatic pause stops a canvasser whose doors came in faster than anyone could knock them
([AUDIT.md](AUDIT.md) → *Automatic pause*), the people surfaces say so:

- **Web:** a red **Paused for review** chip beside the person on the Users page, and a **Paused** filter
  on the Users page (status) and the Team page (quick filter). Their panel says *Paused for review on
  {campaign} since {time}* with **Review** (the pause on the campaign's Audit page) and their past pauses,
  and **Unpause** sits with the buttons at the top. It asks first, because their count starts over. An org
  admin can unpause anyone; a team lead can, from the Team page, when the pause is on a campaign they
  manage (never their own). Someone paused on a campaign the viewer doesn't manage shows only *Paused for
  review — an org admin can unpause.*
- **Phone:** a *paused* badge on the Users list (after *deleted* and *inactive*, one badge per row), a
  **Paused** status filter, and a red line on their profile that opens the pause. On a campaign's member
  sheet, Unpause asks first and the notice has **Review**.
- **The Automatic pause setting** is on the **Settings** page (web only, org admins; it moved there from
  the top of the Users page on 2026-10-27, and **billing admins** change it): on or off for the whole
  organization (on by default; turning it off unpauses everyone at once), and **who gets the email** —
  *Billing admins (always)*, meaning everyone with billing access, including anyone given it later, plus
  anyone you add under **Also email** by searching for an org admin or team lead (up to 25; a lead only
  hears about campaigns they manage, and a lead may be your client). Someone you added who is no longer an
  admin or team lead shows as *Not emailed: no longer an admin or team lead*, and a billing admin's Save
  drops them. The email names no one and points to the Settings page; the card shows who last changed
  it.

**Changing someone's role starts their count over.** Only canvassers are ever judged, and a role change —
up or down — moves their restart point, so a lead demoted to canvasser can't be paused on doors they
entered as a lead.

## When someone leaves

People quit mid-campaign. Two things have to happen, and they must not be confused with each other:

**Their work stays. Always.** Every door they knocked still counts toward the campaign's totals, its
coverage, and its bill — forever. A knock is a record of something that happened; whether the person
who made it still has a login is a completely separate question. **Nothing you can do to an account
changes a single count**: not deactivating it, not removing them from a campaign, not removing them
from the org, not even deleting the account outright. They keep appearing on reports with their
numbers. (On the **Timeline**, pick the **All time** range to see everyone who has ever worked the
campaign — the default view is *today*, so people who left naturally have no rows in it.)

**Their team stays too.** The team a door belongs to is **stamped on the door**, not looked up later —
so a canvasser's doors stay on their team even after they're deactivated, taken off the campaign,
removed from the org, or their account is deleted. This matters when you report a team's number to a
client: before, removing someone from a campaign silently moved their doors into "No coordinator", the
bucket you exclude, and a real campaign under-reported one team by **104 doors**.

**Losing a person never moves a number. Reassigning one does, and so does someone coming back** —
deliberately. Changing someone's crew, or adding them back to a campaign they worked before, moves *all*
of their doors **on that campaign** onto their team (see
[A team's numbers follow the crew you have set today](#a-teams-numbers-follow-the-crew-you-have-set-today)),
which is what lets you fix a crew you forgot to set. The two are different events on purpose: a
roster change you make (a crew change, or adding someone back) moves the numbers; somebody leaving does
not. See
[METRICS.md](METRICS.md#teams-coordinators--the-counting-contract).

**A deactivated person can still be put on a crew; a removed one can't.** Deactivating somebody leaves
them on the campaign, so their crew is still settable and their doors still move. Removing them from the
campaign deletes their place on it, and with it the crew field — add them back to the campaign, on the
crew you want, if you need to move their doors: they move as the person rejoins.

**Their name stays, within limits.** Deactivation, campaign-removal and org-removal all keep the
person's name on reports. **Deleting the account is the exception** — whether the person does it or an
org admin does (see *Deleting a member's account*): the account is scrubbed (the App Store requires a
real delete), but the org's record of the *work* survives, and a snapshot of the name is kept for a
**retention window** so an audit can still say who walked which doors. Once that window
lapses the snapshot is purged and their past work no longer directly identifies them (it stays keyed to
an internal account id — de-identified, not anonymous) — that is the intended end state, not a bug.
The snapshot is **name-only**: email and phone die with the account, immediately, on every surface.

**Their books come back.** Whatever they were *holding* is handed back so someone else can take it:

| What you do | What they lose | What comes back |
| --- | --- | --- |
| **Deactivate** their account | Their login, in this org. Reversible any time. | Nothing — they keep their books, because you may well switch them back on tomorrow. |
| **Remove from a campaign** | That campaign only, including their crew there. | Their books and effort-crew places **on that campaign**. Books they hold on *other* campaigns — and their crews there — are untouched. |
| **Remove from the org** | Everything, in this org. | Their books, crews, campaign places and team-lead grants across **every** campaign in the org. |
| **Delete the account** (the person themselves, or an org admin) | The account, permanently. | Everything they were holding, everywhere. |

A book can have **several canvassers on it**. Releasing one person leaves everyone else's assignment
exactly where it was — only the departing person's is handed back. If they were the only one on it,
the book simply returns to the pool as unassigned, ready to give to somebody else.

> **Books orphaned by an older version.** Removing someone from a campaign used to release only their
> place on the roster and leave the books themselves assigned to them. If that happened to you, run
> `npm run repair:orphaned-assignments` (dry-run by default; add `--apply` to commit) to hand those
> books back. It never touches a knock.

## Deleting a member's account

**Org admins can delete a member's account** from the person's panel on the web, or their profile in
the phone's admin app (since 2026-10-24). Team leads never can. It's for a person who asked to be deleted, or an
account that shouldn't exist at all: a test account, a duplicate, one made with the wrong email, someone
hired who never started. **Most of the time, Remove from org is what you want**: it ends their access and
keeps everything your records need, including their name on reports and on a team.

**It's hard to do by accident.**

1. **It's tucked away.** **Delete account…** sits behind **More options**, next to a reminder that
   Remove from org is usually what you want. On the web: **Users → the person → More options ▸** in their
   panel. On the phone: **More → Users → the person** (from a campaign's list, tap **Manage profile ›**
   first) **→ Account → More options**.
2. **First confirmation: a review.** It names the person (name, role, email) and spells out what deleting
   them means, worked out from their own records: how many door results and surveys stay on your
   reports, which books come back and which stay with the other canvassers on them, whether they lead a
   crew, and what to do about doors still on their phone. **Continue** or **Cancel**.
3. **Second confirmation: type their email.** **Delete permanently** stays grey until the email you type
   matches theirs. Going back a step clears what you typed.

When it can't be deleted, the review lists the reasons instead, each saying what to do (another
organization → Remove from org; billing access → ask an admin who has it; the only admin → make someone
else an admin first), and offers only **Close**.

**Which accounts you can delete.** Any account that **belongs only to your organization**:

- **Not your own.** To delete yourself, use Profile → Delete account on the phone.
- **Not a Doorline staff account.**
- **Not in any other organization**, active or switched off. The review says so without naming the
  organization, and points you to Remove from org. An organization they *used to* work for doesn't stop
  you; it keeps their name on its records for 180 days, the same as yours (below).
- **People with billing access are protected.** Only an admin who also has billing access can delete
  them — or remove them from the organization, which any admin could do before. Without billing access,
  neither option shows for them.
- **Not the only admin, and not the only admin with billing access.**
- **The demo's app-review logins can't delete anyone.**

**What deleting does, for everyone:**

- **Their login and contact details are erased now:** email, phone, password, and the name on the account
  itself. They can never sign in again, and nobody can restore the account. Any invite or password link we
  emailed stops working.
- They come off every campaign, walk-list crew and team-lead grant. Books only they were on go back to
  unassigned; shared books stay with the other canvassers on them.
- Their email address is freed. If they come back, they get a **new** account, and their past work stays
  with the deleted one.
- The emails we sent them personally (invites, password resets, added-to notices) no longer show their
  address in Doorline's send log. Deletion warnings and staff-access notices that went to them as a
  billing admin keep it, as evidence ([EMAIL.md](EMAIL.md)).

**If they did work here** (door results, surveys, FbTime hours):

- **Nothing on your reports or your bill changes.** Every door result and survey stays.
- **Doorline keeps their name privately for 180 days**, so it still shows on canvasser reports on the web
  and the phone, team labels and by-team totals, the GPS audit, and Survey Results downloads and every
  other export — then they show as **Deleted user**. This holds even if you deactivated them first, and in
  any organization where they recorded doors or surveys before.
- **Other screens show "Deleted user" right away:** the rest of the map (the GPS audit's flags on it keep
  the name), a door's history, survey details and other detail screens. They read the account directly; a
  separate fix will bring them in line.
- **If they lead a crew**, those people have no coordinator until you pick one (tick several on the Team
  page and use **Move to crew…**). The team keeps its numbers, and its name for the same 180 days, until
  you move its people: their doors there move with them, like any crew change. Remove from org keeps the name, because the account stays — the
  better choice if you'll keep reporting by that team to a client.
- **Doors still on their phone.** For any account somebody has used, the review asks you to have them open
  the app with signal first, so their phone sends everything it's holding, and warns more strongly if
  their phone sent doors in the last week. Until the phone fix ships after Election Day, anything left on
  the phone goes up under whoever signs in on it next. A switched-off (deactivated) person's phone can't
  send anything: whatever it already tried to send while switched off was refused and thrown away. Switch
  them back on first if the doors it still holds matter (once billing is sorted, if it's paused).

**Their row on the Users list.** If the account was used (they signed in, have anything on your records,
or ever coordinated a crew), the row stays as **Deleted account**, with who deleted it and when ("Deleted
Oct 23, 2026 by Alex Kim", "Deleted their own account", "Deleted through Doorline support"). On the web it
keeps one action, **Remove from org**, which tidies the row away without changing anything on your
reports. **If nobody used it**, they disappear from your Users list completely. Accounts made before
mid-May 2026 always keep a **Deleted account** row, because Doorline only started recording sign-ins then.

**Billing paused.** While an organization is read-only (billing paused, ended, or a trial that ran out),
an admin can still delete an account and switch someone's access off with **Deactivate** or **Remove from
org**. Turning access back on still waits for billing ([BILLING.md](BILLING.md)).

**Super admins inside an organization** (the web Users page, or the phone's admin Users screen) — it
depends on how they're there:

| How the super admin is there | What they can delete |
|---|---|
| As one of the organization's own admins | The same as any admin. |
| As a member in some other role | Nothing; the review says why. |
| In Doorline's own organizations (the demo), without a membership | Like any admin. |
| Under a support grant, support level | Unused accounts only. |
| Under a support grant, break-glass | Any account the rules allow. |

Every deletion under a grant is recorded in the support-access log, naming the account. The platform page
(*Deleting an account from the console*, above) works as before: break-glass only, and it can delete any
account, including one in several organizations.

How it works: Part 2 → *Account deletion* → *The org door*. The plan, the owner's decisions and the
review log: [PROPOSAL_ADMIN_ACCOUNT_DELETION.md](PROPOSAL_ADMIN_ACCOUNT_DELETION.md).

## Deleting your account

Anyone can delete their own account from the mobile app: **Profile ▸ Delete account**. It's permanent —
their login, name, email, phone and password are gone, and **no admin can bring the account back**. This
is different from *deactivating* someone, which an admin can undo at any time.

**What the campaign keeps.** The doors they knocked and the survey answers they recorded **stay with the
campaign**. Those are the organization's records of work performed, not the person's personal content, so
deleting an account never changes a campaign's counts, its coverage, or its bill.

**Where their name still shows.** For as long as the retention window below is open, the organization's
**canvasser reports** (the leaderboard, the Timeline, each canvasser's own page, the canvassers CSV),
**team labels and by-team totals**, the **GPS audit**, and **Survey Results downloads and every other
export** still show their real name — they resolve it from the retained snapshot
([`hydrateCanvassers`](../server/src/services/reports/canvasserIdentity.js)), which is the whole point of
keeping it. Since 2026-10-24 that covers every organization whose records carry the person: a membership
in any status (deactivated included), and any organization where they recorded doors or surveys before
(it used to be only the organizations where they were still active). **Other surfaces — the rest of the
map (the GPS audit's flags keep the name), a door's history, survey details — read the scrubbed account row
and show "Deleted user" at once.** Once the
window lapses and the snapshot is purged, everything shows "Deleted user" and their past work no longer
directly identifies them (the records remain keyed to the internal account id).

**Their name is kept for a while, on purpose.** Alongside those records we hold their name for **180 days**
so the organization can still check *who* did which field work — canvassing records include the location
each door was logged at, and a GPS audit is worthless if you can't attach it to a person. This is stated
plainly to the user before they delete, and it means **nobody can delete their way out of a quality audit**.
After 180 days the name is removed for good; the old records stay with the campaign but no longer
directly identify the person. That includes the one place the name was saved as words rather than read
from the account: a Door Outcomes change filtered by that canvasser ("Cara Canvasser · Riverside · Pass 2")
reads "Deleted user · Riverside · Pass 2" from then on (since 2026-10-20 — before that the name stayed).

**Four things will stop a deletion**, and the app says which:

- **Unsynced doors.** If they knocked houses while offline and those haven't reached the server yet, the app
  syncs first and refuses to delete until it's done — otherwise that work would be thrown away.
- **You're the only admin.** A sole admin deleting themselves would leave the org with nobody who can add
  users, cut turf, or run reports. Make someone else an admin first.
- **You're the only admin who can manage billing.** Same reasoning, sharper edge: with no bill-payer left,
  nobody could pay the subscription and the whole org would eventually go read-only.
- **You're the only super-admin.** Promote another one first.

**What happens to their work.** Any walk lists or books they were holding are **handed back** and become
unassigned, so no doors are stranded with someone who's gone. They come off every campaign roster.

**If they come back later.** Deleting releases their email address, so they can be re-added. They get a
**brand-new account** — their old knocks stay attached to the deleted one. That's deliberate: re-hiring
someone must not quietly re-attach them to a flag history they deleted.

**If your organization uses FbTime.** The email on their FbTime link goes when the account is deleted,
with the rest of their contact details. The link itself stays until the 180-day removal, because it is
what keeps the hours they clocked their own — an admin who links their new account can keep the old one
counting as the same FbTime person (**Unlink → Yes — keep**). When the 180 days are up, nothing on
Doorline's side ties the old account to an FbTime person any more, and its past hours stay measured.
See [FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md).

Someone who's already uninstalled the app can request deletion at **doorline.app/delete-account**.

---

# Part 2 — Technical reference

## Models

- **`User`** ([server/src/models/User.js](../server/src/models/User.js)) — global account. `email` is
  **globally unique** (lowercased). No `organizationId`. Roles are *not* here. New fields:
  - `mustChangePassword: Boolean` — set whenever a new account is created (all three create paths pass
    it) **or** an admin issues a temp reset; forces a change at next login. Surfaced in `toSafeJSON()`.
  - `tempPasswordSetAt: Date` — when the temp password was set; used to expire it (72h). Written
    alongside `mustChangePassword` on created accounts too, so a brand-new hire's temp password also
    expires after 72h.
  - `isSuperAdmin: Boolean` — platform-wide; bypasses org-role checks.
  - `lastLoginAt: Date` — written in **exactly one place**, `POST /auth/login` (which the sign-in
    screens AND both apps' in-place password prompts call). It is "when they last typed a password",
    **not** a last-activity clock: a used sign-in is extended up to 90 days without one (see *Sessions*
    below), so a canvasser who works daily can legitimately read `2 months ago`. Both consoles label it
    **Last password login**. Exposed in `toSafeJSON()`.
  - `lastSeenAt: Date` — the true last-activity clock, stamped by `requireAuth` on any authenticated
    request and throttled to ~15 min per user per process (`middleware/lastSeen.js`), so it is
    approximate by design. **Super-admin-only**: emitted by `GET /super-admin/users` and
    `services/platform/userOversight.js` and nowhere else — deliberately absent from `toSafeJSON()`
    and from `GET /admin/memberships`, so an org admin can never read when a member (who may also
    belong to another org) was last online. **Not indexed**: it is projected into one response and is
    never a predicate or sort key, so an index would buy write amplification on the hottest write
    path for no read at all. Both clocks are **scrubbed on account deletion**
    ([PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) v4).
  - `endedSessionIds: [String]` — session ids this account signed out of (`POST /auth/logout`);
    `requireAuth` refuses any token carrying one. Keeps the last 200; `default: undefined`, so it isn't
    written as `[]` on every create and save; `select: false`, so only `requireAuth`
    (`.select('+endedSessionIds')`) ever loads it. Never leaves the server (absent from `toSafeJSON()`
    and every projection); cleared by account deletion. See *Sessions* below.
- **`Membership`** ([server/src/models/Membership.js](../server/src/models/Membership.js)) — join table
  `{ userId, organizationId, role: 'admin'|'lead'|'canvasser', isActive, addedBy }`, unique on
  `(userId, organizationId)`. The `'lead'` (team lead) role is a **campaign-scoped admin** — its
  authority is the set of campaigns granted via `CampaignManager` (below). The enum add is additive, so
  **no migration** is needed. Fields:
  - `acknowledgedAt: Date|null` — `null` = the "added to org" banner is still pending; a timestamp =
    dismissed.
  - `paceRestartAt: Date|null` — automatic pause's restart point for this member: visits before it never
    count toward a pause. Moved forward only (`$max`) — on every resolve (unpause, the org turning it off,
    the console rollback) and on any role change (`routes/admin/memberships.js`). It lives here, not on the
    pause record, so deleting a resolved pause can't bring old fails back ([AUDIT.md](AUDIT.md) §G.1).
  - `coordinatorId: ObjectId|null` (ref `User`) — **legacy, no longer read.** The crew moved to
    `CampaignAssignment.coordinatorId` (below) when it became per-campaign. Nothing writes it any more
    except the org-departure cleanup, and no surface reads it; it is left on disk deliberately so a
    per-team row that moves unexpectedly can be compared against the value it moved *from*. Dropping
    the field is a separate, later step.
- **`CampaignManager`** ([server/src/models/CampaignManager.js](../server/src/models/CampaignManager.js))
  — a team lead's grant to manage one campaign: `{ campaignId, userId, organizationId, grantedBy,
  grantedAt }`, unique `(campaignId, userId)`, indexed `{ userId, organizationId }`. Deliberately
  **separate** from `CampaignAssignment` (the walker roster) so a lead can *manage* a campaign without
  walking it — and can also walk it independently. The full authz contract is in [ROLES.md](ROLES.md).

## Auth & the forced-password-change flow

- **Login** (`POST /auth/login`) returns `{ token, user: toSafeJSON(), memberships }`. The JWT payload
  is `{ sub, email, isSuperAdmin, auth_ms, sid }` — no org; `auth_ms` and `sid` are explained under
  *Sessions* below. Memberships carry `isNew: !acknowledgedAt`.
  - On login, if `mustChangePassword && tempPasswordSetAt` is older than `TEMP_PASSWORD_TTL_HOURS`
    (72), login is rejected with `code: 'TEMP_PASSWORD_EXPIRED'`.
- **`mustChangePassword` enforcement** — [server/src/middleware/passwordGate.js](../server/src/middleware/passwordGate.js)
  `blockIfMustChangePassword` returns `403 { code: 'PASSWORD_CHANGE_REQUIRED' }`. It's mounted once as
  a choke point in [server/src/routes/index.js](../server/src/routes/index.js):
  `router.use(['/super-admin','/admin','/mobile'], requireAuth, blockIfMustChangePassword)`. `/auth` is
  deliberately excluded so `change-password`, `me`, `logout` stay reachable.
- **The `lastSeenAt` stamp** — [server/src/middleware/auth.js](../server/src/middleware/auth.js) writes
  `User.lastSeenAt` at the very end of `requireAuth`, gated by `shouldStampLastSeen()`
  ([middleware/lastSeen.js](../server/src/middleware/lastSeen.js)). Three details are load-bearing:
  - **It sits after every 401 guard**, immediately before `req.user = user`. A deleted or
    session-revoked account has already been refused above, so a tombstone can never be re-stamped by
    the deleted holder's still-valid token — which is what keeps the deletion scrub true.
  - **It is fire-and-forget** (`.catch(() => {})`, unawaited) and passes `{ timestamps: false }`. An
    awaited write that rejected on a transient DB blip would fail a live request; and without
    `timestamps: false` the stamp would drag `User.updatedAt` forward every 15 minutes for every active
    account.
  - **The throttle is an in-process LRU Map, not a "is the stored value stale?" check.** `requireAuth`
    runs **twice** on every `/admin`, `/mobile` and `/super-admin` request (the `routes/index.js`
    gate plus each sub-router's own mount) and **three times** on nested campaign routes, since
    `/admin/campaigns` is mounted ahead of `/admin/campaigns/:campaignId/*` and Express `use()`
    prefix-matches. Every one of those passes reads the same stale document, so a DB comparison would
    fire the write on all of them. Recording the decision before the write is issued is what makes
    passes 2 and 3 no-ops. Per-process like the login limiter's store: N dynos each write once per
    window per user and a redeploy clears the table, both fine — a miss costs one redundant `$set`.
- **Login throttle & lockout** — [server/src/middleware/loginRateLimit.js](../server/src/middleware/loginRateLimit.js)
  exports two `express-rate-limit` limiters (per-IP `max:50`, per-email `max:10`, 15-min window,
  `skipSuccessfulRequests`) mounted on `/api/auth/login`. Both `skip` emails in
  `LOGIN_RATELIMIT_ALLOWLIST` (comma-separated, lower-cased) so an allowlisted super-admin is never
  throttled. State is the default in-process `MemoryStore` (per-dyno; cleared on redeploy).
  `clearLoginLockout(email)` calls `loginEmailLimiter.resetKey(email)`, exposed to super admins via
  `POST /super-admin/users/:userId/clear-lockout`.
- **Self-serve email reset** — `POST /auth/forgot-password` (public; always the same generic 200,
  answered BEFORE any user lookup so response timing can't reveal whether an account exists; the
  token write + email run detached after the response). Issues a 32-byte single-use token — stored
  **sha256-hashed** in `User.passwordResetToken`/`passwordResetExpiresAt` (1h; invite links use the
  same fields at 72h) — and emails `https://doorline.app/reset-password/<raw>`.
  `POST /auth/reset-password` consumes it in ONE atomic `findOneAndUpdate` (hash + unexpired +
  active + undeleted → set `passwordHash`, clear `mustChangePassword`/`tempPasswordSetAt`/both
  token fields), so two racing submits can't both win; strength is Zod-checked BEFORE the lookup so
  a weak password never burns the token. Throttled by its own limiters (per-IP 20 + per-email
  5 / 15 min, counting every request on a store **separate** from the login lockout — see
  `middleware/loginRateLimit.js`). **Completing a reset revokes every existing session**: it stamps
  `User.passwordChangedAt`, and `requireAuth` refuses any session whose sign-in time (`auth_ms`) is
  before that instant (`401 { code: 'SESSION_REVOKED', reason: 'password_changed' }`) — "I changed my
  password" ends every other device's session.
  A null stamp grandfathers sessions issued before this feature. Mail itself is dormant until
  `RESEND_API_KEY`/`MAIL_FROM` are configured (`services/mail/mailer.js`).
- **Self-service change** — `POST /auth/change-password` (`requireAuth` only, no org context). Verifies
  `currentPassword`, **enforces strength on `newPassword` via `strongPasswordSchema`** (8+ with an
  uppercase, a lowercase, a number, and a special character), rejects reuse, sets
  `{ passwordHash, mustChangePassword: false, tempPasswordSetAt: null, passwordChangedAt: changedAt }`
  — ONE `changedAt`, which is also the fresh token's `auth_ms`, so that token passes the strict `<`
  check while every older session fails it
  (plus clearing any outstanding emailed reset/invite token — a link issued for the old
  credentials must not fire later), returns fresh `{ token, user, memberships }`. The stamp revokes every session issued before the
  change; the **fresh token in the response** is how the device that made the change continues
  seamlessly (both clients adopt it) — critical for a canvasser completing the forced change
  mid-shift, whose queued knocks must flush on the very next screen. This is the endpoint the
  **forced change** after a temp password also hits, so a rescued user's replacement is strong.
- **Admin reset** — `PATCH /admin/memberships/:userId/password` now sets a **temporary** password:
  `{ passwordHash, mustChangePassword: true, tempPasswordSetAt: now }`. Still gated by membership in the
  caller's active org, so any of a multi-org user's admins can issue one. Deliberately does NOT
  stamp `passwordChangedAt`: live sessions are already suspended recoverably by the password gate
  (`403 PASSWORD_CHANGE_REQUIRED` — the phone shows the forced-change screen instead of dumping to
  login), and the hard revocation lands the moment the user completes that change. The mobile
  offline queue **holds** (never drops) queued knocks on any 401 (every session end is
  `SESSION_REVOKED`) and on the gate's 403, and the queue survives sign-out — so a mid-shift reset can
  no longer lose billable work (`mobile/lib/offlineQueue.js` isAuthFailure). On the phone the
  forced-change screen itself is queued off the door flow (`components/SessionGate.jsx`), so it never
  unmounts a half-filled survey.
- **Set on create** — every account-creation path hashes SOME password + forces a first-login
  change, but the typed temp password is OPTIONAL on all three: super-admin provisioning
  (`POST /super-admin/organizations`, first admin — a typed password is echoed once in the 201,
  a blank one is generated internally and `tempPassword` comes back null), admin add-member
  (`POST /admin/memberships`), and the team-lead crew endpoint (`POST /admin/campaigns/:id/crew`).
  Blank/'' → `createOrgMember` hashes `crypto.randomBytes(18)` base64url that is never returned,
  logged, or emailed — the emailed set-password invite (72h, same machinery as reset) is the
  account's way in. All route through
  `createOrgMember({ ..., mustChangePassword: true })`, which writes `{ mustChangePassword, tempPasswordSetAt }`
  **only on the create-new branch** — so linking an existing account never touches its password or flag.

**Residual risk (by design):** the resetting admin also knows the temp password. The gate means a temp
password can only reach `change-password`/`me`/`logout` — it cannot read or act in any org. Using it to
*change* the password would lock out the real user, who notices immediately and re-requests a reset. The
72h expiry bounds the window. Full elimination isn't possible under shared identity; this is the
mitigation envelope.

**Doorline staff in an internal org use this same admin reset — there is no separate super-admin
password endpoint.** In a Doorline-owned **internal** org (`Organization.isInternal`), a super admin
enters freely — no support grant, no AccessLog row (`middleware/orgContext.js`; the org holds only
synthetic data, see [PLATFORM.md](PLATFORM.md)) — and then acts *as* that org's admin, because
`requireOrgRole(...)` passes through for a super admin. So resetting a demo account's temporary password
is just `PATCH /admin/memberships/:userId/password`, the ordinary org-admin surface above; there is
deliberately no parallel `/super-admin/.../password` route to build or secure. (Reaching a **customer**
org's admin surfaces works the same way, except `orgContext` first requires a live, logged support
grant — the reset endpoint itself is identical.) The authz side of this is in [ROLES.md](ROLES.md) →
*Super admins inside an org — including internal orgs*.

## Sessions: lifetime, extension, and how they end

Built 2026-10-10 from [PROPOSAL_SESSION_EXPIRY.md](PROPOSAL_SESSION_EXPIRY.md) (the plan and its three
review rounds). The short version: every ended session answers ONE coded 401; a sign-in that ran out
is answered with a password prompt **in place** on both clients; deliberate ends sign out fully.

**The token.** [services/auth/tokens.js](../server/src/services/auth/tokens.js) signs
`{ sub, email, isSuperAdmin, auth_ms, sid }` with `expiresIn: JWT_EXPIRES_IN || '30d'` (the idle
window; a value without a unit is read as **milliseconds**).

- `auth_ms` — the moment the person typed their password. Login captures it **before** the user lookup;
  change-password passes the exact instant it writes as `passwordChangedAt`. Revocation compares it in
  milliseconds (`authMs < passwordChangedAt`), so a login in the same second as a password change no
  longer survives it. A token minted before this field existed counts as `iat * 1000 + 999` — exactly
  the old whole-second rule. Residual: one database write round trip plus dyno clock skew.
- `sid` — the session id. Extension carries it; `POST /auth/logout` ends it. A token without one uses
  `'legacy:'` + the first 32 hex characters of sha256(signature) (`legacySessionId`), so every copy of
  one old token shares one id.
- `renewUserToken(user, { authMs, sid })` is the extension path and **throws** without both — it can
  never fall back to "now", which would reset the cap and outlive a password change.

**Every ended session is the same 401** — `{ error, code: 'SESSION_REVOKED', reason }` — because that
code is what every phone bundle since 2026-07-18 and the web already turn into "go to sign-in":

| `reason` | When | phone | web |
|---|---|---|---|
| `missing` | no `Bearer` header | password in place (storage lost the token) | sign-in page (signed out in another tab) |
| `expired` | past `exp`, or past the 90-day cap | password in place | password in place |
| `invalid` | any verify throw (bad signature, malformed, non-JSON, future `nbf`), a failed shape check, no such user, a `sid` ended by sign-out | password in place | password in place |
| `deleted` | `deletedAt` set | sign-out | sign-in page |
| `inactive` | `isActive: false` without `deletedAt` (legacy rows only; login refuses them) | sign-out | sign-in page |
| `password_changed` | `auth_ms` before `passwordChangedAt` | sign-out — **or** in place within 30 minutes of the latest of the prompt coming up, its last use, and its switch to asking for the new password (`keepReauthInPlace`: a reset from the prompt) | same |

The `error` text is what an OLD app shows where it catches the 401 without signing out, so it never
claims a sign-out happened ("Your sign-in has ended. Sign in again to keep going."). Wrong typed
passwords, the share-link password and FbTime's `KEY_*` passthroughs stay non-`SESSION_REVOKED` 401s.

**`requireAuth`'s order** ([middleware/auth.js](../server/src/middleware/auth.js)): no Bearer →
`missing`; `verifySessionToken` (`ignoreExpiration`; ANY throw → `invalid`; a missing `JWT_SECRET` →
503); `sessionClaims` shape check BEFORE any DB read (object; no `purpose`/`kind`; string ObjectId
`sub`; integer `iat`/`exp`; `auth_ms` absent or finite; `sid` absent or a non-empty string);
`User.findById` (a throw → 503); `deletedAt` → `deleted`; `!isActive` → `inactive`; revocation →
`password_changed`; ended `sid` → `invalid`; `floor(now/1000) >= exp` → `expired` (jsonwebtoken's own
rule, applied after the lookup so a deleted account never reads "expired"); the cap → `expired`; then
the `lastSeenAt` stamp and `req.auth = { iat, exp, authMs, hasAuthMs, sid }`. **Server faults are 503
with generic text** (`Sign-in check unavailable. Try again.`), logged server-side — a database blip
answered as a coded 401 would end every session at once. `verifyToken` behaves as before and is still
used by the share-unlock route, whose 24-hour expiry must not widen.

**Extension — `GET /auth/me`.** Adds `token` when `renewalDue` (a day old, or half a short life) AND
not `mustChangePassword` AND at least one active membership in an active organization that isn't being
deleted (`loadMembershipsForUser`) AND not a super admin AND before `authMs + cap`.
The new token keeps `auth_ms` and `sid`. A throw while extending is logged and the response simply has
no `token`. `/auth/me` always sends `Cache-Control: no-store`. Extension writes nothing — never
`lastLoginAt`.

**The cap.** `SESSION_MAX_DAYS = 90`, enforced in `requireAuth` for tokens that carry `auth_ms`. Old
tokens expire on their own `exp`, so a long idle window can't become a mass sign-out at deploy.

**Sign-out.** `POST /auth/logout` pushes `req.auth.sid` onto `User.endedSessionIds`
(`$slice: -200`, `timestamps: false`). The field is `select: false`: `requireAuth` is its one reader
(`.select('+endedSessionIds')`), so up to 200 ids never ride along on member lists or populates. Both
clients call logout fire-and-forget, quiet, before forgetting the token; with no signal it never
arrives, and a write failure answers 503. Either way that session simply runs out.

**Bull board** ([queues/bullBoard.js](../server/src/queues/bullBoard.js)) accepts only its own ticket
(`purpose: 'bullboard'`) from its `bb_token` cookie — never a session token, never `Bearer` or `?t=`.
`requireAuth` refuses the ticket (and share tokens) as sessions.

**The phone** ([mobile/lib/sessionStore.js](../mobile/lib/sessionStore.js),
[sessionEnd.js](../mobile/lib/sessionEnd.js)):

- One promise-chain lock around every token change (sign-in, sign-out, extension adoption, password
  rotation, ended-session handling); `authState.js` wires it to SecureStore and the caches. A renewal
  landing during a sign-out can no longer write the last person's token back.
- `api.js` reports ended sessions itself (several callers swallow the 401), for the session the answer
  was about (`tokenToEnd`: a bare request from a previous session never ends the next one).
- `components/SessionGate.jsx` owns WHEN: the password screen (`ReauthSheet.jsx`) never covers the door
  flow (`CANVASS_FLOW`, now including `/survey-practice/*`); deliberate sign-outs and the forced
  password change are queued until the person is off a door, after in-flight saves settle; "Signing
  out…" covers the cache clears. **Later** appears only after a sign-in attempt failed for lack of
  signal, and collapses the screen into `ReauthNotice.jsx` on the map, books and building screens;
  elsewhere the same failure offers **Go back** when there is a screen to go back to.
- A password change heard while the screen is up keeps it in place only within 30 minutes of the
  latest of: the screen coming up (`raisedAt`), someone last using it (Sign in, Forgot password?,
  Later, Go back, the notice: `touchReauth` stamps `activeAt`), and the screen first switching to ask
  for the new password (`changeHeardAt`, stamped once — a repeat answer about the same change doesn't
  move it). `keepReauthInPlace` → `resetWindowOpen`. A screen left untouched for longer, likely on a
  lost phone, signs out, a screen already asking for the new password included.
- The roster write guard (`cache.js` `setRosterWriteGuard`, checked at write time inside the
  coalescer) keeps a late save from writing the walk list back after a sign-out; a session
  **generation** (bumped on every sign-in and sign-out, never on an extension or a password typed into
  the in-place screen) makes `bootstrapQueryFn` discard a roster that lands after a sign-out or a new
  sign-in.
- `refreshSession` adopts the extended token after saving identity, and saves nothing for a session
  that changed meanwhile. Polls pause while the password is pending.
- A failed roster refresh keeps the houses on screen (the full-screen error is for nothing to show, or
  a final 4xx answer such as an archived campaign). The map and books read the shared `['bootstrap']`
  cache through `useSeatedRoster` (rules in the plain `lib/seatedRoster.js`): `bootstrapQueryFn` tags
  each failure with its campaign, another campaign's roster or failure never shows, and this
  campaign's roster is fetched until it arrives or its own fetch fails. A cancelled refresh is not a
  failure. A sign-in clears every cached query except the store-update check, and a password change
  reruns whatever failed with the old token.

**The web** ([client/src/auth/AuthContext.jsx](../client/src/auth/AuthContext.jsx),
[lib/sessionEnd.js](../client/src/lib/sessionEnd.js)):

- `api/client.js` dispatches `doorline:session-ended` for a live session end; it never clears the token
  itself (that would push every other tab into a sign-out). A request answered with a run-out (or, while
  the prompt is up, a password change or another tab's sign-out) is **held** until the session is back,
  then retried once — the 401 came from the sign-in check, so it never ran: nothing fails under the
  prompt, and a Save clicked at the wrong moment completes after the password. "While the prompt is up"
  is a flag AuthContext sets on every change to it (`setSessionPromptUp`). Polls pause while the prompt
  is up (react-query's `focusManager`); the one poll that runs in the background anyway
  (`refetchIntervalInBackground`) is held with the rest and doesn't stack.
- **The active org is per tab** (`getActiveOrgId()` reads localStorage once, then the tab owns it), so a
  sign-in, sign-out or org switch in another tab no longer re-points this tab's requests — which also
  kept a password reset in another tab from stripping the org from a tab holding edits behind its
  prompt. A reload starts from the org last stored by any tab: an org switch or sign-in there, or a
  tab continuing at its password prompt (`reauthenticate()` writes its org back, below).
- A password changed elsewhere while a tab's prompt is up keeps it in place only within 30 minutes of
  the latest of: the prompt coming up, someone last using it (a sign-in attempt, Forgot password?), and
  its switch to asking for the new password (`keepReauthInPlace` → `resetWindowOpen`, from
  `max(raisedAt, activeAt, changeHeardAt)`, the same rule as the phone); another tab signing out never
  closes a prompt that is up. Tabs that load together accept an answer for the same person even when another
  tab stored its extended token first. The provider decides: the password prompt
  in place (`components/ReauthModal.jsx`, portaled at `z-[60]`, other body children `inert`, Escape and
  Tab caught on window in the capture phase so a drawer underneath never sees them), or the sign-in page
  with `?signedOut=<reason>` (first redirect wins, never off a public page).
- The page-load check is quiet and keeps the token for a run-out (prompt in place, deep link and org
  kept) and for a 5xx/offline ("Couldn't reach Doorline." with Try again / Sign in again); only a
  deliberate end, or an older server's uncoded 401, clears it.
- An open tab extends its sign-in when it comes into view or on a 6-hour look, only if someone used it
  since the token was issued (`renewCheckDue`). A `storage` listener keeps tabs in step: the same
  person's new token closes this tab's prompt, on any page; another person's sends the tab to
  `/login`, which — with that person's token stored — lands it on their home, so it never keeps showing
  the last person's page. On a public page (a reset in progress, a shared report), which must not be
  navigated away from, the tab instead forgets the last person at once (`forgetPerson`: no user, no
  prompt, held requests failed) and loads fresh as soon as it leaves the page. The same check
  (`reconcileStoredToken`) runs on every prompt, user or page change, and right after this tab stores a
  token itself (its own password change or extension), so a prompt never outlives its token; and every
  change to the prompt updates the ref the listeners read at once, not at the next render.
- A run-out never reaches `login()`: `reauthenticate()` continues the session and leaves the active org
  alone (like a reload), so the recorded sign-in rule — typing your password starts you at your home
  ([lib/roles.js](../client/src/lib/roles.js)) — still holds for the sign-in page. `reauthenticate()`
  writes the tab's org back to storage when the tab has one (a tab with none never erases another
  tab's choice), so the tab's next full load starts there too, and continues when another tab signed
  out meanwhile. `login()` fails anything still held for an old prompt and clears react-query's cache
  before the new person loads, so nothing a previous person loaded in that tab (after a sign-out, or
  in a tab that forgot its person) can paint under them: most console query keys name neither the
  person nor the org. `logout()` in a tab that holds no person (it forgot its person, or never had
  one, like a reset link opened in a fresh tab) leaves the stored token and org alone, since they
  belong to whoever signed in elsewhere (the reset page signs out this way).
  `changePassword()` ignores every `password_changed` while the change is on its way (a request the
  prompt held and re-sent carries a token it can't know) — but not while the prompt still holds the
  change back, when such an answer can only be a change made elsewhere — then reruns whatever failed.
- **Sign out buttons go through `useSignOut()`** (exported beside `useAuth`): `logout()` then
  `navigate('/login', { replace: true })`, in one render. A bare `logout()` left `ProtectedRoute` to
  redirect with `from` set, and the sign-in page sent the NEXT person back to the page the last one was
  on. Every in-console Sign out button uses it — the account menu, the narrow-screen menu, Profile, the
  Forbidden screen and the org picker. The password prompt's **Not you? Sign out** instead does
  `logout()` plus a full load of `/login` (ReauthModal.jsx), which has the same effect. A session that
  ends on its own still keeps its page.
- **`switchOrg()` drops the previous org's cached pages** when the org actually changes (keeping the
  platform org list), so every caller — the org pickers, the support prompt, the platform switcher —
  gets it. A team lead's home campaign ([ROLES.md](ROLES.md)) would otherwise resolve against the
  old org's campaign list and read "Campaign not found".

**Tests:** server `test/sessionLifetime.test.js` (unit) and `test/sessionLifetime.int.test.js` (the
HTTP contract, old tokens, the race, the cap, sign-out, bull board); phone
`mobile/lib/sessionEnd.test.js` and `sessionStore.test.js` (every race case); web
`client/src/lib/sessionEnd.test.js` plus `sessionEnd.parity.test.js` (the copy is identical on both
clients).

## Cross-org guards

- **Login-email lock** — `PATCH /admin/memberships/:userId/user` rejects an email change with
  `403 { code: 'MULTI_ORG_EMAIL_LOCKED' }` when the target belongs to ≥2 active orgs and the caller is
  neither the user nor a super-admin. Name/phone still apply. The roster (`GET /admin/memberships`)
  exposes a per-member `user.isMultiOrg` boolean (a global active-membership count ≥2 — never *which*
  orgs) so the UI can disable the email field with an explanation. Enforced in both
  the web person panel's [PersonProfileForm.jsx](../client/src/components/people/PersonProfileForm.jsx) and the mobile
  [users/[id].jsx](../mobile/app/(app)/admin/users/[id].jsx).
- **Link vs create intent — the ORG door still asks; the CAMPAIGN door resolves.** They diverged on
  2026-08-08.

  **`POST /admin/memberships`** (org Users page, `requireAdminRole`) is unchanged: it takes
  `linkExisting` (shared `memberIdentityShape`), and `false` + existing email → `409 EMAIL_EXISTS_USE_LINK`;
  `true` + no account → `404 EMAIL_NOT_FOUND`; `true` + already in this org → `409 ALREADY_MEMBER`. Its two
  surfaces send it and offer the link toggle ([UsersPage.jsx](../client/src/pages/UsersPage.jsx) and the org
  form in [admin/users.jsx](../mobile/app/(app)/admin/users.jsx)), auto-switching the toggle on when the
  server returns `EMAIL_EXISTS_USE_LINK`.

  **`POST /admin/campaigns/:id/crew`** no longer asks for intent. It **still accepts `linkExisting` and
  ignores it** — already-released mobile binaries send it — and resolves the address itself
  (`resolveEmailInOrg`), branching to create / claim / no-op / attach with no second round trip. Both
  409s are therefore unreachable on this route, and the two clients that fed it a toggle
  ([CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx),
  [CreateCanvasserSheet.jsx](../mobile/components/CreateCanvasserSheet.jsx)) have dropped it. Full outcome
  table in [ROLES.md](ROLES.md) → *The lead's crew surface*.

  Letting a **team lead** attach an existing cross-org account (not just create) remains deliberate: a lead
  owns onboarding and a returning canvasser may already have an account from another org. What changed is
  *when* they learn that: the pre-commit lookup answers `outside` for every address that is not already a
  colleague — identical for "no account anywhere", "an account in another organization", and a tombstoned
  address — so identity is revealed only in the success response, after the add has happened, an email has
  gone to the person, and an audit line exists. The older guards still apply (`isMultiOrg` boolean only,
  added-to-org banner on next login).

## Crews (coordinators) — a PER-CAMPAIGN link

A supervisory link scoped to one campaign: **`CampaignAssignment.coordinatorId`**
([CampaignAssignment.js](../server/src/models/CampaignAssignment.js), unique `{campaignId, userId}`,
indexed `{campaignId, coordinatorId}`) → a `User` who is an **active `admin` or `lead` in the same org**.
Distinct from **Efforts**, which partition the *doors/work*; the crew partitions *people*.

It lived on `Membership.coordinatorId` — unique `{userId, organizationId}`, so **one slot per person per
org**. Two leads managing two campaigns with a shared canvasser overwrote each other, and the ledger
re-stamp below then dragged the FIRST campaign's whole history onto the SECOND lead's team, in a race
that lead does not manage. Reproduced end to end before the fix; locked by
[perCampaignCrews.int.test.js](../server/test/perCampaignCrews.int.test.js), which is the first suite to
build **two campaigns in ONE org** (teamAttribution's second campaign is in a different org, so all 22 of
its tests stayed green through the bug and could never have caught it).

**Read at KNOCK TIME ONLY.** `coordinatorForWrite` ([mobile/canvass.js](../server/src/routes/mobile/canvass.js))
resolves the crew for the door's campaign and freezes it onto the new ledger row, with a per-request memo
(a survey submit resolves the team twice — the `SurveyResponse` and its paired activity row must not
drift). It replaced a zero-query read off `req.activeMembership`, which is per-*org* and is exactly what
let two leads clobber each other. **Past attribution is never re-derived from the roster**; that is what
lets a departed coordinator's team keep the doors it supervised, and why hard-deleting the roster row on
campaign removal is safe.

**Endpoints.**

- **Set / clear** — `PATCH /admin/campaigns/:campaignId/crew/:userId/coordinator`, body
  `{ coordinatorId: id|null, fromCoordinatorId?: id|null }`
  ([leadCrew.js](../server/src/routes/admin/leadCrew.js)), mounted behind `requireCampaignManager`
  (org admin, super admin, or a lead granted *this* campaign). The `campaignId` comes from the **URL**,
  which is load-bearing: the gate keys on the same param, so a lead physically cannot address a campaign
  they weren't granted. Taking it from the body would reopen exactly that hole. `404` when the person
  holds no roster row on this campaign — there is no crew there to set. `fromCoordinatorId` is the crew
  the client previewed (checked with `Object.hasOwn`, so an explicit `null` means No crew): when the
  roster says something else by now, `409 { code: 'changed-meanwhile', now }` and the client re-previews.
  Released phones omit it and the server uses the crew it reads. A job still holding the row answers
  `409 { code: 'busy', retryAfterSeconds }`. **Only a new pick is validated**: repeating the current crew
  (the open-time preview, **Finish it**) is not, because switching a coordinator off or changing their
  role leaves their crews in place, and validating would leave those people's unfinished jobs
  unfinishable. Returns `{ ok, coordinatorId, restamp: { changed, activities, surveys, doors, error },
  finished }`.
- **Preview** — `GET …/crew/:userId/coordinator-preview?coordinatorId=<id|none>` returns
  `{ from, to, doors, activities, surveys, subjectRunsCrew, unfinished, busy, retryAfterSeconds, sources,
  finishIt }` from the *same* filter the write uses
  ([restampCoordinator.js](../server/src/services/memberships/restampCoordinator.js)). `doors` is the
  deduped `knocksPipeline` count, not the row count — quoting rows next to the word "doors" would move
  the team row by less than the confirmation promised. `sources` names each team the moving rows count
  for now, newest first (`planSources`, both ledgers). Run with the person's **current** crew, it is what
  the web panel and the phone's member sheet run when they open someone: `finishIt` is true when an
  earlier job was left unfinished, or the person is on a real crew and some of their rows here still
  carry another team. Never for No crew with no job: that is what every departure leaves, and conforming
  it is the 104-door bug.
- **Several people** — `POST …/crew/coordinator-bulk/preview` takes `{ userIds (≤ 500 distinct),
  coordinatorId }` and returns a row per person plus exact, deduplicated `totals` (`bulkPlan`, hinted to
  the campaign indexes). Rows the write would skip say why: `not-on-campaign` (a lead's id off the
  roster, with no name or counts), `not-in-org` (no name), `staff`, `is-coordinator`, `same-crew`, `busy`
  (left out of the totals), and a No-crew pick for someone already on No crew is `same-crew` before
  anything is counted. An org admin also previews people not on the roster (`onCampaign: false`), which
  is how the add from the organization and the phone's Assign all shown show what joining does; someone
  off the roster whose account is deleted or whose membership here is switched off reads `deleted` or
  `switched-off`. An optional `intent` makes the totals exactly what the next write does: `'move'` (for
  Move to crew…) reads anyone off the roster as `not-on-campaign`, and `'join'` (for the add from the
  organization, Assign all shown and the phone's one-person Assign) reads anyone already on it as
  `already-on-campaign`, so a list that went stale while it was open can't overstate the count; every
  client sends one. `PATCH …/crew/coordinator-bulk` takes `{ people: [{ userId, from }] (≤ 10),
  coordinatorId }` and runs them four at a time (`CREW_JOB.sideBySide`); the clients send 10 per request,
  one request at a time, each person with the `from` their preview showed. **The write never puts anyone
  on the campaign**: someone without a roster row by then (removed since the preview, say) answers
  `not-on-campaign`, so a stale list can't undo a removal. Adding is `POST …/assignments`, which checks
  the membership again. A person's `doors` in the preview are deduplicated across teams, like their
  one-person preview.
- **Read-only, org-wide** — `GET /admin/memberships/:userId/crews` returns one row per campaign the
  person is rostered to (`campaignId`, `campaignName`, `campaignIsActive`, `coordinatorId`,
  `coordinatorName`). It feeds the panel's **Everywhere in your organization** section on the web.

**Web UI.** Setting a crew lives on the campaign Team page: one person in the person panel's campaign
section ([client/src/components/people/](../client/src/components/people/): picker → staged change →
[CoordinatorConfirm.jsx](../client/src/components/CoordinatorConfirm.jsx) → commit), several people in
**Move to crew…** ([client/src/components/team/](../client/src/components/team/)). Neither is gated on
the member's active state: a deactivated-but-rostered person's crew must stay settable, which is what
makes the ~1,700 doors sitting in "No team" on a live org — knocked by people since switched off —
recoverable at all. When doors would move, `CoordinatorConfirm` also asks `GET
/admin/client-reports/series/affected?campaignId=&coordinatorIds=` (every source and target coordinator
the move touches, so a move out of several teams or a Finish it names each) and names the client-report
teams it answers, active teams whose current or past crews include them and that already have a report:
"This also changes the numbers in the Paid team client report(s)." Labels only; a failed check just
leaves the line out ([CLIENT_PORTAL.md](CLIENT_PORTAL.md) §H). The phone's member sheet
([MemberSheet.jsx](../mobile/components/MemberSheet.jsx)) and the Users hub's **Move all shown to a
crew…** ([users.jsx](<../mobile/app/(app)/admin/users.jsx>)) use the same previews and writes but never
call it: the phone doesn't load client reports ([ADMIN_APP.md](ADMIN_APP.md)). The Users page shows crews
read-only, in the shared panel's **Everywhere** section from `/crews` (the old `UserProfileModal.jsx` and
its **Crews** block were replaced by the panel on 2026-10-27);
[UsersPage.jsx](../client/src/pages/UsersPage.jsx) has no Coordinator column, coordinator filter or
add-member coordinator field.

**Reports ARE team-scoped — but NOT through `baseFilter`.** `?coordinatorId=<id|none>` on
`/canvasser-timeline`, plus `GET /admin/reports/team-breakdown` (every team at once, with the
reconciliation). The team lives on the **ledger** (`CanvassActivity.coordinatorId`), not on the
roster — a roster join is what used to lose a canvasser's doors the moment they were taken off a
campaign.

**The lead set is derived from the LEDGER, scoped to the campaign.** `leadIdsForScope(scope)`
([reports.js](../server/src/routes/admin/reports.js)) = the distinct non-null `coordinatorId` on
`CanvassActivity` ∪ `SurveyResponse` in that scope — who folds onto their own team row via
`teamFoldStage`, and who the "No team" bucket must therefore exclude. Both obvious alternatives are
wrong now: **`Membership`** has no campaign and would fold a lead's doors onto their own team in
campaigns where they run no crew at all; **`CampaignAssignment`** is a roster gate that is hard-*deleted*
on removal, so a lead would lose their own folded doors the moment their last crew member came off the
roster — the 104-door bug through the back door. The stamp already on the ledger cannot be un-said, so it
survives departure, org removal and roster churn. [auditTeamCounts.js](../server/src/migrations/auditTeamCounts.js)
imports the identical derivation and fold; an audit that can be wrong in a *different* way from the thing
it audits is worse than no audit.
**Consequence, and it is real:** somebody who runs a crew in campaign A but knocks in campaign B without
one no longer folds onto their own team in B — they land in B's "No team", which is the correct
per-campaign answer.

**Every write of `CampaignAssignment.coordinatorId` goes through
[`setCoordinator.js`](../server/src/services/memberships/setCoordinator.js)**, as **one job per change,
kept on the roster row** (`CampaignAssignment.crewJob: { token, run, until, from, to, sources, activities,
surveys, doors, byUserId, source }`, `default: undefined`). There is no transaction to lean on (the test
harness is a standalone mongod), so a change can be cut off halfway and two changes to one person can
interleave; the job is what makes both safe:

1. **Plan** — what would move toward the new crew, by source team, on both ledgers. No writes.
2. **Claim** — one conditional `updateOne` on the app clock: the roster still says `from` and no job
   holds the row (`'crewJob.until': { $not: { $gte: now } }`). It sets the crew and the job (`token` = the
   `CoordinatorChange` `_id`, `run` = a UUID per attempt, a **150 s** hold). It writes the roster *first*
   on purpose: knocks from then on stamp the new team, and a failure leaves a finite, shrinking drift
   rather than one every later knock adds to. A lost claim is the 409 above.
3. **Ledger** — `restampLedgerCoordinator` on each ledger, every `updateMany` capped at `maxTimeMS`
   60 s and preceded by a renewal of the hold filtered on `token` and `run`. A renewal that misses, or
   comes back after more than 30 s, means the job lost its hold and stops without writing. Then a
   **second pass** ~2 s later catches a knock that read the old crew just before the claim — only when
   the claim changed the crew and the person has rows (a join skips it unless it joins a real crew and
   the person is an org admin or staff, the only people who knock off-roster).
4. **Record and release** — the `CoordinatorChange` upserted on `{ _id: token }` with the planned counts,
   `doorsMoved` and `sources`; then `$unset crewJob`, matched on `token` and `run`.

A run cut off anywhere leaves the job on the row. Its hold runs out by itself and the person's panel
then offers **Finish it** (the same PATCH, with the current crew as both pick and `from`), which re-runs
steps 3-4 under a fresh `run` and closes older open error records with `finishedBy`. A lost hold or an
interrupted job writes its record **insert-only** (`$setOnInsert`, with `createdAt`/`updatedAt` set
explicitly and timestamps off), so a late finisher can never overwrite a newer job's record. The web
server's driver waits at most 30 s for a pooled connection (`waitQueueTimeoutMS` in `server.js`), which
keeps a renewal, its write and one ledger write inside the hold. A no-op re-pick is completely silent —
no write, no audit row, or the log stops being able to answer "why did this team's number move?" — and so
is a bare No-crew repeat.

**Joining a campaign is the same job** (`joinCampaignCrew`): the roster insert *is* the claim, with
`crewJob` in `$setOnInsert` only when the person has rows to move, so the second of two simultaneous
adds inserts nothing and moves nothing. If planning throws, it falls back to a plain insert. Its callers
are the add by email (`POST …/crew`), the add from the organization (`POST /admin/campaigns/:id/assignments`,
four at a time) and the two book routes (`ensureCampaignAssignments(…, { join: true })`; only org admins,
the campaign's leads and internal staff get that far without a roster row). Every other writer of a roster row's crew — `releaseAssignedWork`,
the demo seeder, `migrateCampaignCoordinators` — also clears `crewJob`, so a job on a row always names
the row's current crew; a job whose row changed under it stops at its next renewal.

`test/coordinatorChokePoint.test.js` asserts structurally which files may write the field:
`setCoordinator.js`; [`deleteAccount.js`](../server/src/services/users/deleteAccount.js) — **the
sanctioned exception**, since departure must never touch the ledger or the 104-door bug returns —
[`migrateCampaignCoordinators.js`](../server/src/migrations/migrateCampaignCoordinators.js) (roster only,
never the ledger) and `seedDemoOrg.js` (writes roster and ledger in the same run from one crew map, so
there is no pre-existing history to re-stamp). `leadCrew.js` came off the list on 2026-10-27: its create
path now calls `joinCampaignCrew`. Drift and unfinished jobs are listed by `npm run audit:team-counts`
and fixed with Finish it; `repair:team-stamps` keeps only its switch for an org's team surfaces.

**`restampFilter` REQUIRES a `campaignId` and throws without one.** Required rather than
optional-with-a-default, because an omitted scope silently meaning "everything" *is* the bug this change
removes. `organizationId` and `userId` are required for the same reason (a cross-tenant write). The rule
it implements is now: *the current coordinator owns all of that canvasser's history — all time, in this
campaign.* Changing a crew in campaign A moves zero doors in campaign B.

**`CoordinatorChange`** ([model](../server/src/models/CoordinatorChange.js)) gained a **nullable**
`campaignId` (`null` = a row written under the old org-wide model, which must stay readable) and an index
`{campaignId, createdAt}` — "why did THIS campaign's team move?". Since 2026-10-27 a new record's `_id` is
its job's token, and it carries `sources` (each team the rows came from, with counts), `doorsMoved` (the
deduped door count the check showed), `run` and `finishedBy` (the later record that finished it); `source`
adds `campaign_join`. All additive: old records read as before, and the History feed folds them for
released phones (`fromCoordinator` reads *Several teams* when there was more than one source).

> 🚨 **Do NOT "mirror the effort scoping" by adding the key to `baseFilter()`.** An earlier version of
> this doc recommended exactly that, and it is a trap: `baseFilter`'s result is spread into **Household**
> queries (`/overview`: `{ isActive: true, ...cFilter }`), and a household has no team — a door doesn't
> belong to a crew. The key would match zero households and **silently zero out Coverage**. `effortId`
> only survives in `baseFilter` because it *is* denormalized onto `Household`.
>
> Use the opt-in `crewFilter(req)` + `withTeam(match, team)` helpers in
> [reports.js](../server/src/routes/admin/reports.js), spread **only** into `CanvassActivity` /
> `SurveyResponse` matches. `withTeam` composes with `$and` — never spread a `$or` team clause into a
> match that may already carry one (the cross-timezone date windows build one).
>
> Full contract: [METRICS.md](METRICS.md#teams-coordinators--the-counting-contract).

## Campaign roster & assignment gating

- **`CampaignAssignment`** ([server/src/models/CampaignAssignment.js](../server/src/models/CampaignAssignment.js))
  — the per-campaign roster, unique `{campaignId, userId}`. It's the source of truth for **campaign
  membership** (distinct from org `Membership` and from per-walk-list `EffortMember`) and, since crews
  became per-campaign, it also carries `coordinatorId` — see [Crews (coordinators)](#crews-coordinators--a-per-campaign-link).
  Removal from a campaign **hard-deletes** the row, crew and all; nothing that must survive a departure
  may be derived from it.
- **Team page endpoints** ([server/src/routes/admin/assignments.js](../server/src/routes/admin/assignments.js)):
  `GET /admin/campaigns/:id/assignments` returns the roster enriched with each member's `role` +
  `isSuperAdmin` (joined from `Membership`/`User`) so pickers/Team page can render badges, and the
  account's `createdAt` (for *Never signed in* vs *No sign-in recorded*); `POST` (add) / `DELETE /:userId`
  (remove) manage it. `POST` takes `{ userIds, coordinatorId? }` (absent or `null` = No crew; a team lead
  may send only their own id): it reads the roster once and joins everyone not on it through
  `joinCampaignCrew`, four at a time, so their earlier doors here move to that crew. It answers `201 {
  created, total, crew: { set, skipped: [{ userId, reason: 'already-on-campaign'|'unfinished'|'error' }],
  doors, activities, surveys } }`; someone already on the roster is skipped untouched (an add never
  re-crews).
- **Mobile visibility gate** — [bootstrap.js](../server/src/routes/mobile/bootstrap.js) filters a
  canvasser's campaigns to their `CampaignAssignment`s (`assertCampaignAccess`); org admins/super-admins
  bypass and see all.
- **Assignment gate** — `partitionAssignable({campaignId, organizationId, userIds})`
  ([campaignRoster.js](../server/src/services/campaignRoster.js)) returns `{ allowed, notOnTeam }`:
  allowed = already on the roster, **or** an org admin, **or** a team lead holding a `CampaignManager`
  grant on **this** campaign (never "is a lead somewhere" — a grant elsewhere must not open this
  campaign), each only if currently activated; super admins only in an internal org, with a live
  account and no membership needed (`internalStaffIdSet`). In a customer org staff need an active
  membership like anyone else (2026-10-24, PRIVACY_VERIFICATION item 36; see ROLES.md for why). The
  lead branch is new: the check
  matched `role: 'admin'` only, so a lead running a campaign could not put themselves on a book without
  asking an admin to roster them first. Both assign paths use it —
  single-book [turfAssignments.js](../server/src/routes/admin/turfAssignments.js) `POST /` and bulk
  [turfs.js](../server/src/routes/admin/turfs.js) `assign-bulk` — returning `409 { code:'not-on-team',
  notOnTeam }` when nothing is allowed. `EffortMember` pre-staging ([efforts.js](../server/src/routes/admin/efforts.js)
  `POST /:id/members`) applies the same gate but never writes the roster. After a successful assign,
  `ensureCampaignAssignments(…, { join: true })` adds any admin or lead assigned on the fly to the roster
  (a no-op for existing members), so self-assign grants mobile visibility — and joins them like any
  return, so their earlier doors on the campaign move to No team until their crew is set (the owner's
  rule, 2026-10-26: the doors follow the person, whatever their role). If the join throws, it falls back
  to a plain upsert so the assignment still lands.
- **Client** — the three book pickers and the walk-list RosterPanel source their candidate list from
  the shared [useCampaignTeam(campaignId)](../client/src/lib/useCampaignTeam.js) hook (roster + the
  current admin, so self-assign always works; staff count as the current admin only in an internal
  org, read off the org switcher's cached `/super-admin/organizations` list) instead of the org-wide
  `GET /admin/memberships`. Each
  offers a "＋ Add someone to the team →" link to the Team page ([CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx)).

## In-app "added to org" notice

- New memberships start with `acknowledgedAt: null` → `isNew: true` in the login/`/auth/me` payload.
- Shown on **both web and mobile**, so admins *and* canvassers are notified (the web console is
  admin-only; canvassers only see the mobile app):
  - Web: [AddedToOrgBanner.jsx](../client/src/components/AddedToOrgBanner.jsx), mounted in
    [Layout.jsx](../client/src/components/Layout.jsx), reads `useAuth().memberships`.
  - Mobile: [AddedToOrgBanner.jsx](../mobile/components/AddedToOrgBanner.jsx), mounted as a top overlay
    in [(app)/_layout.jsx](../mobile/app/(app)/_layout.jsx), reads `isNew` memberships from cache.
- Dismiss → `POST /auth/memberships/:membershipId/acknowledge` (scoped to `userId: req.user._id`), which
  sets `acknowledgedAt`. Web flips `isNew` in `AuthContext`; mobile drops it from state and rewrites the
  cached memberships so it stays gone on cold start.

## Automatic pause on the people surfaces

`Organization.pacePause` holds the org's setting — `enabled` (default `true`), `billingAdmins` (default
`true`), `alertUserIds` (`default: undefined`, so it isn't written as `[]`), `enabledAt` (stamped only on
an off → on change), `changedAt`, `changedBy` — always written by **dotted path**, since assigning the
object would wipe its siblings. `GET /admin/pace-pauses/settings` (org admins) returns it with `live` (the
`PACE_PAUSE` switch covers the org), `canEdit`, `openPauses`, and `eligible` (active org admins and leads,
named, with their billing access); `PATCH` needs the admin role **and** `billingAccess` (or a super admin;
`billingAccess` isn't cleared on demotion, so the role is checked too) and takes `{ enabled?,
billingAdmins?, alertUserIds? }` under zod `.strict()` — at most 25 ids, each an active admin or lead.
Since 2026-10-27 the GET also returns `chosen: [{ userId, name, role, eligible }]`, every stored
recipient, so someone who stopped being an admin or lead shows by name as *Not emailed* instead of
vanishing while their stale id made every Save fail; the page saves only eligible ids, which drops them.
Web: [PacePauseSettingsCard.jsx](../client/src/components/settings/PacePauseSettingsCard.jsx) with its
`RecipientPicker` on the **Settings** page (`/settings`, org admins, read-only without billing access;
it moved off `UsersPage.jsx`), the chip from `GET /admin/pace-pauses?status=paused` (blocking pauses
only), and [PacePauseProfileSection.jsx](../client/src/components/users/PacePauseProfileSection.jsx) in
the person panel (`?userId=&status=all`; renders nothing for someone never paused; its Unpause moved to
the panel's state buttons). Phone: the
shared paused list (`mobile/lib/pacePauses.js`) feeds `admin/users.jsx`'s badge and `admin/users/[id].jsx`'s
line ([ADMIN_APP.md](ADMIN_APP.md)). No change to `GET /admin/memberships`.

## Client gating

- Web: `AuthContext` exposes `mustChangePassword`, `changePassword`, `acknowledgeMembership`.
  `ProtectedRoute` redirects to `/change-password` when the flag is set (except the change-password route
  itself, via `allowPasswordChange`). `LoginPage` redirects on the flag; `api/client.js` funnels an
  in-flight `PASSWORD_CHANGE_REQUIRED` 403 to the same page.
- Mobile: `app/index.jsx` redirects to `app/change-password.jsx` when the cached user has the flag.

## The active org (`canvass.activeOrgId`)

The JWT carries **no org claim** — it's org-agnostic. The active org is a client-held value sent as the
`X-Org-Id` header on every request (web: `localStorage` key `canvass.activeOrgId`, set in
[api/client.js](../client/src/api/client.js); mobile: the same key in `AsyncStorage`). On the web it is
read from localStorage once per tab, then held by that tab (see *Sessions*): another tab's org switch,
sign-in or sign-out no longer re-points it. The server resolves and re-authorizes it per request in
[middleware/orgContext.js](../server/src/middleware/orgContext.js), so the client's copy is a
*preference*, never a grant.

Because it **persists**, a bad value used to be sticky: pick an org you have no console role in, and every
reload landed back on the same Forbidden screen until you cleared site data. Two guarantees now prevent
that (see [ROLES.md](ROLES.md) for the full contract):

- **Self-heal.** `AuthContext` clears `activeOrgId` whenever the persisted org is one the user has no
  console role in — demoted, removed, hand-edited, or stale from an older build. Super admins are exempt
  (they legitimately hold an `activeOrgId` for orgs they aren't members of).
- **Auto-select is console-aware.** `autoSelectOrgId` ([lib/roles.js](../client/src/lib/roles.js)) enters
  an org at login only when the user has console access to **exactly one**. The old rule keyed off
  `memberships.length === 1`, which happily auto-selected a *canvasser* org.

**Response codes for recovery.** `ORG_CONTEXT` (403 not-a-member / 404 org-gone / 400 bad header) means
"that isn't your org" → both clients drop `activeOrgId` and route to the picker. `FORBIDDEN_ROLE` (403
from any role gate) means "the org is fine, your role isn't" → the web client does *not* eject on it;
mobile uses it to detect a mid-session role change, refetching `/auth/me`
([mobile/lib/session.js](../mobile/lib/session.js)) and re-routing only if the role actually changed.
Mobile otherwise cached memberships at login and never refetched them, so a demoted user kept rendering
admin screens whose every query 403'd onto a dead Retry button.

## Input validation

Member/user fields (and campaign/org/survey fields) validate the same way everywhere via shared Zod
schemas in [server/src/utils/validators.js](../server/src/utils/validators.js):

- `phoneSchema` — US phone: strips to digits, **rejects letters**, stores canonical `(555) 123-4567`
  (optional/empty → `undefined`). Replaced a duplicated inline schema in `memberships.js`/`createMember.js`.
- `usStateSchema` — 2-letter, uppercased, checked against the **real** state set (the exported `STATE_TZ`
  keys in [usStateTimeZone.js](../server/src/utils/usStateTimeZone.js)) — so `"XX"` is rejected.
- `nameSchema` (trim, 1–80), `emailSchema` (`.email()` + max), `slugSchema` (kebab-case, orgs).
- **Two password schemas, by who sets it.** `passwordSchema` (min 8, max 200, **no** complexity, but
  basic hygiene — **no control characters/null bytes and no leading/trailing whitespace**, a copy-paste
  footgun) gates admin-set **temporary** passwords (create-user, admin reset, create-canvasser, super-admin
  provisioning) — the user replaces them at first login, so complexity would only add friction (a simple
  `victory26` passes; `" victory26"` and control chars don't). `strongPasswordSchema` (8+ with an uppercase,
  a lowercase, a number, and a special character, via a shared `passwordProblem` message) gates the
  passwords a user **chooses for themselves** (`POST /auth/change-password`). Both are mirrored in
  [client/src/lib/validators.js](../client/src/lib/validators.js) and
  [mobile/lib/validators.js](../mobile/lib/validators.js): `PASSWORD_RULES` / `passwordChecklist` /
  `isStrongPassword` drive the strong live checklist, and `tempPasswordProblem` / `isValidTempPassword`
  pre-validate the relaxed create/reset fields — so both agree with the server (which stays the real
  guard). The two masked-with-toggle password inputs live at `components/PasswordInput.jsx` on each
  client; every password field uses it (a couple of create-canvasser fields that once rendered the
  password in cleartext were switched over).

The **server is the authoritative guard**; the clients mirror it for UX only — plain-JS helpers in
[client/src/lib/validators.js](../client/src/lib/validators.js) power the reusable
[PhoneInput](../client/src/components/ui/PhoneInput.jsx) (auto-format) and the campaign **State** dropdown
(`US_STATES`), and [mobile/lib/validators.js](../mobile/lib/validators.js) formats the phone field on
mobile. No new dependency, and **no migration** — phone is display-only contact info (new writes are
normalized; old values format best-effort). Locked by
[validators.test.js](../server/test/validators.test.js).

## Account deletion (App Store 5.1.1(v) / Play account-deletion policy)

**Why we owe this at all.** Both stores trigger on **account *creation***, not on having a login. Google's
wording: *"If your app allows users to create an account from within your app, then it must also allow
users to request for their account to be deleted."* Our mobile binary creates accounts — the admin
`CreateUserForm` in `admin/users.jsx` and the crew endpoint in `admin/campaign-assignments/[campaignId].jsx`
— so the trigger fires. Apple additionally forbids the support-flow substitute: *"Apps not operating in
highly regulated industries should not require people to make a phone call, send an email, or go through
other support flows."* Canvassing is not a regulated industry.

**Deletion is a scrub-in-place, not a row removal — and that is forced by the schema, not chosen.**
`CanvassActivity.userId`, `SurveyResponse.userId`, `FlagReview.reviewedBy` and
`HouseholdLocationChange.userId` are all `required`, so the `User` document **cannot** be removed without
destroying the knock ledger — and that ledger is what campaign counts and the invoice are computed from.
`knocksPipeline` groups on `{householdId, passId}` and **never joins `User`**, so a scrub provably cannot
move a bill. Every per-canvasser report LEFT-joins `User` with a null-safe fallback, so rows go *nameless*,
never missing.

| Field | Meaning |
| --- | --- |
| `User.deletedAt` | Terminal. Checked in `requireAuth` (`401 SESSION_REVOKED`, reason `deleted`) **and** at login. Deletion also sets `isActive:false`, and nothing else does today: the admin Deactivate and Remove actions are **per organization** and change the `Membership`, never the account, so a removed person keeps their sign-in and their other orgs (they simply stop being extended once no organization is left). Older rows may still carry `isActive:false` from pre-multitenancy code; `requireAuth` answers those `inactive`. Apple: *"only offering to temporarily deactivate or disable an account is insufficient."* |
| `User.deletionLocked` | The App Review / Play reviewer demo login. A reviewer **will** press the button — that's what 5.1.1(v) asks them to test — and an unguarded delete would destroy the demo tenant and leave the *next* submission unreviewable. |
| `DeletedUserRecord` | The identity snapshot. See below. |

**`requireAuth` is the revocation.** The JWT is stateless — 30 days idle, extended while used up to 90
days from the typed password ([tokens.js](../server/src/services/auth/tokens.js); see *Sessions* above)
— but `requireAuth` loads the user from the DB on **every** request, so refusing a `deletedAt` user there
kills the session immediately rather than whenever the token would have run out.

**The fraud-audit problem, and `DeletedUserRecord`.** Scrubbing the `User` row satisfies the stores but
destroys the only join key the GPS audit has: `flagDetection` resolves a flagged canvasser through
`User.firstName/lastName/email`. Without a snapshot, a canvasser could fabricate a day of *billable* doors,
delete their account, and leave the org holding a GPS trail it cannot attach to anybody — then rejoin under
the freed email with a clean flag history. **The flagged rows survive a scrub; the attribution is what
dies.** So we snapshot identity **before** scrubbing, org-scoped, with a bounded and disclosed retention
window (`DELETED_IDENTITY_RETENTION_DAYS`, default 180). Both stores permit this — Play names *"security,
fraud prevention or regulatory compliance"* outright; Apple requires retained data be disclosed — and the
deletion sheet, the public page and the privacy policy all say so in the same words.

**The one name frozen as text.** Every surface names a person from their account id at read time, so the
window ends everywhere at once — except a Door Outcomes run's `scopeSummary` (ReclassifyRun,
SurveyConversionRun, UnknockRun, AnswerEditRun), a line frozen at creation that puts the filter's canvasser
first ([scopeSummary.js](../server/src/services/canvass/scopeSummary.js) — a name only, never an email,
since 2026-10-20). The purge rewrites that first part to "Deleted user" on every run whose
`selection.scope.userId` is the purged account, per record before its stamp, and once more, each night,
over every record purged before this step existed and every account deleted longer ago than the window
(`User.deletedAt`, the account deletion's own `RETENTION_DAYS`) that no unpurged record holds — an
organization's deletion drops a record once no organization is left on it, though the person's work can
sit in the run lines of another organization that had removed them before they deleted — idempotent,
without touching the runs' `updatedAt`
([scrubFrozenNames.js](../server/src/services/retention/scrubFrozenNames.js); privacy item 32(c), closed
2026-10-20). The job's log line and the console script report the count (`names off run lines`).

**Guards** (all in [deleteAccount.js](../server/src/services/users/deleteAccount.js)): `DELETION_LOCKED`,
`LAST_SUPER_ADMIN`, `LAST_ADMIN`, `LAST_BILLING_ADMIN`. The last two are asked twice: by
`checkDeletionBlockers` before anything is written, and again by a recount of *live* admins and live billing
admins after the person's memberships go off (step 4 of the model below), which refuses — and switches them
back on — rather than strand an org. Both counts are of live accounts only (`deletedAt` checked), the same
definition as [billingGuards.js](../server/src/services/memberships/billingGuards.js).
The billing one matters most: losing the last `billingAccess` admin means nobody can pay the subscription,
and the entitlement gate drives the whole org read-only when it lapses — **no deletion, by anyone, may
financially suspend a customer.**

**The offline queue is a live hazard.** [offlineQueue.js](../mobile/lib/offlineQueue.js) *holds* every 401
(a session problem, never a verdict on the knock) but *drops* any other 4xx so one bad submission can't wedge
the queue forever. The moment the account dies, every unsynced knock 401s with reason `deleted` and is
held on a phone whose account can never sign in again: it can only go up under whoever signs in next on
that phone, and it is real, billable field work.
`DeleteAccountSheet` therefore **flushes first and refuses to delete while anything is still pending**. Do
not weaken that. **Every other door deletes from somebody else's device**, so nothing can flush the
person's phone first: for any `used` account the org door's review asks the admin to have them open the
app with signal (the stronger variant when the profile's `lastActivityAt` is within 7 days), and until
the phone clean-up ships after Election Day
([PROPOSAL_ADMIN_ACCOUNT_DELETION.md](PROPOSAL_ADMIN_ACCOUNT_DELETION.md) §E2) a deleted account's
leftover items still go up under the next sign-in on that phone. A **deactivated**
person's items are not held but dropped: with no active membership their writes answer `403 ORG_CONTEXT`
([orgContext.js](../server/src/middleware/orgContext.js)), not a 401, and the queue drops any non-401 4xx.

**Two `required` traps** worth stating, since both fail *silently* the wrong way:
`passwordHash` cannot be cleared (a `.save()` throws; a `$set: null` slips past the validator and then makes
`bcrypt.compare(plain, null)` **throw**, turning a clean 401 into a 500) — burn it to an unusable random hash
instead. And `email` is `unique`, so the tombstone must embed the user id (`deleted+<id>@…`); a single shared
constant would `E11000` on the **second** deletion, surfacing as a misleading "Email already exists" 409.

**Re-hiring gives a new `_id` on purpose.** Scrubbing releases the real email, so a returning person is a
*new* `User`. Their old knocks stay bound to the tombstone — re-hiring must not quietly re-attach someone to
a flag history they deleted.

**Surfaces.** `GET /auth/account/deletion-check` (blockers + retention copy) and `DELETE /auth/account`
(re-authenticated with the current password). Mobile: `components/DeleteAccountSheet.jsx`. Web:
`/delete-account` — **public, no login** — which Google requires *in addition to* the in-app path, because
*"some users may have already uninstalled your app."* Declared in Play Console under **App content ▸ Data
safety ▸ Data deletion**. The privacy policy's `#delete-account` anchor is load-bearing for the same reason;
don't rename it.

Locked by [accountDeletion.int.test.js](../server/test/accountDeletion.int.test.js) (8/8), which asserts the
things that protect the business, not just the stores: billable knocks unchanged across a deletion, the
already-issued token dead immediately, a sole admin/bill-payer blocked, the reviewer account untouchable, and
a deleted canvasser still selectable on the campaign map with her GPS trail resolvable to a real person.

**Bonus fix shipped alongside.** `DELETE /admin/memberships/:userId` never released `TurfAssignment` or
`EffortMember` — so removing someone from an org left them still holding their books: the doors never
resurfaced as unassigned and the effort readiness rollup still counted them as crew. Both paths now share
`releaseAssignedWork`.

### The deletion model (every door, since 2026-10-24)

Four doors call one `deleteAccount()`: the person (`DELETE /auth/account`), the platform page
(`DELETE /super-admin/users/:userId`, break-glass), the CLI (`npm run delete:account`), and the org door
below. One rule: **one deletion at a time per account; only membership changes before the account dies,
and those are undone on refusal; everything else afterwards, idempotent, keyed by `userId`, and finished by
a sweep if a crash interrupts it.** There are no Mongo transactions here, so every step is a conditional
write or a compensating recount:

1. **Blockers** — `checkDeletionBlockers`, or the org door's `reviewOrgDeletion`, which its route runs
   first (`reviewed: true`).
2. **The lock is the pending `DeletedUserRecord`** (`claimDeletionLock`). It is inserted with
   `$setOnInsert` — `pendingAt`, `pendingToken`, the name (blank for an unused account), `reason`,
   `deletedBy`, `unusedOrgId`, `touchedMemberships: []`, `finishedAt: null` — or an existing record is
   claimed only when it is **not finished** and not held by a live attempt (`pendingAt` null, or older than
   `LOCK_STALE_MS`, 10 minutes), its shape reset. A finished record is never claimable. Anything else
   answers `409 DELETION_IN_PROGRESS` ("A deletion of this account is already under way. Try again in a few
   minutes.") on all three routes. A refusal from here on deletes the record only by its own
   `pendingToken`. Every lock field is declared on the schema: `strictQuery` drops an undeclared path from a
   filter, which would then match every record.
3. **The burned password hash**, precomputed (bcrypt), so the window from the last re-check to the gate is
   a single write.
4. **Memberships off, one row at a time**, each id written onto the lock's `touchedMemberships` first; then
   the recount for each org touched — an admin row with no live admin left → `LAST_ADMIN`, a billing-admin
   row with no live billing admin left → `LAST_BILLING_ADMIN` — and the org door re-asks
   `OTHER_ORGANIZATION`. A refusal switches those rows back on and releases the lock; two admins deleting
   each other both refuse rather than strand the org. Any other error between the lock and the gate does
   the same, so a retry isn't locked out for ten minutes.
5. **The gate**: one `User.findOneAndUpdate({ _id, deletedAt: null, …(unused ? { lastLoginAt: null } : {}) },
   { $set: <the scrub> })`. On no match: deleted by something else → `ALREADY_DELETED` (the record is left
   for the sweep); still live (an unused-account deletion whose target just signed in) → undone,
   `USAGE_CHANGED`. A gate write that errors but landed is finished at once.
6. **`finishDeletion(userId)`**, idempotent, which the sweep also calls: `organizationIds` = every org with
   a membership in **any** status, plus the orgs of the person's own `CanvassActivity` (desk marks,
   `via: 'bulk'`, excluded — their `userId` is whoever pressed the button) and `SurveyResponse` rows, by
   `userId`-only aggregates; every membership `isActive: false, billingAccess: false` (an unused account's
   row in the deleting org deleted outright); `releaseAssignedWork(userId)`; the FbTime links'
   `fbtimeEmail` nulled; the account's own email-log rows scrubbed ([EMAIL.md](EMAIL.md)); and the record
   stamped `finishedAt`, with the name from the scrub's pre-image (blank when `unusedOrgId`),
   `organizationIds`, `deletedAt`, `retentionUntil`, `purgedAt: null`, `reason`/`deletedBy` only on insert,
   and the lock fields and any legacy `email`/`phone` unset.

The widened `organizationIds` applies to **every** door, self-deletion included: deactivated memberships
and former organizations whose ledgers carry the person now get the name for the window too (it was only
the memberships active at deletion).

`reason` is fixed by the lock claim:

| Who deleted | `reason` | Users-list `how` |
|---|---|---|
| The person themselves | `self` | `self` — "Deleted their own account" |
| The CLI | `operator` | `support` — "Deleted through Doorline support" |
| The platform page; staff under a grant; staff in an internal org without a membership | `super_admin` | `support` |
| A customer admin, or a staffer acting as this org's own admin member | `org_admin` | `admin` — "Deleted by Alex Kim" |

**The sweep** is `sweepDeletionLocks`: every 15 minutes as the `deletion-lock-sweep` job (at :07, :22,
:37 and :52, override `DELETION_SWEEP_CRON`; registered in `MAINTENANCE_JOBS`, never `REPEATABLE_JOBS`,
which stays retention-only for the health banner), and again as the first step of the nightly
`purge-deleted-identities` run, which records its counts on its `RetentionRun` (`deletionsFinished`,
`deletionsReleased`, `liveRecordsDeleted`, `legacyRecordsFinished`, `emailRowsRescrubbed`, `skippedLive`;
failures fold into `failed`). The 15-minute job writes no run of its own. "Deleted" means `deletedAt` is
set **or** there is no User document. A record pending for more than ten minutes: account deleted →
`finishDeletion`; still live (the attempt died before the gate) → its `touchedMemberships` switched back
on and the lock deleted by its token. A record neither pending nor finished predates the lock: on a
deleted account it is stamped finished (unclaimable for good); on a live one it is deleted, conditioned on
`{ _id, pendingAt: null, finishedAt: null }` so it can't race a fresh claim. Accounts deleted in the last
7 days get the email-log scrub again, for mail logged after it ran. The purge itself then **skips, and
counts (`skippedLive`), any due record whose account isn't deleted**: its FbTime step deletes links and
must never run for a live account ([OPERATIONS.md](OPERATIONS.md)).

### The org door: an admin deletes a member

```
GET    /admin/memberships/:userId/deletion-check   requireAdminRole
DELETE /admin/memberships/:userId/account          requireAdminRole   body { confirmEmail, expectKind }
```

[memberships.js](../server/src/routes/admin/memberships.js). Guards, in order: `requireAdminRole` (a lead
gets `403 ADMIN_ONLY`), `ensureOrgScoped`, `isValidObjectId` (400), `refuseVendorStaffTarget` (a
grant-holder targeting a staff account: `403 STAFF_SELF_MINT`), and `addAuditSubjects(res, 'user', userId)`,
so a grant-holder's call is logged naming the account. Then **`reviewOrgDeletion`**
([deleteAccount.js](../server/src/services/users/deleteAccount.js)) — one function for the preflight and
the DELETE, so the review the admin read and the rule the server enforces are the same code. It throws
`NOT_A_MEMBER` (404, the identical body for an unknown id and for a member of another org) and
`ALREADY_DELETED` (409). Otherwise its checks run in this order, the first refusal ends them, and each
comes back as a **blocker** `{ code, message }` whose message names the remedy (on the preflight, `200`
with `canDelete: false`):

1. **Who's asking**, in `orgContext`'s order. A super admin with a membership here: an admin one → this
   org's admin (`reason: org_admin`); any other role → `ADMIN_ONLY`. In an internal org without a
   membership: allowed (`super_admin`). Under a support grant (`super_admin`): support tier → unused
   accounts only (`BREAK_GLASS_REQUIRED`); break-glass → any. A non-staff caller with `deletionLocked` (a
   store review login) → `REVIEW_LOGIN`.
2. `SELF`, then `STAFF_ACCOUNT` (the target is a super admin).
3. **`OTHER_ORGANIZATION`**: `Membership.exists({ userId, organizationId: { $ne } })`, **any status**
   (owner decision 2026-10-24). When it fires the response is that one blocker and nothing else — no name,
   id or count of the other org, and no `usage`.
4. **`BILLING_TARGET`**: the target's membership here has `billingAccess` and the caller is a customer
   admin without it.
5. `checkDeletionBlockers` restricted to this org and phrased about the person (`DELETION_LOCKED`,
   `LAST_ADMIN`, `LAST_BILLING_ADMIN`); no blocker carries an `organizationId`.

Otherwise the preflight answers `{ canDelete, blockers, confirmEmail, kind, usage, holding }`:

- **`usage`**, this org only: `signedIn` = `!!lastLoginAt` (`lastSeenAt` stays super-admin-only);
  `fieldRecordsHere` (this org among the person's own ledger orgs, desk marks excluded — `userId`-only
  `distinct`s, the org compared in code, so no other org's rows are read); `fbtimeHours`; `crew { people,
  campaigns }` (roster rows on this org's campaigns whose `coordinatorId` is the person); `wasCoordinator`
  (a crew now, a `CoordinatorChange` from or to them, or a legacy `Membership.coordinatorId`).
- **`kind`**: `'unused'` only when the account was created on or after `CLOCKS_RELIABLE_FROM` (2026-05-15,
  a week after `lastLoginAt` shipped) and every `usage` value is false or zero; otherwise `'used'`.
- **`holding`**: campaign rosters, active-round books `{ soleHolder, shared }`, effort crews, lead grants,
  `membershipActive`, `retained: { days }`.

The clients take the door-result count (`doorsKnocked + restricted`), the survey count and the sync line's
`lastActivityAt` from the profile's existing `GET /:userId/stats`.

**The DELETE**: a blocker → `409 BLOCKED { blockers }`; `confirmEmail` not equal to the account's email
(trimmed, case-insensitive) → `400 confirm-email-mismatch`; `expectKind` ≠ the review's `kind` →
`409 USAGE_CHANGED` (both clients go back to the review); then `deleteAccount(userId, { reason, deletedBy,
org: { organizationId, unused }, reviewed: true })` → `200 { ok, deletedAt, kind, released }`, or its own
`409 DELETION_IN_PROGRESS`, `ALREADY_DELETED` or `USAGE_CHANGED`. An **unused** account's membership row
in this org is deleted, so it leaves the Users list; a **used** one stays as a tombstone row. The log line
is `[user-delete] <actor id> deleted account <id> in org <org id> (<kind>)` — ids, never an address.

**Tombstone rows.** `GET /admin/memberships` gives each deleted account's row `deletion: { at, how, byName }`
— `null` while there is no record or it is still pending, which reads "Deleted account". `how` comes from
the record's `reason` (table above; anything else → `unknown`, "Deleted <date>"). `byName` is filled only
for `how: 'admin'`, and only when that admin has a membership, in any status, in the organization viewing
the row and a live account of their own — otherwise "Deleted by an admin", so a link that raced the
deletion into another org never shows that org's admin by name. A deleted row's `user.email` is still the
tombstone address; neither client displays it. The web keeps **Remove from org** on the row; the phone
shows only the header and the deletion line, and `MemberSheet` hides temp password, Resend invite, Assign
and Reactivate.

**Remove from org needs billing access for a billing-access member.** `DELETE /admin/memberships/:userId`
on a membership with `billingAccess` answers `403 BILLING_ACCESS_REQUIRED` ("Only an admin with billing
access can remove this person.") to an org admin who lacks billing access. Without it, Remove followed by
re-adding the same email would quietly clear the flag — the deletion rule's back door. Staff are exempt,
and so is a **deleted** account's row (anyone may tidy a tombstone, and accounts deleted before this
shipped never had the flag cleared). The clients hide Remove and Delete on a live billing-access row from
a viewer without billing access (`isSuperAdmin || activeMembership.billingAccess`).

**No door leaves an org without a live admin.** Remove from org, a demotion (`PATCH /:userId` with a
non-admin `role` or `isActive:false`) and `/deactivate` re-count LIVE admins after their write and undo
one that reached zero (`409 LAST_ADMIN`, `LAST_ADMIN_ERROR` in `billingGuards.js`), the same post-write
backstop billing access has. With account deletion two admins can take each other out from two doors at
once (one deleting, one removing); a staff actor can no longer remove, demote or switch off an org's only
admin either.

**No write lands on a deleted account.** Eleven writers used to read `deletedAt` and then write, or never
check it. Each is now safe one of three ways:

- **Conditional on `deletedAt: null`:** the login and `lastSeenAt` stamps (one helper,
  [sessionStamps.js](../server/src/services/auth/sessionStamps.js)), `PATCH /auth/me`,
  `POST /auth/change-password` and `issuePasswordResetToken` (which then returns no link, and every caller
  skips its email). The two self routes answer `401` reason `deleted` on no match.
- **Conditional, answering `409 ACCOUNT_DELETED`:** `PATCH /admin/memberships/:userId/user` and
  `/:userId/password`.
- **Re-read after the route's LAST write and converge** (`convergeIfDeleted`: the membership back to
  `isActive: false, billingAccess: false`, the person's `CampaignManager` grants in the org deleted, and the
  roster row the write added) — never a snapshot restore, which brought back the very admin role and
  billing flag the deletion had just removed: `PATCH /admin/memberships/:userId` (which also refuses a
  tombstone up front), `/reactivate`, the crew `/reactivate`, the crew add's inline reactivation and roster
  upsert, and `createOrgMember`'s link.

**Paused organizations.** The DELETE, Remove from org and both Deactivate doors pass the entitlement gate
in a read-only org; nothing that turns access back on does ([BILLING.md](BILLING.md) → *The gate*, rule 4).

**Names on the promised screens.** Eight lookups that read the scrubbed account row now go through
`hydrateCanvassers`, which restores a deleted person's name from the record for **the request's org only**
(the record's `organizationIds`) and blanks their email: the GPS audit's canvasser and reviewer
([AUDIT.md](AUDIT.md)); the Coordinator label on the leaderboard and the Timeline
(`ledgerCoordinatorLabels`, which now takes the org); `/team-breakdown` and `/tag-teams` team names;
`/canvassers/:userId/summary` and `/responses`; `/voters-by-answer.csv`'s canvasser columns; and the
canvasser CSV's crew stamp (`crewStampLabel`) — team names through one `teamNamesOf` in
[reports.js](../server/src/routes/admin/reports.js). `hydrateCanvassers` restores nothing when handed no
org (fail closed). About 45 other lookups (`.populate()` and plain `User.find`: the map, door history, the
response detail, the Notes hub…) still print "Deleted user" at once, left for a follow-up. The record is no
way in: the per-person drills still answer only for people the org, or a lead's campaigns, carries
(`orgCarriesUser` / `campaignsCarryUser`). Pinned by
[deletedUserNames.int.test.js](../server/test/deletedUserNames.int.test.js); the deletion itself by
[orgAccountDeletion.int.test.js](../server/test/orgAccountDeletion.int.test.js).

**Clients.** Web: the person panel's [PersonActions.jsx](../client/src/components/people/PersonActions.jsx)
(**More options ▸**, closed on every open) and [PersonPanel.jsx](../client/src/components/people/PersonPanel.jsx)
(the guarded close: Escape, the scrim and × wait while the delete dialog is open; this replaced
`UserProfileModal.jsx` on 2026-10-27), [DeleteMemberDialog.jsx](../client/src/components/DeleteMemberDialog.jsx)
(the two steps) and [UsersPage.jsx](../client/src/pages/UsersPage.jsx) (the Deleted pill, the deletion
line, the page notice), every sentence built in [lib/memberDeletion.js](../client/src/lib/memberDeletion.js).
Phone: `admin/users/[id].jsx`, [DeleteMemberSheet.jsx](../mobile/components/DeleteMemberSheet.jsx) and
[MemberSheet.jsx](../mobile/components/MemberSheet.jsx), copy in
[lib/memberDeletion.js](../mobile/lib/memberDeletion.js) — see [ADMIN_APP.md](ADMIN_APP.md). Both offer
the option only when `isOrgAdmin` (phone: the admin or super role), not on oneself, a deleted account or a
staff account, and not on a billing-access member to a viewer without billing access — a display gate; the
server decides. Both read a failed DELETE the same way (`afterFailedDelete`, `reloadNote`, `goneNotice` —
held word for word by `client/src/lib/memberDeletion.parity.test.js`): a stale review or a block goes back
to a reloaded review with the reasons on top; a lost answer (`ALREADY_DELETED`, or `NOT_A_MEMBER` for an
unused account whose row went with the delete) closes as after a success; no answer reloads the review,
whose preflight finds out. The web dialog owns its stats subscription (a refetch of unchanged stats once
left it stuck on "Checking…"), and a synchronous ref keeps a double click or Enter-plus-click from sending
two DELETEs or closing the dialog mid-delete.

## Releasing work: `releaseAssignedWork(userId, scope)`

The one place that hands back everything a person was holding. Three callers, three scopes —
[services/users/deleteAccount.js](../server/src/services/users/deleteAccount.js):

| Scope | Caller | Releases |
|---|---|---|
| `{}` (global) | account deletion | every org, every campaign |
| `{ organizationId }` | `DELETE /admin/memberships/:userId` (remove from org) | all of that org's campaigns, **plus** `CampaignManager` grants and the legacy org-level `Membership.coordinatorId` links |
| `{ campaignId }` | `DELETE /admin/campaigns/:id/assignments/:userId` (remove from campaign) | **that campaign only** — including the `CampaignAssignment` row, so the crew goes with it |

The campaign scope was the missing one, and it had the *identical* bug the org path had already
fixed: it deleted the `CampaignAssignment` and nothing else, leaving the person holding their books.
Three things make the campaign scope correct, and each is a trap:

- **It must not be the org scope.** All four work models (`TurfAssignment`, `EffortMember`,
  `CampaignAssignment`, `CampaignManager`) denormalize `campaignId`, so the scope is exact. Reusing
  `{ organizationId }` here would strip the person's books in **every other campaign in the org**.
- **The `Membership` coordinator reset is skipped.** `Membership` has **no** `campaignId`, so
  `Membership.updateMany({ coordinatorId: userId })` is inherently org-level. Running it for a
  campaign removal would sever a supervision link that has nothing to do with that campaign. (That
  field is now legacy — see [Models](#models) — but the org/global scopes still clear it, and it is
  the one write the crew choke-point test sanctions outside `setCoordinator.js`, precisely because
  departure must not touch the ledger.)
- **`CampaignManager` is left alone.** The reason is *authorization*, not taxonomy: the route is
  mounted behind `requireCampaignManager`, which passes for **any lead holding a grant on that
  campaign** — cascading here would let one lead revoke another's grant (or their own) from a
  walker-roster button. Revoking a grant stays admin-only, on the Users page.

**It releases across ALL rounds, active and archived.** No history is lost: `CanvassActivity` stamps
`userId`, `passId`, `turfId` and `effortId` on **every knock row**, so *who walked which book in
which round* lives in the ledger. `TurfAssignment` is present-tense "who is supposed to walk this".
Limiting the release to active rounds would in fact **fail to fix the bug** — `efforts.js`,
`campaignSummaries.js` and `setupStatus.js` count assignments on passes of *any* status, so one stale
archived row keeps a campaign reading as "staffed" by someone who is gone.

Locked by [campaignRemoval.int.test.js](../server/test/campaignRemoval.int.test.js) (7/7): a sibling
campaign is untouched, a **co-assigned canvasser keeps the shared book** (`TurfAssignment` is one row
per `(turf, user)`), the `CampaignManager` grant and the org `coordinatorId` survive, **every
`CanvassActivity` row survives**, and org-removal still cascades fully.

Rows orphaned *before* this fix are repaired by
[`repairOrphanedAssignments.js`](../server/src/migrations/repairOrphanedAssignments.js)
(`npm run repair:orphaned-assignments`, dry-run by default) — it finds anyone holding work on a
campaign they are no longer rostered on and hands it back. Idempotent; never touches the ledger.

## Migrations (run at deploy)

`acknowledgedAt`'s `default: null` only applies to *new* docs, so existing memberships would all read as
`isNew` and spam every current member. Backfill them:

```
npm run migrate:ack-memberships          # dry run
npm run migrate:ack-memberships -- --apply
```

It sets `acknowledgedAt = createdAt` for memberships where the field is **absent** (`$exists: false`),
so it never clobbers a genuinely-new unacknowledged membership. See
[server/src/migrations/migrateAckMemberships.js](../server/src/migrations/migrateAckMemberships.js).
`mustChangePassword`/`tempPasswordSetAt` need no backfill (absent → falsy → "not required").

**Account deletion needs no backfill** — `deletedAt`/`deletionLocked` default to `null`/`false`, which read
correctly for every existing user. Two things *do* need doing at deploy:

```
npm run purge:deleted-identities             # dry run
npm run purge:deleted-identities -- --apply  # schedule this daily
```

Without it on a schedule, *"we keep your name for a limited period"* is a promise we don't keep — which is
exactly what a privacy complaint is made of. Heroku Scheduler daily is enough; the window is months.

### Team attribution (`coordinatorId` on the ledger) — a one-time backfill

The scripts live in the server repo, so **the server must be deployed first** — you cannot run them
before the push. That is safe: the schema addition is additive (`default: null`), new knocks start
recording their team immediately, and the team surfaces **refuse to render** until
`Organization.teamAttributionReadyAt` is set, so a single deploy can never show half-migrated numbers.

Run them from the Heroku Run console (which starts at the **repo root** — the root `package.json`
forwards each one to `server/`; see [OPERATIONS.md](OPERATIONS.md#-the-run-console-starts-you-at-the-repo-root-not-in-server)).

```
# 1. deploy, then:
npm run migrate:activity-coordinator -- --preflight   # READ-ONLY. Run this first.
npm run migrate:activity-coordinator                  # dry run
npm run migrate:activity-coordinator -- --apply
npm run audit:team-counts -- --campaign=<id>          # READ-ONLY; exits 1 if anything fails
```

> The trailing `--` is what carries the flag through the root → `server/` hop. Drop it and the flag is
> **eaten silently** — you'd get a dry run and believe it applied. (Verified end-to-end: `--preflight`
> prints PREFLIGHT, no flag prints DRY RUN, `--apply` prints APPLYING.)

- **`--preflight` is read-only and mandatory.** It lists every canvasser who has ever knocked and
  whether a team can still be resolved for them. Deactivation and campaign-removal keep the
  coordinator; **removal from the ORG hard-deletes the `Membership`**, taking the coordinator with it —
  so anyone in that state is unattributable *forever*. Find that out while someone can still say who
  they belonged to.
- **The idempotency key is `{ coordinatorId: { $exists: false } }`, never `{ coordinatorId: null }`.**
  In Mongo `{field: null}` **also matches documents where the field is absent**, so a `null` key would
  re-stamp *deliberate* nulls on the second run — handing a candidate's own doors to a team. The
  migration would reintroduce the bug it exists to fix. (Same reason `migrate:ack-memberships` above
  keys on `$exists: false`.)
- **It stamps TODAY's teams onto ALL history.** No historical record of team membership exists to
  recover. Correct for anyone who never changed coordinators; an approximation for anyone who did. From
  the deploy onward, every knock freezes its own team as it happens.
- **`audit:team-counts` is the gate.** It reconciles every column — doors, survey doors, surveys taken —
  on the live data, prints the per-team rows, and exits non-zero if the arithmetic doesn't close. Run it
  before you quote any team's number to a client. With no flags it audits **every campaign in every org**
  (`--org=<slug>` / `--campaign=<id>` narrow it): campaign ids only exist in the console URL, and a gate
  nobody can run without hunting for ids is a gate that stops getting run. Read the trap below before
  trusting a ✓.

### Crews move to the campaign roster — `migrate:campaign-coordinators`

Seeds `CampaignAssignment.coordinatorId` from the old `Membership.coordinatorId`, so the day after the
migration every campaign answers exactly what the org used to answer — and from then on the answers can
diverge. Same Run-console rules and the same trailing `--`.

```
npm run migrate:build-indexes -- --apply              # CampaignAssignment gained an index; prod is autoIndex:off
npm run migrate:campaign-coordinators -- --preflight  # READ-ONLY. Run FIRST.
npm run migrate:campaign-coordinators                 # dry run
npm run migrate:campaign-coordinators -- --apply
```

- **It writes ONLY `CampaignAssignment`** — not one `CanvassActivity`, not one `SurveyResponse`. That is
  what makes it re-runnable and reversible-by-doing-nothing: every frozen team stamp stays exactly where
  it is, so **no door changes hands as a result of running it**.
- **The idempotency key is `{ coordinatorId: null }` here** — the *inverse* of the ledger backfill above,
  and correct for the opposite reason: an unset roster row means "no crew chosen", never "deliberately no
  crew", because nothing has ever been able to choose one. It also means a crew a lead has already set
  per-campaign is never overwritten by the stale org-level value.
- **`--preflight` names the orphans**: people with knocks on a campaign they hold no roster row for
  (removed from it, or an admin handed a book on the fly). Their history keeps the team already frozen on
  it, so nothing is lost — but there is no row to seed and no future crew change can reach them.
- **`Membership.coordinatorId` is deliberately left in place.** Dropping it is a separate, later step:
  keeping it means that if a per-team row moves unexpectedly, the value it moved *from* is still on disk.
- **Per-TEAM rows CAN move** across this deploy — not from the copy, but because the report's lead set is
  now derived per campaign from the ledger (above). **Campaign totals are team-blind and cannot move.**
  So diff the **per-team rows** against a pre-deploy `audit:team-counts` baseline; the totals will agree
  either way and prove nothing.

> 🚨 **A green reconciliation proves almost nothing. Diff the rows.** The identity `/team-breakdown` and
> the audit print — `Σ teams − crossTeamDoors == campaign billable` — is **arithmetically incapable of
> failing**: `crossTeamDoors = Math.max(0, teamSum − knocks)`, and `teamFoldStage` puts every row on
> exactly one team, so `teamSum >= knocks` always and the check reduces to `knocks == knocks`. The
> **surveys-taken** column is the same shape one level simpler — Σ of `{$sum: 1}` over a partition is the
> total by construction. Only **survey doors** can genuinely fail, and only in one situation: two
> *different* teams surveying the same door-pass (it has no cross-team subtraction to absorb the double
> claim), which makes it an overlap detector, not a proof that any row landed in the right bucket. **A
> wrong bucket is still counted, and no sum check can see a bucket** — which is exactly how the original
> 104-door bug survived. So the verification that actually verifies is the **per-team ROW diff** against a
> pre-deploy baseline, plus the audit's per-canvasser ledger cross-check. Same reason
> `perCampaignCrews.int.test.js` asserts per-row.

And **set `deletionLocked: true` on the App Review / Play reviewer demo accounts before you submit.** If a
reviewer deletes the demo login while testing the delete button, the next submission can't be reviewed.
Note also that prod runs with `autoIndex` off, so the new `DeletedUserRecord` indexes need
`npm run migrate:build-indexes -- --apply`.
