# Campaigns (start one, manage it, extend it)

The campaign is the top-level container for a canvassing project — its voters, walk lists, passes,
surveys, and reports all hang off it. This doc covers the **setup flow at a glance** plus the rules
for **managing** a campaign afterward (editing, archiving, deleting) and **extending** a live one
(adding more doors as a new walk list). For a click-by-click first-run walkthrough, see
[GETTING_STARTED.md](GETTING_STARTED.md).

- **Part 1 — For everyone** is plain language: the first-campaign flow at a glance, the on-screen
  guide that walks it, and the management/extend rules.
- **Part 2 — Technical reference** is for developers (and Claude): the model, endpoints, the
  setup-progress derivation, the delete cascade, and the frontend files.

Related: [GETTING_STARTED.md](GETTING_STARTED.md) (the step-by-step first-run walkthrough),
[EFFORTS.md](EFFORTS.md) (walk lists own the doors and passes), [IMPORTS.md](IMPORTS.md) (how a
CSV matches and reaches Intake), [WALKLISTS.md](WALKLISTS.md) (route a specific CSV to one walk list),
[SURVEYS.md](SURVEYS.md) (attach a survey before activating a pass), [PASSES.md](PASSES.md) (passes:
lifecycle + where they're managed), [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (cutting books),
[METRICS.md](METRICS.md) (the numbers), [TIMEZONES.md](TIMEZONES.md) (why a timezone change matters),
[ROLES.md](ROLES.md) (delegating a campaign to a team lead).

---

# Part 1 — For everyone

## Start your first campaign — the whole flow

A campaign goes from "created" to "canvassers in the field" through one ordered chain. The **Setup
progress** card on the campaign's dashboard walks you through it — it's a live checklist with a
"next step" button, so you never have to remember the order. At a glance:

1. **Create the campaign** — **Campaigns → New campaign** (a slide-in drawer): name, type (survey /
   lit drop), state (a dropdown of real US states), timezone (auto-fills from the state), and the
   optional **key dates** (Election Day, the early-voting window, a short note — see "Key dates"
   below). A survey is **not** required at creation.
2. **Import voters** — **Voter Import**: upload a voter file (geocoded for you if it has no lat/lng).
   New addresses land in **Intake** (owned by no walk list yet). See [IMPORTS.md](IMPORTS.md).
3. **Attach a survey** *(survey campaigns only)* — on the campaign's **Survey** tab, pick or build
   the survey. Timing is flexible: any time before you activate a pass (the requirement is enforced
   at **activation**, not creation). Lit-drop campaigns skip this. See [SURVEYS.md](SURVEYS.md).
4. **Create a walk list and give it doors** — **Walk Lists → New walk list**, then **Claim** its
   doors (from a saved search, or "Claim all Intake"). Creating the walk list **auto-creates its
   Pass 1** — no separate "make a pass" step. See [EFFORTS.md](EFFORTS.md) and [PASSES.md](PASSES.md).
5. **Cut and accept books** — **Turf Cutting**: cut the pass's doors into walkable books (geometric,
   or by attribute like precinct), then **Accept** them. See [PASSES_AND_TURF.md](PASSES_AND_TURF.md).
6. **Assign canvassers** — assign books to people (add canvassers on **Users** first if you have
   none). This can be done **before or after** activation.
7. **Activate the pass** — open the walk list's **Passes** panel → **Activate**. Now it's live and
   the field app shows the work. Activation is **gated on books**: you can't activate until the pass
   has at least one **accepted** book (and, for survey campaigns, a survey attached).

For the full click-by-click version of each step, see [GETTING_STARTED.md](GETTING_STARTED.md).
Inside a campaign the left sidebar lists that campaign's tabs in roughly this order, so the nav
mirrors the chain. How that drill-in works is below.

## The Campaigns page (the launchpad)

**Campaigns** opens on a summary strip — how many campaigns you have, how many are active, and the
total households / houses-knocked across the active ones — above the campaign list itself. The list
renders two ways (a **Cards | Table** toggle, remembered per browser): **cards** show each
campaign's identity, status, setup chip, key dates, and core counts with a visible **Assignments**
button and an **Open dashboard →** link; **table** is the dense many-campaigns view with the same
info and actions. A **search box** (name or state) and a **sort** menu (recent, name, households,
knocked %, setup progress) sit above the list, and **archived campaigns collapse into their own
section** at the bottom so finished work doesn't crowd the live view. Each card/row's **⋮ menu**
holds View dashboard, Assignments, and — for org admins — Edit, Archive/Reactivate, and Delete.

Archived campaigns are reachable from the **phone** too: the mobile admin Overview has a **Show
archived campaigns** reveal (rows tagged *Read-only*), and every campaign-scoped admin screen's
**campaign chip** lists them under an **Archived · read-only** divider. So a finished campaign's
notes, maps, reports and exports are two taps away on either client — see
[ADMIN_APP.md](ADMIN_APP.md) → *The campaign chip*.

## Key dates (Election Day, early voting, a note)

Every campaign can carry three optional dates plus a note, set in the create/edit drawer (org
admins only — leads see them but can't change them):

- **Election Day** — shown with a live countdown chip ("12 days", "Today", then a muted "Passed")
  on the campaign card, the table's Election Day column, and the campaign dashboard header.
- **Early voting start / end** — shown as a state, and **always naming both ends of the window**:
  *"Opens Oct 20 · through Nov 1"* before it starts, *"Open now · Oct 20 – Nov 1"* (green) while it
  runs, *"Ended Nov 1"* after. Either bound can be left empty (open-ended on that side); the end
  can't be before the start (enforced on save).
- **Key dates note** — up to 280 characters of free text (polling hours, clerk's-office address…),
  shown beside the dates everywhere they appear.

**Canvassers see them too**: the mobile "Pick a campaign" screen shows the key-dates chip, the
early-voting window, and the note under each campaign — so the field team knows the stakes without
asking. The same chip rides along **inside** a campaign, so the dates don't disappear the moment
they start knocking: it's in the header of the canvasser's **Books** screen (no note — kept
glanceable over the map) and on the mobile **admin campaign detail** screen (with the note, for
leads/admins working from their phone).

The chip always names the **actual date**, never a bare countdown: *"🗳 Election Day · Wed, Nov 4"*
with *in 12 days* beside it (*tomorrow* / *today* turn brand-red as it lands; once it's behind you,
*"Election Day was Wed, Nov 4"*). Early voting likewise always names **both** bounds — *"Early
voting Oct 20–Nov 1"* — including before the window opens, which is when canvassers are most often
asked when it *ends*. All date math runs in the **campaign's timezone** (dates are stored as plain
`YYYY-MM-DD` civil dates), so every admin and canvasser sees the same day regardless of where they
are.

## Navigating a campaign (the drill-in)

**Click a campaign** (its name, or Open dashboard) to *drill in*: the left sidebar swaps
from the org-level items to **that campaign's tabs** — Home, Survey, Voter Import, Walk Lists,
Saved Searches, Turf Cutting, Team, Timeline, Map, Audit, **Survey Explorer** (drill into any
survey answer — who gave it, who recorded it, and where; see [SURVEYS.md](SURVEYS.md)), Notes,
Early Voting, Client Reports — with a
**"‹ Campaigns"** link to exit and a **campaign switcher** dropdown to hop to another campaign
without leaving the page you're on. (Passes aren't a top-level tab — they live inside each walk
list; see [PASSES.md](PASSES.md).) The **URL is the active campaign**: `/campaigns/:id` is its Home (dashboard), and each tab is
`/campaigns/:id/…`. There are no more per-screen "Campaign" dropdowns — the URL plus the sidebar
switcher are how you pick which campaign you're working in.

The switcher lists **active campaigns only** — archived ones are reached from **Campaigns** or
**Overview**, each of which has an archived section, and that is also where you reactivate them.
An archived campaign you are *currently in* stays in the switcher (labelled `· Archived`) so the
control is never blank and you can always switch back out of it.

### The Setup progress card

On a campaign's dashboard, the **Setup progress** card shows where you are in that setup chain —
each step has a status (done / now / to-do), a deep link to its screen, and one highlighted **next
step** button. (Creating a walk list auto-satisfies the "Pass created" step, so it's one fewer thing
to do by hand.) It's non-blocking (you can still jump anywhere). The Campaigns list and the Overview
cards show a compact **"Setup x/N"** chip so you can spot a half-set-up campaign at a glance.

Once the pass is **activated**, the card collapses to a slim **"Live"** confirmation. You can
dismiss that confirmation with its **✕** — it then stays hidden for every admin of the campaign. It
also disappears on its own once real **knocks start coming in** — the dashboard is for monitoring
from then on. (The one exception: if you later add a walk list that isn't live yet, a small nudge
reappears — see "Add more doors" below.)

The app also signposts each hand-off: after you create a campaign it points you to Import; after an
import it points you to Walk Lists to claim; after a claim it points you to cut books; after
accepting books it points you to assign + activate. And it guards the two silent dead-ends: it won't
let you cut books for a walk list that owns **0 doors**, and it asks you to confirm if you activate a
pass with **0 canvassers assigned**.

## Manage a campaign — what you can change, and when

Open **Campaigns** and use a card/row's **⋮ menu** (Edit / Archive / Delete — the edit form opens
in the drawer). The rules protect your data once canvassing has started:

- **Name, state** — always editable.
- **Key dates + note** — always editable, **org admins only** (a lead can edit the campaign's name,
  survey, and timezone, but not its dates).
- **Restricted doors on invoices** — always editable, **org admins only.** Three choices: *use the
  organization default* (which the drawer spells out for you), *count them*, or *don't count them*.
  Deliberately **not** locked by canvassing activity, unlike Type: it's a reporting policy that's
  recomputed live on every read, so flipping it mid-campaign is safe and fully reversible — it
  changes how door totals are presented, never what was recorded. See
  [METRICS.md](METRICS.md) → **Billable doors** for what actually moves (spoiler: only the door
  totals on invoice-facing surfaces, never a rate or the coverage funnel).
- **Timezone** — editable, but once you have activity you'll see a warning: changing it **re-buckets
  every past daily stat** (a knock near midnight can move to a different calendar day). Nothing is
  lost and all-time totals are unchanged, but day-by-day numbers shift. See [TIMEZONES.md](TIMEZONES.md).
- **Type (survey ⇄ lit drop)** — **locked once canvassing has started.** Flipping it would corrupt
  how door statuses are computed and orphan existing survey responses, so the radios go read-only
  with a note. To run a different type, create a new campaign.
- **Survey template** — the campaign's **Survey** tab (`/campaigns/:id/survey`) is where you attach,
  change, or preview the survey. Repointing a survey campaign warns you if the chosen survey already
  has responses (new answers report alongside the old ones). To change questions, duplicate the
  survey on the Surveys page and pick the copy. See [SURVEYS.md](SURVEYS.md).

### Archive vs. delete

- **Archive** is always available and **reversible**: the campaign becomes **read-only** and you
  can **Reactivate** it anytime. Read-only is literal, not shorthand for "hidden": canvassers stop
  seeing it, and the server itself refuses the writes that would change the field — assigning or
  unassigning books and turf, cutting or re-cutting them, adding or removing people from the
  campaign, and moving a house pin — on the web dashboard and the phone alike. Everything that
  only *reads* stays open: every dashboard, map, Timeline, Notes, Overlaps, GPS audit and
  duplicate-survey report, and **exports keep working**, so a finished race is still yours to take
  with you. Two things are deliberately not frozen: **reviewing a GPS flag** (that records a
  decision about past work — it doesn't change the field) and **editing the campaign itself**,
  which is how you reactivate it. This is the normal "we're done" action.
  **It is also what stops the campaign billing** — a live campaign bills every month whether or not
  anyone knocks, so a finished race left un-archived quietly keeps costing money. Once a campaign's
  `electionDay` has passed and it is still active, the Campaigns page and the campaign dashboard show
  an **archive nudge** ([ArchiveNudge.jsx](../client/src/components/ArchiveNudge.jsx)); archiving in
  the first 3 days of a month with no field activity that month also makes that month free. Full
  rules in [BILLING.md](BILLING.md). Note that **reactivating clears `archivedAt`**, which makes the
  skipped months billable again on any statement that hasn't been issued — which is why **Reactivate
  confirms before it fires** (a modal on the Campaigns page saying exactly that: billing resumes,
  archived months included, and an archived campaign is already fully readable if you only want the
  data). Archiving stays one-click; it only ever stops billing.
- **Delete** is permanent and is **only allowed before any canvassing** (no knocks or surveys
  recorded). When allowed, it cascades — it removes the campaign and everything it owns (its
  imported voters and doors, efforts, draft rounds, books, walk lists, early-vote marks, reports,
  team-change history). **If your org runs other campaigns, they are untouched** — voter records
  are per-campaign, so deleting one campaign removes only *its* copies; a person shared with
  another campaign lives on there, and a **Do not contact** request is preserved even if their
  last record dies (a later import re-flags them automatically). Once a campaign has field
  activity, **Delete is disabled** ("Archive instead") — you can't destroy real canvassing history.
  **Removal runs in the background**: confirming the dialog answers instantly, the campaign shows
  a **"Deleting…"** badge on the Campaigns page (it can't be opened, edited, or canvassed while it
  shows), and it disappears from the list when removal finishes — usually within a minute, a few
  minutes for very large campaigns. There is no cancel after you confirm. If something interrupts
  the removal (say the worker restarts mid-run), the badge turns to **"Delete failed"** with a
  **Retry delete** action that finishes the job; a campaign in that state stays hidden and inert
  everywhere else until the retry completes. Deleting also waits its turn: if an import or export
  is still running for the campaign, Delete asks you to let it finish first.

## Add more doors later (a new walk list on a live campaign)

Common case: the first walk lists targeted specific precincts, and now you want to add "the rest of
the city" without disturbing the completed work. The right move is a **new walk list** (walk lists
own disjoint doors, so a new one stays cleanly separate). The flow:

1. **Import the CSV first.** The import **preview** shows the split before you commit — *new doors*,
   *existing doors* (updated in place, never duplicated, ownership untouched), *moved voters*, and
   *near-duplicates* (watch this — see the caveat below). New addresses land in Intake.
2. **Build a saved search from that same CSV** (**Saved Searches → from CSV** — it matches by Voter
   ID). This freezes exactly the doors in your file, and tells you how many are already in another
   walk list.
3. **Create the new walk list** and **claim that saved search** (or seed it at creation). This claims
   only the list's doors — precise. Its **Pass 1** is created automatically.
4. **Cut books (by precinct if you like) → accept → assign → activate.**

**Why a saved search instead of "Claim all Intake"?** "Claim all Intake" grabs **every** unowned door
in the campaign — so if any leftover Intake exists from an earlier import, it gets swept into the new
walk list. The button shows the exact count and asks you to confirm, steering you to a saved search
when Intake is mixed. Quick check: if the Intake count equals the doors you just imported, "Claim all
Intake" is clean; if it's higher, use the saved search.

**How "new" is decided:** doors are matched by **normalized address** (within the campaign); voters
by **state Voter ID** (within the org). So re-uploading addresses you've imported before is safe and
idempotent — they refresh in place, only genuinely new ones go to Intake.

**The near-duplicate caveat:** the address match is *strict* — it does **not** treat "123 N Main St"
and "123 North Main Street" as the same door. If your vendor reformats a previously-imported address,
it'll be treated as a **new** door (a duplicate). The import preview flags these as **near-
duplicates**; if that count is above zero, inspect the samples before committing.

**Seeing a new walk list's progress:** each walk list row on the **Walk Lists** page shows its own
readiness — either **Live**, or **"Setup x/5 · next: …"** (doors → pass → books → assigned →
activated) — so a fresh walk list surfaces what's left. And if a live campaign has a walk list that
isn't live yet, the dashboard shows a small **"N walk list(s) still need setup"** nudge so it isn't
masked by the campaign already reading "complete."

---

# Part 2 — Technical reference

## Model

[Campaign.js](../server/src/models/Campaign.js): `organizationId`, `name`, `type` (`survey` |
`lit_drop`), `state` (2-char, uppercased — validated against the real US-state list via `usStateSchema`
in [validators.js](../server/src/utils/validators.js)), `surveyTemplateId` (nullable), `isActive` (the
archive flag), `timeZone`, and the key dates: `electionDay` / `earlyVotingStart` / `earlyVotingEnd`
(**`'YYYY-MM-DD'` strings, default null** — civil dates interpreted in the campaign's `timeZone`;
strings on purpose, a `Date` at UTC midnight would render a day early in US zones) plus `datesNote`
(trimmed string, max 280), and `billRestrictedDoors` (**tri-state Boolean, default `null`** — `null`
= inherit `Organization.billRestrictedDoors`, `true`/`false` = explicit override; always resolve via
[billRestricted.js](../server/src/services/reports/billRestricted.js), since reading the field raw
collapses "inherit" into "off"). ISO date strings order chronologically as plain strings, so all
window checks are lexicographic — no `Date` parsing. A `pre('validate')` invariant enforces that a `survey`
campaign has a `surveyTemplateId` and a `lit_drop` campaign never does (it nulls it on save). There
is no `draft` state — `isActive` is the only lifecycle flag (active ⇄ archived).

**`isActive: false` is enforced, not decorative.** [middleware/campaignWritable.js](../server/src/middleware/campaignWritable.js)
refuses field-mutating writes on an archived campaign with **409 `{ code: 'campaign-archived' }`**,
mounted on the turf/books router, turf assignments, the campaign roster, and the campaign-nested
household pin move — plus an inline assert on the second pin door in
[routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js), because an identical write must
never be 200 through one door and 409 through the other. Deliberately **not** guarded: exports
(a read, and the reason archiving isn't deletion — `middleware/entitlement.js` already exempts them
for read-only *orgs*), flag review (bookkeeping about past work), the `*-preview` POSTs (they
persist nothing), and campaign `PATCH` — guarding that last one would make an archived campaign
impossible to reactivate. The guard gates on write METHODS so every read still passes, and it lives
at the **route layer only**: `deleteOrganization`, `deleteAccount`/`releaseAssignedWork`,
`deleteCampaign`, coordinator re-stamp and the demo seeders all write assignments through the
shared services and must keep working on orgs holding archived campaigns. 409 rather than 403 is
deliberate — `mobile/lib/api.js` inspects 400/403/404 for `ORG_CONTEXT`/`FORBIDDEN_ROLE`, so a 403
an already-released bundle doesn't recognise can eject the user to the org picker. Pinned by
[test/archivedCampaign.int.test.js](../server/test/archivedCampaign.int.test.js).

## Endpoints — [routes/admin/campaigns.js](../server/src/routes/admin/campaigns.js)

- **GET `/admin/campaigns`** — `withCounts()` attaches per-campaign `counts` (households, knocked,
  surveysSubmitted, litDropped) and, via [campaignSummaries.js](../server/src/services/reports/campaignSummaries.js),
  the management flags `{ setupComplete, stepsDone, stepsTotal, nextStepKey, hasCanvassed, deletable,
  canEditType }`.
- **POST `/admin/campaigns`** — create; survey type requires a valid in-org `surveyTemplateId`.
  Key-date fields validate as `isoDateSchema` (shared, in `validators.js`); an inverted early-voting
  window (`earlyVotingEnd < earlyVotingStart`, lexicographic) is a `400`.
- **PATCH `/admin/campaigns/:id`** — update. **Type-lock guard:** if `type` changes and
  `campaignHasCanvassed(id)` (any `CanvassActivity` or `SurveyResponse`), returns `400
  { code: 'type-locked' }`. Archive/reactivate is just `{ isActive }`. The key-date fields join
  `isActive`/`type`/`state` in the **org-admin-only** list (a lead's PATCH of them is a `403`);
  explicit `null` clears a date; the window check runs against the **merged** values (incoming ??
  stored), so PATCHing one bound still validates against the other.
- **Where the fields surface:** GET `/admin/campaigns` (lean-doc spread — automatic), the
  per-campaign rows of GET `/admin/reports/campaign-rollup` (added to its projection + row object in
  [reports.js](../server/src/routes/admin/reports.js) — it picks fields, nothing flows automatically),
  GET `/mobile/campaigns` (the picker) **and** the per-campaign GET `/mobile/bootstrap` `campaign`
  object ([bootstrap.js](../server/src/routes/mobile/bootstrap.js) — both additive, so older clients
  ignore them; bootstrap carries them so the Books header + mobile admin detail can show the chip
  in-campaign, not just on the picker). Covered end-to-end by
  [campaignDates.int.test.js](../server/test/campaignDates.int.test.js).
- **`billRestrictedDoors` surfaces differently** — it is a *policy*, not a display field, so nothing
  ships the raw tri-state to a client except the edit drawer. `GET /admin/campaigns` returns it via
  the lean spread **plus** an envelope-level `orgBillRestrictedDoors` (so the drawer can label what
  "use the organization default" resolves to); every report surface ships the **resolved** boolean
  alongside the numbers it affects. Covered by
  [billableRestricted.int.test.js](../server/test/billableRestricted.int.test.js).
- **DELETE `/admin/campaigns/:id`** — **only when `!hasCanvassed`** (else `400 { code: 'has-activity' }`),
  and `409 { code: 'campaign-busy' }` while an ImportJob/ExportJob is active for the campaign (an
  import writing rows mid-cascade would orphan voters). **A background job since 2026-08**: a
  106,958-door delete ran inline for minutes, Heroku's 30s router limit 503'd the browser while the
  dyno finished anyway. The route now CAS-stamps `Campaign.deletion`
  (`{requestedAt, requestedBy, status pending|running|failed, heartbeatAt, error}`), enqueues on
  `campaign-delete-queue` (stable `jobId` = campaignId + `removeOnComplete/Fail: true` so a Retry's
  re-add is never silently deduped against a finished job), and answers **`202 {queued: true}`** —
  idempotently while a fresh stamp exists; a `failed` stamp re-stamps and re-enqueues (Retry). While
  stamped, the campaign is **quarantined**: `GET /admin/campaigns` moves it from `campaigns` into a
  separate **`deletingCampaigns`** array (so every picker/drill-in surface treats it as gone with
  zero client changes; only the Campaigns page renders those rows), every campaign-scoped resolver
  spreads `NOT_DELETING` ([deletionState.js](../server/src/services/campaigns/deletionState.js)) →
  404, PATCH answers `409 campaign-deleting`, and the import/turf/export processors fail a job that
  claims into a stamped campaign. The worker
  ([deleteCampaignProcessor.js](../server/src/services/campaigns/deleteCampaignProcessor.js))
  re-checks `campaignHasCanvassed` at claim (a knock can land between gate and run), heartbeats
  every 30s through even single multi-minute `deleteMany` awaits, marks `failed` on every failed
  attempt, and runs the cascade; stale stamps (pending >2min unclaimed, running >3min silent) are
  CAS-expired to `failed` by the list GET — the poll is the watchdog (the imports pattern). Success
  writes nothing: the row being gone is the completed state, and the Campaigns page polls (2s,
  predicate) until it vanishes. **No cancel after confirm** — a cancel racing the cascade would
  manufacture half-deleted campaigns. Failed deletions also surface on the super-admin retention
  health endpoint (`campaignDeletionHealth`). Cascade order via
  [deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js): `deleteCampaignCascade()`
  first parks DNC stickiness (a flagged person whose LAST row lives here → `DncPendingId` with the
  flag's original attribution, so a future import re-flags) and re-points org-level `VoterNote`s to
  a surviving sibling row (deleting them only when no sibling survives; the join runs from the
  small note side, and the platform-stats distinct runs as an aggregation cursor — both formerly
  `distinct()` calls that hit Mongo's 16MB cap around ~600k voters, which would have made huge
  campaigns permanently undeletable), then `Voter.deleteMany({ campaignId })` — **exactly this
  campaign's rows; sibling campaigns' voters are structurally unreachable** — then
  `deleteMany({ campaignId })` over **every** campaignId-scoped collection (Household, Effort,
  EffortMember, Pass, Turf, TurfAssignment, TurfSnapshot, SavedSearch, VotedUpload, VotedVoter,
  VotedPendingId, CampaignAssignment, CampaignManager, **CoordinatorChange** (added 2026-08 — was
  the documented orphan class), ClientReport, ClientReportMapPoint, ReportShareLink,
  CanvassActivity, SurveyResponse, SurveyResponseArchive, ImportJob, HouseholdLocationChange,
  ExportJob — raw GridFS import files + export artifacts deleted first), then the campaign. The
  platform-stats capture banks only people whose **last** row dies (shared people keep counting
  in `live`).

## Setup progress

The cold-start readiness chain is a pure derivation in
[setupSteps.js](../server/src/services/reports/setupSteps.js) — `deriveSetupSteps({ campaign, counts })`
→ 8 steps (`survey` skipped for lit_drop), each `done | current | todo | skipped`, plus
`{ stepsDone, stepsTotal, complete, nextStepKey, nextStepRoute }`.

- **GET `/admin/campaigns/:id/setup-status`** ([setupStatus.js](../server/src/routes/admin/setupStatus.js))
  returns that object plus `hasCanvassed` and `effortsNeedingSetup` (non-archived efforts without an
  active pass). Polled by [SetupProgress.jsx](../client/src/components/SetupProgress.jsx), which
  renders the hub, collapses to "Live" when `complete && !hasCanvassed`, and returns the
  efforts-needing-setup nudge (or `null`) when `complete && hasCanvassed`.
- The list/rollup share [campaignSummaries.js](../server/src/services/reports/campaignSummaries.js)
  (one helper feeding the campaign-rollup and the campaigns list — same source of truth as the hub).
- **Per-effort** readiness is [effortSetupSteps.js](../server/src/services/reports/effortSetupSteps.js)
  — `deriveEffortSetup({ doorCount, passes, publishedTurfs, assignments, hasActivePass })` → a 5-step
  chain (doors → round → books → assigned → active). [efforts.js](../server/src/routes/admin/efforts.js)
  GET attaches it as `effort.setup` (rolling published-turf/assignment counts up from pass → effort).

## Frontend

- **Campaign-scoped routes** — the in-campaign screens live under `/campaigns/:campaignId/*` in
  [App.jsx](../client/src/App.jsx) (`survey`, `import`, `walklists`, `efforts`, `turfs`, `passes`,
  `team`, `timeline`, `map`, `audit`, `explorer`, `notes`, `early-voting`, `reports`,
  `reports/:id`; the bare `/campaigns/:campaignId` is the dashboard). Each screen reads the active campaign from `useParams().campaignId` — there is **no
  localStorage campaign selector**. Old flat routes (`/efforts`, `/passes`, …) and `/dashboard/:id`
  redirect into this shape.
- Two-level drill-in nav: [navItems.js](../client/src/components/navItems.js) (`ORG_NAV` for the top
  level + `CAMPAIGN_NAV` for the in-campaign tabs), rendered by
  [Layout.jsx](../client/src/components/Layout.jsx) (sidebar with the "‹ Campaigns" exit + campaign
  switcher) and [BottomNav.jsx](../client/src/components/BottomNav.jsx).
  The switcher's `pickerCampaigns` filters the shared `['admin','campaigns']` cache to
  `isActive !== false`, **plus the current campaign whichever it is**. Three things that filter
  must not become: (1) the request — the endpoint stays unfiltered, because ~25 call sites share
  that one cache entry and eleven screens render *"Campaign not found"* or redirect on a
  `find()` miss; (2) the validity test — an archived campaign you are in must still resolve
  (`currentCampaign`, and the `openMockFlags` badge, both read the **unfiltered** list); (3)
  `!isActive` — a row from an older server that omits the field must read as active. Mobile's
  `CampaignChip` deliberately lists archived campaigns and is **not** to be "made consistent"
  with this; [campaignSelection.js](../mobile/lib/campaignSelection.js) records why (an
  active-only validity check once left an all-archived org with nothing selectable).
- Hub + hand-offs: [SetupProgress.jsx](../client/src/components/SetupProgress.jsx),
  [NextStepBanner.jsx](../client/src/components/NextStepBanner.jsx) (the reusable next-step signpost).
- Management UI: [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) — the KPI `StatCard`
  strip (client-side sums over active campaigns), search/sort, the Cards | Table `Segmented` toggle
  (persisted to localStorage `campaignsView`), the collapsible archived section, skeleton loading,
  and the Delete confirm modal. The pieces live in
  [components/campaigns/](../client/src/components/campaigns/): `CampaignFormDrawer.jsx` (the old
  inline form in the shared `Drawer` + the key-date inputs; date fields submit `null`, never `''`),
  `CampaignCard.jsx` (also exports `TypePill`/`StatusBadge`/`CountdownChip`), and
  `CampaignsTable.jsx` (shared `DataTable`). Both views take the same `menuItems(c)` from the page.
- Key-date helpers: [lib/electionDates.js](../client/src/lib/electionDates.js) (web) and
  [mobile/lib/electionDates.js](../mobile/lib/electionDates.js) (mirror) — `daysUntil` /
  `earlyVotingState` compute against **today in the campaign's tz** (`Intl` en-CA), and display
  formatting goes through UTC-anchored parts so a `'YYYY-MM-DD'` never shifts a day. The campaign
  dashboard header ([DashboardPage.jsx](../client/src/pages/DashboardPage.jsx)) and the mobile
  campaign picker ([campaigns.jsx](../mobile/app/(app)/campaigns.jsx)) render from the same helpers.
  On mobile, the in-campaign chip is one shared component,
  [ElectionCountdownChip.jsx](../mobile/components/ElectionCountdownChip.jsx), reused by the canvasser
  Books header ([books.jsx](../mobile/app/(app)/books.jsx)) and the mobile admin campaign detail
  ([admin/campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx)).

  Invariants worth keeping:
  - **`earlyVotingState` names both bounds in every state**, `upcoming` included. It used to return
    a start-only `"Early voting opens Oct 20"` until the window actually opened — which hid the end
    date for most of a campaign, exactly when canvassers get asked for it. (Web had the same defect
    and got the same fix.) It also returns an `urgent` flag for *opens tomorrow* / *last day today*.
  - **The chip always renders the real date**, not a bare countdown; the countdown is a **sibling**
    `Text`, never inside the pill (a pill child that overruns wraps *inside the lozenge*, and a
    two-line pill reads as broken).
  - `formatDay(dateStr, opts)` takes `Intl` overrides (the chip passes `{ weekday: 'short' }`).
  - **`hasKeyDates(campaign)`** is the single predicate for "is there anything to show". The chip
    self-nulls on it, and any caller drawing chrome *around* the chip must gate on the same call —
    `campaign` is truthy even with no dates set, so a naive `campaign &&` check hangs a divider over
    nothing. The Books header card uses it for exactly that.
  - **One urgency color.** Imminent dates go brand-red; amber is the Refused disposition's color and
    is never spent here.
- Extend-a-campaign guards: [EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) — the ClaimPanel
  "Claim all Intake" count + note + confirm modal, and the per-effort readiness chip on each row.
