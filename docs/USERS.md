# Users, organizations & cross-org identity

How a person becomes a member of an organization, what it means that one account can belong to
several orgs at once, and the guardrails that stop one org from quietly affecting a user who also
belongs to another.

- **Part 1 — For everyone** is plain language: accounts vs memberships, roles, adding/linking
  people, passwords, and what's shared vs isolated across orgs.
- **Part 2 — Technical reference** is for developers (and Claude): the data model, the auth/password
  flow, the cross-org guards, and the one-time migration.

Related: [EFFORTS.md](EFFORTS.md) (crews are drawn from an org's canvassers), [METRICS.md](METRICS.md)
(per-user, per-org stats).

---

# Part 1 — For everyone

## Accounts vs memberships (the key idea)

There is **one account per email address, shared across the whole platform.** A person signs in once
with their email + password — no organization is chosen at sign-in.

Belonging to an organization is a separate thing called a **membership**: it links your one account
to an org and gives you a **role** there (Admin or Canvasser). The same person can have memberships
in several orgs, each with its own role, and switch between them with the org switcher.

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

If you try to create a **new** user with an email that already exists anywhere, you'll get a clear
error telling you to use the "Existing user" box instead (and the box auto-checks for you).

When you add someone, **they're told.** The next time they sign in they see an in-app banner: "You've
been added to *{org}* as *{role}*." They dismiss it and it's gone. (There's no email system yet, so
the notice is in-app.)

## Coordinators (who oversees whom)

Each member can optionally have a **coordinator** — an admin in the same org who oversees them. Use it
when one campaign has several admins splitting the team (e.g. two vendors, or a paid vs. volunteer
crew): tag each canvasser with the admin who runs their group, so you can see and report on "who
reports to whom." A coordinator must be an **admin in this org**; you can leave it as *None*.

You set it two ways, both on the Users page:

- **When adding a member** — pick a "Coordinator (optional)" from the dropdown of this org's admins.
- **Later** — open a member's profile and choose/clear their coordinator (it saves immediately).

The Users list shows a **Coordinator** column, and a **Coordinator filter** lets you narrow the list to
everyone a given admin oversees (or "No coordinator"). This is about *people management*; dividing the
*work* itself is what Efforts do ([EFFORTS.md](EFFORTS.md)) — the two are independent and complementary.

## Passwords & lockouts

A locked-out user can't reach *any* org, so password recovery has to work even when the only
super-admin isn't around. How it works:

- An admin clicks **"Set temporary password"** on the user's profile and gives them a temporary one.
- The next time that person signs in, they're **required to choose a new password** before they can
  do anything. The temporary one stops working the moment they set their own.
- A temporary password is only good for **72 hours** — after that an admin has to set a new one.

This means an admin can always rescue someone, but the admin never ends up holding a working password
to the user's *other* orgs.

## What's shared vs isolated across orgs

Because the account is shared, some things are global and some are per-org:

| Thing | Scope | Who can change it |
| --- | --- | --- |
| Name, phone | Shared (one profile) | Any admin of an org they belong to, or a super-admin |
| **Login email** | Shared (it's how they sign in everywhere) | The user or a super-admin only, **if** they're in 2+ orgs |
| Password | Shared | Any of their org's admins (as a *temporary* password) or the user |
| Role | Per-org | Each org's admin sets the role in their own org |
| Coordinator | Per-org (membership) | Each org's admin — points to an admin in the same org |
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
  `{ userId, organizationId, role: 'admin'|'canvasser', isActive, addedBy }`, unique on
  `(userId, organizationId)`. New fields:
  - `acknowledgedAt: Date|null` — `null` = the "added to org" banner is still pending; a timestamp =
    dismissed.
  - `coordinatorId: ObjectId|null` (ref `User`) — the supervising admin in this org, or `null`. Indexed
    `{ organizationId, coordinatorId }`.

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
  `currentPassword`, rejects reuse, sets `{ passwordHash, mustChangePassword: false, tempPasswordSetAt: null }`,
  returns fresh `{ user, memberships }`. The existing JWT stays valid (payload is unaffected).
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

A per-org supervisory link: `Membership.coordinatorId` → a `User` who is an **active `admin` in the same
org**. Set on **create** (`POST /admin/memberships`, optional `coordinatorId`) and **update**
(`PATCH /admin/memberships/:userId`, nullable `coordinatorId`); a shared validator (`resolveCoordinatorId`)
rejects a non-admin / cross-org / self reference with `400`, and `''`/`null` clears it. `GET /admin/memberships`
returns each member's `coordinatorId` (a plain id — the client resolves the name from the same roster, so
no extra query/populate). The web UI lives in [UsersPage.jsx](../client/src/pages/UsersPage.jsx) (Add-member
dropdown + table column + filter) and [UserProfileModal.jsx](../client/src/components/UserProfileModal.jsx)
(save-on-change dropdown). No migration needed — absent → `null`. Distinct from **Efforts**, which
partition the *doors/work*; the coordinator partitions *people*.

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
