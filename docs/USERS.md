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
to the org you just left.

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

You can also add a **canvasser inline from a campaign's Team page** (the **+ New canvasser** button) —
it creates (or links) the account and puts them on that campaign in one step, on **both** the web console
and the mobile admin app. This inline form is available to **team leads** too (a lead owns onboarding), and
it offers the same **Existing user** link toggle, so a returning canvasser who already has an account can
be added without a duplicate. (It only makes/links *canvassers*; use the Users page for admins/leads.) The
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
  does everything an admin does (import voters, attach a survey, build walk lists, cut turf, run passes,
  assign books, manage the crew, and see the reports / map / timeline). They **cannot** create, archive,
  or delete a campaign, touch the org-wide survey/tag libraries or Users administration, or see any
  campaign they weren't granted. Grant a lead their campaigns on the Users page (set role → Team lead,
  then check the campaigns).
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

**One place: a campaign's Team tab, in the web console.** Open the campaign → **Team** → click the
person → pick their crew. Before anything commits, a confirmation tells you how many of **that
campaign's** doors the change would move, and what it will not touch; you can cancel. Admins can do this
on any campaign; a team lead can on the campaigns they were granted. (The mobile admin app can add and
create people on a campaign, but crews are set on the console.)

The org **Users** page can no longer *set* a crew — it shows them. Open a member's profile and the
**Crews** block lists **one row per campaign** they're on, with the crew they're on there, each row
linking straight to that campaign's Team tab. There is no crew dropdown on the profile, no Coordinator
column or filter on the Users list, and no coordinator field on "Add member": one value on a person's
org profile cannot be true for somebody who is on two campaigns.

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
  console shows you the door count before it commits.
- **Someone who leaves keeps their doors on their team.** Deactivate them, take them off the campaign,
  remove them from the org, delete their account — their doors stay where they belong. **Losing a
  person never moves a number; only a crew change does.** (This used to be broken: the team was read
  from the campaign roster, so removing someone deleted the row the lookup depended on and their doors
  fell silently into "No coordinator" — the bucket admins deliberately *exclude*. On a live campaign
  that under-reported one team by **104 doors**.)
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
  them, **add them back to the campaign first**, then set the crew.

The **Timeline** shows a **by-team breakdown**: every team's doors, survey doors, surveys taken and
connection rate, with a Campaign row that the teams add up to. See
[METRICS.md](METRICS.md#teams-coordinators--the-counting-contract) for exactly how a team's doors are
counted (and what happens in the rare case two teams knock the same house).

**Crews drive book assignment, within the campaign.** Wherever you assign work, people are grouped by
their crew **on that campaign**:

- The campaign **Team** page groups the roster into crews (a section per coordinator, plus "No
  coordinator").
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

Manage it on the campaign's **Team** page (two panes: add org members on the left, the current team on
the right — **click a team member** to open a quick, campaign-scoped panel: their activity in this
campaign, set their crew/coordinator — this is the only place a crew is set — or remove them from the
campaign). A person joins a campaign's team these ways, all equivalent:

1. **Team page → Add** an existing org member — or **+ New canvasser** to create a brand-new person
   straight onto the team (works on the web console **and** the mobile admin app's Assignments screen).
2. **Walk Lists → Manage → Pre-add** — pre-stage someone onto a walk list (also puts them on the team).
3. **Assigning them a book** — an admin assigning a book adds that person to the team automatically.

Because assignment is now **team-only**, the everyday flow is: add people on the Team page first, then
assign their books. **Admins, super-admins and a campaign's team leads are the exception** — they can be
assigned (including themselves) on the fly and are added to the team at that moment, so whoever is
running the campaign can always self-assign a book without a separate step. (A lead's exception is
scoped to the campaigns they were granted, and it is new: they used to be refused, so a lead cutting
turf had to ask an admin to roster them onto their own campaign.) Everyone appears in these lists,
including you — there's no "hide myself."

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
- A temporary password is only good for **72 hours** — after that an admin has to set a new one. This
  applies to a freshly created account too, so have new people sign in promptly.
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
| Name, phone | Shared (one profile) | Any admin of an org they belong to, or a super-admin |
| **Login email** | Shared (it's how they sign in everywhere) | The user or a super-admin only, **if** they're in 2+ orgs |
| Password | Shared | Any of their org's admins (as a *temporary* password) or the user |
| Role | Per-org | Each org's admin (admin / team lead / canvasser) — see [ROLES.md](ROLES.md) |
| Team-lead campaign grants | Per-org (`CampaignManager`) | Each org's admin — which campaigns a lead manages |
| Crew / coordinator | **Per-campaign** (the campaign roster) | An admin, or a team lead on that campaign — points to an admin or team lead in the same org |
| Active / inactive | Per-org (membership) | Each org's admin, for their own org |
| Removed from org | Per-org (membership) | Each org's admin — only removes *their* membership |

The important one: for a person who belongs to **more than one org**, a regular admin **cannot change
their login email** (that would change how they sign into the *other* orgs). The email field is shown
**disabled with an explanation** in that case. Only the user themselves or a super-admin can change it.

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

**Losing a person never moves a number. Reassigning one does** — deliberately. Changing someone's crew
moves *all* of their doors **on that campaign** onto the new team (see
[A team's numbers follow the crew you have set today](#a-teams-numbers-follow-the-crew-you-have-set-today)),
which is what lets you fix a crew you forgot to set. The two are different events on purpose: a
roster change you make moves the numbers; somebody leaving does not. See
[METRICS.md](METRICS.md#teams-coordinators--the-counting-contract).

**A deactivated person can still be put on a crew; a removed one can't.** Deactivating somebody leaves
them on the campaign, so their crew is still settable and their doors still move. Removing them from the
campaign deletes their place on it, and with it the crew field — re-add them to the campaign if you need
to move their doors.

**Their name stays, within limits.** Deactivation, campaign-removal and org-removal all keep the
person's name on reports. **Self-deletion is the exception**: the account is scrubbed (the App Store
requires a real delete), but the org's record of the *work* survives, and a snapshot of the identity
is kept for a **retention window** so an audit can still say who walked which doors. Once that window
lapses the snapshot is purged and their past work no longer directly identifies them (it stays keyed to
an internal account id — de-identified, not anonymous) — that is the intended end state, not a bug.
The snapshot is **name-only**: email and phone die with the account, immediately, on every surface.

**Their books come back.** Whatever they were *holding* is handed back so someone else can take it:

| What you do | What they lose | What comes back |
| --- | --- | --- |
| **Deactivate** their account | Their login, in this org. Reversible any time. | Nothing — they keep their books, because you may well switch them back on tomorrow. |
| **Remove from a campaign** | That campaign only, including their crew there. | Their books and effort-crew places **on that campaign**. Books they hold on *other* campaigns — and their crews there — are untouched. |
| **Remove from the org** | Everything, in this org. | Their books, crews, campaign places and team-lead grants across **every** campaign in the org. |
| **Delete the account** (the person does this themselves) | The account, permanently. | Everything they were holding, everywhere. |

A book can have **several canvassers on it**. Releasing one person leaves everyone else's assignment
exactly where it was — only the departing person's is handed back. If they were the only one on it,
the book simply returns to the pool as unassigned, ready to give to somebody else.

> **Books orphaned by an older version.** Removing someone from a campaign used to release only their
> place on the roster and leave the books themselves assigned to them. If that happened to you, run
> `npm run repair:orphaned-assignments` (dry-run by default; add `--apply` to commit) to hand those
> books back. It never touches a knock.

## Deleting your account

Anyone can delete their own account from the mobile app: **Profile ▸ Delete account**. It's permanent —
their login, name, email, phone and password are gone, and **no admin can bring the account back**. This
is different from *deactivating* someone, which an admin can undo at any time.

**What the campaign keeps.** The doors they knocked and the survey answers they recorded **stay with the
campaign**. Those are the organization's records of work performed, not the person's personal content, so
deleting an account never changes a campaign's counts, its coverage, or its bill.

**Where their name still shows.** For as long as the retention window below is open, the **leaderboard,
the Timeline and the canvassers CSV** still show their real name — those three surfaces resolve it from
the retained snapshot ([`hydrateCanvassers`](../server/src/services/reports/canvasserIdentity.js)), which
is the whole point of keeping it. **Other surfaces — the map, the GPS audit, the per-canvasser
drill-downs — read the scrubbed account row and show "Deleted user".** Once the window lapses and the
snapshot is purged, everything shows "Deleted user" and their past work no longer directly identifies
them (the records remain keyed to the internal account id).

**Their name is kept for a while, on purpose.** Alongside those records we hold their name for **180 days**
so the organization can still check *who* did which field work — canvassing records include the location
each door was logged at, and a GPS audit is worthless if you can't attach it to a person. This is stated
plainly to the user before they delete, and it means **nobody can delete their way out of a quality audit**.
After 180 days the name is removed for good; the old records stay with the campaign but no longer
directly identify the person.

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
  - `lastLoginAt: Date` — written in **exactly one place**, `POST /auth/login`. It is "when they last
    typed a password", **not** a last-activity clock: tokens live 30 days and the mobile app skips
    the login screen whenever it holds one, so a canvasser who works daily legitimately reads
    `27d ago`. Exposed in `toSafeJSON()`.
  - `lastSeenAt: Date` — the true last-activity clock, stamped by `requireAuth` on any authenticated
    request and throttled to ~15 min per user per process (`middleware/lastSeen.js`), so it is
    approximate by design. **Super-admin-only**: emitted by `GET /super-admin/users` and
    `services/platform/userOversight.js` and nowhere else — deliberately absent from `toSafeJSON()`
    and from `GET /admin/memberships`, so an org admin can never read when a member (who may also
    belong to another org) was last online. **Not indexed**: it is projected into one response and is
    never a predicate or sort key, so an index would buy write amplification on the hottest write
    path for no read at all. Both clocks are **scrubbed on account deletion**
    ([PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) v4).
- **`Membership`** ([server/src/models/Membership.js](../server/src/models/Membership.js)) — join table
  `{ userId, organizationId, role: 'admin'|'lead'|'canvasser', isActive, addedBy }`, unique on
  `(userId, organizationId)`. The `'lead'` (team lead) role is a **campaign-scoped admin** — its
  authority is the set of campaigns granted via `CampaignManager` (below). The enum add is additive, so
  **no migration** is needed. Fields:
  - `acknowledgedAt: Date|null` — `null` = the "added to org" banner is still pending; a timestamp =
    dismissed.
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
  is `{ sub, email, isSuperAdmin }` — no org. Memberships carry `isNew: !acknowledgedAt`.
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
    the deleted holder's still-valid 30-day token — which is what keeps the deletion scrub true.
  - **It is fire-and-forget** (`.catch(() => {})`, unawaited) and passes `{ timestamps: false }`.
    `requireAuth` wraps its whole body in a catch returning a blanket `401`, so an awaited write that
    rejected on a transient DB blip would eject a live session; and without `timestamps: false` the
    stamp would drag `User.updatedAt` forward every 15 minutes for every active account.
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
  `User.passwordChangedAt`, and `requireAuth` refuses any JWT issued before that instant
  (`401 { code: 'SESSION_REVOKED' }`) — "I changed my password" ends every other device's session.
  A null stamp grandfathers sessions issued before this feature. Mail itself is dormant until
  `RESEND_API_KEY`/`MAIL_FROM` are configured (`services/mail/mailer.js`).
- **Self-service change** — `POST /auth/change-password` (`requireAuth` only, no org context). Verifies
  `currentPassword`, **enforces strength on `newPassword` via `strongPasswordSchema`** (8+ with an
  uppercase, a lowercase, a number, and a special character), rejects reuse, sets
  `{ passwordHash, mustChangePassword: false, tempPasswordSetAt: null, passwordChangedAt: now }`
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
  offline queue **holds** (never drops) queued knocks on both `401 SESSION_REVOKED` and the gate's
  403, and the queue survives sign-out — so a mid-shift reset can no longer lose billable work
  (`mobile/lib/offlineQueue.js` isAuthFailure).
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

## Cross-org guards

- **Login-email lock** — `PATCH /admin/memberships/:userId/user` rejects an email change with
  `403 { code: 'MULTI_ORG_EMAIL_LOCKED' }` when the target belongs to ≥2 active orgs and the caller is
  neither the user nor a super-admin. Name/phone still apply. The roster (`GET /admin/memberships`)
  exposes a per-member `user.isMultiOrg` boolean (a global active-membership count ≥2 — never *which*
  orgs) so the UI can disable the email field with an explanation. Enforced in both
  [UserProfileModal.jsx](../client/src/components/UserProfileModal.jsx) and the mobile
  [users/[id].jsx](../mobile/app/(app)/admin/users/[id].jsx).
- **Link vs create intent** — `POST /admin/memberships` **and** the team-lead crew endpoint
  `POST /admin/campaigns/:id/crew` both take `linkExisting` (shared `memberIdentityShape`). `false` +
  existing email → `409 EMAIL_EXISTS_USE_LINK`; `true` + no account → `404 EMAIL_NOT_FOUND`; `true` +
  already in this org → `409 ALREADY_MEMBER`. All four surfaces send it and offer the link toggle — web
  ([UsersPage.jsx](../client/src/pages/UsersPage.jsx), [CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx))
  and mobile ([admin/users.jsx](../mobile/app/(app)/admin/users.jsx),
  [campaign-assignments/[campaignId].jsx](../mobile/app/(app)/admin/campaign-assignments/[campaignId].jsx))
  — and each **auto-switches the toggle on** when the server returns `EMAIL_EXISTS_USE_LINK`. Letting a
  **team lead** link (not just create) is deliberate: a lead owns onboarding and a returning canvasser may
  already have an account from another org; the same privacy guards apply (name revealed only on linking,
  `isMultiOrg` boolean only, added-to-org banner on next login).

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

- **Set / clear** — `PATCH /admin/campaigns/:campaignId/crew/:userId/coordinator`
  ([leadCrew.js](../server/src/routes/admin/leadCrew.js)), mounted behind `requireCampaignManager`
  (org admin, super admin, or a lead granted *this* campaign). The `campaignId` comes from the **URL**,
  which is load-bearing: the gate keys on the same param, so a lead physically cannot address a campaign
  they weren't granted. Taking it from the body would reopen exactly that hole. `404` when the person
  holds no roster row on this campaign — there is no crew there to set.
- **Preview** — `GET …/crew/:userId/coordinator-preview?coordinatorId=<id|none>` returns
  `{ from, to, doors, activities, surveys, subjectRunsCrew }` from the *same* filter the write uses
  ([restampCoordinator.js](../server/src/services/memberships/restampCoordinator.js)). `doors` is the
  deduped `knocksPipeline` count, not the row count — quoting rows next to the word "doors" would move
  the team row by less than the confirmation promised.
- **Read-only, org-wide** — `GET /admin/memberships/:userId/crews` returns one row per campaign the
  person is rostered to (`campaignId`, `campaignName`, `campaignIsActive`, `coordinatorId`,
  `coordinatorName`). This is what replaced the Users page's single dropdown.

**Web UI.** Setting a crew lives in exactly one component:
[CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx)'s member panel (picker → staged change →
[CoordinatorConfirm.jsx](../client/src/components/CoordinatorConfirm.jsx) → commit). The panel is **not**
gated on the member's active state: a deactivated-but-rostered person's crew must stay settable, which is
what makes the ~1,700 doors sitting in "No team" on a live org — knocked by people since switched off —
recoverable at all.
[UserProfileModal.jsx](../client/src/components/UserProfileModal.jsx) renders the read-only **Crews**
block from `/crews`; [UsersPage.jsx](../client/src/pages/UsersPage.jsx) lost its Coordinator column,
coordinator filter and add-member coordinator field. **Mobile has no crew-setting surface** — the campaign
Team screen adds and creates members only.

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
[`setMemberCoordinator`](../server/src/services/memberships/setCoordinator.js)**, which updates the roster
row, re-stamps that person's ledger history *in that campaign* onto the new team, and files a
`CoordinatorChange` audit row (a no-op re-pick is completely silent — no write, no audit row, or the log
stops being able to answer "why did this team's number move?"). It writes the roster *first* on purpose:
if the ledger write fails, the drift is a finite, shrinking set that a retry or `repair:team-stamps`
closes, whereas the reverse order would have every subsequent knock add more drift.
`test/coordinatorChokePoint.test.js` asserts structurally which files may write the field:
`setCoordinator.js`, `leadCrew.js` (create-a-canvasser onto a campaign),
[`deleteAccount.js`](../server/src/services/users/deleteAccount.js) — **the sanctioned exception**, since
departure must never touch the ledger or the 104-door bug returns —
[`migrateCampaignCoordinators.js`](../server/src/migrations/migrateCampaignCoordinators.js) (roster only,
never the ledger) and `seedDemoOrg.js` (writes roster and ledger in the same run from one crew map, so
there is no pre-existing history to re-stamp).

**`restampFilter` REQUIRES a `campaignId` and throws without one.** Required rather than
optional-with-a-default, because an omitted scope silently meaning "everything" *is* the bug this change
removes. `organizationId` and `userId` are required for the same reason (a cross-tenant write). The rule
it implements is now: *the current coordinator owns all of that canvasser's history — all time, in this
campaign.* Changing a crew in campaign A moves zero doors in campaign B.

**`CoordinatorChange`** ([model](../server/src/models/CoordinatorChange.js)) gained a **nullable**
`campaignId` (`null` = a row written under the old org-wide model, which must stay readable) and an index
`{campaignId, createdAt}` — "why did THIS campaign's team move?".

> ⚠️ **Known gap (not part of the design).** `GET /admin/campaigns/:id/assignments`
> ([assignments.js](../server/src/routes/admin/assignments.js)) still joins the crew label from
> **`Membership.coordinatorId`**, the legacy org-wide field — it was not moved with the rest. Verified
> against a live server: with `Membership` → Asa and the campaign roster row → Frank, the endpoint returns
> Asa. Everything *counted* is unaffected (numbers come from the ledger stamp), but the Team page's crew
> grouping, its member-panel dropdown default, and the book picker's crew filter / "mixed crews" flag all
> read through [useCampaignTeam.js](../client/src/lib/useCampaignTeam.js) from this endpoint, so they show
> the stale value and a crew set on the Team tab appears to revert on refetch. Fix = read
> `CampaignAssignment.coordinatorId` for the campaign, then delete this note.

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
  `isSuperAdmin` (joined from `Membership`/`User`) so pickers/Team page can render badges; `POST`
  (add) / `DELETE /:userId` (remove) manage it.
- **Mobile visibility gate** — [bootstrap.js](../server/src/routes/mobile/bootstrap.js) filters a
  canvasser's campaigns to their `CampaignAssignment`s (`assertCampaignAccess`); org admins/super-admins
  bypass and see all.
- **Assignment gate** — `partitionAssignable({campaignId, organizationId, userIds})`
  ([campaignRoster.js](../server/src/services/campaignRoster.js)) returns `{ allowed, notOnTeam }`:
  allowed = already on the roster, **or** an org admin, **or** a team lead holding a `CampaignManager`
  grant on **this** campaign (never "is a lead somewhere" — a grant elsewhere must not open this
  campaign), each only if currently activated; super admins always. The lead branch is new: the check
  matched `role: 'admin'` only, so a lead running a campaign could not put themselves on a book without
  asking an admin to roster them first. Both assign paths use it —
  single-book [turfAssignments.js](../server/src/routes/admin/turfAssignments.js) `POST /` and bulk
  [turfs.js](../server/src/routes/admin/turfs.js) `assign-bulk` — returning `409 { code:'not-on-team',
  notOnTeam }` when nothing is allowed. `EffortMember` pre-staging ([efforts.js](../server/src/routes/admin/efforts.js)
  `POST /:id/members`) applies the same gate. After a successful assign, `ensureCampaignAssignments`
  adds any admin assigned on the fly to the roster (a no-op for existing members), so self-assign grants
  mobile visibility.
- **Client** — the three book pickers and the walk-list RosterPanel source their candidate list from
  the shared [useCampaignTeam(campaignId)](../client/src/lib/useCampaignTeam.js) hook (roster + the
  current admin, so self-assign always works) instead of the org-wide `GET /admin/memberships`. Each
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

## Client gating

- Web: `AuthContext` exposes `mustChangePassword`, `changePassword`, `acknowledgeMembership`.
  `ProtectedRoute` redirects to `/change-password` when the flag is set (except the change-password route
  itself, via `allowPasswordChange`). `LoginPage` redirects on the flag; `api/client.js` funnels an
  in-flight `PASSWORD_CHANGE_REQUIRED` 403 to the same page.
- Mobile: `app/index.jsx` redirects to `app/change-password.jsx` when the cached user has the flag.

## The active org (`canvass.activeOrgId`)

The JWT carries **no org claim** — it's org-agnostic. The active org is a client-held value sent as the
`X-Org-Id` header on every request (web: `localStorage` key `canvass.activeOrgId`, set in
[api/client.js](../client/src/api/client.js); mobile: the same key in `AsyncStorage`). The server resolves
and re-authorizes it per request in [middleware/orgContext.js](../server/src/middleware/orgContext.js),
so the client's copy is a *preference*, never a grant.

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
| `User.deletedAt` | Terminal. Checked in `requireAuth` **and** at login. Distinct from `isActive` on purpose — `isActive:false` is the reversible admin deactivate, and `PATCH /admin/memberships/:userId/password` can revive it. Apple: *"only offering to temporarily deactivate or disable an account is insufficient."* |
| `User.deletionLocked` | The App Review / Play reviewer demo login. A reviewer **will** press the button — that's what 5.1.1(v) asks them to test — and an unguarded delete would destroy the demo tenant and leave the *next* submission unreviewable. |
| `DeletedUserRecord` | The identity snapshot. See below. |

**`requireAuth` is the revocation.** The JWT is stateless with a 30-day life
([tokens.js](../server/src/services/auth/tokens.js)) and carries no `jti`/`tokenVersion` — but
`requireAuth` loads the user from the DB on **every** request, so refusing a `deletedAt` user there kills
the session immediately rather than in a month.

**The fraud-audit problem, and `DeletedUserRecord`.** Scrubbing the `User` row satisfies the stores but
destroys the only join key the GPS audit has: `flagDetection` resolves a flagged canvasser through
`User.firstName/lastName/email`. Without a snapshot, a canvasser could fabricate a day of *billable* doors,
delete their account, and leave the org holding a GPS trail it cannot attach to anybody — then rejoin under
the freed email with a clean flag history. **The flagged rows survive a scrub; the attribution is what
dies.** So we snapshot identity **before** scrubbing, org-scoped, with a bounded and disclosed retention
window (`DELETED_IDENTITY_RETENTION_DAYS`, default 180). Both stores permit this — Play names *"security,
fraud prevention or regulatory compliance"* outright; Apple requires retained data be disclosed — and the
deletion sheet, the public page and the privacy policy all say so in the same words.

**Guards** (all in [deleteAccount.js](../server/src/services/users/deleteAccount.js), all enforced on the
*write*, not just the pre-check): `DELETION_LOCKED`, `LAST_SUPER_ADMIN`, `LAST_ADMIN`, `LAST_BILLING_ADMIN`.
The billing one matters most: losing the last `billingAccess` admin means nobody can pay the subscription,
and the entitlement gate drives the whole org read-only when it lapses — **self-deletion must not be able to
financially suspend a customer.**

**The offline queue is a live hazard.** [offlineQueue.js](../mobile/lib/offlineQueue.js) *drops* any 4xx so
one bad submission can't wedge the queue forever. The moment the account dies, every unsynced knock 401s and
is silently discarded — real, billable field work. `DeleteAccountSheet` therefore **flushes first and refuses
to delete while anything is still pending**. Do not weaken that.

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
