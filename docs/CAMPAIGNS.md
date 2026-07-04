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

1. **Create the campaign** — **Campaigns → New campaign**: name, type (survey / lit drop), state,
   timezone (auto-fills from the state). A survey is **not** required at creation.
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

## Navigating a campaign (the drill-in)

The **Campaigns** page is the launchpad. **Click a campaign** to *drill in*: the left sidebar swaps
from the org-level items to **that campaign's tabs** — Home, Survey, Voter Import, Walk Lists,
Saved Searches, Turf Cutting, Team, Daily Timeline, Map, Early Voting, Client Reports — with a
**"‹ Campaigns"** link to exit and a **campaign switcher** dropdown to hop to another campaign
without leaving the page you're on. (Passes aren't a top-level tab — they live inside each walk
list; see [PASSES.md](PASSES.md).) The **URL is the active campaign**: `/campaigns/:id` is its Home (dashboard), and each tab is
`/campaigns/:id/…`. There are no more per-screen "Campaign" dropdowns — the URL plus the sidebar
switcher are how you pick which campaign you're working in.

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

Open **Campaigns** and use a row's **Edit / Archive / Delete** actions. The rules protect your data
once canvassing has started:

- **Name, state** — always editable.
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

- **Archive** is always available and **reversible**: the campaign becomes read-only (canvassers
  stop seeing it) and you can **Reactivate** it anytime. This is the normal "we're done" action.
- **Delete** is permanent and is **only allowed before any canvassing** (no knocks or surveys
  recorded). When allowed, it cascades — it removes the campaign and everything it owns (its
  imported voters and doors, efforts, draft rounds, books, walk lists, early-vote marks, reports).
  Once a campaign has field activity, **Delete is disabled** ("Archive instead") — you can't destroy
  real canvassing history.

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
`lit_drop`), `state` (2-char, uppercased), `surveyTemplateId` (nullable), `isActive` (the
archive flag), `timeZone`. A `pre('validate')` invariant enforces that a `survey` campaign has a
`surveyTemplateId` and a `lit_drop` campaign never does (it nulls it on save). There is no `draft`
state — `isActive` is the only lifecycle flag (active ⇄ archived).

## Endpoints — [routes/admin/campaigns.js](../server/src/routes/admin/campaigns.js)

- **GET `/admin/campaigns`** — `withCounts()` attaches per-campaign `counts` (households, knocked,
  surveysSubmitted, litDropped) and, via [campaignSummaries.js](../server/src/services/reports/campaignSummaries.js),
  the management flags `{ setupComplete, stepsDone, stepsTotal, nextStepKey, hasCanvassed, deletable,
  canEditType }`.
- **POST `/admin/campaigns`** — create; survey type requires a valid in-org `surveyTemplateId`.
- **PATCH `/admin/campaigns/:id`** — update. **Type-lock guard:** if `type` changes and
  `campaignHasCanvassed(id)` (any `CanvassActivity` or `SurveyResponse`), returns `400
  { code: 'type-locked' }`. Archive/reactivate is just `{ isActive }`.
- **DELETE `/admin/campaigns/:id`** — **only when `!hasCanvassed`** (else `400 { code: 'has-activity' }`).
  Cascades via [deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js):
  `deleteCampaignCascade()` removes the voters housed in the campaign's households, then
  `deleteMany({ campaignId })` over **every** campaignId-scoped collection (Household, Effort,
  EffortMember, Pass, Turf, TurfAssignment, TurfSnapshot, WalkList, VotedUpload, VotedVoter,
  VotedPendingId, CampaignAssignment, ClientReport, ClientReportMapPoint, ReportShareLink,
  CanvassActivity, SurveyResponse, ImportJob), then the campaign. (ImportJob raw files in GridFS are
  a known minor orphan.)

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
  `map`, `early-voting`, `reports`, `reports/:id`; the bare `/campaigns/:campaignId` is the
  dashboard). Each screen reads the active campaign from `useParams().campaignId` — there is **no
  localStorage campaign selector**. Old flat routes (`/efforts`, `/passes`, …) and `/dashboard/:id`
  redirect into this shape.
- Two-level drill-in nav: [navItems.js](../client/src/components/navItems.js) (`ORG_NAV` for the top
  level + `CAMPAIGN_NAV` for the in-campaign tabs), rendered by
  [Layout.jsx](../client/src/components/Layout.jsx) (sidebar with the "‹ Campaigns" exit + campaign
  switcher) and [BottomNav.jsx](../client/src/components/BottomNav.jsx).
- Hub + hand-offs: [SetupProgress.jsx](../client/src/components/SetupProgress.jsx),
  [NextStepBanner.jsx](../client/src/components/NextStepBanner.jsx) (the reusable next-step signpost).
- Management UI: [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) — the `CampaignForm`
  type-lock + timezone warning, the list's "Setup x/N" chip, Archive/Reactivate, and the Delete
  confirm modal.
- Extend-a-campaign guards: [EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) — the ClaimPanel
  "Claim all Intake" count + note + confirm modal, and the per-effort readiness chip on each row.
