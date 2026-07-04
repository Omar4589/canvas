# The platform console (super admin)

What a **super admin** is, and the platform-wide console they use to oversee every organization on the
instance — the Control Room, Organizations, All Users, People, and background Jobs.

- **Part 1 — For everyone** is plain language: who a super admin is and what each screen does.
- **Part 2 — Technical reference** is for developers (and Claude): the gate, the endpoints, and where
  each screen's data comes from.

Related: [ROLES.md](ROLES.md) (org roles — admin / team lead / canvasser, which the super admin sits
above), [USERS.md](USERS.md) (accounts vs memberships), [PERSONS.md](PERSONS.md) (the cross-org People
layer, managed from this console), [METRICS.md](METRICS.md) (the numbers behind the Control Room).

---

# Part 1 — For everyone

## Who a super admin is

Org roles (admin / team lead / canvasser) live **inside** one organization. A **super admin** is
platform-wide: they sit above every org, can enter any of them, and run the platform console. It's a
deliberately small, trusted group (you promote someone to it from All Users). A super admin isn't the
same as an org admin — an org admin runs *their* org; a super admin oversees *all* of them and the
platform itself.

Super admins work in a **platform view** (no single active organization). From there they can drop into
any org to work inside it, then come back out.

## The screens

- **Control Room** — the platform's home page: headline totals (organizations, users, super admins,
  campaigns), **who's active right now** (canvassers who logged something in the last 15 minutes),
  **today's activity** (doors knocked, surveys, lit drops — across every org), and a table of every
  organization with its members, campaigns, who's live, and when it was last active. Alongside it, a
  **live activity feed** streams recent door events (Not home / Wrong address / **Refused** / Survey /
  Lit drop) from across all orgs.
- **Organizations** — the list of every org; create a new one, and activate/deactivate them. A
  deactivated org's members can't sign into it.
- **All Users** — every account on the platform (with the orgs each belongs to and their role in each).
  This is where you **promote or demote a super admin**. You can't change your own super-admin flag.
- **People** — the cross-org **Person** layer: the same real person appearing in several orgs, deduped;
  review merge/split candidates, approve edit proposals, and set ownership/locks. Fully documented in
  [PERSONS.md](PERSONS.md).
- **Jobs** — the background job queues (imports, turf-cutting) for when something needs a look under the
  hood.

---

# Part 2 — Technical reference

## The gate

Everything here is behind `requireSuperAdmin` ([middleware/auth.js](../server/src/middleware/auth.js)),
which checks `req.user.isSuperAdmin`. Separately, `requireOrgRole(...)` **bypasses** its role check for a
super admin (`if (req.user.isSuperAdmin) return next()`), so a super admin can act inside any org's admin
routes too. `isSuperAdmin` lives on the `User` (global), not on a `Membership` — see [USERS.md](USERS.md).
The client mirrors this: `ProtectedRoute requireSuperAdmin` + `AuthContext.isSuperAdmin`; the sidebar's
`SUPER_NAV` ([navItems.js](../client/src/components/navItems.js)) lists these screens.

## Screens → endpoints

| Screen | Client page | Endpoint(s) |
|---|---|---|
| Control Room | [SuperAdminHomePage.jsx](../client/src/pages/SuperAdminHomePage.jsx) | `GET /super-admin/platform-overview`, `GET /super-admin/activity-feed` ([platform.js](../server/src/routes/superAdmin/platform.js)) |
| Organizations | [OrganizationsPage.jsx](../client/src/pages/OrganizationsPage.jsx) | `GET/POST /super-admin/organizations`, `PATCH /super-admin/organizations/:orgId` ([organizations.js](../server/src/routes/superAdmin/organizations.js)) |
| All Users | [SuperAdminUsersPage.jsx](../client/src/pages/SuperAdminUsersPage.jsx) | `GET /super-admin/users`, `POST /super-admin/users/:userId/promote` ([users.js](../server/src/routes/superAdmin/users.js)) |
| People | [SuperAdminPeoplePage.jsx](../client/src/pages/SuperAdminPeoplePage.jsx) + [PersonDetailPage.jsx](../client/src/pages/PersonDetailPage.jsx) | `/super-admin/persons/*` ([persons.js](../server/src/routes/superAdmin/persons.js)) — see [PERSONS.md](PERSONS.md) |
| Jobs | queues page | Bull Board at `/admin/queues` (`requireBullBoardAuth`, mounted in [app.js](../server/src/app.js)) |

## Notes

- **`platform-overview`** aggregates platform-wide but counts only activity tied to **active** campaigns
  (matching the campaign count). "Today" is a UTC-day window; "active now" is a 15-minute window of
  distinct `userId`s. `today.doorsKnocked` sums the door actions in `ACTION_DOOR` — which **includes
  `refused`** (a first-class billable knock; it was previously omitted and undercounted — see
  [METRICS.md](METRICS.md)).
- **`activity-feed`** returns the most recent `CanvassActivity` events whose `actionType ∈ ACTION_DOOR`
  (so Refused events appear, matching the "Refused" styling both feed UIs already ship), newest first,
  with org / canvasser / campaign / household populated; supports `?since=` for polling and `?limit=`.
- **`promote`** toggles `User.isSuperAdmin`; a super admin **cannot** toggle their own flag (guards
  against self-lockout / accidental self-demotion).
- **Organizations** `PATCH` flips `isActive` (deactivate hides the org from its members) and edits
  name/slug (slug validated kebab-case — see [validators.js](../server/src/utils/validators.js)).
