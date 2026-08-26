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
   below) plus an optional **door goal** and **goal date** ("Door goal and pace", below). A survey
   is **not** required at creation.
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

## Door goal and pace (added 2026-08)

A campaign can carry a **door goal** — how many doors it's aiming for — and an optional **goal
date**. Set both in the same create/edit drawer as the key dates. Unlike the key dates, **a team
lead can set a campaign's goal**: a lead running a campaign owns its target.

- **Door goal** — a count of **billable doors**, the same doors an invoice counts (see
  [METRICS.md](METRICS.md)). One house counts once per round, so going back for a second round
  adds to the total. Leave it blank and none of this appears.
- **Goal date** — when you want to be there. **Leave it blank and Election Day is used**, so a
  campaign that only ever filled in an Election Day still gets a countdown and a pace. Setting it
  explicitly is for the common case of wanting the turf walked *before* Election Day.

Once a goal is set, the campaign's **Home** page grows a thin **goal strip** in the header, right
under the campaign type and **on the same row as the key dates**: a progress bar, the percentage, done/target,
doors left, and how many a day it takes from here. It sits there rather than in
the body deliberately: it is the only number on the page the filters below don't touch, and
campaign-identity space is where a filter-immune number belongs. The strip names its own **goal
date** only when one was set explicitly; when the deadline fell back to Election Day, the countdown
pill beside it already says so. The Campaigns list carries a compact version (a bar and
`3.4k / 10k`) on both the cards and the table, and the mobile admin campaign screen shows a fuller
version in its own group.

Three things worth knowing about how the numbers behave:

- **The goal strip ignores the page's filters.** Everything else on Home honors the date range, the
  walk list, and the crew picker. The goal is always the campaign's all-time, campaign-wide total.
  That is why it lives in the header rather than among the filtered numbers — the placement is the
  explanation, and the full sentence is behind its (i).
- **Days are calendar days, and today is not one of them.** The daily target divides by the days
  remaining *after* today: by the time you're looking at the number, today is already planned or
  underway, so counting it would understate every day that follows. (On the goal date itself it
  clamps to one day — all of it, today.) Days nobody knocks are still counted. The pace you're
  *doing* is measured the same way, so the two are directly comparable — and working at exactly
  the needed rate projects finishing exactly on the goal date.
- **It reports, it does not grade.** The goal shows where you are and what each remaining day has
  to carry. It deliberately makes no Ahead/Behind judgement and offers no projected finish date —
  those existed briefly and were removed in August 2026, server side included.

**Canvassers never see the goal** — not on the campaign picker, not in Books, nowhere in the
canvasser app. It's a management number. It *can* be shown to a client on a published weekly
report, but only as an explicit per-report tick (see [CLIENT_PORTAL.md](CLIENT_PORTAL.md)).

## Change history — who edited this campaign (added 2026-08)

A door goal is a contract number, and a lead can change one. **History** records who changed what
and when: the goal and its date, the key dates and note, the billable-doors policy, archiving and
reactivating, and the campaign's name, type and state. Open it from a campaign's **⋮ menu →
History**, or from the **History** link on the door-goal strip when a number looks wrong.

The feed also folds in **team reassignments**, which is the other way a number moves without anyone
knocking a door: changing someone's coordinator re-stamps all of their past work onto the new team,
so *"why did Bo's team jump by 3,907?"* is answerable here rather than only from a database console.
A reassignment whose ledger re-stamp failed part-way says so in red — that is the one case where the
by-team totals legitimately don't reconcile until it's re-run.

Two edits are deliberately **not** recorded: the timezone (it already announces itself — every
day-bucketed number on the campaign shifts, and the drawer warns you before you do it) and the
attached survey (visible on the campaign's own Survey tab). Everything logged is something whose
silent change could mislead someone about money, a deadline, or what was promised.

Leads see the history of campaigns they run, and no others — the same scoping as every other
campaign screen.

**On the phone**, open the campaign and tap **Quick actions → History**. (The door-goal line has
no History link of its own — tapping it explains the numbers instead; the tile is always there and
does not depend on a goal being set.) Same feed, same scoping, read-only on both.

> **This is not the Audit page.** Three different things in this product are called "audit," and
> they answer different questions. **History** (here) = who changed the campaign's *settings*.
> **[Audit](AUDIT.md)** = GPS quality flags on individual knocks. **Timeline** = who knocked what,
> when. And separately, `AccessLog` records **Doorline staff** reading customer data under a support
> grant — that one is a privacy record, reviewed in the Control Room, not an org-facing feature.

## Navigating a campaign (the drill-in)

**Click a campaign** (its name, or Open dashboard) to *drill in*: the left sidebar swaps
from the org-level items to **that campaign's tabs**, grouped by what you're doing (added
2026-08, once the flat list passed 18 items): **Home** sits ungrouped at the top, then
**Setup** (Survey, Voter Import, Walk Lists, Saved Searches, Turf Cutting, App Customization),
**Field** (Team, Timeline, Map), **Quality** (Audit, Door Outcomes, Overlaps, Notes), **Results**
(**Survey Explorer** — drill into any survey answer: who gave it, who recorded it, and where;
see [SURVEYS.md](SURVEYS.md) — and Early Voting), and **Deliverables** (Client Reports, Exports,
Print Packets). Item order inside each group kept the old flat order on purpose, so the grouping
added structure without moving muscle memory; the collapsed icon rail shows thin dividers where
the expanded sidebar shows the group labels (the same treatment the super-admin Platform section
already used), and the mobile-web More sheet mirrors the same groups. A
**"‹ Campaigns"** link exits, and a **campaign switcher** dropdown hops to another campaign
without leaving the page you're on. (Passes aren't a top-level tab — they live inside each walk
list; see [PASSES.md](PASSES.md).) The **URL is the active campaign**: `/campaigns/:id` is its Home (dashboard), and each tab is
`/campaigns/:id/…`. There are no more per-screen "Campaign" dropdowns — the URL plus the sidebar
switcher are how you pick which campaign you're working in.

The Home dashboard's numbers filter three ways: by **date range**, by **walk list**, and by **crew**
(a coordinator dropdown — everyone by default, one coordinator's crew, or "No coordinator"; the
same filter the Timeline has). Every activity number on the page follows the crew filter; the
**Coverage** section deliberately doesn't — doors don't belong to a crew — and says so while a crew
is selected. Counting rules in [METRICS.md](METRICS.md).

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
  survey, timezone, and door goal, but not its dates).
- **Door goal + goal date** — always editable, **by org admins AND team leads.** The deliberate
  exception to the line above: a lead running a campaign owns its target. See "Door goal and pace".
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
- **Door outcomes** — always editable, **by org admins AND team leads** (same reasoning as the door
  goal: whoever runs the campaign owns what canvassers can record). Lives on the **App
  Customization** page — see the section below.

### Door outcomes — which buttons canvassers see (added 2026-08)

Every campaign starts with the full set of outcome buttons in the field app. The **App
Customization** page in the campaign drill-in (`/campaigns/:id/customize`, and the matching
screen in the mobile admin app) lets you turn individual ones off — say a campaign that never
wants **No soliciting** used. The web page renders a **live phone mockup** of the door screen
beside the toggles — flip one and its button slides out of the preview, so you see exactly what
your canvassers will. (The page is named for what it will grow into — every "what does the field
app offer" setting belongs here. Changing what ALREADY-recorded entries say is a different job,
on the **Door Outcomes** page below.) What's toggleable is deliberately narrow:

- **Can be turned off:** Wrong address, Refused, No soliciting, Restricted access (a lit-drop
  campaign only shows the last two — the first two don't exist in its door UI).
- **Never toggleable:** Not home and the completion action (Surveyed / Lit dropped). Without those,
  a walk can't be recorded at all.

Turning an outcome **off** does two things: the button disappears from the door screen, and the
server refuses fresh submissions of it (so a phone with a stale view can't sneak one in — the
canvasser gets a clear "turned off" message and the app refreshes its buttons). One deliberate
exception: a knock a canvasser recorded **while offline, before you flipped the toggle**, is still
accepted when their phone reconnects — a settings change never destroys real door data.

**Nothing about the past changes.** Doors already recorded keep their status, color, and place in
every count, rate, export, and invoice. This is a recording policy, not a reporting one — see
[METRICS.md](METRICS.md). Each flip is logged to the campaign's change history ("Door outcomes:
all on → Refused off"), highlighted the same way invoice-policy changes are. The admin **desk marks** —
**bulk restrict** on a book, or **Mark restricted** on a single home from the Turf Cutting map, the Map
page or the mobile admin app — keep working even while Restricted is toggled off: they're desk actions
owned by the same people who own the toggle.

### Door Outcomes — correcting what was recorded (added 2026-08)

**Door Outcomes** (`/campaigns/:id/outcomes`, in the sidebar's **Quality** group beside Audit) is
where an **org admin** changes what a recorded entry says. Two different jobs share it:

- **Correcting a mistake** — the canvasser hit the wrong button and this door was really Refused.
  Here moving the numbers is the *point*: they were wrong before.
- **Folding a retired outcome** — "we've stopped using No soliciting, make its history read Not
  home." Here the entries were *true*, so moving a reported number would be fabrication.

The page doesn't ask which you meant. **It prices every change before it runs**, and that is the
whole safety model:

- A conversion that can't move anything says so plainly — *"No reported numbers change."* That's
  the case for any mix of **Not home, Wrong address and No soliciting**: each counts as one knock
  and none counts as reaching a person, so knocks, contact rate, survey rate, coverage and billable
  doors are identical before and after.
- A conversion that *does* move something shows your campaign's own before-and-after — knocks,
  billable doors, contact rate, survey rate, restricted doors — with the changed figures in red and
  a red confirm button. **Refused** moves the contact rate (someone answered) and **Restricted**
  moves billable doors (it can be invoiced), so those are always priced. They are still allowed:
  a wrong button deserves a real fix.
- **Lit dropped can never be converted**, in either direction, by anyone — a lit drop has no
  answers to move either way.
- **Surveyed CAN be converted, in both directions**, but not as a relabel — see the next section.
  Converting *into* Surveyed makes you enter the answers first; converting *out of* it removes
  real answers, so they are archived rather than deleted and you are shown exactly whose.

Working the page: filter by outcome, canvasser, walk list, round, or a date range (the campaign's
own days, like every other dated page) — or, on a survey campaign, by a **specific survey answer**
— tick the entries you want (one row to fix one door, or **Select all N matching** to fold a whole
batch), pick what they should become, and review.

The **answer filter** (the *Survey answers* disclosure in the filter bar) finds the doors where
someone gave a particular answer — "everyone this canvasser surveyed who answered *Opposed*." It
asks for one other narrowing first (canvasser, walk list, round or dates), it only ever matches
Surveyed entries — the other chips lock while it's on — and on a campaign that has used more than
one survey you pick which survey's answers you mean. Each matching row then shows who matched at
that visit and who else answered there, because a Surveyed entry is the whole visit: changing it
takes every answer that canvasser recorded at that door that round, and the review step names each
person, matched or merely present. Each change also freezes a one-line description of the filter
that produced it ("Cara Canvasser · answered Opposed · Aug 1 – Aug 7"), so the run list can tell a
narrow correction from a whole-campaign fold. **Everything else about each entry is kept** — the time, the GPS location, who knocked it,
and which round and turf it belonged to. Only the label changes; door colors follow, and phones
pick the new colors up on their next sync. Every change is listed with a **one-click Revert** that
undoes it exactly — including a selection that spanned several outcomes, since each entry remembers
its own original. Runs and reverts both appear in the campaign's change history, highlighted.

Two things the page deliberately won't show you: entries an admin created from the desk — **bulk
restrict** on a book or **Mark restricted** on a single home (desk marks, not field observations, each
with its own undo where it was made: the book's Unmark, or the house popup / door panel), and entries a
previous run already changed, until that run is reverted.

The **App Customization** page keeps a small **Reclassification** card for the common follow-up
right after you switch an outcome off; it is the same machinery, limited to the never-moves-a-number
folds.

### Converting to and from Surveyed (added 2026-08)

Sometimes the entry isn't just mislabelled — the conversation actually happened and the app has no
record of it. A canvasser tapped Not home by mistake and only noticed back at the office, where
re-doing it would flag their GPS as far from the door. Or a whole week of doors got recorded as
Refused because that button was left switched on. Both are fixable here, and both go beyond
relabelling: a Surveyed door has to own real answers, so **you enter them.**

**Recording answers for doors (→ Surveyed).** Select the entries, pick **Surveyed**, then choose
how much detail you have:

- **Enter answers** applies one answer set to everyone at every selected door. This is the right
  tool for "that whole batch was really *Undecided*."
- **Door by door** walks you through the selection one address at a time, so each household gets
  its own real answers. Leaving part-way (**Finish later**, or just closing the tab) leaves the
  session listed under **Survey answer changes** as *Unfinished — N of M done*, with **Resume** to
  carry on and **Stop here** to keep what's done and close it. The remaining doors are recomputed
  from what actually saved, so there is no cursor to go stale.

Either way you can **leave questions blank** — record only what you actually know. Nothing is
required.

Who gets an answer recorded: **every voter on file at that address, except anyone marked
do-not-contact, and except anyone who already answered that round.** That last rule is absolute —
a real answer a canvasser collected in the field is never overwritten by a desk entry. The confirm
step names everyone who will be skipped and why.

Every answer you record here is **attributed to the canvasser who knocked** — their knock, their
time, their GPS, their round and team, so their numbers and their pay reflect the work they did.
The answers themselves are stamped **"Entered by ‹you› on ‹date›"**, visible on the voter's record
and in exports, so nobody mistakes a desk entry for a doorstep conversation. They count in your
contact rate and survey rate exactly like a field answer — the stamp is about where the answer came
from, not about whether it counts.

**Removing answers (Surveyed → a door outcome).** This is the cleanup direction: a canvasser faked
a run of surveys and you need those doors back in play. Select the surveyed entries, pick what they
should become (usually **Not home**, so the doors get re-knocked), and the confirm step lists
**exactly whose answers are about to be removed, by name.** The answers are **archived, not
deleted** — they stay on each voter's record, restorable, because in an investigation the answers
you are removing are the evidence.

Only the **entry's own canvasser** is affected. If a second canvasser genuinely surveyed the same
door in the same round, their answers survive untouched — which is the whole point when the reason
for the cleanup is that one person's work is suspect.

Every run row — plain reclassifications and survey conversions alike — carries a **Details** view:
the itemized list of doors changed (was → now, canvasser, round, when) and, for conversions, the
answers recorded or removed per voter. Served from the stamps themselves
(`GET …/reclassify-outcomes/:runId/entries`, `GET …/survey-conversions/:runId/entries?kind=doors|answers`,
paginated, org-admin only), which carries one honest consequence: **revert consumes the stamps, so
an undone run keeps its summary but loses its itemization** — except reverse-run archives a revert
could not restore, which persist and are listed as such.

Both directions are priced like everything else on this page, always in red (recording or removing
answers always moves the survey rate at minimum), and both are **undoable in one click** — a
door-by-door session undoes as a single unit. A large run happens in the background with a progress
bar; if it stops part-way, everything that landed is correct and you can either undo it or pick up
where it stopped.

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
(trimmed string, max 280), the door goal `doorGoal` (**Number, default null, min 1** — a count of
BILLABLE doors) and `goalDate` (same `'YYYY-MM-DD'` civil-date convention as the key dates; null
falls back to `electionDay`), and `billRestrictedDoors` (**tri-state Boolean, default `null`** — `null`
= inherit `Organization.billRestrictedDoors`, `true`/`false` = explicit override; always resolve via
[billRestricted.js](../server/src/services/reports/billRestricted.js), since reading the field raw
collapses "inherit" into "off"), and `disabledOutcomes` (**String array, default `[]`** — door
outcomes turned off in the canvasser app; element-enum'd to `TOGGLEABLE_OUTCOMES` from
[outcomeToggles.js](../server/src/services/canvass/outcomeToggles.js) so `not_home` and the
completion actions can never appear; a flat array on purpose — the PATCH assigns it wholesale,
which is atomic, dodging the partial-subdoc trap the goal fields' comment documents. Enforced at
recording time in [routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js): a fresh
submission of a disabled outcome is `400 { code: 'OUTCOME_DISABLED' }`, while a replay carrying
`wasOfflineSubmission: true` is accepted — same client-asserted trust posture as
`supersededByNewer`, because rejecting it would silently destroy a real knock recorded before the
toggle flipped). ISO date strings order chronologically as plain strings, so all
window checks are lexicographic — no `Date` parsing. A `pre('validate')` invariant enforces that a `survey`
campaign has a `surveyTemplateId` and a `lit_drop` campaign never does (it nulls it on save). There
is no `draft` state — `isActive` is the only lifecycle flag (active ⇄ archived).

**[CampaignChange.js](../server/src/models/CampaignChange.js)** — the configuration audit trail:
`{ organizationId, campaignId, field, fromValue, toValue, byUserId, source }`, one row per field
per edit, written from the campaigns PATCH handler against an explicit `AUDITED_FIELDS` list
(`timeZone` and `surveyTemplateId` are deliberately absent — see Part 1). `fromValue`/`toValue` are
`Mixed` because the audited fields span String, Number and tri-state Boolean, and `null` is a real
value on both sides for most of them. `disabledOutcomes` stores as a **sorted comma-join**
(`'refused,restricted'`; empty ≡ never-set ≡ `null`) via an array branch in `normalizeAudited`, so
a reordered no-op PATCH can't log a phantom change; both clients' `campaignHistory.js` split it
back into labels ("Refused, Restricted off" / "all on"). Written **after** `campaign.save()` on purpose so a row can
never describe a change that didn't land, and `await`ed rather than fire-and-forget — the narrow
window where the save commits and the insert throws (one unlogged edit, a 500) is the accepted cost
of that ordering, and it is the cheaper mistake than logging a change a failed save never made.
Deliberately **not** `AccessLog`, for the reason `CoordinatorChange` already records: that
collection is scoped to platform staff reading customer content under a support grant. In
`CAMPAIGN_SCOPED` and `ORG_SCOPED`, so an audit row never outlives the thing it describes.

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
  window (`earlyVotingEnd < earlyVotingStart`, lexicographic) is a `400`. `doorGoal` is
  `z.number().int().min(1).max(10_000_000).nullable()` (there is no shared numeric validator — this
  follows the inline precedent in `superAdmin/billing.js`); a `goalDate` with no `doorGoal` is a
  `400 { code: 'goal-date-without-goal' }`.
- **PATCH `/admin/campaigns/:id`** — update. **Type-lock guard:** if `type` changes and
  `campaignHasCanvassed(id)` (any `CanvassActivity` or `SurveyResponse`), returns `400
  { code: 'type-locked' }`. Archive/reactivate is just `{ isActive }`. The key-date fields join
  `isActive`/`type`/`state` in the **org-admin-only** list (a lead's PATCH of them is a `403`);
  explicit `null` clears a date; the window check runs against the **merged** values (incoming ??
  stored), so PATCHing one bound still validates against the other. **`doorGoal`/`goalDate` are
  deliberately NOT in that org-admin-only list** (owner ruling 2026-08-14) — a lead may set their
  own campaign's target. The goal pair gets the same merged-value treatment, so clearing the goal
  while a date is stored is the same `400` as setting a date with no goal. **`disabledOutcomes` is
  also deliberately NOT in the org-admin-only list** (owner ruling 2026-08-16, same reasoning):
  zod-validated as `z.array(z.enum(TOGGLEABLE_OUTCOMES))`, deduped and assigned wholesale, audited.
  Pinned end-to-end (lead edit, enum rejection, `OUTCOME_DISABLED`, offline tolerance, both mobile
  wires, audit join, bulk-restrict carve-out) by
  [disabledOutcomes.int.test.js](../server/test/disabledOutcomes.int.test.js) — and the single-home
  desk-mark carve-out (`restrict-doors` still 200 with `disabledOutcomes: ['restricted']`) by
  [restrictDoors.int.test.js](../server/test/restrictDoors.int.test.js) case 13; the
  server/client/mobile constant mirrors by [outcomeToggles.test.js](../server/test/outcomeToggles.test.js).
- **Outcome RECLASSIFICATION** — folding a retired outcome's recorded history into another —
  is a separate, stricter tool:
  [reclassifyOutcomes.js](../server/src/services/canvass/reclassifyOutcomes.js) behind
  GET/POST `/admin/campaigns/:id/reclassify-outcomes` and POST `…/revert`, **org admins only**
  (`isOrgAdmin`, not `canManageCampaign` — a lead owns what their canvassers see, not what the
  ledger says), plus GET `…/outcome-entries` for the Door Outcomes page's filtered table.
  `RECLASSIFIABLE_OUTCOMES` is all five DOOR outcomes; the completion actions are absent from
  **this module** and must stay absent, because a bare `actionType` flip into `survey_submitted`
  fabricates answers nobody gave and a bare flip out of it orphans answers somebody did — and this
  module has neither an answer composer nor an archive, so it cannot honestly do either. **The
  Surveyed direction is real, and lives in the sibling `services/canvass/surveyConversion.js`**,
  which pays for both halves: an admin composes real answers against the door's own survey, every
  created row carries a `deskEntry` stamp, and the reverse direction ARCHIVES rather than deletes.
  See §Converting to and from Surveyed below. `lit_dropped` remains unconvertible in both
  directions — a lit drop has no answers to move either way. **`RATE_NEUTRAL_OUTCOMES =
  ['not_home','wrong_address','no_soliciting']` is the set that carries the old safety argument**:
  all three are in `KNOCK_ACTIONS` and none is a contact, so knocks, `contactRate`,
  `connectionRate`, `billableDoorsOf` and every `Campaign.stats` counter are unmoved by any
  conversion within it (no counter keys on the three individually — `knockCount`/`activityCount`
  cover them, the rest count surveys/lit/refused/restricted). A pair touching `refused` or
  `restricted` DOES move a reported figure, so it is allowed but **priced** — see `computeImpact`
  below — and it triggers `recomputeCampaignStats` afterwards, which the rate-neutral path
  deliberately skips. The target must not be a retired outcome (`TARGET_DISABLED`); the old
  "source must be switched off first" rule was **dropped** (owner ruling 2026-08-16) because it
  made correcting a live campaign's mistyped entry impossible.
- **`computeImpact` is a simulation, not a formula.** The "after" figures come from the SAME
  `knocksPipeline` that produces "before", with a `$set` ahead of it rewriting `actionType` for
  exactly the selected ids — so a preview cannot drift from what the run actually does. The int
  test asserts previewed-after equals the real totals once the run lands. It is skipped entirely
  for a rate-neutral pair (provably nothing moves) which is also what keeps the whole-outcome fold
  unbounded; a money-moving selection is capped at `RECLASSIFY_MAX_IMPACT_ENTRIES` (25k,
  `SELECTION_TOO_LARGE`) since it scans the ledger.
- **Selection.** A scoped run sends `scope` (outcomes/userId/passId/effortId/dateFrom/dateTo/
  surveyTemplateId/answerFilters/answerTagFilters — the date bounds are `dateFrom`/`dateTo`
  because `from`/`to` already name the outcomes) and may send `actionIds`, which only **narrows**
  it, the flag-bulk-review rule, so a stale checkbox can never reach a row the current filter
  doesn't show. Every route resolves the scope ONCE through
  [`resolveEntryScope`](../server/src/services/canvass/entryScope.js) — dates become half-open
  campaign-tz windows via `zonedDayRange` (the old raw-`new Date()` parse made a single-day range
  zero-width), ids are cast, the answer filter runs its one `SurveyResponse` read, and every
  refusal is thrown there so all four routes refuse identically. `buildEntryFilter` **throws** on
  a scope that didn't come from the resolver, and `resolveConversion` no longer exists — the
  conversion routes call the same `resolveSelection` with `SOURCES_FOR(direction)`, so the table
  and both write paths can never interpret one scope differently. A selection may span DOOR
  outcomes (the run records `from: 'mixed'`, each row stamps its own origin, revert stays exact),
  but one straddling the surveyed boundary is refused (`409 SELECTION_SPANS_DIRECTIONS`) instead
  of silently narrowed as before. A malformed scope value is a 400, never "no filter". Omitting
  scope and ids is the whole-outcome fold the App Customization card uses (id-free, so unbounded).
- **The answer filter** ([`answerScope.js`](../server/src/services/canvass/answerScope.js)) joins
  the two ledgers on the visit TRIPLE `(householdId, passId ?? null, userId)` — one canvasser's
  visit to one door in one round, the same key the conversion archives on
  ([`doorKey.js`](../server/src/services/canvass/doorKey.js)); never `CanvassActivity.voterId`
  (names only the LAST voter surveyed) and never `householdId` alone (sweeps a second canvasser's
  honest row into the cleanup). The `SurveyResponse` match requires `surveyTemplateId` (slugs are
  unique only within one template), pushes down only the provably-safe narrowings (`userId`,
  `passId`, the date window onto `submittedAt` — `effortId` deliberately stays activity-side), and
  builds clauses with `answerFilterClause`/`answerTagClause` under `$and` (docs/SURVEYS.md §J's
  dual-read + `__other__` rules, never a hand-rolled `$elemMatch`). Matched triples fold into one
  `countDocuments`-able clause grouped by `(passId, userId)`. **Bounds:** the filter requires one
  other narrowing (`400 ANSWER_FILTER_NEEDS_NARROWING` — a speed bump) and the response read caps
  at `ANSWER_SCOPE_MAX_RESPONSES` (20k, env-overridable at call time — the hard bound). Truncation
  makes `total` a lower bound (`totalIsLowerBound` on the GET), withdraws Select-all-N, and
  refuses scope-only writes (`409 ANSWER_SCOPE_TRUNCATED`) while id-scoped writes stay legal — a
  ticked row is by construction inside the resolved set. Other refusals:
  `ANSWER_FILTER_NEEDS_TEMPLATE`, `ANSWER_FILTER_REQUIRES_SURVEYED`, `INVALID_SCOPE` (unreadable
  JSON). The entries wire gains per-row `survey` evidence (voters/answers at the visit, who
  matched), `sources` (what the matching set is made of — the client reads select-all direction
  off this), and `answerScope` metadata; the removal preview gains `matchedResponses`/
  `matchedVoters` and a matched-first, per-row-flagged manifest. Scoped runs freeze
  `selection.scope` + a human `scopeSummary` on both run models
  ([`scopeSummary.js`](../server/src/services/canvass/scopeSummary.js)).
- **Door status** is re-resolved by `recomputeHouseholdStatusesBatched` — one read plus one
  `bulkWrite` per 500-door chunk instead of two round trips per door, which is what lets a
  several-thousand-door run finish inside a web request. Its `timestamps: true` is load-bearing:
  `/mobile/changes` finds changed doors by `updatedAt`, so a status write that doesn't bump it
  never reaches the phones (asserted in the int test). Converted rows keep GPS/timestamp/user/pass/turf/effort and gain a
  `CanvassActivity.reclassified { from, at, byUserId, runId }` stamp; **a stamped row is excluded
  from later runs**, so provenance stays exactly one level deep and revert never guesses. Rows
  are stamped BEFORE the [`ReclassifyRun`](../server/src/models/ReclassifyRun.js) row is written
  (same "a row must mean this landed" ordering as `CampaignChange`), then door status is
  re-resolved in bounded chunks. Both the run and its revert write a `CampaignChange` with
  `field: 'outcomeReclassify'` and `source: 'outcome_reclassify'` — a **new enum value**, per that
  model's own note that a bulk/repair path must declare itself rather than masquerade as a human
  field edit; `source` is never shipped to clients, so it is not a client change. `ReclassifyRun`
  is in **both** delete cascades. Pinned by
  [reclassifyOutcomes.int.test.js](../server/test/reclassifyOutcomes.int.test.js), whose central
  assertion is the money invariant, compared field-by-field before and after.
- **Where the fields surface:** GET `/admin/campaigns` (lean-doc spread — automatic), the
  per-campaign rows of GET `/admin/reports/campaign-rollup` (added to its projection + row object in
  [reports.js](../server/src/routes/admin/reports.js) — it picks fields, nothing flows automatically),
  GET `/mobile/campaigns` (the picker) **and** the per-campaign GET `/mobile/bootstrap` `campaign`
  object ([bootstrap.js](../server/src/routes/mobile/bootstrap.js) — both additive, so older clients
  ignore them; bootstrap carries them so the Books header + mobile admin detail can show the chip
  in-campaign, not just on the picker). Covered end-to-end by
  [campaignDates.int.test.js](../server/test/campaignDates.int.test.js).
- **GET `/admin/campaigns/:campaignId/history`** — the change feed. Gated by `canManageCampaign`,
  the same gate as the PATCH that writes it, so a lead reads only campaigns they run. Merges
  [CampaignChange](../server/src/models/CampaignChange.js) (config edits) with
  [CoordinatorChange](../server/src/models/CoordinatorChange.js) (team reassignments) in memory —
  both are inherently low-volume per campaign, so it reads a bounded `HISTORY_CAP` slice of each
  and reports `truncated` rather than carrying a cross-collection cursor. Legacy
  `CoordinatorChange` rows with `campaignId: null` (pre per-campaign crews) are **excluded** —
  guessing which campaign they belonged to would invent history. Actor names come from
  `hydrateCanvassers`, which never drops an id, so an edit by someone since deleted still renders
  with a name and a standing. Returns `{ items[], truncated, createdAt, createdBy }`; the creation
  pair anchors the bottom of the feed so an unedited campaign still reads as a timeline.
- **Where the GOAL surfaces — deliberately narrower.** `doorGoal`/`goalDate` ride the lean spread on
  GET `/admin/campaigns`, and both that route and the rollup additionally attach a computed **`goal`
  block** (below). They are **NOT** added to `/mobile/campaigns` or `/mobile/bootstrap`: canvassers
  never see a goal. Covered by
  [campaignGoal.int.test.js](../server/test/campaignGoal.int.test.js).
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
- **Change history (mobile):** [admin/history.jsx](../mobile/app/(app)/admin/history.jsx) — a flat
  screen (nesting under `campaign/[campaignId]/` would mean restructuring that file), registered
  as a hidden `<Tabs.Screen name="history" href={null} />` in
  [admin/_layout.jsx](../mobile/app/(app)/admin/_layout.jsx) or it renders as a visible tab.
  Campaign-scoped by `CampaignChip` + the focus re-sync (the Overlaps/Notes shape), one `InsetGroup`
  of INERT `InsetRow`s (nothing behind a row to open), the Overlaps state ladder verbatim
  (resolving → no campaign → error+Try again → loading → list). A 403 is a legitimate state — a
  lead on a campaign they don't manage — and lands in the error branch. Words come from
  [mobile/lib/campaignHistory.js](../mobile/lib/campaignHistory.js), hand-mirrored from the web
  copy with **one divergence**: it formats dates through `formatGoalDate` (goalPace.js) because
  mobile's `electionDates.js` has no `formatDateLabel`. Reached from the Quick-actions
  `NavTileGrid` tile — the only mobile entry point since the Door goal group it also lived on was
  replaced by a compact line whose tap opens the metric sheet. Uses the same react-query key as web,
  `['admin','campaign-history',campaignId]`.
- **Change history:** [CampaignHistoryDrawer.jsx](../client/src/components/CampaignHistoryDrawer.jsx),
  mounted on both [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) (⋮ → History) and
  [DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) (the goal strip's History link) — one
  component, one query key `['admin','campaign-history',campaignId]`, two entry points. Labels and
  value formatting live in [campaignHistory.js](../client/src/lib/campaignHistory.js), never on the
  server, so re-wording a field label is not a data migration and an old row renders with today's
  copy. `labelForField` falls back to a de-camel-cased guess, so a field the server starts logging
  before the client knows about it still renders instead of vanishing.
- **The edit drawer is open to LEADS**, not just org admins — the server has always accepted
  `name`/`surveyTemplateId`/`timeZone` from them and now takes the goal too, so withholding the
  drawer entirely left a lead unable to reach a field they own. `canEditAdminFields={isOrgAdmin}`
  renders the org-admin-only inputs disabled with a one-line reason rather than hiding them.
- **Door goal:** the server owns every number
  ([goalProgress.js](../server/src/services/reports/goalProgress.js)); the clients only pick words
  and colors, from [goalPace.js](../client/src/lib/goalPace.js) and its hand-mirrored twin
  [mobile/lib/goalPace.js](../mobile/lib/goalPace.js) (the metricHelp rule: reword one, reword both).
  Rendered by [GoalStrip.jsx](../client/src/components/GoalStrip.jsx) on
  [DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) — one thin flex-wrap line **inside the
  header block**, under the type/state line and sharing ONE wrapping row with the key-date pills
  (`hasKeyDates || hasDoors` gates the row; a thin `w-px` divider separates the two halves only
  when both are present). They were stacked rows until 2026-08-15 — two lines of vertical space
  for two sets of the same kind of fact.
  The placement replaced a taller body card *and* its caption: this is the only number on the page
  that ignores the range/walk-list/crew pickers, and putting it in campaign-identity space — beside
  Election Day and early voting, which are equally filter-immune — makes that legible without a
  sentence apologising for it. The sentence still exists in `metricHelp.doorGoal` behind the (i).
  The strip prints its own deadline **only** when `deadlineSource === 'goalDate'`; on the Election
  Day fallback the countdown pill directly above is already saying it.
  Compact `GoalCell` / `GoalBlock` are exported from
  [CampaignCard.jsx](../client/src/components/campaigns/CampaignCard.jsx) and reused by
  [CampaignsTable.jsx](../client/src/components/campaigns/CampaignsTable.jsx), the same way
  `CountdownChip` already is. Mobile mirrors the web placement rather than the web markup: a two-line pressable in the
  key-dates block of `admin/campaign/[campaignId].jsx`, beside `ElectionCountdownChip` and above
  `DateRangeBar`, which replaced a tall `InsetGroup` that sat *below* all three filter controls it
  ignores. It opens the shared `MetricSheet` (the screen's convention for explaining a metric)
  rather than carrying a caption. The compact goal bar in `RowAccessory` on `admin/index.jsx` is
  unchanged. Mobile has **no goal editor** — it is read-only for campaign fields, exactly like the
  key dates.
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
