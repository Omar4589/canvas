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

## Adding someone to your org

On the Users page, "Add member" has two modes:

- **New user** (default) — you provide their name, email, optional phone, an initial password, and a
  role. This creates a brand-new account.
- **Existing user (by email — link them to this org)** — check the box and enter just an email + role.
  This finds a person who *already has an account* (e.g. they canvass for another campaign) and adds
  a membership to your org, without creating a duplicate.

You can also add a **new canvasser inline from a campaign's Team page** (the **+ New canvasser** button)
— it creates the account and puts them on that campaign in one step, on **both** the web console and the
mobile admin app. (That inline form only makes canvassers; use the Users page for admins/leads or to link
an existing account.) The **phone** field is optional and **auto-formats to `(555) 123-4567`** as you
type — it won't accept letters.

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

## Coordinators (who oversees whom)

Each member can optionally have a **coordinator** — an admin in the same org who oversees them. Use it
when one campaign has several admins splitting the team (e.g. two vendors, or a paid vs. volunteer
crew): tag each canvasser with the admin who runs their group, so you can see and report on "who
reports to whom." A coordinator must be an **admin or team lead in this org**; you can leave it as
*None*.

You set it two ways, both on the Users page:

- **When adding a member** — pick a "Coordinator (optional)" from the dropdown of this org's admins and
  team leads.
- **Later** — open a member's profile and choose/clear their coordinator (it saves immediately).

The Users list shows a **Coordinator** column, and a **Coordinator filter** lets you narrow the list to
everyone a given admin oversees (or "No coordinator").

**Coordinators are your "crews," and they drive book assignment.** Wherever you assign work in a
campaign, people are grouped by coordinator:

- The campaign **Team** page groups members into crews (a section per coordinator, plus "No
  coordinator").
- The **book-assignment** picker (Turf Cutting) has a **crew filter** — pick "Paid Lead" and you see
  only that crew, so you can select the whole team and assign them to the chosen books in one action.
  Each person shows their crew, and a book that ends up with **two crews** flags a "mixed crews" note.

This lets you run, say, a paid team and a volunteer team in **one** walk list: put both crews on the
Team, set each person's coordinator, cut the books, then assign each crew to its books. (Reporting is
still **per-person** — there's no per-crew total yet; see the note in [EFFORTS.md](EFFORTS.md).) Dividing
the *doors* into disjoint areas is still what separate walk lists do ([EFFORTS.md](EFFORTS.md)) —
coordinators divide the *people*, walk lists divide the *territory*; use whichever (or both) fits.

## The campaign team (who can work a campaign)

Being in the org isn't the same as being on a **campaign**. Each campaign has its own **team** — the
subset of org members who work it. The team is what:

- **gates the mobile app** — a canvasser only sees campaigns they're on (admins & super-admins see all); and
- **gates book assignment** — you can only assign books to people on the team.

Manage it on the campaign's **Team** page (two panes: add org members on the left, the current team on
the right — **click a team member** to open a quick, campaign-scoped panel: their activity in this
campaign, set their crew/coordinator, or remove them from the campaign). A person joins a campaign's team
these ways, all equivalent:

1. **Team page → Add** an existing org member — or **+ New canvasser** to create a brand-new person
   straight onto the team (works on the web console **and** the mobile admin app's Assignments screen).
2. **Walk Lists → Manage → Pre-add** — pre-stage someone onto a walk list (also puts them on the team).
3. **Assigning them a book** — an admin assigning a book adds that person to the team automatically.

Because assignment is now **team-only**, the everyday flow is: add people on the Team page first, then
assign their books. **Admins & super-admins are the exception** — they can be assigned (including
themselves) on the fly and are added to the team at that moment, so an admin can always self-assign a
book without a separate step. Everyone appears in these lists, including you — there's no "hide myself."

## Passwords & lockouts

A locked-out user can't reach *any* org, so password recovery has to work even when the only
super-admin isn't around. How it works:

- An admin clicks **"Set temporary password"** on the user's profile and gives them a temporary one.
- The next time that person signs in, they're **required to choose a new password** before they can
  do anything. The temporary one stops working the moment they set their own.
- A temporary password is only good for **72 hours** — after that an admin has to set a new one.
- When the person sets **their own** password, it has to be reasonably strong: at least 8 characters
  with an uppercase letter, a lowercase letter, a number, and a special character. A live checklist
  ticks each rule off as they type. (The admin's *temporary* password isn't held to this — it's
  short-lived and replaced immediately anyway.)

This means an admin can always rescue someone, but the admin never ends up holding a working password
to the user's *other* orgs.

## What's shared vs isolated across orgs

Because the account is shared, some things are global and some are per-org:

| Thing | Scope | Who can change it |
| --- | --- | --- |
| Name, phone | Shared (one profile) | Any admin of an org they belong to, or a super-admin |
| **Login email** | Shared (it's how they sign in everywhere) | The user or a super-admin only, **if** they're in 2+ orgs |
| Password | Shared | Any of their org's admins (as a *temporary* password) or the user |
| Role | Per-org | Each org's admin (admin / team lead / canvasser) — see [ROLES.md](ROLES.md) |
| Team-lead campaign grants | Per-org (`CampaignManager`) | Each org's admin — which campaigns a lead manages |
| Coordinator | Per-org (membership) | Each org's admin — points to an admin or team lead in the same org |
| Active / inactive | Per-org (membership) | Each org's admin, for their own org |
| Removed from org | Per-org (membership) | Each org's admin — only removes *their* membership |

The important one: for a person who belongs to **more than one org**, a regular admin **cannot change
their login email** (that would change how they sign into the *other* orgs). The email field is shown
**disabled with an explanation** in that case. Only the user themselves or a super-admin can change it.

---

# Part 2 — Technical reference

## Models

- **`User`** ([server/src/models/User.js](../server/src/models/User.js)) — global account. `email` is
  **globally unique** (lowercased). No `organizationId`. Roles are *not* here. New fields:
  - `mustChangePassword: Boolean` — set when an admin issues a temp password; forces a change at next
    login. Surfaced in `toSafeJSON()`.
  - `tempPasswordSetAt: Date` — when the temp password was set; used to expire it (72h).
  - `isSuperAdmin: Boolean` — platform-wide; bypasses org-role checks.
- **`Membership`** ([server/src/models/Membership.js](../server/src/models/Membership.js)) — join table
  `{ userId, organizationId, role: 'admin'|'lead'|'canvasser', isActive, addedBy }`, unique on
  `(userId, organizationId)`. The `'lead'` (team lead) role is a **campaign-scoped admin** — its
  authority is the set of campaigns granted via `CampaignManager` (below). The enum add is additive, so
  **no migration** is needed. Fields:
  - `acknowledgedAt: Date|null` — `null` = the "added to org" banner is still pending; a timestamp =
    dismissed.
  - `coordinatorId: ObjectId|null` (ref `User`) — the supervising admin **or team lead** in this org, or
    `null`. Indexed `{ organizationId, coordinatorId }`.
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
- **Self-service change** — `POST /auth/change-password` (`requireAuth` only, no org context). Verifies
  `currentPassword`, **enforces strength on `newPassword` via `strongPasswordSchema`** (8+ with an
  uppercase, a lowercase, a number, and a special character), rejects reuse, sets
  `{ passwordHash, mustChangePassword: false, tempPasswordSetAt: null }`, returns fresh
  `{ user, memberships }`. The existing JWT stays valid (payload is unaffected). This is the endpoint
  the **forced change** after a temp password also hits, so a rescued user's replacement is strong.
- **Admin reset** — `PATCH /admin/memberships/:userId/password` now sets a **temporary** password:
  `{ passwordHash, mustChangePassword: true, tempPasswordSetAt: now }`. Still gated by membership in the
  caller's active org, so any of a multi-org user's admins can issue one.

**Residual risk (by design):** the resetting admin also knows the temp password. The gate means a temp
password can only reach `change-password`/`me`/`logout` — it cannot read or act in any org. Using it to
*change* the password would lock out the real user, who notices immediately and re-requests a reset. The
72h expiry bounds the window. Full elimination isn't possible under shared identity; this is the
mitigation envelope.

## Cross-org guards

- **Login-email lock** — `PATCH /admin/memberships/:userId/user` rejects an email change with
  `403 { code: 'MULTI_ORG_EMAIL_LOCKED' }` when the target belongs to ≥2 active orgs and the caller is
  neither the user nor a super-admin. Name/phone still apply. The roster (`GET /admin/memberships`)
  exposes a per-member `user.isMultiOrg` boolean (a global active-membership count ≥2 — never *which*
  orgs) so the UI can disable the email field with an explanation. Enforced in both
  [UserProfileModal.jsx](../client/src/components/UserProfileModal.jsx) and the mobile
  [users/[id].jsx](../mobile/app/(app)/admin/users/[id].jsx).
- **Link vs create intent** — `POST /admin/memberships` takes `linkExisting`. `false` + existing email →
  `409 EMAIL_EXISTS_USE_LINK`; `true` + no account → `404 EMAIL_NOT_FOUND`. Both web
  ([UsersPage.jsx](../client/src/pages/UsersPage.jsx)) and mobile
  ([admin/users.jsx](../mobile/app/(app)/admin/users.jsx)) send it and offer the link toggle.

## Coordinators

A per-org supervisory link: `Membership.coordinatorId` → a `User` who is an **active `admin` or `lead`
in the same org**. Set on **create** (`POST /admin/memberships`, optional `coordinatorId`) and **update**
(`PATCH /admin/memberships/:userId`, nullable `coordinatorId`); a shared validator (`resolveCoordinatorId`,
in [createMember.js](../server/src/services/memberships/createMember.js)) rejects a non-admin/lead /
cross-org / self reference with `400`, and `''`/`null` clears it. `GET /admin/memberships`
returns each member's `coordinatorId` (a plain id — the client resolves the name from the same roster, so
no extra query/populate). The web UI lives in [UsersPage.jsx](../client/src/pages/UsersPage.jsx) (Add-member
dropdown + table column + filter) and [UserProfileModal.jsx](../client/src/components/UserProfileModal.jsx)
(save-on-change dropdown). No migration needed — absent → `null`. Distinct from **Efforts**, which
partition the *doors/work*; the coordinator partitions *people*.

**Surfaced in assignment.** The campaign-roster endpoint `GET /admin/campaigns/:id/assignments`
([assignments.js](../server/src/routes/admin/assignments.js)) returns each member's `coordinatorId` +
resolved `coordinatorName` (one `User` lookup over the distinct coordinators). [useCampaignTeam.js](../client/src/lib/useCampaignTeam.js)
carries it to the book-assignment picker ([BookAssignmentPanel.jsx](../client/src/components/BookAssignmentPanel.jsx)
— crew filter chips + per-row crew label + a "mixed crews" flag) and the Team page
([CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) — the roster grouped by crew). Reports
are **not** yet coordinator-scoped (only `effortId` is — see [reports.js](../server/src/routes/admin/reports.js)
`baseFilter`); per-crew totals would add a `coordinatorId` filter there, mirroring the effort scoping.

## Campaign roster & assignment gating

- **`CampaignAssignment`** ([server/src/models/CampaignAssignment.js](../server/src/models/CampaignAssignment.js))
  — the per-campaign roster, unique `{campaignId, userId}`. It's the source of truth for **campaign
  membership** (distinct from org `Membership` and from per-walk-list `EffortMember`).
- **Team page endpoints** ([server/src/routes/admin/assignments.js](../server/src/routes/admin/assignments.js)):
  `GET /admin/campaigns/:id/assignments` returns the roster enriched with each member's `role` +
  `isSuperAdmin` (joined from `Membership`/`User`) so pickers/Team page can render badges; `POST`
  (add) / `DELETE /:userId` (remove) manage it.
- **Mobile visibility gate** — [bootstrap.js](../server/src/routes/mobile/bootstrap.js) filters a
  canvasser's campaigns to their `CampaignAssignment`s (`assertCampaignAccess`); org admins/super-admins
  bypass and see all.
- **Assignment gate** — `partitionAssignable({campaignId, organizationId, userIds})`
  ([campaignRoster.js](../server/src/services/campaignRoster.js)) returns `{ allowed, notOnTeam }`:
  allowed = already on the roster **or** an org admin/super-admin. Both assign paths use it —
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

## Input validation

Member/user fields (and campaign/org/survey fields) validate the same way everywhere via shared Zod
schemas in [server/src/utils/validators.js](../server/src/utils/validators.js):

- `phoneSchema` — US phone: strips to digits, **rejects letters**, stores canonical `(555) 123-4567`
  (optional/empty → `undefined`). Replaced a duplicated inline schema in `memberships.js`/`createMember.js`.
- `usStateSchema` — 2-letter, uppercased, checked against the **real** state set (the exported `STATE_TZ`
  keys in [usStateTimeZone.js](../server/src/utils/usStateTimeZone.js)) — so `"XX"` is rejected.
- `nameSchema` (trim, 1–80), `emailSchema` (`.email()` + max), `slugSchema` (kebab-case, orgs).
- **Two password schemas, by who sets it.** `passwordSchema` (min 8, **no** complexity) gates
  admin-set **temporary** passwords (create-user, admin reset, create-canvasser) — the user replaces
  them at first login, so complexity would only add friction. `strongPasswordSchema` (8+ with an
  uppercase, a lowercase, a number, and a special character, via a shared `passwordProblem` message)
  gates the passwords a user **chooses for themselves** (`POST /auth/change-password`). The same rule
  set is mirrored in [client/src/lib/validators.js](../client/src/lib/validators.js) and
  [mobile/lib/validators.js](../mobile/lib/validators.js) (`PASSWORD_RULES` / `passwordChecklist` /
  `isStrongPassword`) so the live requirements checklist under the new-password field agrees with the
  server. The two masked-with-toggle password inputs live at `components/PasswordInput.jsx` on each
  client; every password field uses it (a couple of create-canvasser fields that once rendered the
  password in cleartext were switched over).

The **server is the authoritative guard**; the clients mirror it for UX only — plain-JS helpers in
[client/src/lib/validators.js](../client/src/lib/validators.js) power the reusable
[PhoneInput](../client/src/components/ui/PhoneInput.jsx) (auto-format) and the campaign **State** dropdown
(`US_STATES`), and [mobile/lib/validators.js](../mobile/lib/validators.js) formats the phone field on
mobile. No new dependency, and **no migration** — phone is display-only contact info (new writes are
normalized; old values format best-effort). Locked by
[validators.test.js](../server/test/validators.test.js).

## Migration (run once at deploy)

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
