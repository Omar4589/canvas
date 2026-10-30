# Roles & the team-lead (campaign-scoped admin)

Who can do what in an organization, and how the **team lead** role lets you delegate a single campaign
without handing over the whole org.

- **Part 1 — For everyone** is plain language: the three roles, what a team lead can and can't do, and
  how to grant one.
- **Part 2 — Technical reference** is the authorization contract: the grant store, the middleware, the
  per-surface enforcement, and how the client/mobile scope themselves.

Related: [USERS.md](USERS.md) (accounts, memberships, coordinators), [CAMPAIGNS.md](CAMPAIGNS.md) (the
campaign lifecycle a lead runs), [EFFORTS.md](EFFORTS.md) (walk lists / crews within a campaign).

---

# Part 1 — For everyone

There are three roles on a membership, plus a platform-wide **super admin** that sits above every org.

- **Admin** — runs the whole organization.
- **Team lead** — a **campaign-scoped admin**: runs the specific campaigns they're granted, and nothing
  outside them.
- **Canvasser** — walks doors in the mobile app for the campaigns they're on. No console.

## What a team lead is for

An org often runs several campaigns at once. A **team lead** is a trusted person you hand one (or a
few) of them to run end-to-end — they report to the admins, who usually create + set up a campaign and
then hand it off. A lead avoids the all-or-nothing choice of making a campaign runner a full org admin
(which would give them every other campaign and all the org settings too).

**The lead may not be your person at all.** The typical org here is a grassroots canvassing firm
hired by campaigns: the org owner runs the company, admins work for the owner — and a team lead may
be *the client's own campaign manager*, granted their one campaign. That trust model is why every
wall below exists: a client's rep never sees billing or the fields that drive what the firm invoices,
never touches another client's campaign, never sets an org-wide fact like Do-Not-Contact — and their
**survey library shows only what they authored or what's already on their campaigns**, never another
client's scripts, campaign names, or volumes. Two plain yes-or-no facts about a survey in that
library do reach a lead — never which campaign, never how many: whether a campaign they don't
manage has it attached (an archived one counts), and, for a survey on one of their campaigns,
whether it already has answers anywhere in the organization (owner ruling 2026-10-03). The second
decides whether its answer types and Go to are locked; the save would refuse those changes anyway.

Inside a campaign they're granted, a lead is **as powerful as an admin**: import the voter file, build
and attach a survey (authoring their own templates, not just picking from the library), build walk
lists, cut turf, create and activate passes (rounds), assign books — **including to themselves**, since
a lead who runs a campaign shouldn't have to ask an admin to put them on a book — build and manage the
crew (including creating new canvassers), print walk packets, export the campaign's data from the
Export Center, **look up any voter in the campaign and read their profile** (read-only — a lead adds
notes but edits nothing; the campaign **Voters** tab, see [VOTERS.md](VOTERS.md)), and see all the
reporting — map, timeline, insights, early voting, and client reports.

**Automatic pause** ([AUDIT.md](AUDIT.md) → *Automatic pause*) follows the same wall. A lead sees and
**unpauses** a canvasser paused on a campaign they manage — and, since a lead may be the client, that
includes the client's own rep — but only that campaign's doors: a door the canvasser saved on another
campaign that day shows as *a door on another campaign*, with no address, result or distance. A lead whose
canvasser is paused on a campaign they don't manage learns only that much (*Paused for review — an org
admin can unpause*), because the canvasser can't work the lead's campaign either. Org admins see every
pause and alone delete a resolved one and fix the doors on Door Outcomes; only a
billing admin changes the setting and who gets the alert email, on the org **Settings** page (org admins
only; it lived on the Users page until 2026-10-27). **Only canvassers are ever judged or
paused:** admins and team leads review and unpause, and they are the ones who enter paper results door by
door, which would otherwise pause them.

## What a team lead can never do

- **Create, archive, or delete a campaign** — admins shape the campaign list; a lead is handed campaigns.
- **Change a campaign's key dates, type, state, or its billable-door policy** (whether restricted
  homes count toward invoiced door totals — see [BILLING.md](BILLING.md)). A lead edits their
  campaign's name, survey, timezone, and **door goal**; anything that changes what gets *invoiced*
  stays with org admins. The server refuses with a 403 naming the field, so this can't be bypassed
  from the UI. The door goal is the deliberate exception (owner ruling 2026-08-14): a lead running a
  campaign owns its target, and because a target is a number someone can quietly lower, every edit
  to it is recorded to the campaign's **History** feed with the actor's name (see
  [CAMPAIGNS.md](CAMPAIGNS.md) → *Change history*). Leads reach the campaign edit drawer for this
  reason, with the org-admin-only fields rendered read-only rather than withheld.
- **Turn an off-by-default door outcome on or off.** Some door outcomes can't be checked, so they
  start **off** on every campaign — today there is one, **Not a target voter**, for someone at the
  door who isn't on the list and won't give their name ([CANVASSER_APP.md](CANVASSER_APP.md); the setting:
  [CAMPAIGNS.md](CAMPAIGNS.md) → *Off until you turn it on*). Only org admins switch one on or off.
  A lead sees the switch on **App Customization** and whether it's on, but can't change it — the
  one setting on that page a lead can see and not change, since the other outcome switches and who
  can add a person at the door stay theirs. The server refuses a lead either way, so this can't be
  bypassed from the UI. The reason (owner ruling 2026-10-02): turning on an outcome nobody can
  verify is the org's trust decision, and a lead may be the paying client. Once it's on, **everyone
  on that campaign** gets the button — including any canvasser a lead adds to the crew later — so
  admins turn it on only for crews they trust. The switch appears only on survey campaigns, and only
  once Doorline has made the outcome available; every flip is recorded in the campaign's
  **History** with who did it.
- **Run the org survey library, or touch the tag library.** Surveys are nuanced: a lead **can author**
  survey templates — create new ones, and edit or duplicate their own or any survey attached to a
  campaign they manage — but their **library is scoped to exactly that set**: the list, the attach
  picker, and the walk-list override picker show only authored-or-attached templates, and attaching
  any other template by id is refused server-side the same way (`survey-out-of-scope`).
  **Archiving, un-archiving, and deleting** templates stay with org admins, and the org-wide Surveys
  library page itself is admin-only (a lead works from their campaign's Survey tab). One consequence
  to know — the **detach cliff**: if a lead detaches an admin-authored template from their only
  campaign using it, it leaves their library and an admin must re-attach it. The **tag library** is
  stricter: a lead can *read* tags (to filter by them) but never create, edit, merge, or delete them.
- **Flag a voter Do-Not-Contact, or clear the flag.** DNC is an org-wide fact about a person, not a
  campaign fact — setting it anywhere silences that voter in every campaign — so it stays with org
  admins.
- **Run org-wide or admin-only exports.** The Export Center works for a lead campaign by campaign:
  exports of a managed campaign are theirs to create and download; the org-wide scope and the
  admin-only types (**Voter profile notes**, the full backup) are refused. Note the deliberate
  seam (owner ruling 2026-09-01): the lead-visible **Notes** type unions all three note sources,
  so a lead *can* export voter-profile note bodies through it — they already read them on the
  Notes hub for campaigns they manage. Recorded in
  [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 17.

  A second ruling in the same seam (owner, 2026-09-23): **a lead is sometimes the client** — an
  external stakeholder paying for the one campaign they hold a grant for, with no access to the org
  — so the lead-visible **Results by voter** type also lets a lead tick its opt-ins (contact &
  demographic details, the note from each survey) exactly as an admin can. "Can a lead export this"
  is the same question as "is this fit to hand the customer". Recorded in
  [EXPORTS.md](EXPORTS.md) and [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).
- **Org settings or the org-WIDE voter directory.** Those stay admin-only. Inside a granted campaign a
  lead does have the campaign **Voters** tab (since 2026-10-01): that campaign's own records, searched
  and opened as **read-only** profiles — contact details and email, the household, this campaign's
  survey answers and notes, and any do-not-contact flag with its reason, who set it and when — and a
  lead can add a note. It is the same read they already had in the phone's Voter search and in the
  campaign's exports, brought to the web (owner ruling 2026-09-30: a lead may be the paying client, so
  lead-visible = client-visible). What stays with admins is the org-wide page — every campaign at once,
  each person deduped with their campaign chips — and every edit.
- **The org-WIDE Users view.** Since 2026-07-23 a lead **does** get the Users page — but scoped:
  their list is exactly the people rostered on campaigns they manage, deduped, never the whole
  organization. (That scoped surface lives in the **mobile** admin app's Users hub and the underlying
  API; the **web** console's org Users page stays admin-only — on web a lead's people work happens on
  the campaign Team page.) **The campaign Team page is scoped the same way as of 2026-08-08** — it shows
  that campaign's people, not the organization's, and a lead adds someone by typing their **email
  address** rather than browsing a directory. Until then its add-picker returned every active member of
  the whole org, making it the one place a lead saw *more* of the organization than their own Users list
  would show them. On that scoped list a lead can **set temporary passwords**, **switch accounts off
  and back on**, and — since 2026-08-09 — **edit the person's name, email, and phone**, for
  **canvasser accounts only** — never an admin, another lead, or Doorline staff (the server refuses,
  not just the UI). Identity edits ride the same guards an admin's do: a deleted account is
  untouchable, and the **login email of anyone who also belongs to another organization is locked**
  (only that person or Doorline can change it). A lead can also **set the crew of anyone on their
  campaign's team**, one person or several at once (the Team page's **Move to crew…**, the phone's **Move
  all shown to a crew…**), **resend invites** to canvassers who never signed in, and **take canvassers,
  people no longer in the organization, and themselves off the campaign** — on the web, and since
  2026-10-27 on the phone too. Changing roles, creating org-level accounts, and deleting remain
  admin-only.

  **The off-switch caveat is a real one:** deactivation is *not* campaign-scoped — an account is
  either on or off for the whole organization, so switching off someone a lead shares with another
  campaign takes them out of that campaign too. The app says which campaigns it reaches before you
  confirm, and the lead can reverse it.
- **Grant the team-lead role** or change anyone's grants — only admins do that.
- **Remove anyone from the organization, or delete anyone's account.** Both are org-admin actions, in
  the person's panel on the web and on their profile on the phone: **Remove from org**, and **Delete
  account** — tucked behind **More options**, with two confirmations — for an account that belongs only to this
  organization (since 2026-10-24; see [USERS.md](USERS.md) → *Deleting a member's account*). A lead never
  sees either, and the server refuses them (`ADMIN_ONLY`). Even among admins, **billing access protects
  its holder**: only an admin who has billing access too can remove or delete someone who has it.
- **See or touch any campaign they weren't granted** — everything is default-deny; a lead with no
  grants sees an empty console.

## Granting a team lead

On the **Users** page (admins only): add or edit a member, set their role to **Team lead**, and check
the campaigns they should manage — **Add member** offers Team lead with its campaign list on the web and,
since 2026-10-30, on the phone's **+ New** (All campaigns). You can change the checked campaigns anytime;
unchecking one revokes it immediately. Creating, then granting, are two separate admin acts — a brand-new
campaign has no lead until an admin grants one.

The org view's add and a person's **Add to campaigns** / **Remove** (PROPOSAL_ADD_TO_CAMPAIGNS.md) are **org
admin** acts: `POST /admin/memberships/resolve`, `POST /admin/memberships/by-email`, `GET
/admin/memberships/:userId/campaign-history` and `POST /admin/memberships/:userId/campaigns` all answer a
lead `403 ADMIN_ONLY`. A lead still adds people to their own campaigns through the Team page's add by email
(`/crew`), which these routes don't touch.

## Where a team lead works

- **Web console** — they sign in to the same console. With **one active campaign**, they land straight
  on that campaign's **Home**; with more than one, or none yet, they land on **Campaigns**, which shows
  only the campaigns they manage. **‹ Campaigns** at the top of the sidebar (the first icon when the
  sidebar is collapsed; **More → ‹ All campaigns** in a narrow window) always opens that list — it's
  where a campaign's **Edit** and **Assignments** live, and where archived campaigns are. Inside a
  campaign, every tab an admin sees is there — the campaign **Voters** tab included. The org-only areas
  (Overview, Surveys, Tags, the org-wide Voters directory, Users) simply aren't in their nav. The
  campaign **Home** doesn't show a lead the organization's Doorline billing notes ("Not billing yet",
  the after-Election-Day archive reminder) — only an org admin can act on those.
- **Mobile admin app** — they get the same admin tabs (Overview / Timeline / Map / Books / More),
  scoped to their campaigns. With **one active campaign**, the **Overview** tab *is* that campaign's
  screen (captioned **Team Lead**), refreshing itself every 30 s while on screen, with any archived
  campaigns near the bottom; with more than one, or none, it's the usual list. **More → Voter search** finds anyone in the campaign and opens their profile,
  scoped to that campaign just like the web tab. **People management is one surface: More → Users**
  (the old standalone campaign
  Team screen merged into it). A campaign's **Team** tile opens Users pre-filtered to that campaign.
  There a lead sees their campaigns' people, adds canvassers by email (**Add a canvasser** asks who the
  address belongs to first, then the crew), sets temporary passwords, switches canvasser accounts off/on,
  sets crews (one person, or **Move all shown to a crew…**), resends invites, and takes canvassers, people
  no longer in the organization and themselves off a campaign — and never sees assignment controls
  (**Assign all shown** is for admins; their adds land on the campaign; rostering others is admin work). If a lead also walks
  doors, that's a separate thing: they're added to a campaign's walker roster like any canvasser and
  use the canvassing flow for their own books. When a lead switches into canvass mode, the drawer's
  **Admin dashboard** row brings them straight back.

## If you have different roles in different organizations

One account, one email — but a separate role in each org you belong to. You might be an **admin** in one
and a **canvasser** in another. Two rules follow from that, and they're worth knowing:

- **The web console only shows the orgs where you're an admin or team lead.** An org where you're a
  canvasser can't be opened in the console — there's nothing there for you to run. It still appears on
  the org picker, greyed out under **No console access**, so you can see it's there; the work for it
  lives in the mobile app.
- **If there's exactly one org you can run from the console, signing in takes you straight into it.**
  No picker, no choice to get wrong. You'll only see the picker when you genuinely have two or more.

The **mobile app** has no such restriction: every role has a home there, so *all* your orgs are
selectable, and switching between them is how an admin-in-one/canvasser-in-another account moves between
running a campaign and walking doors.

Switching orgs in the console always lands you on that org's home page (Overview for an admin; for a lead,
their campaign when they run exactly one active campaign there, otherwise Campaigns) — it never leaves you on a page belonging to the org you just left. Each browser tab keeps its
own organization: switching in one tab doesn't move your other open tabs ([USERS.md](USERS.md) →
*Sessions*).

---

# Part 2 — Technical reference

## The grant store

`CampaignManager` ([server/src/models/CampaignManager.js](../server/src/models/CampaignManager.js)) —
`{ campaignId, userId, organizationId, grantedBy, grantedAt }`, unique `(campaignId, userId)`, indexed
`{ userId, organizationId }`. A lead's authority is **exactly** the set of campaigns they hold a grant
for. It's kept **separate** from `CampaignAssignment` (the walker roster) on purpose: managing ≠ walking.
It's added to the campaign delete cascade ([deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js))
and cleared when a member is removed or their role changes away from `lead`.

The `Membership.role` enum gains `'lead'` — **additive, no migration**. Default-deny means a
half-rolled-out lead (role set, no grants yet) simply sees nothing until granted.

## The authz helpers + middleware

[services/authz/campaignManagement.js](../server/src/services/authz/campaignManagement.js):

- `isOrgAdmin(req)` — super admin or org `admin` (unscoped; manages every campaign).
- `isConsoleUser(req)` — super / admin / lead (may see the console at all).
- `managedCampaignIds(req)` — a lead's grant set in the active org (array of `ObjectId`).
- `canManageCampaign(req, campaignId)` — `true` for super/admin, or a lead **granted that campaign**;
  invalid id → `false`. Default-deny.

`requireCampaignManager` ([middleware/auth.js](../server/src/middleware/auth.js)) gates a campaign-nested
route on `canManageCampaign(req, req.params.campaignId)`. It runs after `orgContext` and **replaces**
`requireOrgRole('admin')` on the twelve campaign routers; each keeps its own `loadCampaign` org-ownership
check, so ownership and management are enforced independently.

## Super admins inside an org — including internal orgs

A super admin acts on org routes through the **same admin surfaces** everyone else does, not a parallel
one: `requireOrgRole(...)` short-circuits to `next()` for any `isSuperAdmin` caller
([middleware/auth.js](../server/src/middleware/auth.js)), so once `orgContext` has seated them in an org
they use the ordinary `/admin/*` endpoints as an admin. What differs is only how `orgContext` seats
them: a **customer** org requires a live support grant (and logs), while a **Doorline-owned internal
org** (`Organization.isInternal`) is free entry — no grant, no AccessLog row — because it holds only
synthetic data (see [PLATFORM.md](PLATFORM.md) → *When Doorline staff can see customer data* and
*Internal (Doorline-owned) organizations*).

This is why there is **no separate super-admin password-reset endpoint.** Resetting a member's
temporary password in an internal org goes through the **normal org-admin surface** —
`PATCH /admin/memberships/:userId/password`, the same "Set temporary password" control an org admin
uses (see [USERS.md](USERS.md)). Staff act *as* the internal org's admin, directly; there is nothing to
build alongside it.

**Deleting a member's account from inside an org** (`/admin/memberships/:userId/deletion-check` and
`…/account`, 2026-10-24) resolves staff in the same `orgContext` order, inside `reviewOrgDeletion`
([deleteAccount.js](../server/src/services/users/deleteAccount.js)):

| How the super admin is there | What they can delete | `reason` recorded |
|---|---|---|
| As one of the organization's own admins (a membership with role `admin`) | The same as any admin | `org_admin` |
| As a member in some other role | Nothing — `ADMIN_ONLY`, as a blocker the review shows | — |
| In an internal org, without a membership | Like any admin | `super_admin` |
| Under a support grant, support tier | Unused accounts only — a used one is `BREAK_GLASS_REQUIRED` | `super_admin` |
| Under a support grant, break-glass | Any account the rules allow | `super_admin` |

A grant-holder's call names the account in the support-access log (`addAuditSubjects`), and
`refuseVendorStaffTarget` still refuses one that targets a staff account (`STAFF_SELF_MINT`). No caller,
staff included, can delete a staff account here (`STAFF_ACCOUNT`). The platform page
(`DELETE /super-admin/users/:userId`, break-glass) is unchanged, and is still how staff delete an account
that belongs to several organizations.

## Per-surface enforcement (the contract)

**Campaign-nested routers** — `requireCampaignManager` (super/admin/granted-lead): `assignments`,
`campaignHouseholds`, `walklists`, `voted`, `efforts`, `passes`, `setup-status`, `turfs`,
`turfs/:turfId/assignments`, `crew` (the lead crew surface, detailed below), `packets`
(printable walk packets — voter PII on paper, read-only; pinned by
[packet.int.test.js](../server/test/packet.int.test.js)), and — since 2026-10-01 — `voters`
([campaignVoters.js](../server/src/routes/admin/campaignVoters.js): the campaign-scoped voter
directory, a profile that is campaign-scoped for leads and org-wide for admins, and add-note — the
**lead read surface for voter records**, read-only by construction since add-note is the router's
only write; every other profile mutation stays on the admin-only org router. See
[VOTERS.md](VOTERS.md) §B–C). A lead does everything an admin does inside a granted campaign.

**Automatic pause** — [routes/admin/pacePauses.js](../server/src/routes/admin/pacePauses.js), under
`requireOrgRole('admin', 'lead')`, every lookup filtered by `organizationId`. `viewerScope`: org admins
(and super admins) see the org; a lead the campaigns `managedCampaignIds` returns. `GET /` and `GET /:id`
redact for a lead (`shapeWindowVisit`: another campaign's visit is `{ at, fail, otherCampaign }`, and a
hop whose other end is hidden keeps only its seconds and verdict), and add `rosterLines` — the one fact
about another campaign a lead gets, a roster canvasser blocked there. `POST /:id/unpause` follows the
pause's campaign (403 `FORBIDDEN_ROLE` once the lead no longer manages it). Org admins only: `DELETE /:id`,
`GET /settings` (which the Settings page reads, with `chosen` naming every stored recipient and whether
they can still be emailed); `PATCH /settings` additionally needs `billingAccess` (or a super admin) —
403 `billing-access-required`. The live check and the gate judge **canvassers only** (`judgedMember`: role
`canvasser`, active), and any role change moves the member's restart point (`memberships.js`), so a
demotion or promotion never carries old fails.

**Correcting a household pin** — the same `canManageCampaign` policy on **both** write paths, one of
them not campaign-nested: web `PATCH /admin/campaigns/:id/households/:householdId/location` (via the
router's `requireCampaignManager`) and mobile `POST /mobile/households/:householdId/location` (which
calls `canManageCampaign(req, household.campaignId)` **inline**, since its path carries no
`:campaignId`). **Canvassers cannot move a pin** — moving one is a data change with an audit trail, and
leaving it open let a faked door be laundered past the GPS audit (see [AUDIT.md](AUDIT.md) § B.7). This
is the only mobile route with a role gate: everything else under `/mobile` is scoped by data
(`canvasserHouseholdScope`), not by role. Note the ordering — the gate **replaces** the route's
`assertHouseholdAccess` call, whose roster check would otherwise refuse a lead who manages the campaign
but was never rostered onto it as a walker.

**Mobile read surfaces never roster-wall a granted lead (2026-08-07).** The canvasser-facing
readers — `/mobile/bootstrap`, `/mobile/changes`, `/mobile/me/*`, and the voter search/profile on
`/mobile/voters` — used to require a `CampaignAssignment` for any non-admin, so a lead who managed a
campaign but was never rostered as a walker hit a raw 403, and a rostered lead's voter search was
book-scoped into an empty list. All of them now fall through to `canManageCampaign`: a granted lead
gets what an unrostered **admin** gets (empty books on bootstrap, campaign-wide voter search —
manager scope). **Writes are unchanged**: knocks still require a real roster row for non-admins, and
walking still means being rostered. Pinned by
[perRoundVoterView.int.test.js](../server/test/perRoundVoterView.int.test.js) ("granted lead needs
NO roster row") and the walkthrough below. **Since 2026-10-01 the mobile profile is also
campaign-SCOPED for a lead**, not just roster-free: `GET /mobile/voters/:voterId` passes
`scopeCampaignId` to `buildVoterProfile` for every non-org-admin, so a lead's profile carries this
campaign's survey answers and notes only and an empty `otherCampaigns` (an org admin's keeps the
cross-campaign union); a voter outside the resolved campaign answers 403
`{ code: 'VOTER_NOT_IN_CAMPAIGN' }` (status kept at 403 — the shipped app inspects 403 codes — and
deliberately not `FORBIDDEN_ROLE`, which would read as a role change), and the manager-scope search
filters `{ organizationId, campaignId }` instead of a `$in` of every household id in the campaign.
No app update was needed; the server narrows the payload. Detail in [VOTERS.md](VOTERS.md) §C.

**The whole journey is pinned end-to-end** by
[leadWalkthrough.int.test.js](../server/test/leadWalkthrough.int.test.js): one lead runs the entire
lifecycle — config, survey authoring, effort/pass/books, **self-assignment**, the mobile walk (a
real knock), every report surface the mobile admin app calls, packets, exports, a client report
publish + share, and the Users surface — in dependency order, so a regression that walls any step of
the real workflow fails even when each router gate is individually correct.

That parity extends past the router gate into the **assignability** check those routers share:
`partitionAssignable` ([services/campaignRoster.js](../server/src/services/campaignRoster.js)) allows
anyone on the campaign roster, **any active org `admin`**, **a lead holding a `CampaignManager` grant on
_this_ campaign**, or Doorline staff **in an internal org only** — the lead arm scoped to the campaign,
never "is a lead somewhere". Without it a lead could cut turf and hand out every book except their own:
the check matched role `'admin'` only, so self-assignment 409'd as *not on the team*.

**Staff are not assignable in a customer org without a membership** (`internalStaffIdSet`, 2026-10-24,
[PRIVACY_VERIFICATION](PRIVACY_VERIFICATION.md) item 36). The staff arm used to apply in every org, so
a customer's admin or lead could put any Doorline staff account on a book or a walk-list crew. The 201,
where anyone else's id earns a 409, confirmed the id was staff. The book and crew lists then served the
staffer's name and email (the Team list their phone and last sign-in too), and
`ensureCampaignAssignments` put them on the customer's team without the customer adding them. Now a staffer in a customer org needs an active membership like anyone else, and
support access can't mint one (`vendorGuards.js` refuses a grant-holder write that targets a staff
account). The one other way a staff account gets a membership is break-glass org creation, which can
seat the org's first admin. In an internal org, where `orgContext` seats staff as members with no row,
a live staff account still passes. `departedMemberIdSet` (the snapshot-restore gate) applies the same
rule, and the web pickers offer staff "You" only in an internal org (`useCampaignTeam`). Pinned by
[staffRosterScope.int.test.js](../server/test/staffRosterScope.int.test.js) and
[partitionAssignable.int.test.js](../server/test/partitionAssignable.int.test.js).

**Campaign-targeted org routers** — role `('admin','lead')` at the router, then a per-request check:

- **`campaigns`** ([campaigns.js](../server/src/routes/admin/campaigns.js)) — `GET /` returns only
  `managedCampaignIds` for a lead. `POST` (create) and `DELETE` are **admin-only** (inline
  `isOrgAdmin` guard). `PATCH /:id` is allowed for a managed campaign, but a lead's body
  may not carry the org-admin-only keys — `isActive` (archive), `type`, `state`, the key dates
  (`electionDay`, `earlyVotingStart`, `earlyVotingEnd`, `datesNote`), `billRestrictedDoors`, and since
  2026-10-02 `enabledOutcomes`. The lockout loop refuses the first one present with a 403 naming the
  field, before the campaign is even loaded; what's left — `name`, `surveyTemplateId`, `timeZone`,
  `doorGoal`/`goalDate`, `disabledOutcomes`, `doorAddPolicy` — is lead-editable (the comments at the
  loop record each ruling and say not to "tidy" either class into the other).
  - **`enabledOutcomes`** (the off-by-default outcomes, today `not_target`) gets words instead of the
    raw key — `"Only an org admin can turn off-by-default outcomes on or off."` — and is refused on or
    off, `[]` included, so a lead can't switch it off either. Its sibling `disabledOutcomes` stays
    lead-editable (owner ruling 2026-08-16); this one is the org's trust decision (owner ruling
    2026-10-02 — a lead may be the paying client). The switch has **no per-user term once on**: the
    bootstrap's `enabledOutcomes` is turned on ∩ released ∩ survey campaign for every caller (unlike
    `canAddVoters`, which is per user), so a canvasser a lead adds to the crew later gets the button
    too — intended. Pinned by [optInOutcomes.int.test.js](../server/test/optInOutcomes.int.test.js)
    (the lead refusal, on and off, with the same lead's `disabledOutcomes` edit still 200).
- **`imports`** ([imports.js](../server/src/routes/admin/imports.js)) — every campaign-targeted endpoint
  (`/csv`, `/csv/preview`, `/csv/preview-enqueue`, `/geocode-check`, the job detail/errors/undo, and the
  history list) requires the target `campaignId ∈ managedCampaignIds` for a lead (`manages()` helper).
- **`reports`** ([reports.js](../server/src/routes/admin/reports.js)) — a router-level gate requires a
  lead to pass a **managed** `campaignId`; org-wide (no campaignId) reports are refused. This also closes
  a pre-existing gap where `baseFilter` trusted any `campaignId`. The one exception is
  **`/campaign-rollup`** (the multi-campaign list, e.g. the mobile admin landing): it's exempt from the
  gate and instead self-scopes its list to `managedCampaignIds`.
  - **The per-person drills** (`/canvassers/:userId/*`) answer only for someone this request may see,
    checked once on the router's `:userId` param. Anyone else gets the same 404 as an id that doesn't
    exist.
    - **An org admin:** anyone the org carries, meaning a membership in any status, or their own
      knocks (desk marks excluded) or surveys on its ledger (`orgCarriesUser`).
    - **A lead:** only people on a campaign they manage, meaning rostered, granted, coordinating a crew,
      or with their own work there (`campaignsCarryUser`). That is the same wall as the Users list, and
      any managed campaign counts, not just `?campaignId`.
  - **The canvasser CSV's crew stamp** (`?coordinatorId=`) names a coordinator only when the same
    check passes, or when they are stamped on the doors in the export's scope. Anyone else prints
    "unknown coordinator".
  - **Why:** until this fix deployed (PRIVACY_VERIFICATION item 35 records when), `/summary` and
    `/responses` returned any account's name, email, phone and last sign-in by id, to admins and leads
    of any org, and let a lead open anyone in their own org.
- **`client-reports`** ([clientReports.js](../server/src/routes/admin/clientReports.js)) — every handler
  authorizes on the report/series/campaign's `campaignId` via `manages()`; the list scopes to
  `managedCampaignIds`. Leads keep full control of their campaigns' reports, team series and links
  (owner ruling 2026-10-23), including the client links in
  [clientReportShares.js](../server/src/routes/admin/clientReportShares.js), Archive, and Restore in the
  tab's History. **Since 2026-10-28 that includes seeing a link's password**: Share's Show (`GET
  /admin/client-reports/shares/:id/password`) answers the campaign's admins and leads (`loadShareInOrg`:
  the organization, then `canManageCampaign`). A lead sees the password of every link on the campaigns
  they manage, links sent to other people included, so a client given a lead account can too
  (PRIVACY_VERIFICATION item 44(d)). **Doorline staff under a support grant can neither view nor type
  a link password** (`403 STAFF_CANNOT_VIEW_PASSWORD`, `403 STAFF_CANNOT_SET_PASSWORD`; a password made
  up for them is never in the answer), so a grant can't become lasting access to a report through
  `/share`; staff in an internal organization, being members there, can. Three things are admin-only:
  the org-wide report logo (`PUT`/`DELETE /admin/branding/logo`,
  [branding.js](../server/src/routes/admin/branding.js); leads may read it), Erase of an edit's earlier
  text (`POST /admin/campaigns/:campaignId/history/…/erase`, and `?eraseHistory=1` on a report delete),
  and the legacy-link sweep below, which nothing in the app calls since 2026-10-28
  ([CLIENT_PORTAL.md](CLIENT_PORTAL.md)).

**Org-wide, read-for-leads** — `tags`: role `('admin','lead')` so a lead can `GET` the library (to
filter by tag), but every mutation (create, edit, merge, delete) carries a per-route
`requireOrgRole('admin')`.

**Surveys — leads author; admins own the lifecycle; the lead's library is scoped (2026-08-08).**
The `surveys` router is `('admin','lead')`, and a lead's access is per-survey rather than
blanket-denied: `POST /` (create) is **open to leads** — `createdBy` is stamped — while `PATCH /:id`
and `POST /:id/duplicate` gate on `canManageSurvey`
([campaignManagement.js](../server/src/services/authz/campaignManagement.js)): the lead authored it,
or it is attached to a managed campaign as the campaign default or an Effort (walk-list) override.
Archive, unarchive, and `DELETE` carry `requireOrgRole('admin')`.

The **LIST** (`GET /`) applies the same predicate as a set: for a lead the find filter is
`$or [{createdBy}, {_id ∈ attachedSurveyTemplateIds(managed)}]` (the set-form helper lives beside
`canManageSurvey` so the two can't drift), and the usage metadata is narrowed to their campaigns —
`usedByCampaigns`, `usedByWalkLists`, and `responseCountByCampaign` are filtered, `responseCount`
re-derives from the narrowed buckets, and exactly two bare booleans cross that line (no names, no
volumes): **`usedElsewhere`** — on every row in the library, authored ones included: the template is
attached beyond the lead's campaigns right now (archived campaigns and walk lists count; neither
list behind it is filtered by status) — keeps the builder's shared-edit warning honest, and
**`hasResponses`** is org-wide for a template attached to a managed campaign
(`attachedSurveyTemplateIds`; owner ruling 2026-10-03, verbatim *"as long as its part of their
campaigns, yes"*) — the rows the `PATCH`'s `409 survey-has-responses` checks, legacy no-campaign
rows included — so the builder's answer-type and Go to locks match the save; a template in the
library only through `createdBy` keeps the narrowed yes/no. Recorded in
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 26. Without the scoping, the list handed a
client-side lead every template's full question content plus other clients' campaign names and
response volumes.

**ATTACH is guarded the same way, server-side** — the list scoping alone would be cosmetic since
attach went by id: the campaign default (`PATCH /admin/campaigns/:id`,
[campaigns.js](../server/src/routes/admin/campaigns.js)) and the walk-list override (POST/PATCH on
[efforts.js](../server/src/routes/admin/efforts.js), via `resolveOverrideTemplate`) both refuse a
template failing `canManageSurvey` with `403 { code: 'survey-out-of-scope' }` — deliberately **not**
`FORBIDDEN_ROLE`, which mobile treats as a role change. Detach (`null`) stays free; admins are
untouched. The efforts path also gained plain validation (ObjectId shape + org ownership → 400) —
previously any string was stored verbatim. One consequence, the **detach cliff**: detaching an
admin-authored template from a lead's only campaign using it removes it from their scope, and only
an admin can re-attach it. Pinned by [teamLead.int.test.js](../server/test/teamLead.int.test.js)
(list + attach matrices), [surveys.int.test.js](../server/test/surveys.int.test.js) (override
validation), and [leadWalkthrough.int.test.js](../server/test/leadWalkthrough.int.test.js) (the
cliff, live).

**Org-wide, lead-SCOPED** — `memberships` (the Users surface) is `('admin','lead')` since
2026-07-23, with per-route boundaries inside
([memberships.js](../server/src/routes/admin/memberships.js)):

- `GET /` — a lead's list is filtered to `leadVisibleUserIds` (everyone holding a
  `CampaignAssignment` on a campaign in their `managedCampaignIds` grant set; empty grants → empty
  list, default-deny).
- `PATCH /:userId/password`, `/deactivate`, `/reactivate`, `POST /:userId/resend-invite`, and — since
  2026-08-09 — `PATCH /:userId/user` (identity: name/email/phone) — allowed for a lead only when
  `leadMayManageTarget` passes: the target's membership role is **`canvasser`** AND they share a
  managed campaign. Fellow leads and admins are never manageable (privilege-escalation guard).
  Identity edits keep every guard the admin path has — vendor-staff refusal, the tombstone 409, the
  **multi-org email lock** (`MULTI_ORG_EMAIL_LOCKED`), and the duplicate-email 409 — and refuse with
  a plain-message 403, deliberately not `ADMIN_ONLY` (leads sometimes may) and never
  `FORBIDDEN_ROLE` (the mobile shell treats that as a role-recovery signal).
- `GET /:userId/{crews,campaigns,stats,recent-activity}` — read drills allowed for any *visible*
  target (`leadMaySeeTarget`), 403 outside the scope. What they **return** to a lead covers only the
  campaigns the lead manages (`leadCampaignScope`, 2026-10-25, PRIVACY_VERIFICATION item 40): the
  totals and recent doors come from those campaigns' ledger rows, `/campaigns` lists those campaigns,
  and `/crews` keeps every campaign's name (for the switch-off warning) but nulls the coordinator and
  the live flag on the others. They used to answer org-wide, which showed a client-lead another
  client's door addresses for a shared canvasser.
- `POST /`, `PATCH /:userId` (role/grants/billing), `DELETE /:userId` — walled by
  `requireAdminRole` → `403 { code: 'ADMIN_ONLY' }`. So are the two account-deletion routes added
  2026-10-24, `GET /:userId/deletion-check` and `DELETE /:userId/account` ([USERS.md](USERS.md) → *The org
  door*), and the four added 2026-10-30 for the org view's add and a person's campaigns
  ([PROPOSAL_ADD_TO_CAMPAIGNS.md](PROPOSAL_ADD_TO_CAMPAIGNS.md)): `POST /resolve` (who owns an address, with
  their standing and doors on each active campaign; it shares `/crew/resolve`'s hourly counters), `POST
  /by-email` (add and put on campaigns, a crew each), `GET /:userId/campaign-history` and `POST
  /:userId/campaigns` (a profile's Add to campaigns). A lead never reaches them — they add people through
  a campaign's Team page — while `GET /:userId/crews` (above) now also carries `crewSize` on the rows a
  lead may see, which that campaign's roster already tells them.
- **The Remove rule.** `DELETE /:userId` (Remove from org) of a membership with `billingAccess` also needs
  the caller's own billing access: an org admin without it gets `403 BILLING_ACCESS_REQUIRED`, the same
  protection `BILLING_TARGET` gives against deletion — otherwise Remove followed by re-adding the email
  would clear the flag. Staff are exempt, and so is a deleted account's row (anyone may tidy a tombstone).
  Both clients hide Remove and Delete on such a row from a viewer without billing access (the phone gained
  Remove from org on 2026-10-24).
- **No org without a live admin.** Remove from org, a demotion (`PATCH /:userId` role or `isActive:false`)
  and `/deactivate` re-count LIVE admins after their write and undo one that reached zero
  (`409 LAST_ADMIN`), mirroring the billing backstop. An admin acting on another admin is always one of
  those left, so only a race (two admins taking each other out from two doors, one of them a deletion) or a
  staff actor can reach it.
- The whole matrix is pinned by
  [`test/leadUserManagement.int.test.js`](../server/test/leadUserManagement.int.test.js).

**Org-only, leads blocked** — `voters` (the org-wide voter directory, `/admin/voters`) stays
`requireOrgRole('admin')` with no per-route carve-outs — the lead read surface for voter records is
the separate campaign-nested `voters` router above (`/admin/campaigns/:campaignId/voters`), never a
carve-out on this one; `dnc` is mounted org-level and admin-only on purpose (see below); and `queues`
is stricter than the old "admin" framing here — its one route is `requireSuperAdmin`, a **platform**
surface, so even org admins don't reach it (the web mounts it under `RoleGate require="super"`).

> ⚠️ **One write on `leadCrew` is NOT campaign-shaped, and it is the only one.**
> `PATCH .../crew/:userId/deactivate` and `.../reactivate` write `Membership.isActive`, and
> [`Membership`](../server/src/models/Membership.js) has **no `campaignId`** — one row per person per
> org. So the usual guarantee on this router ("the campaign in the URL bounds the blast radius") does
> **not** hold for these two, and they are guarded on the **target** instead:
>
> - the role lives **inside the update filter**, not in a read before it — a read-then-write races a
>   concurrent promotion to `{role:'admin', billingAccess:true}` and would defeat *both* billing
>   layers, which were computed against the stale snapshot;
> - `User.isSuperAdmin` is refused outright — a super-admin can hold an ordinary canvasser membership,
>   and switching it off would force Doorline staff onto the support-grant path where every request
>   logs as vendor intrusion, poisoning the audit trail `orgContext` exists to keep clean;
> - vendor staff (support-grant holders) are guarded per **target**, not per router: the 2026-07-29
>   owner decision removed the blanket `VENDOR_READ_ONLY` rule (never re-add it), so a support grant
>   now permits crew writes — every one recorded by `accessLog` — with one surviving refusal: any
>   write **targeting** a Doorline staff account, via `refuseVendorStaffTarget`
>   ([vendorGuards.js](../server/src/services/memberships/vendorGuards.js)), which guards all four
>   leadCrew writes (create, coordinator, deactivate, reactivate);
> - the response carries **`alsoAffects`** — the other campaigns this reaches. The clients disclose
>   the reach **before** committing by reading `GET /admin/memberships/:userId/crews` into the
>   confirm dialog (mobile MemberSheet + member detail, the web person panel): `/crews` resolves
>   campaign *names* and is deliberately **not grant-filtered**, so the list names campaigns the
>   acting lead doesn't manage — which is the point. (Only the names, since 2026-10-25: on campaigns
>   the lead doesn't manage, the coordinator and the live flag come back null, item 40.) (Never resolve ids against `GET
>   /admin/campaigns` for this — that list is lead-scoped and drops exactly the campaigns the
>   warning exists to name.)
>
> They ship as a **pair**. A deactivate without its inverse would be a one-way door for a lead, and
> their books stay assigned precisely because reactivation is one tap away — the same reason the org
> route doesn't release work either.

**Campaign-map data — allows leads, authorized per campaign.** The campaign Map tab is lead-visible, so
its data endpoints allow `('admin','lead')` and gate leads on the campaign: `households`
([households.js](../server/src/routes/admin/households.js)) — `GET /map` requires a managed `campaignId`
(no org-wide map), and `GET /:householdId/activity` authorizes on the household's `campaignId`; and
`activities` (`GET /admin/activities/:id`, the ping detail) authorizes on the activity's `campaignId`. So
a lead sees the map + ping/household detail only for campaigns they manage.

**Export Center — campaign-scoped for leads.** `exports` is `('admin','lead')` with the
imports/reports posture ([exports.js](../server/src/routes/admin/exports.js)): a lead may create and
download exports of a **managed** campaign; the org-wide scope (`campaignId: null`) and the
admin-only types are refused (`def.adminOnly || !campaign` → `isOrgAdmin`), the type list is
filtered per role, and the history list scopes to `managedCampaignIds` — a lead's `$in` filter never
matches `null`. Pinned by [exports.int.test.js](../server/test/exports.int.test.js).

**DNC — deliberately NOT lead territory.** `/admin/dnc` is mounted **org-level**, not
campaign-nested, and gated `requireOrgRole('admin')` ([dnc.js](../server/src/routes/admin/dnc.js)):
DNC is an org-wide fact on the Voter, and the campaign-nested `voted.js` gate
(`requireCampaignManager`) would admit leads — the mount comment in
[routes/index.js](../server/src/routes/index.js) records exactly this. Pinned by
[dnc.int.test.js](../server/test/dnc.int.test.js).

**Import mapping profiles — deliberately lead-writable.** `GET`/`POST /admin/imports/profiles` are
org-wide, name-keyed vendor column mappings behind only the router's `('admin','lead')` gate: a lead
can read them and save/overwrite one by name. Owner-ruled 2026-08-07 — leads run imports, so they
keep profile self-service; the profiles hold column mappings, never voter data.

**Client-report shares — one write is org-shaped, and it is admin-only.** Every share route
authorizes leads per campaign via `manages()`
([clientReportShares.js](../server/src/routes/admin/clientReportShares.js), since 2026-10-24; it was
part of clientReports.js) — except
`POST /shares/revoke-legacy`, the org-wide sweep that kills every legacy-open link at once. That is
an org operator's switch, so since 2026-08-07 it carries a per-route `requireOrgRole('admin')`;
before that a lead could enumerate and bulk-revoke links on campaigns they held no grant for. Pinned
by [reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js). Since 2026-10-28 nothing in
the app calls it (the links panel is gone), and every legacy-open link is a link to all of a campaign's
reports, which the `RETIRE_ALL_REPORTS_LINKS` switch turns off for every organization at once
([CLIENT_PORTAL.md](CLIENT_PORTAL.md) §K); the route still answers, admin-only.

**The lead's crew surface** — `leadCrew` ([leadCrew.js](../server/src/routes/admin/leadCrew.js)) at
`/admin/campaigns/:campaignId/crew`, behind `requireCampaignManager`:

- **`GET /`** — **this campaign's roster**, plus a separate `coordinators` array. Until 2026-08-08 this
  ran `Membership.find({ organizationId, isActive: true })`: every active member of the **whole
  organization**, with name, email, org role and `isSuperAdmin`. It was the campaign Team page's
  add-picker, and the web page routed **leads** here *specifically because* they cannot reach
  `/admin/memberships` — so a lead's picker was **wider** than the org Users list, which has always been
  narrowed to `leadVisibleUserIds`. A lead may be the client's own campaign manager, so that was another
  client's staff list. Rows are now scoped to the campaign; **fields are unchanged**, because the shipped
  mobile book-assign pickers read this list and already intersect it with the roster
  (`mobile/app/(app)/admin/books.jsx`), making the narrowing a no-op for them.
  `coordinators` is name-and-role only (no email) and is deliberately **org-level**: `resolveCoordinatorId`
  accepts any active admin or lead, and managing a campaign does not put you on its roster, so deriving
  the crew dropdown from the roster would empty it on a campaign whose lead does not walk.
- **`POST /resolve`** `{email}` → `{ outcome, person }`. The lookup behind the add box. `on-campaign` /
  `in-org` / `in-org-inactive` name the person; **`outside` is one indistinguishable answer** covering *no
  account anywhere*, *an account in another organization*, and *an address released by a deleted account* —
  no name, no role, no account status, nothing to compare (the body is byte-identical, and the membership
  query runs whether or not an account exists). A named answer also carries `history: { doors, sources:
  [{ coordinatorId, name, doors, canLead }] }` — this campaign's doors and the teams they count for, newest
  first, so the add step can pre-pick a returning person's old crew — and, for `in-org-inactive` only,
  `onCampaign`. POST rather than GET so an address never enters a URL or a proxy log. **Rate-limited per
  actor** ([crewResolveLimit.js](../server/src/middleware/crewResolveLimit.js)) with two counts since
  2026-10-27 (the owner's call: an add of many new people in an hour is plausible, a probe of many
  colleagues is not): **60 an hour** for lookups that find nobody, **30 an hour** for lookups that name
  somebody. Once either runs out every lookup waits, so the 429 (`code: 'rate-limited'`,
  `retryAfterSeconds`) can't tell the two apart. The limits are the defence: an `AccessLog` row is written
  only for Doorline staff working under a support grant (`middleware/accessLog.js`), as for every other
  read, never for a customer's own staff. (This bullet used to say every named answer writes an
  `AccessLog` subject line; it never did — corrected 2026-10-27.)
- **`POST /`** — resolve-then-branch. `linkExisting` is still **accepted and ignored** (released mobile
  binaries send it); what the address resolves to decides. Free address → create + set-password invite
  (`outcome:'created'`). Colleague in this org → **claim**: roster row only, **no membership write**, so a
  lead can never silently promote or demote anyone (`'in-org'`, `addedToCampaign`). Already on the campaign
  → idempotent no-op (`'on-campaign'`, no email, crew included). Every add takes `coordinatorId` (absent or
  `null` = No crew) and joins through `joinCampaignCrew`, so a returning person's earlier doors here move to
  that crew, and the 201's `restamp` says how many and from which teams (`sources`). The can't-be-your-own-
  coordinator check gets the person's id only for a **named** outcome: for `outside` it would answer for
  the account behind the address, and its 400 would say the address has one. Address that turns out to hold an account **elsewhere** →
  attach that real person, **discard the typed name and password** (`'attached'`, `attached:true`,
  `addedToOrg`) — overwriting a stranger's name would be a lie, and setting their password is the takeover
  path in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 14. Switched-off colleague →
  `409 MEMBER_DEACTIVATED` for a lead (reactivating is org-wide), reactivate-and-roster for an admin.
  The old `EMAIL_EXISTS_USE_LINK` / `ALREADY_MEMBER` round trip is gone **from this route** — both were the
  server asking the client to retry with different intent. `POST /admin/memberships` (admin-only) is
  unchanged and still uses them — for phones without the 2026-10-30 update; the web Users page and the
  phone hub now add through `POST /admin/memberships/by-email`, which resolves like this route.
- **`PATCH /:userId/coordinator`** + **`GET /:userId/coordinator-preview`** — both scoped to this
  campaign's roster. The PATCH takes `fromCoordinatorId` (the crew the client previewed) and answers
  `409 changed-meanwhile` or `409 busy` instead of moving anyone twice; only a new pick is validated, so
  Finish it works for a crew whose coordinator was switched off ([USERS.md](USERS.md) → *Crews*).
- **`POST /coordinator-bulk/preview`** + **`PATCH /coordinator-bulk`** (since 2026-10-27) — Move to crew
  for up to 500 people (preview) and 10 per write. For a lead, anyone not on this campaign's roster comes
  back `skip: 'not-on-campaign'` with no name or counts, so the preview can't be used to look people up.
  An org admin's preview also reads off-roster people (for the add checks), but the write never puts
  anyone on a campaign: adding is `POST …/assignments`. The preview's `intent` (`'move'` or `'join'`)
  matches its totals to the write that follows. Other skips: `not-in-org`, `deleted`, `switched-off`,
  `already-on-campaign`, `staff`, `is-coordinator`, `same-crew`, `busy`.

`POST /` and the coordinator write refuse on an **archived** campaign (409 `campaign-archived`); the crew
door used to bypass that read-only promise while `.../assignments` honoured it. `/resolve` is exempt (writes
nothing), and so are deactivate/reactivate — org-wide acts that merely arrive through a campaign URL.

This is how a lead builds a crew without the org Users admin. Removing *existing* members and reading the
roster still go through `.../assignments`, with two lead rules since 2026-10-25 (PRIVACY_VERIFICATION item
41): a lead's `POST` there takes **only their own id** (the phone's self-assign when they take a book),
and books and walk-list crews take only the lead themself off the team (`partitionAssignable`
`selfOnlyFor`), so the team can't be used to read another member's email and phone; and a lead's `DELETE`
reaches **canvassers and themselves**, never an org admin, another lead or Doorline staff. Both refusals
are a plain-message 403, never `FORBIDDEN_ROLE`; the add refusal is the same for every other id, and a
removal of someone the org and campaign don't have answers like a made-up id, so neither says who is a
member or who is staff.

**A lead's coordinator change is confined to the campaign in the URL — structurally, not by
convention.** A crew lives on `CampaignAssignment.coordinatorId` (unique `{campaignId, userId}`), so
both the roster write and the **ledger re-stamp** that follows it (see [USERS.md](USERS.md) and
[METRICS.md](METRICS.md#teams-coordinators--the-counting-contract)) are keyed on
**`req.params.campaignId`** — resolved through `loadOwnedCampaign`, which also re-checks org ownership.
That is *the same param* `requireCampaignManager` gated the mount on, which is the whole guarantee: a
lead physically cannot address a campaign they weren't granted, because there is no campaign id in the
body to forge. Changing a crew in campaign A moves zero doors in campaign B. The preview endpoint still
exists so they see the door count before committing — now **this campaign's** count.

> ⚠️ **Take the scope from the URL, never from the body — and never let it default.**
> `restampFilter` ([restampCoordinator.js](../server/src/services/memberships/restampCoordinator.js))
> **requires** a `campaignId` and throws without one, rather than treating an omitted scope as
> "everything". That was the bug: the crew used to live on `Membership` (unique
> `{userId, organizationId}` — one slot per person per org), so two leads managing two campaigns with a
> shared canvasser overwrote each other, and the org-wide re-stamp then dragged the **first** campaign's
> entire history onto the **second** lead's team, in a race that lead does not manage.

Member creation + validation is shared in
[services/memberships/createMember.js](../server/src/services/memberships/createMember.js)
(`createOrgMember`, `resolveCoordinatorId` — now accepts admin **or** lead coordinators —,
`resolveManagedCampaigns`), reused by both `memberships` and `leadCrew`. Since 2026-10-27
`createOrgMember` takes no campaign and no crew at all: joining an **org** carries no crew, and putting
the person on a campaign — with the move of any earlier doors there — is the caller's
`joinCampaignCrew`, the same join every way onto a roster uses.

## Granting (admins only)

`POST/PATCH /admin/memberships` accept `managedCampaignIds[]` when the role is/becomes `lead`;
`resolveManagedCampaigns` validates every id is a campaign in the org, and the route reconciles
`CampaignManager` rows (upsert the set, delete the rest). Leaving the `lead` role clears all grants;
`DELETE /:userId` clears them too. `GET /admin/memberships` returns each member's `managedCampaignIds`,
narrowed for a lead reader to the reader's own grants (2026-10-25): a fellow lead's grants on other
campaigns are another client's campaigns.
It also returns each member's **`campaignIds`** — the campaigns they are ROSTERED on
(`CampaignAssignment`), which is a different fact from the grant set above. That list is
**scoped for a lead** to campaigns they actually manage: the member list is already narrowed by
`leadVisibleUserIds`, but an unfiltered assignment set would tell a lead every campaign each of
their canvassers is on, including ones they hold no grant for. `fbtime {linked, personName,
source}` rides the same response but is **admin-only** and null unless the org has a live FbTime
connection — the org-wide roll-up is a wider disclosure than the per-user one a lead already gets
from `GET /:userId/stats`.
The login / `/auth/me` payload carries `managedCampaignIds` on a lead membership so the client scopes
without an extra fetch.

## Who may open the console: the one predicate

[client/src/lib/roles.js](../client/src/lib/roles.js) is the **single** definition of "this membership
role can use the web console" — `CONSOLE_ROLES = ['admin', 'lead']`, plus `isConsoleRole`,
`consoleMemberships`, `nonConsoleMemberships`, and `autoSelectOrgId`. Super admin is a global `User`
boolean, not a membership role, so it is deliberately **not** in that list; callers pass `isSuperAdmin`
separately to `consoleHomePath` ([lib/homePath.js](../client/src/lib/homePath.js)). Never inline
`role === 'admin' || role === 'lead'` again.

The bug that produced this file: the org picker and the sidebar switcher each built their own unfiltered
membership list, so a user who was an admin in Org A and a **canvasser** in Org B could pick Org B, get
routed by `homePathForRole('canvasser')` to the admin-only `/admin`, and hit a Forbidden screen that had
replaced the whole app — no nav, no way back, and sticky across reloads because `canvass.activeOrgId`
persists in `localStorage`.

`homePathForRole` is now a lookup (`{admin: '/admin', lead: '/campaigns'}`) that returns **`null`** for
any other role, so no role can silently land on `/admin` again. `resolveHomePath` counts *console*
memberships: exactly one → enter it and skip the picker; two or more → the picker; zero → `null`.

**A team lead with one active campaign lands inside it** (2026-10-13,
[PROPOSAL_LEAD_CAMPAIGN_LANDING.md](PROPOSAL_LEAD_CAMPAIGN_LANDING.md)). The server puts
`homeCampaignId` on every lead membership row from `/auth/login`, `/auth/me`, `/auth/change-password`
and `PATCH /auth/me` ([routes/auth.js](../server/src/routes/auth.js) `loadMembershipsForUser`): the one
campaign they hold a grant for in that org that is active and not mid-delete, else `null`. Admin rows
never carry it. `consoleHomePath({ role: 'lead', homeCampaignId })` returns `/campaigns/<id>`, and
`resolveHomePath` passes it for the active org and for the only console org, so every landing — sign-in,
the org picker (including its auto-enter), the org switcher, a password change, the marketing CTA, the
Forbidden button — follows. It is a **landing rule only**: `/campaigns` stays a real page (the only home
of a campaign's Edit and Assignments), so nothing may ever redirect `/campaigns` or `/campaigns/:id`.
Because a home can now be a campaign's root, never compare `homePath` to a string — use
`isConsoleHomePath(path)` (LoginPage's deep-link restore) and `homeLinkLabel(path)` (the Forbidden and
"Campaign not found" buttons: Go to Campaigns / Go to your campaign / Go to Control Room / Choose an
organization / Go to Overview). `CampaignMissing` sends a lead whose own home is the missing campaign to
`/campaigns` instead, so it can't loop. The phone decides the same thing from the lead's
`/admin/campaigns` list (`mobile/lib/campaignSelection.js` `soleActiveCampaign`/`overviewChoice`);
[leadHomeCampaign.int.test.js](../server/test/leadHomeCampaign.int.test.js) pins the two to one answer.

**`null` is a destination, not an error.** `postAuthPath()` (same file) is `resolveHomePath(args) || '/select-org'`,
and every post-auth caller uses it — `LoginPage` (both the submit path and the already-signed-in guard) and
`ChangePasswordPage`. `/select-org` explains that the console is admins-and-leads only and carries the
**Get the app** install card. Before this, `LoginPage` rendered a dead-end red error naming roles the user
doesn't have, so a canvasser who set their password from an emailed invite link had nowhere to go at all —
the one path `ChangePasswordPage` had always handled correctly.

## The gate invariant

> **A gate that wraps `<Layout/>` may only *redirect*. A gate that renders *inside* `<Layout/>` may
> render `<Forbidden/>`.**

Breaking this rule is what made the bug unrecoverable rather than merely wrong.

- [ProtectedRoute.jsx](../client/src/components/ProtectedRoute.jsx) is the **ORG-level** gate and wraps
  `<Layout/>`, so with a user it only ever `<Navigate>`s: owes a password change → `/change-password`;
  no active org → `/select-org`; **active org but no console role in it** → `/select-org`. With no user
  it redirects to `/login` (carrying the reason for a deliberate end), except in its only two
  non-redirect branches, which render where no Layout exists and each keep a way out: a blank page under
  the in-place password prompt when the page opened on a sign-in that ran out, and the "Couldn't reach
  Doorline." card (Try again / Sign in again) when the page-load check couldn't reach the server
  ([USERS.md](USERS.md) → *Sessions*). Props are `requireActiveOrg`, `requireConsoleAccess`,
  `allowPasswordChange`. No redirect loop is possible: every target is mounted with those flags off.
- [RoleGate.jsx](../client/src/components/RoleGate.jsx) is the **ROLE-level** gate and lives *inside*
  `<Layout/>` as a pathless layout route (`require="orgAdmin" | "billing" | "super"`). On failure it
  renders [Forbidden.jsx](../client/src/components/Forbidden.jsx) in the content area, with the sidebar,
  the org switcher and Sign out still on screen. It replaced four inline
  `<div className="p-8 text-danger">Forbidden…</div>`s.

`AuthContext` **self-heals** a stale `activeOrgId`: if the persisted org is one the user has no console
role in (demoted, removed, hand-edited, left over from an older build), it is cleared, so the app can
never be pinned to an unusable org across reloads. Super admins are exempt — they legitimately hold an
`activeOrgId` for orgs they aren't members of. `AuthContext.homePath` is guaranteed non-null (falls back
to `/select-org`) because six render-time consumers pass it straight to `<Link to>` / `navigate()`.

Two more `AuthContext` rules every caller relies on. **`switchOrg` drops the previous org's cached pages**
when the org actually changes (keeping only the platform org list), so the org pickers, the support prompt
and the platform switcher can't forget it — a lead's home campaign would otherwise resolve against the old
org's list. **`useSignOut()`** is the one way an in-console button signs someone out (the password prompt's **Not you?
Sign out** does `logout()` plus a full load of `/login`, to the same effect): it ends the session and goes to a
plain `/login`, so the sign-in page never sends the next person back to the page the last one was on (a bare
`logout()` let `ProtectedRoute` stash `from`).

## Client & mobile scoping

- **Web** — `AuthContext` derives `isOrgAdmin`, `isLead`, `isConsoleUser` (the *active* org) and
  `hasConsoleAccess` (*any* org), plus `managedCampaignIds`. [App.jsx](../client/src/App.jsx) mounts
  **two** `<Layout/>` shells: an **org-scoped** one (`requireConsoleAccess` — all campaign pages, incl.
  import and the campaign Survey select *and builder*, which leads may reach; the server's
  `canManageSurvey` enforces per-survey scope) with a nested `RoleGate require="orgAdmin"` around the
  org-admin screens (Overview, Surveys, Tags, the org-wide Voters directory, Users, duplicate-surveys —
  the campaign `/campaigns/:id/voters*` pair lives in the campaign block outside that gate, so leads
  reach it) and a `RoleGate
  require="billing"` nested inside that around `/billing`; and an **org-agnostic** one
  (`requireActiveOrg={false}` — `/profile`, `/help`) with a nested `RoleGate require="super"` around
  the platform screens — including the Jobs/queues screen, which lives in the super shell (not the
  orgAdmin group) because its server route is `requireSuperAdmin`. Nav
  ([navItems.js](../client/src/components/navItems.js) + [Layout.jsx](../client/src/components/Layout.jsx)
  + [BottomNav.jsx](../client/src/components/BottomNav.jsx)) filters the top-level list to `leadVisible`
  (just Campaigns) for a lead; the full campaign drill-in nav — the campaign **Voters** tab included — is
  the same for both roles.
  [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) hides create/edit/archive/delete for leads;
  [AppCustomizationPage.jsx](../client/src/pages/AppCustomizationPage.jsx) renders the *Off until you
  turn it on* switch **disabled, never hidden**, unless `useAuth().isOrgAdmin` — a lead reads whether
  it's on, with "Only org admins can turn this on or off." — while the outcome switches and the
  Add-person radios above and below it stay live for them;
  [CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) **shows** a lead the authoring
  affordances (New/Edit/Duplicate) via `canManage = isOrgAdmin || managedCampaignIds.includes(campaignId)`,
  with the server's `canManageSurvey` as the per-survey authority;
  [CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) adds people **by email address** for
  both roles, crew picked before the add, and is where a crew is set on the web — one person in their
  panel, several with **Move to crew…** (the org Users page shows existing crews read-only; its Add member
  and a panel's Add to campaigns set a crew only for a campaign they put someone on).
  Login/select-org land a lead on `/campaigns` (they have no `/admin` Overview), or inside their one
  active campaign when they have exactly one (`homeCampaignId`, above).
- **The `/admin/memberships` fork** — that route is admin-only, so any *campaign* page that reads it for
  a name list breaks for a lead. Three pages branched on `isOrgAdmin` and called
  `/admin/campaigns/:id/crew` instead, keying the query `['admin','campaign-crew',campaignId]` so the two
  never share a cache entry. **The failure mode that made it worth a bullet:** the 403 arrived as an empty
  array, so the picker rendered *empty* and the labels rendered *blank* — the UI asserting there is nobody,
  rather than that you may not look. Both web cases were found only by grepping for the pattern after the
  mobile one was reported.
  **Since 2026-08-08 the fork is mostly gone, because the endpoint it forked to was the leakier of the
  two** (see the crew surface above). Where each page landed:
  - `CampaignTeamPage` — **no fork**. Both roles read the campaign-scoped `crew` list; adding is **Add
    people → By email**. An **org admin** additionally gets **From your organization**, which reads
    `/admin/memberships`, for bulk staffing (typing twenty addresses would be worse than the picker it
    replaced); a lead never fetches it.
  - [CampaignAssignmentsModal.jsx](../client/src/components/CampaignAssignmentsModal.jsx) — opened from the
    Campaigns page's **ungated** action list, so a lead reaches it; it was therefore the *second* copy of
    the org directory. Since 2026-10-27 it only lists and removes (item 41's rule for a lead): its Assign
    branch is retired for a link to the Team page's **Add people**, so there is one way to add someone,
    with the crew and the door check.
  - [EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) (the "assigned by" labels) — **no fork**: names
    now resolve from `.../assignments`, which keeps a row for someone since removed from the campaign.
    Resolving them against the crew list would have reintroduced the exact blank-name failure above.
- **The two org lists** — [SelectOrgPage.jsx](../client/src/pages/SelectOrgPage.jsx) makes only
  `consoleMemberships` selectable, renders `nonConsoleMemberships` as a muted, non-interactive **"No
  console access"** section pointing at the mobile app, and auto-enters when there is exactly one console
  org. [OrgSwitcher.jsx](../client/src/components/OrgSwitcher.jsx) lists only `consoleMemberships` and,
  critically, **navigates to the new org's home on every switch** (for a lead with one active campaign
  there, that campaign). Not navigating was a second bug:
  a URL is org-scoped, so switching while sitting on `/users` (admin → lead org) 403'd, and switching
  while drilled into `/campaigns/<old org's id>` produced "Campaign not found".
- **Mobile** — canvasser-first, so **every** membership is selectable and there is no Forbidden screen
  anywhere: every gate is a `<Redirect>`, and the root re-router ([index.jsx](../mobile/app/index.jsx))
  re-derives the role after each org switch. [lib/role.js](../mobile/lib/role.js) mirrors the web split —
  `isOrgAdmin` (unscoped org authority; **excludes** `lead`) vs `isConsoleUser` / `isConsoleRole` (may see
  the admin app; **includes** `lead`). Gate admin *entry points* on `isConsoleUser`, billing/org-wide
  affordances on `isOrgAdmin` — which is also what disables the *Off until you turn it on* switch in
  [admin/app-customization.jsx](../mobile/app/(app)/admin/app-customization.jsx) for a lead
  (`loadRoleContext().isOrgAdmin`, held in state that starts `false`, so a lead never gets a live
  switch even for a frame). [admin/_layout.jsx](../mobile/app/(app)/admin/_layout.jsx) and
  [index.jsx](../mobile/app/index.jsx) both use `isConsoleRole`; the canvasser drawer's **Admin
  dashboard** row is gated on `isConsoleUser` (it was `isOrgAdmin`, which stranded a lead who switched to
  canvass mode). In [more.jsx](../mobile/app/(app)/admin/more.jsx) the org Users row is **shown** to
  leads (server-scoped to their campaigns' rosters since 2026-07-23 — the old `isLead` branch that hid
  it was deleted as dead code); the **Duplicate surveys** row is likewise `isConsoleUser`, but the
  Delete inside that screen is `isOrgAdmin`, since `admin/voters.js` is `requireOrgRole('admin')`
  router-wide — a lead reads every duplicate and can remove none. The campaign screen's **Team** tile
  ([components/CampaignHome.jsx](../mobile/components/CampaignHome.jsx), hosted by
  [campaign/\[campaignId\].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx)) opens the
  **Users hub pre-filtered to that campaign** ([users.jsx](../mobile/app/(app)/admin/users.jsx)) —
  since the 2026-07-23 change made `/admin/memberships` lead-scoped server-side, the hub is one
  surface for everyone. (The historical bug this area carried: before the scoping, a lead's
  `/admin/memberships` call 403'd and the hub rendered the failure as **"No users yet"** — the app
  stating as fact that the organization is empty to somebody simply not allowed to look.) The member
  sheet ([MemberSheet.jsx](../mobile/components/MemberSheet.jsx)) carries a coordinator picker
  (staged pick → `coordinator-preview` door count → confirm, sending `fromCoordinatorId`, with **Finish
  it** when the open-time preview says so) wired to the campaign-scoped `crew` endpoints, and the hub's
  **Move all shown to a crew…** uses the bulk pair, so crews are settable from mobile as well as from
  [CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) on web. The **canvasser** flow is
  untouched — a lead who walks is scoped as a canvasser via `CampaignAssignment` exactly like anyone
  else.

## Machine-readable 403s

Both role gates in [middleware/auth.js](../server/src/middleware/auth.js) (`requireOrgRole`,
`requireOrgMember`, `requireCampaignManager`) return `403 { error, code: 'FORBIDDEN_ROLE' }`, and every
org-resolution failure in [middleware/orgContext.js](../server/src/middleware/orgContext.js) (not a
member → 403, org not found → 404, bad header → 400) carries `code: 'ORG_CONTEXT'`. The distinction is
what lets the clients self-heal *correctly*:

- **`ORG_CONTEXT`** = "that isn't your org" → drop `activeOrgId`, route to the picker. Both clients do
  this ([client/src/api/client.js](../client/src/api/client.js);
  [mobile/app/_layout.jsx](../mobile/app/_layout.jsx)'s `QueryCache.onError`).
- **`FORBIDDEN_ROLE`** = "the org is fine, your role isn't." The web client deliberately does **not**
  eject on this (a lead calling an admin-only endpoint is a bug to fix, not a reason to sign them out).
  Mobile uses it to detect a **mid-session role change**: it refetches `/auth/me` via
  [lib/session.js](../mobile/lib/session.js) and only re-routes if the role actually changed — which
  makes the recovery loop-proof. `refreshSession()` also runs on app foreground, on the authenticated
  shell mounting, and before the org picker lists memberships, since mobile otherwise cached roles at
  login and never refetched them.

## Verification

Server files pass `node --check`; the client passes `npm run build`.

**The console-access rule** is a pure function, so it's unit-tested with no React, DOM or DB:
[client/src/lib/homePath.test.js](../client/src/lib/homePath.test.js) (`npm --prefix client test`) walks
the roles × org-count matrix and locks the regressions — `homePathForRole('canvasser') === null`;
admin-in-A + canvasser-in-B resolves to `/admin` **even with a stale `activeOrgId` pointing at B**;
`autoSelectOrgId` never picks a canvasser org; and `consoleHomePath` still handles the synthetic
`'super_admin'` role the two org lists build (the trap in the refactor — a lookup map returns `null` for
it, which would have silently broken super-admin org entry). It also pins the home campaign: a lead with
one lands in it, an admin with a stray id never does, and `isConsoleHomePath` / `homeLinkLabel` are total.
[landingRender.smoke.test.js](../client/src/lib/landingRender.smoke.test.js) renders the screens that use
them (CampaignMissing, Forbidden, the sidebar's campaign box).

**The authorization matrix** is covered by throwaway-mongod integration tests (`npm --prefix server run
test:int`):

- [leadHomeCampaign.int.test.js](../server/test/leadHomeCampaign.int.test.js) — `homeCampaignId` on
  `/auth/login` and `/auth/me` for every shape (one, one + archived, two, none, only archived, one +
  mid-delete, two orgs, a grant pointing at another org's campaign, an admin row), plus the agreement
  check against each lead's own `/admin/campaigns` list.
- [teamLead.int.test.js](../server/test/teamLead.int.test.js) — seed an org, an admin, and a lead granted
  campaign A only (with a campaign B they don't manage), then assert the lead gets 200 on A's field
  routes / import / scoped reports (overview, the notes feed, campaign-rollup self-scoping) /
  campaign survey PATCH / the campaign map / household activity / the activity ping detail, and 403
  on the same for B, on campaign create/archive/delete, on tag creation, on survey
  archive/unarchive/delete, and on the org voter directory. Survey **create** is asserted **201** —
  leads author — and edit/duplicate follow the `canManageSurvey` scope (own or managed-attached yes,
  unmanaged-attached no). The lead's survey list carries `hasResponses` org-wide for a survey on
  their campaigns — as a walk-list survey or as the campaign's own (another campaign's answers, a
  legacy no-campaign row) — and narrowed for one they only authored; on every survey on their
  campaigns it agrees with the `PATCH`'s 409 (the authored-only one keeps its narrowed false while
  its save still refuses, by ruling); it never names another campaign, and carries exactly six
  annotation keys. `GET /admin/memberships` is asserted **200 lead-scoped** (since
  2026-07-23); the full Users boundary matrix is
  [`leadUserManagement.int.test.js`](../server/test/leadUserManagement.int.test.js)'s job. `.../crew`
  is 200/201, `GET /admin/campaigns` returns only A, and role 403s carry `code: 'FORBIDDEN_ROLE'` at
  both the org and campaign gate. Lead scope on the newer surfaces is pinned elsewhere: packets in
  [packet.int.test.js](../server/test/packet.int.test.js), exports in
  [exports.int.test.js](../server/test/exports.int.test.js), the DNC refusal in
  [dnc.int.test.js](../server/test/dnc.int.test.js), the flags list + bulk review in
  [flagBulkReview.int.test.js](../server/test/flagBulkReview.int.test.js), the canvasser timeline and
  overlap doors in
  [perCanvasserAndOverlaps.int.test.js](../server/test/perCanvasserAndOverlaps.int.test.js), the
  admin-only `revoke-legacy` share sweep in
  [reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js), and the refused
  `enabledOutcomes` PATCH (on and off) in
  [optInOutcomes.int.test.js](../server/test/optInOutcomes.int.test.js).
- [perCampaignCrews.int.test.js](../server/test/perCampaignCrews.int.test.js) — the scope guarantee
  above, as a fixture no other suite could build: **two campaigns in ONE org** (Asa leads HD54, Frank
  leads HD64, Maria canvasses both). Asserts that two leads setting Maria's crew in their own campaigns
  don't clobber each other, and that Frank's change in HD64 moves **zero** doors in HD54 — the campaign
  he does not manage. `teamAttribution.int.test.js` puts its second campaign in a *different* org, so
  all 22 of its tests stayed green through both bugs: a suite that cannot construct the failure cannot
  report it.
- [multiOrgRoles.int.test.js](../server/test/multiOrgRoles.int.test.js) — the mixed-role contract: ONE
  user who is `admin` in Org A and `canvasser` in Org B. Asserts login returns **both** memberships with
  their true roles (the client's picker filter depends on the canvasser row being present), that
  admin-only routes with `X-Org-Id: B` are 403 + `FORBIDDEN_ROLE` (the server never trusted the client's
  role logic), that an org with no membership is 403 + `ORG_CONTEXT` (a *different* recovery), and that
  Org B still serves the routes a canvasser is entitled to.
