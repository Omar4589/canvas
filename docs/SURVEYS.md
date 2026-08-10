# Surveys

How surveys are built, run at the door, stored, and reported — including conditional questions,
read-aloud option scripts, "Other (specify)", and the (now much more permissive) rules for editing a
survey that's already collecting answers.

- **Part 1 — For everyone** is plain language: what a survey is, how to build one (including
  branching logic, per-option scripts, and **tags** that group answers across questions), what
  you can safely change once it has answers, and **auditing answers** — drilling from any count to
  the voters behind it, who *recorded* each entry and when, and the Survey Explorer page.
- **Part 2 — Technical reference** is for developers (and Claude): the data model, dual-read
  reporting, the soft-retire reconcile, the shared visibility evaluator, answer normalization, the
  migrations, the **tags** story — the org-level `Tag` library + management API, the
  cross-question rollup, by-tag walk lists, and CSV export — and the **answer drill-in** endpoints
  (per-canvasser breakdown, the voters-by-answer CSV, the response detail) with their counting
  contract (§J).

Related: [METRICS.md](METRICS.md) ("Surveys" and "Surveyed voters" definitions),
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (one survey per voter **per pass**),
[EFFORTS.md](EFFORTS.md) (a **walk list can override** the campaign survey — the door's walk-list
survey wins, falling back to the campaign default),
[VOTERS.md](VOTERS.md) (editing a single response on a voter's profile),
[EXPORTS.md](EXPORTS.md) (full survey results at scale — wide + long CSVs; the in-page
voters-by-answer CSV stays as the interactive drill).

---

# Part 1 — For everyone

## What a survey is

A **survey** is the questionnaire a canvasser runs at the door. One survey (we call it a "survey
template") belongs to your **organization** and can be attached to one or more **campaigns**. It
has:

- an **intro** and a **closing** — short scripts the canvasser reads,
- a list of **questions**, each one of three types:
  - **Single choice** — pick one option,
  - **Multiple choice** — pick any number of options,
  - **Text** — free typing.

Each question can be marked **required** and has an **order** (where it appears in the list).

Survey campaigns use a survey; **lit-drop campaigns** don't — they just record that literature was
dropped. (See [METRICS.md](METRICS.md) for how the two campaign types count.)

## The Surveys library page (web admin)

The org **Surveys** page is a proper library now — built to answer "what surveys do we have and how
are they doing?" at a glance, with authoring split out onto its own pages:

- **Stat cards** up top: total surveys, total responses, how many are **in use** (attached to a
  campaign or walk list), and how many are **drafts** (not attached anywhere).
- A **search box** and an **Active / Archived / All** filter over the list.
- One **row per survey**: name + created date, **everywhere it's used** — campaigns *and* walk-list
  overrides (a survey used only on a walk list used to show as unused; it doesn't anymore) — question
  count (what canvassers actually see; retired questions don't inflate it), response count, and a
  version badge.
- **Click a row** to open the **quick view** — a side panel with the survey's dates, everywhere it's
  used (each linking straight to that campaign's results), response totals **per campaign**, and a
  read-only preview of every question. It's the fast way to *see* a survey without opening the
  builder; **View full results →** jumps to the campaign dashboard's Survey-results section.
- **Actions** live on each row (⋮ menu) and in the quick view: **Edit**, **Duplicate**, and
  **Archive** or **Delete** (see below).

**Creating and editing** happen on dedicated pages — **+ New survey** opens `/surveys/new` and
**Edit** opens `/surveys/<id>/edit`, both hosting the full builder; save or cancel returns you to
the library. In the builder you give the survey a name, write the intro/closing, then add questions —
wording, type, options, required. When you attach the survey to a campaign, canvassers on that
campaign start seeing it.

### Archiving and deleting

- **Archive** hides a survey from the Active list and from every survey picker (campaign form,
  Change-survey dialog, walk-list override dropdowns) — **without touching anything**: campaigns
  still using it keep working, responses keep reporting, and wherever it's currently selected it
  stays visible (labeled "archived") so nothing silently resets. **Unarchive** brings it back.
  Archive is for retiring old questionnaires you're done with but whose data you keep.
- **Delete** is only offered for a survey that is truly unused — **zero responses, not any
  campaign's survey, not any walk list's override**. Anything in use shows Archive instead, and the
  server refuses an in-use delete with the specific reasons. Delete is permanent; it exists so an
  abandoned draft doesn't live forever.

Beyond plain questions and options, the builder supports three extras:

### Conditional questions ("Show only if…")

You can make a question appear **only when an earlier answer matches**. On any question (after the
first), open **Show only if…** and add one or more rules. A rule reads:

> *"`<earlier question>` **is / is not / is any of** `<option(s)>`"* — or, for a text question,
> *"is answered / is not answered."*

With multiple rules you choose **Match ALL** (every rule must hold) or **Match ANY** (one is enough).
Rules can reference **only earlier questions** — the builder won't let you point at a later or the
same question — so the survey can never tangle itself into a loop. This one mechanism covers all the
common shapes: **branch** ("show the follow-up only if they picked X"), **skip** ("hide this unless
they're a supporter"), and **skip-to-end** (the last questions simply don't appear).

At the door, hidden questions never show, and **their answers aren't saved** — a question someone
never sees can't accidentally count in your reports.

### Read-aloud option scripts

Any choice option can carry a short **read-aloud script** — a line the canvasser sees the moment
they pick that option. Add it with **+ read-aloud script** under the option. It's perfect for
follow-up prompts ("Great — what would change your mind?") or rebuttals tied to a specific answer.
It's guidance for the canvasser only; nothing about it changes how the answer is stored or counted.

### "Other (specify)"

Turn on **Other (specify)** on a choice question and the door form gains an **Other** choice with a
small free-text box. Whatever the voter says is captured alongside the structured answer, so you keep
the clean option counts *and* the verbatim text.

**Where those answers show up:**

- **Survey results** give Other its own bar, labelled **Other**, alongside your real options. (It
  used to appear as a strange greyed-out entry called `__other__` badged "no longer asked" — that was
  a bug, not a deleted option.)
- **Click the row** to list the people who wrote something in, each row showing what they typed.
  Before, that list came back empty no matter how many write-ins you had.
- **Filter the map** to Other, like any other answer.
- **Exports** name it: a write-in reads `Other — potholes`, so it can't be mistaken for a real option
  someone happened to name "potholes".
- **The voter's page** shows the typed text, and you can now add, change, or remove an Other answer
  there — including the text. Editing a response used to quietly de-classify it: the words survived,
  but the answer dropped out of the Other count and reappeared as a junk row named after the typing.
- **Client reports** never show the words. Every write-in is folded into a single **Other** row with
  its count intact — a client sees how many people said something else, never what any of them said.

If you also create a normal option literally named "Other" on the same question, both work and stay
separate — the write-in then reads **Other (specify)** so the two are told apart. It's usually a sign
you want one or the other, not both.

> **Note — "Refused to answer" is not built yet.** A per-question "Refused" choice is a planned,
> separate **door-outcome** feature; it does not exist today. Don't expect a Refused toggle in the
> builder.

### Tags (group answers across questions)

A **tag** is a short label you stick on an **answer option** — like "Supporter," "Needs follow-up,"
or "Volunteer." The point of a tag is to pull together related answers that live in **different
questions**. Maybe Q1 asks "Who are you voting for?" and Q5 asks "Would you put up a yard sign?" —
tag the "Our candidate" option in Q1 *and* the "Yes" option in Q5 both **"Supporter,"** and the app
can now treat anyone who picked **either** as a supporter, with no double-counting.

**Tags are an organization library now.** Instead of being typed fresh into each survey, your tags
live in **one managed list** that belongs to your organization and is shared across **every** survey
and saved search. That single list is the source of truth — so "Supporter" means the same thing
everywhere, and you can't accidentally end up with "Supporter," "supporters," and "Suporter" all
floating around as separate things.

**Adding a tag in the builder.** Each answer option has a small **+ tag** link; click it and a
**pick-or-create** box appears. As you type it filters your organization's existing tags — click one
to use it. If what you typed doesn't match any tag, you get an explicit **"Create '…'"** action; only
then is a brand-new tag added to the library. There's no silent typo that quietly forks the list — you
either pick something that already exists or deliberately create a new one. Matching is **not
case-sensitive**: "Supporter," "supporter," and "SUPPORTER" are all the same tag.

**Managing the library (the Tags page).** A dedicated **Tags** page in the main (organization) nav
lists every tag with a **usage summary** — how many options carry it, across how many surveys, and how
many saved searches filter by it. From there you can:

- **Create** a tag up front (or just let the builder create it the first time you use one).
- **Rename** a tag — the new name is rewritten **everywhere at once**: every survey option, every
  survey's tag list, and every saved-search "by tag" filter. Your reports and lists keep working;
  only the label changes.
- **Merge** two tags into one — pick a target and the source's options, surveys, and saved searches
  all fold into the target, then the duplicate is removed. (If you try to *rename* a tag to a name
  that already exists, the page tells you it would collide and offers to **merge into it** instead.)
- **Delete** a tag — it's removed from the library and **untagged everywhere** it was used (you're
  shown its usage and asked to confirm first).

Rename, merge, and delete all **heal across every survey and saved search** in one move — there's no
hunting through individual surveys to fix a label.

> **Tags are an admin-only convenience.** They're metadata you attach for *your* reporting and list-
> building. **Canvassers never see tags** at the door — the mobile survey is unchanged.

Once options are tagged, tags show up in four places:

- **The survey report → "Tags" section.** Open the campaign's survey results (the campaign
  dashboard **or** the Survey Explorer) and you'll find a **Tags** panel. Each tag carries **two
  numbers**, both counting **people, once each**:
  - **Voters** (*identified*) — everyone who **ever** gave a tagged answer, counted once even if
    they hit the tag in several questions or several rounds. This number never goes down.
  - **Current** — of those, how many people's **most recent answer still carries the tag**. Someone
    who said *Support* in round 1 and *Opposed* in round 2 stays in *identified* but drops out of
    *current*. A later visit that **skipped** the question (the survey branched around it) changes
    nothing — the last answer they actually gave still stands. This is the number to quote for
    "how many supporters do we have **now**".
- **The by-team split.** Click a tag and you'll also get a **By team** table: each crew's
  identified and still-current voters, plus a "No team" row and the campaign line. Credit goes to
  the **first team to tag the voter** — a voter reached by two teams stays with the first — so the
  team rows always **add up exactly** to the campaign total, both columns.
- **Building a list "by tag."** When you create a **saved search** (walk list), the answer-filter
  panel has a **By tag** row of tag chips. Pick "Supporter" and the resulting list is **every
  household with someone who matched that tag in any question** — a cross-question reach that the
  per-question answer filters can't express on their own. From the Saved Searches list you can then
  **Export CSV** to download those voters (name, party, age, phone, precinct, address) for a re-
  canvass, a phone bank, or a mail house.
- **Client reports (opt-in).** The report builder has a **Visible tags** checklist — a ticked tag
  shows up on the published report as a "Voter groups" row ("400 identified · 380 still current").
  **Nothing shows unless you tick it**, so internal tags like "Hostile" or "Do not return" can
  never reach a candidate's page by accident. See [CLIENT_PORTAL.md](CLIENT_PORTAL.md).

> **"Current" always means "within the view you're looking at."** Scope the results to round 1
> and a round-2 flip is invisible — the latest answer *in that scope* is the round-1 one. The
> all-rounds view is the one that answers "current supporters, today."

## The campaign's "Survey" tab (every survey this campaign uses)

Each campaign has its own **Survey** tab (open a campaign, then **Survey** in the sidebar). It's a
**coverage view**: not just the default survey, but **which survey every set of doors actually
gets** — so a campaign running two surveys at once (see the next section) is fully visible and
manageable from one screen.

- **The main survey card** — the campaign's default template with its **response count for this
  campaign** (Intake doors + every walk list that doesn't override). The full question list is
  tucked behind a **Preview** toggle (collapsed by default) so the card stays short and the walk-list
  section sits above the fold. Surveys stay reusable **org-level templates**, but you don't get
  bounced to the org-wide list to work on one: **creating and editing happen right here in the
  drill-in** — the builder opens in place and returns you to this tab on save.
- **The "Walk list coverage" table** — one row per walk list: its doors, **which survey it runs**
  (a dropdown that reads "Campaign default → *name*" until you override it), and its **response
  count**. Change a walk list's survey right here — this is the same override the Walk Lists page
  edits, shown from the survey's point of view. If responses came in from doors not yet assigned to
  any walk list, an **Intake** row shows them under the default.

**Creating a survey (one top-level "New survey" button):** click **New survey** in the tab header.
If the campaign has **no main survey yet**, the one you build becomes the main survey (used
everywhere). If a main **already exists**, the new survey is **added to your library** (it never
silently replaces the main) and the tab shows *"'X' created — assign it to a walk list below,"* with
the new survey now available in every walk-list dropdown. To run a second survey on specific doors,
you assign it to a walk list — here or on the Walk Lists page.

**Team leads can now author surveys** for a campaign they manage — **New survey** and **Edit survey**
are available to them, not just admins. They stay scoped to their campaign: the server only lets a
lead edit a survey they **authored** or one **attached to a campaign they manage**, and since
2026-08-08 their **entire library is that same set** — the list, the Change-survey picker, and the
walk-list override dropdown show only authored-or-attached templates, and attaching anything else by
id is refused server-side. (A lead may be the *client's* own manager — see
[ROLES.md](ROLES.md) — so another client's scripts, campaign names, and response volumes must never
appear.) Two consequences worth knowing: **detaching** an admin-authored survey from your only
campaign using it drops it out of your library — an admin has to re-attach it; and the response
counts a lead sees cover **their campaigns only**, so a survey shared beyond their view can read
"0 responses" yet still refuse a question-type change (the org-wide `409 survey-has-responses` guard
is unchanged — the builder shows "used elsewhere in your organization" in that case). Leads can pick
from existing tags but can't create new ones (tag creation stays admin-only). Archiving/deleting
templates stays admin-only too.

From the main card you can:

- **Change survey** — pick a different template from your library for this campaign.
- **Edit survey** — open the builder **right here in the campaign** to edit the attached survey's
  questions; saving returns you to this tab. If that survey is **shared by other campaigns**, the
  builder warns you that edits apply to all of them and offers a one-click **Duplicate** so you can
  edit just this campaign's own copy.

A few rules this tab enforces:

- A **lit-drop campaign** shows a short "surveys aren't used for this campaign" note instead —
  lit-drops record drops, not responses.
- A **survey campaign can't activate a round until a survey is attached** — until then canvassers
  have nothing to fill out. If walk lists have overrides but **no default is attached**, the tab
  warns you: override lists keep working, but Intake doors and non-override lists have no survey.
- **Swapping mid-canvass is allowed.** If you change to a different survey after answers have come
  in, the old responses keep reporting under the old survey and new answers report under the new one
  — nothing is lost or mixed. If the survey you pick **already has responses**, the tab warns you
  that new answers will report **separately** from those.
- There's **no "unlink"** — to stop using a survey you simply **change to a different one**.

## Different surveys for different walk lists

Most campaigns use one survey for everyone — but sometimes different groups need **different
questions** (say a persuasion script for swing doors and a volunteer-recruitment script for your
base). You don't need separate campaigns for that: a **walk list can override the campaign's default
survey with its own**.

- The campaign's **Survey** tab sets the **default** — the survey every door uses unless its walk
  list says otherwise.
- The override can be set in **either place**: the Survey tab's **Walk list coverage** table (the
  survey-centric view, with per-walk-list response counts) or the **Walk Lists** page's **Survey
  override** dropdown (defaults to "Campaign default"). They edit the same setting. Point one walk
  list at "GOTV" and leave another on the default, and each group gets its own questionnaire.
- In the field the app resolves the survey **per door** (household → its book → its walk list's
  override, else the campaign default), so a canvasser working doors from two walk lists sees a
  walk-list switcher and always gets the right questions for the door in front of them. The server
  rejects a submission that doesn't match the door's survey, so the wrong one can't be recorded.
- **Reporting keeps them separate.** Every response is stamped with both the survey it used and the
  walk list it came from, so answers never bleed across surveys and you can filter any report to a
  single walk list. (See the next section, and [EFFORTS.md](EFFORTS.md) for the mechanics — internally
  the override lives on the walk list's `Effort.surveyTemplateId`.)

## Reading results when a campaign used more than one survey

Because a swapped-out survey keeps its own responses, a campaign can end up with answers under **two
or more** surveys over its life. The campaign **dashboard's "Survey results"** section handles this
with a **survey switcher**: when the campaign has answers under a survey other than the one currently
attached, a dropdown appears in the section header. It defaults to the **current** survey (labeled
"current") and lets you jump to any **past** survey's results in one click — so nothing a campaign
collected is ever hidden. A campaign that has only ever used one survey shows no switcher.

How the counts split, so you can trust the numbers:

- **Per-answer breakdowns and tag rollups are per (campaign + survey).** Each response is stamped with
  both its `campaignId` and the `surveyTemplateId` that was attached when it was recorded, so
  "Support: 40" always means *40 for the survey you're looking at* — surveys never bleed into each
  other.
- **The gross "surveys submitted" tally is per-campaign** and sums across every survey the campaign
  used (it counts responses, not a particular answer).
- **Tags do not roll up across different surveys.** A "Supporter" tag on survey A and a "Supporter"
  tag on survey B are counted independently. If you want one combined supporter universe, **evolve a
  single survey by editing it** (add the new question — see "Editing a survey…" below) rather than
  standing up a second survey for the same question. Both tag units — identified **and** still
  current — are judged **within the survey you're viewing**, and so is the by-team split.

## Reading a results card (campaign Home)

Each question on the campaign's Home page gets its own card. Inside it, one row per answer:

- **The answer's wording comes first**, taking as much of the row as it needs, then a short bar, then
  the percentage and the count. A long option — "Supporting law enforcement and first responders" —
  is never cut off mid-word: it fits on one line at normal window sizes, and wraps onto a second line
  in a narrow one. The percentages line up in a column down the card, so you can compare them by eye
  without reading each number.
- **The bar's length is the percentage printed beside it**, nothing else — a bar and its number can
  never disagree. An answer only one or two people gave still paints a visible sliver; an answer
  nobody gave paints nothing at all. The bar is deliberately short: it is there to make the shape of
  the answers scannable at a glance, and the exact figure is right next to it.
- **A retired answer** (an option you removed after people had already given it) keeps its real
  wording and is marked **Retired**. It still counts toward the question's total, because the people
  who gave it really did give it.
- **Click any row** to expand it into the list of people who chose that answer.

Cards sit side by side when the window is wide enough for both to be readable, and one card per row
when it isn't — the switch follows the space the cards actually have, not the size of the window, so
collapsing the sidebar genuinely gives the cards that room. Two cards in a row are the same height,
with the taller one setting it; the shorter one keeps its hint on its bottom edge rather than
stopping halfway.

**A note on percentages.** On a **single choice** question the percentages are a share of the people
who answered, and they add to 100%. On a **multiple choice** question one person can pick three
answers, so the percentages are a share of *picks*, not of people — which is why no single bar gets
very long on a question with a lot of options. That is the honest picture and it is left alone
deliberately: scaling the bars against the leading answer would make them look better and make each
bar disagree with the number printed beside it. The **(i)** next to the card's heading says which of
the two you're looking at.

**Free-text questions** list the most common answers, grouped by identical wording. The heading says
**top 10 answers** when there are more than ten distinct ones — the card shows the ten most common,
not everything that was typed.

## Auditing answers — who chose one, who recorded it, and when

The survey report tells you *how many* picked "Opposed"; sooner or later you need the **who** behind
a number — which voters gave it, which **canvasser typed it**, at what time, with what note, and
where those doors sit. Two places answer that:

**The quick look (campaign Home).** In the dashboard's **Survey results**, click any answer row to
expand it. Each entry in the voter list shows the voter (and party), the address, **who recorded it
and exactly when** (to the second, on the campaign's clock), any **note** typed with the response,
and an **Offline** badge when it was recorded without signal and synced later. **Click a row** to
open the full response detail (below); a small **Map** link jumps to that door on the Map page.
Above the list sit a **canvasser filter** and a **Voters | By canvasser** toggle — flip it to see
who's been recording this answer — plus an **Open full view →** link into the explorer. Expanding a
**tag** gets the same enriched rows (but no by-canvasser view — see below).

**The Survey Explorer (the full page).** Every campaign has a **Survey Explorer** tab in its
sidebar — a whole-page workspace for one drill:

- **Filters** across the top: survey (when more than one has responses), question, the answer as
  clickable **chips** (each with its live count), canvasser, walk list, and a date range that opens
  on **Today** (see [DATE_FILTERS.md](DATE_FILTERS.md)).
- **Headline numbers** for the drilled answer: how many, what share of the question, and how many
  canvassers recorded it.
- **Voters** — a table of every matching entry (voter, address, canvasser, exact time, note,
  Offline badge, per-row Map link). **By canvasser** — a ranked table of who recorded the answer:
  entries, **% of this answer**, **% of their own answers** to this question ("of everything they
  record here, how much is Opposed?"), and their last entry. Click a canvasser to filter the whole
  page to just their entries; click again to clear.
- A **map** of exactly the filtered homes, rendered ABOVE the list (it reads at a glance; the list
  had required a long scroll to reach). **Clicking a pin** opens that door's card — residents, who
  recorded the answer, when, and their note — and a person in that card opens the SAME
  `ResponseDetailDrawer` the list rows open, so there is one response-detail UI, not two. A
  building glyph stands for its whole apartment stack and lists every matching unit. The card is
  built entirely from the map payload (`voters` + `surveys`), so a pin click costs no extra fetch.
  A **fullscreen** toggle replaced the old *Open in Map →* link: that link sent you to another
  page to do what this map now does in place.
- **Export CSV** downloads exactly the current drill — voter, party, address, canvasser, date and
  time, the recorded answer, the note, and an offline flag per row.
- The whole drill lives in the page's address, so a specific view can be bookmarked or shared with
  another admin.

**The response detail.** Clicking an entry anywhere (explorer or accordion) opens the response in
full: every question and answer as recorded, the note, when it was submitted — and when it
**synced**, if it was recorded offline — the round, how far from the house it was recorded (in
feet/miles), an *"Edited by … on …"* line if an admin later changed it, a small locator map, and a
**View on map** link. Org admins also get a link to the voter's record.

**Everyday uses:**

- *"Who wants a yard sign today?"* — question = your yard-sign question, answer = Yes, range =
  **Today**: the list is your pickup route, with names and addresses. Export the CSV or open it in
  the Map.
- *"Who keeps entering Opposed?"* — flip to **By canvasser**. If one person accounts for most of the
  option and it's half of *their own* answers while everyone else sits at 10%, you know whose doors
  to look at — their entry times, notes, and pins tell you the rest.
- *"Pull everyone who said X this week"* — set the range, **Export CSV**.

**Two honest-numbers notes:**

- The by-canvasser table **adds up exactly** to the answer's count in the survey report — and the
  counts are raw per-person entries, never re-credited to teams (this is an audit surface: it
  answers "who pressed the button"; see [METRICS.md](METRICS.md)).
- The headline "Answers" count and the entry list's own total are two different queries; on rare
  legacy data they can differ by an entry or two, so the page reports each as its own number rather
  than pretending they're the same.

**Tags drill differently.** A tag rollup counts *distinct voters* across questions, so there is no
honest per-canvasser split ("who recorded this voter's tag" has no single answer when three
questions feed it). A tag drill gets the enriched voter list (labelled in **entries** — one per
round, so a voter surveyed in two rounds appears twice and the list deliberately reads bigger than
the voter number above it), the **By team** table (the sanctioned split — first-finder credit gives
each voter exactly one team, which is what a per-canvasser column can't do), the canvasser filter,
and the CSV — but no By-canvasser view and no mini map.

**Team leads** get all of this for the campaigns they manage. **On mobile**, tapping an answer's
count on the campaign screen opens the same voter list with the **Voters | By canvasser** toggle
and canvasser filter, and a **View on map** that opens the mobile admin map pre-filtered to the same
drill; the response detail screen shows the same edited-by and offline-synced lines. Tapping a
**tag** on the campaign screen's Tags card opens the same drill in tag mode — entries list plus the
By-team card, no By-canvasser tab and no map link, with the reason stated on screen.

## What a canvasser sees (mobile)

At a voter, the canvasser opens the survey, reads the intro, and answers the questions. As they go:

- **Conditional questions appear and disappear live** — answer the parent and any dependent question
  reveals itself (or hides) immediately.
- When they pick an option that has a **read-aloud script**, that line shows up right under the
  choice.
- An **Other** choice pops a "Please specify" box for free text.
- Required questions must be filled — but **only the questions that are actually showing**. A hidden
  question is never required and is never saved.

They can add a free-form note and submit. Surveys submitted while offline are queued and sync later.
**One survey is kept per voter, per pass** — if a canvasser re-submits for the same voter in the
same pass, the new one replaces the old. When the earlier response belongs to **another canvasser**,
the app asks before opening the survey ("Already surveyed this round") — and if they go ahead, the
replaced answers are **preserved, not lost**: they appear on the voter's profile as a read-only
preserved-response card, and an admin can **restore** them (a lossless swap — the two responses
trade places, nothing is deleted). A house with three voters surveyed in one visit produces
**three survey responses but counts as one knock** (see [METRICS.md](METRICS.md)).

## Editing a survey — what's allowed once it has answers

Before a survey collects any answers, edit it freely. **Once it has responses you can still edit it
almost completely** — the app now protects your reports automatically instead of locking the
controls, so the old "this is blocked" warnings are gone for nearly everything.

Why it's safe: every option has a hidden, **stable id** that never changes, and every stored answer
remembers that id. Reports add up answers by id, so you can **rename** an option or **reword** a
question and the counts follow along untouched. And when you **remove** a question or an option, the
app doesn't delete it — it quietly **retires** it (keeps it, hidden from the field) so the answers
people already gave still appear in your reports under a clearly labeled "retired" bucket.

Once a survey has responses:

- **Safe (do it freely):** rename the survey, edit the **intro/closing**, **reword** a question,
  **rename** an option, toggle **Required**, **reorder** questions, **add** a question or option,
  **remove** a question or option (it's retired, not deleted), and add/edit **conditions**,
  **read-aloud scripts**, or **Other (specify)**.
- **The one blocked change:** changing a question's **answer type** (e.g. single-choice → text). The
  stored answers were recorded in the old shape and can't be re-totaled in the new one, so the type
  control is locked and the server refuses the change.

**Need to change a question's type?** Use **Duplicate** on the Surveys list. It makes a fresh,
fully-editable copy (reset to v1); point your campaign at the copy on the Campaigns page. The
original stays intact so its existing reports keep working. Note: after you repoint a campaign, that
campaign's new answers report under the **copy**, separate from the answers already gathered under
the original — the Campaigns page shows a heads-up when you pick a survey that already has responses.

---

# Part 2 — Technical reference

The implementation lives in
[`server/src/routes/admin/surveys.js`](../server/src/routes/admin/surveys.js) (authoring,
reconcile + rule-graph validation),
[`server/src/routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js) (submission), the
shared [`server/src/services/surveys/`](../server/src/services/surveys/) helpers (visibility,
normalization, dual-read aggregation, edit classification), and the `survey-results` handler in
[`server/src/routes/admin/reports.js`](../server/src/routes/admin/reports.js) (reporting).

## A. Data model

| Model | File | Fields that matter |
|---|---|---|
| `SurveyTemplate` | [models/SurveyTemplate.js](../server/src/models/SurveyTemplate.js) | `organizationId`, `name`, `isActive`, `version` (default 1), `intro`, `closing`, `questions[]`, **`tags: [String]`** (a per-survey **palette** — the distinct display casings of the tags its options use; **derived/kept-in-sync on save**, no longer the source of truth — the org-level **`Tag`** library is, see §I), **`archivedAt`** (`Date \| null`, indexed — soft-archive; hides the template from the Active list + all pickers unless currently selected, touches nothing else; no migration needed, existing docs default `null`), `createdBy`. Org-scoped, **not** campaign-scoped (a campaign points at a template via `Campaign.surveyTemplateId`). |
| `Tag` | [models/Tag.js](../server/src/models/Tag.js) | The **org-level managed tag library** (Phase 3.1): `organizationId`, `name` (canonical display), **`normalizedName`** (trim+lowercase dedupe key), `color` (reserved for a future colored-chip UI, default `null`), `createdBy`, timestamps. **Unique index `{ organizationId, normalizedName }`** makes duplicate tags structurally impossible. Survey options still reference a tag by its display `name` **as a string** (`option.tag`); this collection is the picklist + the target of rename/merge/delete (see §I). |
| `SurveyTemplate.questions[]` | same (`questionSchema`, `{ _id: false }`) | `key` (stable per-survey slug, **the join handle** — never reused once retired), `label`, `type` (`single_choice`/`multiple_choice`/`text`), `options[]`, `required`, `order`, **`retired`** (soft-retire a whole question), **`visibleIf`** (conditional display, default `null`), **`otherOption`** (boolean — adds an "Other: ___" choice), **`refusalOption`** (boolean — reserved for a future door-outcome feature; **no UI, not wired**). |
| `SurveyTemplate…options[]` | same (`optionSchema`, `{ _id: false }`) | **`id`** (stable per-question id — reports/conditions join on this, so `text` is freely editable), `text`, **`tag`** (cross-question group label, default `null`; canonicalized to the palette's casing on save — see §I), **`script`** (per-option read-aloud line), **`retired`** (soft-hide from the field, keep in reports), `order`. |
| `SurveyTemplate…visibleIf` | same (`visibleIfSchema`) | `logic` (`all`/`any`, default `all`) + `rules[]`. Each rule (`ruleSchema`): `questionKey` (an **earlier** question), `op` (`is`/`is_not`/`any_of`/`answered`/`not_answered`), `optionIds[]`. |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `surveyTemplateId`, **`surveyTemplateVersion`** (snapshot at submit), `answers[]`, `voterId`, `householdId`, `userId`, `campaignId`, `organizationId`, `passId`/`turfId`/`effortId` (metadata, nullable), `location`, `submittedAt`, `wasOfflineSubmission`, `editedBy`/`editedAt`. Unique index `{voterId, passId}` (within-pass dedup, DB-enforced); index `{householdId, passId}`. |
| `SurveyResponse.answers[]` | same (`answerSchema`, `{ _id: false }`) | `questionKey` (matches a template question's `key`), `questionLabel` (**snapshot** at submit), **`optionIds[]`** (stable id(s) chosen — the id-native tracking key; single → 1, multi → N, empty for free-text), **`otherText`** (free text typed into the `__other__` option), `answer` (Mixed — string \| string[] \| free text; **kept as a human-readable snapshot AND the legacy reporting fallback** for rows recorded before stable ids existed). |
| `SurveyResponseArchive` | [models/SurveyResponseArchive.js](../server/src/models/SurveyResponseArchive.js) | A **verbatim snapshot** of a `SurveyResponse` that a later write replaced — answers, note, `userId`, GPS, `submittedAt`/`syncedAt`, pass/turf/effort, `editedBy`/`editedAt`, the whole row — plus **server-stamped provenance**: `overwrittenBy`, `overwrittenVia` (`'submit'` = a different canvasser's field submission; `'restore'` = an admin restore displaced it), `overwrittenAt` — never accepted from a request body. **Deliberately a separate collection** so no aggregation, status recompute, or export can mistake a preserved response for a current one — by construction, not by auditing every reader. Restore **consumes** the row it promotes, so every row here is currently-archived (a second restore of the same row is an honest 404). Not unique on `{voterId, passId}` — restore flip-flops legitimately leave several. See §F. |

The `key` is derived in the builder by slugifying the label, with collision suffixes
(`top_issue`, `top_issue_2`, …); option `id`s are derived the same way within a question. Both are
minted once and held immutable so conditions and stored answers keep pointing at the right thing.

## B. Endpoints (authoring)

All under `/admin/surveys`. The router mounts `requireAuth, orgContext, requireOrgRole('admin','lead')`
— that gates the **role**. Create/edit/duplicate are open to **leads** so they can author within
their campaign; **scope** is enforced per-survey by `canManageSurvey(req, survey)`
([services/authz/campaignManagement.js](../server/src/services/authz/campaignManagement.js)): admins →
any; a lead → only a survey they **authored** (`createdBy`, checked first so the create-then-edit-
before-attach case works) **or** one attached to a campaign in their `managedCampaignIds` (as the
campaign default **or** any `Effort` walk-list override). Archive/unarchive/delete stay
**`requireOrgRole('admin')`** (library lifecycle).

| Method · path | Purpose |
|---|---|
| `GET /admin/surveys` | List templates; each annotated with `usedByCampaigns: [{id, name, isActive}]` (campaign **defaults**), **`usedByWalkLists: [{campaignId, campaignName, effortId, effortName}]`** (every `Effort` whose `surveyTemplateId` points here — a survey used *only* as a walk-list override previously showed no usage at all), **`responseCount`** / **`hasResponses`** (org-wide `SurveyResponse.aggregate`), and **`responseCountByCampaign: [{campaignId, campaignName, count}]`** (a second aggregate grouped by `{surveyTemplateId, campaignId}`; a legacy null-`campaignId` bucket is labeled "No campaign"). `archivedAt` flows through — **archived templates are still returned**; Active/Archived filtering is client-side so one `['surveys']` cache serves the list and every picker. **Lead rows are scoped (2026-08-08)**: the find filter is `$or [{createdBy: caller}, {_id ∈ attachedSurveyTemplateIds(managed)}]`, the three usage annotations are narrowed to managed campaigns (the null-campaign bucket drops), `responseCount`/`hasResponses` re-derive from the narrowed buckets, and **`usedElsewhere: true`** (bare boolean) marks a template also attached beyond the lead's campaigns so the builder's shared-edit warning still fires. Admin rows are byte-identical to before. |
| `POST /admin/surveys` | Create (admin **or lead** — no per-survey scope needed; nothing is attached yet, `createdBy` is stamped as the caller, and the follow-on campaign/effort attach is separately campaign-manager-scoped). Zod `upsertSchema` (optional `tags: [String]` palette); `assignOptionIds` mints ids for any id-less option, `validateVisibleIfIntegrity` checks the rule graph, then `canonicalizeTags(withIds, data.tags)` collapses the palette + every `option.tag` to one case-insensitive casing (see §I), and sets `version: 1`, `createdBy`. **Then `ensureTags(orgId, tags, userId)`** auto-upserts org `Tag` docs (see §I). |
| `PATCH /admin/surveys/:surveyId` | Update (admin, or a **lead** who passes `canManageSurvey` → else `403`). When `questions` are present: if the survey **has responses**, `classifyQuestionEdits` blocks **only a question type change** → `409 { code: 'survey-has-responses', reasons }`. Otherwise `reconcileQuestions` (soft-retire absent items, mint ids for new options), `validateVisibleIfIntegrity`, then `canonicalizeTags(reconciled, data.tags ?? existing.tags)`, apply, and bump `version`. After save, **`ensureTags`** auto-upserts the library (see §I). |
| `POST /admin/surveys/:surveyId/duplicate` | Clone into a fresh template (`name: "<name> (Copy)"`, `version: 1`, `isActive: false`, no campaign link, questions copied verbatim, `createdBy` = caller so a lead can then edit their copy). Admin, or a **lead** who passes `canManageSurvey` → else `403` (the answer-type-change escape hatch must work for leads on their campaign's surveys). |
| `POST /admin/surveys/:surveyId/archive` · `POST /admin/surveys/:surveyId/unarchive` | Set/clear `archivedAt`. **Idempotent** (re-archiving keeps the original timestamp). Deliberately separate POSTs — not a PATCH flag — so the upsert/reconcile/version-bump path never sees archive state. Attaching an archived survey is only blocked in the UI (pickers hide it); the API still allows it, keeping unarchive-then-attach trivial. |
| `DELETE /admin/surveys/:surveyId` | Hard-delete, **only when truly unused**. Guard = `SurveyResponse.exists` ∨ `Campaign.exists({surveyTemplateId})` ∨ `Effort.exists({surveyTemplateId})` → `409 { code: 'survey-in-use', reasons: [...] }` naming each reference; otherwise `200 { ok: true }`. Wrong-org / missing id → `404`. |

> **Per-walk-list response counts** live on the efforts endpoint, not here:
> `GET /admin/campaigns/:campaignId/efforts` ([routes/admin/efforts.js](../server/src/routes/admin/efforts.js))
> now returns `responseCount` per effort plus a top-level **`intakeResponseCount`** (responses whose
> `effortId` is null — Intake / pre-walk-list doors). The campaign Survey tab computes the **default
> survey's coverage count** as `intakeResponseCount + Σ responseCount` of efforts **without** an
> override — exact even when the default template is also some walk list's override (a per-survey
> total would double-count there). Guard is `requireCampaignManager`, so leads who run the campaign
> can read counts and set overrides (`PATCH …/efforts/:id { surveyTemplateId }`).
>
> **Attach is validated + scoped (2026-08-08).** Setting `surveyTemplateId` — campaign default
> (`PATCH /admin/campaigns/:id`) or walk-list override (efforts POST/PATCH, via a shared
> `resolveOverrideTemplate`) — now (a) validates the id: ObjectId shape + org ownership → `400`
> (the efforts path previously stored **any** string verbatim, garbage included), and (b) for a
> **lead**, requires `canManageSurvey` → `403 { code: 'survey-out-of-scope' }` (not `FORBIDDEN_ROLE`
> — mobile treats that as a role change). Detach (`null`) is always free; admins attach anything
> org-owned, unchanged. This closes the gap where the lead's scoped list was bypassable by attaching
> an arbitrary template by id.

> **Soft-retire reconcile (replaces the old "blocked destructive edits" model).** The PATCH route no
> longer deletes anything structural. `reconcileQuestions(existingQuestions, incomingQuestions)`
> (in [surveys.js](../server/src/routes/admin/surveys.js)): matches incoming questions to existing
> ones by `key`, **preserves existing option ids**, mints ids for new (id-less) options, and
> **re-appends as `retired: true`** any existing option a question dropped and any existing question
> the payload dropped — ids and text preserved. So removing/renaming/reordering questions and
> options is non-destructive: history is kept, reports keep counting it.

> **The one hard block.** `classifyQuestionEdits(old, new)`
> ([services/surveys/diffQuestions.js](../server/src/services/surveys/diffQuestions.js)) walks
> still-present questions (matched by `key`) and returns a reason **only** when a question's `type`
> changed — the stored answer shape can no longer be aggregated. That's the lone `409` once responses
> exist; the builder mirrors it by locking the type control and offering **Duplicate**.

> **Rule-graph validation (on save, after reconcile).** `validateVisibleIfIntegrity(questions)`
> enforces, over the **final reconciled** questions, that every rule on a non-retired question:
> references a **strictly earlier non-retired** question (forward/self/dangling → error, which also
> makes cycles impossible); uses an op valid for the referenced type (`text` questions support only
> `answered`/`not_answered`); and (for `is`/`is_not`/`any_of`) names `optionIds` that exist on the
> referenced question (retired-inclusive) or the `'__other__'` sentinel when it allows Other. Any
> violation → `400`. The Zod `ruleSchema` additionally requires exactly one `optionId` for
> `is`/`is_not` and at least one for `any_of`.

## C. Dual-read reporting (stable id, legacy text fallback)

Reporting joins answers to the **current** template by `questionKey`, and joins choice answers to
options by **stable option id with a legacy `answer`-text fallback**. The shared helpers in
[`services/surveys/answerAgg.js`](../server/src/services/surveys/answerAgg.js) are the single source
of that logic:

| Helper | Role |
|---|---|
| `choiceKeyStages(questionKey)` | Aggregation fragment: after the caller's `$match`, `$unwind` answers, match the `questionKey`, then emit one `_answerKeys` row per chosen key — the **`optionIds`** for id-native rows, or the literal **`answer`** text (wrapped to an array) for legacy rows. Works for single + multiple. |
| `mergeOptionRows(question, rows, opts)` | Merge raw `$group` rows (`{ _id, count, responseIds? }`) onto the question's **current options** — matched **by id, then by text**. When `question.otherOption` is set it also **seeds the `'__other__'` sentinel into the id lookup ONLY** (never the text lookup — see the trap below), so a write-in is a first-class bucket `{ id: '__other__', text: 'Other', retired: false }` rather than an orphan labelled with the raw sentinel. Leftover values with no current option still collapse into a **retired orphan bucket** (`id: null`, `retired: true`, `text` = the raw value) — that bucket is now only DELETED options and pre-option-id text. Returns `[{ id, text, retired, count, responseIds }]` sorted by count desc. |
| `voterAnswerClause(questionKey, optionId, optionText)` | "Voters who chose this option" filter: id-native `$elemMatch` on `optionIds` **OR** legacy `$elemMatch` on `answer` text (the latter also matches multi-select arrays containing the text). **The text lane is suppressed for `'__other__'`** — a write-in's `answer` is whatever was typed, so the lane can never find one, while it *does* steal an option named "Other", a legacy row reading "Other", and any multi-select array containing it (measured 6 hits against a 3-row truth). Match the sentinel by id alone. |
| `answerFilterClause(questionKey, values, texts)` | Saved-Search / targeted-round filter: match any chosen option **id** (`optionIds.$in`) **OR** their texts (`answer.$in`), tolerating legacy saved filters that stored literal text. |
| `answerTagClause(template, tag)` | "Voters who chose ANY option carrying this tag" — a single cross-question `$or` over the tag's `(questionKey, optionId \| legacy text)` members. Resolves the tag's members via `tagOptionMap(template).get(normalizeTag(tag))` (see §I) and **reuses `voterAnswerClause` per member**, flattening their `$or`s. Empty / unknown tag → `{ _id: null }` (matches nothing). |

Consumers:

- `GET /admin/reports/survey-results`
  ([reports.js `survey-results` handler](../server/src/routes/admin/reports.js)) — builds the
  per-question pipelines with `choiceKeyStages` (choice) or a plain text group, then
  `mergeOptionRows` onto the current options. It **also** emits a `tags[]` rollup via
  `answerTagClause` (see §I).
  > **A `text` question's `options[]` is a TOP-TEN, not the whole set.** The text branch appends
  > `{ $limit: 10 }` after its `$sort: { count: -1 }`, so the array is the ten most common distinct
  > answers. Σ of those counts is therefore a **subtotal** — it is *not* how many people answered.
  > The card used to sum them and label the result "N answered", which was simply wrong on any
  > question with more than ten distinct write-ins; it now reads **"top 10 answers"** (or
  > "N distinct answers" when fewer than ten came back). Anything that wants a true respondent
  > count for a text question has to ask for it — no field on this payload carries one. `voters-by-answer` (and its `.csv` twin) uses `voterAnswerClause` for
  a single option, or `answerTagClause` when a `tag` is supplied (see §I/§J).
- `GET /admin/reports/answer-canvassers` — the per-canvasser breakdown for one option runs the
  **same `choiceKeyStages` explode** grouped by `userId`, so its rows sum exactly to the option's
  `survey-results` count (the counting contract in §J).
- `computeSurveyBreakdowns`
  ([services/reports/computeReport.js](../server/src/services/reports/computeReport.js)) — the
  client-report freeze; same `choiceKeyStages` + `mergeOptionRows` math.
- `resolveWalkList` ([services/walklist/resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js))
  and `GET /admin/households` ([routes/admin/households.js](../server/src/routes/admin/households.js))
  — `answerFilterClause` / `voterAnswerClause` for per-question survey-answer targeting, and
  `answerTagClause` for the cross-question **`answerTagFilters`** (see §I).

**Consequences:** renaming an option **keeps its count** (the id is stable); removing one surfaces
its past answers as a **retired** bucket rather than dropping them. Each response still snapshots
`surveyTemplateVersion`, `questionLabel`, and `answer`, so raw data stays recoverable and pre-id
rows keep reporting via the text fallback.

> **Percentages are per-question (share of that question's answers).** Each option's `percent` = its
> `count` ÷ **that question's own answer total** (the Σ of its merged option counts) — *not* the
> global response count. A **single-choice** question's bars sum to ~100% of the people who answered
> it; a **multiple-choice** question's sum to ~100% of all *selections* (one respondent can
> contribute several). Counts are the raw `$group` totals merged onto the current options. The "N
> answered" header ([QuestionResults.jsx](../client/src/components/QuestionResults.jsx)) is the same
> per-question Σ, so bars and header agree. The client report freezes the identical math
> (`computeSurveyBreakdowns`), and the report bars
> ([ReportBreakdown.jsx](../client/src/components/ReportBreakdown.jsx)) re-derive percent from the
> counts they display — so a published snapshot is always self-consistent.

### The client-report fold (why `computeReport` is different)

`computeSurveyBreakdowns` ([computeReport.js](../server/src/services/reports/computeReport.js)) is the
breakdown-table twin of `publicPointAnswer`: **only the template's canonical option labels may reach a
client.** Two kinds of bucket are not canonical and must never appear under their own label —

- the **`'__other__'` write-in bucket**, whose answers are canvasser-typed free text; and
- every **`id: null` orphan**, which `mergeOptionRows` keys by the RAW answer text — for a
  pre-option-id write-in, again whatever was typed.

Both **fold into a single `Other` row**. Three properties are load-bearing:

1. **It is a fold, not a filter.** Dropping those buckets would silently remove answers from the
   client's percentages. Counts are preserved exactly — only the label is withheld, so Σ options
   still equals the question total.
2. **Test on `id`, never on the label.** Since the write-in became a first-class bucket (§C) it
   arrives here already labelled `Other`, so a label-based test emits **two rows both reading
   "Other"** — split count, split percentage, and duplicate React keys on a public share page.
   `reportSecurity.int.test.js` pins exactly-one-`Other` on the array (a `Map` keyed on the label
   silently last-wins and cannot see the duplicate).
3. **An option still present but `retired: true` keeps its real label** — it has a non-null id, so it
   is canonical. Only *deleted* options fall to the orphan branch. `mergeOptionRows` cannot tell a
   deleted option's authored label from canvasser free text; both arrive as the same untrusted value.

Published reports are **frozen snapshots** — `ClientReport` stores only `{ option, count, percent }`,
recomputed on publish — so a report published before a change does not self-heal.

## D. The visibility evaluator (shared, three copies, drift-guarded)

Conditional display is decided by one **pure** evaluator with **no I/O**, so the server, web builder
preview, and mobile field app always agree on which questions show.

- **Canonical:** [`server/src/services/surveys/visibility.js`](../server/src/services/surveys/visibility.js).
- **Mirrors (byte-for-byte below the `// ==== BEGIN MIRRORED BODY ====` marker):**
  [`client/src/lib/surveyVisibility.js`](../client/src/lib/surveyVisibility.js) and
  [`mobile/lib/surveyVisibility.js`](../mobile/lib/surveyVisibility.js).
- **Fixtures:** [`__fixtures__/visibility.fixtures.json`](../server/src/services/surveys/__fixtures__/visibility.fixtures.json).
- **Tests:** [`visibility.test.js`](../server/src/services/surveys/visibility.test.js) (run via
  `npm test` in `server/`) — exercises the fixtures, op semantics, and a **drift guard** that reads
  each file from the marker on and asserts the three bodies are identical.

Exported API:

- `makeCell(type, optionIds, text)` → `{ optionIds, text }`. **Choice questions carry NO text into
  the evaluator** (only `type === 'text'` keeps text); this is the key invariant that keeps server,
  web, and mobile in agreement when a choice answer's `optionIds` is empty.
- `evaluateVisibleIf(visibleIf, answersByKey)` — pure single-question evaluation. Op semantics:
  `is`/`is_not` compare against `optionIds[0]`; `any_of` is set intersection; `answered`/
  `not_answered` test the cell; an **unknown op fails OPEN** (visible) so a future op can't strand a
  question. `null`/empty rules → visible.
- `visibleQuestionKeys(questions, rawAnswersByKey)` — the order-aware driver. Walks **non-retired**
  questions in authoring order, exposing each **visible** question's answer only to questions
  **after** it (a hidden parent's stale answer is withheld from its children). A rule referencing a
  **later or self** active question **fails CLOSED** (the question hides). Returns a `Set` of visible
  keys.

## E. Answer normalization & dropHidden modes

Both write paths funnel through `normalizeAndFilterAnswers(template, rawAnswers, { dropHidden })`
([services/surveys/normalizeAnswers.js](../server/src/services/surveys/normalizeAnswers.js)) so they
**can't drift**. It **never throws / never 400s**:

- Drops rows whose `questionKey` is unknown to the template.
- Computes valid ids = the question's option ids **plus `'__other__'`** when `otherOption` is on;
  **keeps retired ids**, drops ids the template doesn't recognize.
- Phase-1 backfill: a row with no `optionIds` but an `answer` snapshot maps each answer text to an
  option id by exact text match before filtering.
- Stores `otherText` only when `'__other__'` is among the kept ids.
- Builds the evaluator's answer map with `makeCell` and computes `visibleQuestionKeys`; then returns
  **all** rows (`dropHidden:false`) or **only visible** rows (`dropHidden:true`).

| Caller | Mode | Why |
|---|---|---|
| `POST /mobile/voters/:voterId/survey` ([canvass.js](../server/src/routes/mobile/canvass.js)) | `dropHidden: true` (default) | Drop ghost answers to questions the current logic hides — a question the voter never saw can't count. |
| `PATCH /admin/:voterId/surveys/:responseId` ([routes/admin/voters.js](../server/src/routes/admin/voters.js)) | `dropHidden: false` | **Preserve recorded history** — keep answers even if newer `visibleIf` logic would now hide them. (If the template is missing, the edit is stored as-is rather than wiped.) |

### The `'__other__'` sentinel

"Other (specify)" is a per-question `otherOption` toggle, **not a real option** — it is never a row in
`question.options[]`. It is materialized as a synthetic choice `{ id: '__other__', text: 'Other
(specify)' }` at render time; when picked it shows a free-text box whose value is submitted as
`answer.otherText`, with `'__other__'` carried in `optionIds` and the typed text ALSO snapshotted
into `answer` (there is no option label to snapshot).

**That "flag, not a row" design is the whole trap.** Anything reconciling answers against
`question.options` finds nothing to match, so every such site must seed the sentinel by hand. The
constant and its label rule live in
[`services/surveys/otherOption.js`](../server/src/services/surveys/otherOption.js) (`OTHER_OPTION_ID`,
`otherBucketLabel`) and, on the web, [`lib/surveyChoices.js`](../client/src/lib/surveyChoices.js)
(`choicesFor`) — import them rather than retyping the literal.

The sentinel is accepted everywhere a real option id is:

| Site | Role |
|---|---|
| `normalizeAndFilterAnswers` | Valid-id set, and the gate that keeps `otherText` (`optionIds.includes('__other__')`). |
| `validateVisibleIfIntegrity` / builder condition editor | A pickable rule target; the visibility evaluator treats it as just another id. |
| `mergeOptionRows` (§C) | Seeded into the **id** lookup so a write-in is a first-class reporting bucket. |
| `voterAnswerClause` (§C) | Matched by id only — never by text. |
| `/answer-canvassers` | Keys on the sentinel alone, so its per-canvasser counts still sum to the `/survey-results` count. |
| `buildSurveyResultsWide` (exports) | Seeded into `optionTextById` so a cell reads `Other — potholes`. |
| `voterProfile` + the voter-page editor | `optionIds`/`otherText` ride the wire, so an edit round-trips instead of de-classifying. |
| `SurveyPreview`, mobile field form, print model | Materialize the choice, or the preview shows a shorter survey than the phone asks. |

**`computeReport` deliberately does NOT treat it as canonical** — see *The client-report fold* in §C.

**Two labelling rules, both load-bearing:**

1. **Seed the id lookup, never the text lookup.** Seeding by text lets the sentinel clobber a real
   option an operator named "Other", silently re-attributing that option's legacy rows to the
   write-in (measured: the real option's count fell while the sentinel's rose).
2. **When a real option already owns the label "Other"**, the write-in bucket becomes **"Other
   (specify)"** (`otherBucketLabel`). Nothing forbids that pairing — there is no text-uniqueness
   check on save, deliberately, since rejecting it would 400 an existing template on its next edit —
   and two buckets sharing a label collide as React keys and expand-state on every surface that keys
   on text. Surfaces that can key on `id` now do.

**What cannot be recovered:** a response recorded *before* stable option ids has `optionIds: []` and
only a free-text snapshot. For a write-in that snapshot is arbitrary text, so such a row can never be
re-identified as Other — it surfaces as its own orphan bucket named after the typing. No heuristic
can fix that without guessing, and none is attempted.

## F. Submission & dedup invariants

`POST /mobile/voters/:voterId/survey` ([canvass.js](../server/src/routes/mobile/canvass.js)):

- Validates the template exists and matches the campaign (resolving a **per-effort survey override**
  — the door's effort survey wins over the campaign default; see [EFFORTS.md](EFFORTS.md)); resolves
  `passId`/`turfId`/`effortId` from the submission timestamp (see [PASSES_AND_TURF.md](PASSES_AND_TURF.md)).
- Runs `normalizeAndFilterAnswers(template, data.answers)` (`dropHidden:true`) before persisting.
- **One row per `(voterId, passId)`, latest wins — with cross-canvasser preservation.** The write
  is no longer a blind upsert: the route **pre-reads** the existing row (`findOne`), and when one
  exists whose `userId` differs from the submitter's, it first snapshots it whole into
  **`SurveyResponseArchive`** (`archiveOverwrittenResponse` in
  [services/surveys/archiveOverwrite.js](../server/src/services/surveys/archiveOverwrite.js) —
  snapshot-BEFORE-write, built from the pre-read doc, provenance stamped server-side:
  `overwrittenBy`/`overwrittenVia: 'submit'`/`overwrittenAt`) and only then `$set`s the seen row
  (no upsert on that path). A **same-canvasser re-submit archives nothing** — that replacement is
  the designed self-heal. With no existing row the route does an **insert-only** `create`; an
  `11000` race re-reads the winner and takes the same archive-then-update path, so a
  cross-canvasser replacement **always** leaves an archive row in every interleaving (and the
  `surveyCount` bump stays exact — the reason the paths were split).
- Stores `surveyTemplateVersion: template.version || 1` and resets `editedBy`/`editedAt` (a fresh
  canvasser submission clears any prior admin-edit audit).
- Writes a `survey_submitted` `CanvassActivity` (household-scoped dedup → one knock per
  user/house/pass even for a multi-voter house) and updates `Voter.surveyStatus` / household status.

**The door knows whose survey it is.** The per-round voter wire (bootstrap **and** the `/changes`
delta) carries **`surveyedByMe`** whenever the voter reads `surveyed` this round — `true` = the
requesting canvasser took it, `false` = a teammate did, **absent** = not surveyed this round (or an
old cache/server). The mobile survey screen uses it for a one-time confirm before a cross-canvasser
overwrite ([CANVASSER_APP.md](CANVASSER_APP.md) → the superseded-replay section); the flag **fails
open** by design — a possibly-wrong warning at a door is worse than none, and the server-side
preservation above catches every collision the confirm misses.

**Admin surfaces + the restore swap.** The voter profile lists preserved responses
(`overwrittenSurveys[]`; the winning response carries `replacedEarlier`), and two org-admin-only
routes live in [routes/admin/voters.js](../server/src/routes/admin/voters.js):

- `POST /admin/voters/:voterId/surveys/:archiveId/restore` — a **lossless swap**: the displaced
  current response is archived `via:'restore'`, the preserved one becomes current in place
  (answers, authorship, GPS, and edit audit verbatim), and the promoted archive row is consumed
  (re-restore = 404). If the current response was deleted meanwhile, restore **resurrects** it
  (`surveyCount` +1). Then `recomputeSurveyStatus`.
- `DELETE /admin/voters/:voterId/surveys/archive/:archiveId` — erases a preserved response
  outright (overwritten answer content must never be undeletable).

An admin DELETE of a *current* response never touches archived siblings. An overwrite or a
restore swap moves **no counters** — one current row throughout — and no export ever reads the
archive (leak-sentinel pinned in `exportBuilders.int.test.js`).

**Tests:** [surveyOverwrite.int.test.js](../server/test/surveyOverwrite.int.test.js) (preservation +
restore + insert races), [duplicateSurveys.int.test.js](../server/test/duplicateSurveys.int.test.js)
(the report's `sameRoundOverwritten` kind),
[perRoundVoterView.int.test.js](../server/test/perRoundVoterView.int.test.js) (`surveyedByMe` on
the wire), [perCanvasserAndOverlaps.int.test.js](../server/test/perCanvasserAndOverlaps.int.test.js)
(the overlaps annotation), plus [mobile/lib/resurvey.test.js](../mobile/lib/resurvey.test.js) and
[mobile/lib/duplicateSurveys.test.js](../mobile/lib/duplicateSurveys.test.js) on the client.

## G. Frontend mapping

| File | Renders |
|---|---|
| [client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) | The org **Surveys library** — a pure **list + quick-view** page (authoring lives on `SurveyEditorPage`). `StatCard` row (surveys / total responses / in use / drafts), search + `Segmented` **Active/Archived/All** filter (client-side over `archivedAt`), and a `DataTable` with one row per template: name + created date, **Used in** (campaign names *and* `"{campaign} · {walk list}"` override labels from `usedByWalkLists`), **question count excluding retired questions**, `responseCount`, version/Archived badge, and a `RowMenu` (⋮) with **Edit / Duplicate / Archive-or-Delete** (Delete only when `responseCount === 0` and unused — the server re-checks). Row click opens the **`SurveyQuickView`** drawer. Owns the `duplicate`/`archive`/`unarchive`/`delete` mutations, all invalidating **`['surveys']`** — the one cache key every survey consumer now shares (EffortsPage/CampaignsPage previously used a divergent `['admin','surveys']`; TagsPage's post-delete invalidation had been silently pointing at that dead key). Back-compat: `/surveys?attachTo=<id>` redirects to `/surveys/new?attachTo=<id>`. |
| [client/src/components/SurveyQuickView.jsx](../client/src/components/SurveyQuickView.jsx) | The row-click **quick view**, built on the design-system `ui/Drawer` (right-side slide-over). Sections: version + In use/Draft/Archived badges; created/updated dates + active question count; **Used in** — campaign defaults and walk-list overrides, each linking to `/campaigns/:id?survey=<templateId>` (the dashboard deep-link); **Responses** — org-wide total + the per-campaign split from `responseCountByCampaign` (null-campaign bucket labeled, never linked); a `SurveyPreview` of the questions; and a sticky action bar — **Edit survey** (→ `/surveys/:id/edit`), **Duplicate**, and **Delete** (confirm; only when unused) or **Archive/Unarchive**. Surfaces a delete `409`'s `reasons[]` if one races through the client-side gate. **View full results →** renders one link per campaign in the union of current attachments and campaigns with responses. |
| [client/src/pages/SurveyEditorPage.jsx](../client/src/pages/SurveyEditorPage.jsx) | The **dedicated org builder host** — routes `/surveys/new` and `/surveys/:surveyId/edit` (both in the `requireOrgAdmin` group). Renders the shared `SurveyForm` from [components/SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx) (`QuestionCard`/`OptionRow`/`ConditionEditor`; derives question `key` via `deriveKey` and option `id` by slugify-with-collision-suffix, minted once and held immutable; per-option **read-aloud script**, **Other (specify)**, **Show only if…** with live `ruleError` validation mirroring the server; on a survey with responses only the **type** control locks and removals soft-retire with **Restore**; surfaces the PATCH `409 reasons`). Loads the org tag library (`['admin','tags']`) for the `TagPicker`, same as the in-campaign builder. Edit mode finds its survey in the cached `['surveys']` list (no single-survey GET; load errors render instead of silently bouncing). Two hand-off flows on the create route: **`?attachTo=<campaignId>`** — create → `PATCH /admin/campaigns/:id { surveyTemplateId }` (campaign default) → back to that Survey tab; **`?assignEffort=<effortId>&campaignId=<id>`** — create → `PATCH /admin/campaigns/:id/efforts/:effortId { surveyTemplateId }` (walk-list override) → back to that Survey tab. Plain visits return to `/surveys`. No `refusalOption` UI. |
| [client/src/components/WalkListSurveySelect.jsx](../client/src/components/WalkListSurveySelect.jsx) | The **one** walk-list survey-override picker, shared by `CampaignSurveyPage` and `EffortsPage` so the archived-hiding rule lives in a single place: first option **"Campaign default"** (`''` → `onChange(null)`), then `surveys.filter(s => !s.archivedAt \|\| String(s._id) === current)` — an effort already pinned to a now-archived survey keeps its option (labeled `· archived`) instead of silently reading "Campaign default". A stale/unknown id renders an "Unknown survey" option rather than crashing. |
| [client/src/components/TagPicker.jsx](../client/src/components/TagPicker.jsx) | The per-option tag combobox used by the survey builder's `OptionRow`. Filters the org `tags` prop case-insensitively; selecting an existing tag is the default. The **"Create '…'" action** appears only when nothing matches **and `onCreate` is provided** — so when the builder withholds `onCreateTag` (a **team lead**, since `POST /admin/tags` is admin-only) it becomes pick-only and the placeholder drops "or create one". Renders a selected tag as a clearable chip. |
| [client/src/pages/TagsPage.jsx](../client/src/pages/TagsPage.jsx) | The **org-level Tags management page** (route `/tags`, an `ORG_NAV` entry — [navItems.js](../client/src/components/navItems.js)). Lists every org `Tag` from `GET /admin/tags` with a `usageSummary` ("on M options, across N surveys, K saved searches"), plus search. **Create** (`POST /admin/tags`), inline **Rename** (`PATCH /admin/tags/:id`; a `409 { code: 'tag-exists' }` surfaces a **"merge into it"** button targeting the clashing `tagId`), **Merge** (`POST /admin/tags/:id/merge { targetId }` via a target picker), and **Delete** (`DELETE /admin/tags/:id` behind a usage-aware `confirm`). Delete also invalidates `['surveys']` since the builder reads tagged options. |
| [client/src/pages/CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) | In-campaign **Survey** tab (`/campaigns/:campaignId/survey`) — the **coverage view**. Header holds a top-level **New survey** button (→ `/campaigns/:id/survey/new`). Section 1: the **main survey card** (badge `Default`, `SurveyPreview` behind a **Preview** toggle collapsed by default so the walk-list table stays above the fold, **Change survey** / **Edit survey** → `/campaigns/:id/survey/edit`) whose response count is the **coverage count** (`intakeResponseCount + Σ responseCount` of no-override efforts — see §B), not the template's org-wide total. Section 2: the **Walk list coverage** `DataTable` — per effort: status badge, doors, a `WalkListSurveySelect` wired to `PATCH …/efforts/:id { surveyTemplateId }` (invalidates `['admin','efforts',campaignId]`, the same key `EffortsPage` reads), its `responseCount`; an **Intake** row appears when null-`effortId` responses exist. A `?created=<id>` param (set by the builder after creating a survey that isn't the main) shows a dismissible "assign it to a walk list" banner. States: no default + overrides → warning; no walk lists → pointer to the Walk Lists page; **lit-drop** unchanged. **Authoring affordances (New/Edit) gate on `canManage` = `isOrgAdmin || managedCampaignIds.includes(campaignId)`** — so campaign-managing **leads** author too; the server (`canManageSurvey`) is the real scope gate. Attach/change = `PATCH /admin/campaigns/:id { surveyTemplateId }`; the Change-survey picker hides archived templates unless attached. |
| [client/src/pages/CampaignSurveyBuilderPage.jsx](../client/src/pages/CampaignSurveyBuilderPage.jsx) | **In-drill-in survey builder** (`/campaigns/:campaignId/survey/new` and `/survey/edit`) — **now in the console route group, so campaign-managing leads reach it** (was admin-only). Renders the shared `SurveyForm` inside the campaign so authoring never bounces to the org list. **New (conditional attach):** `POST /admin/surveys`, then **attach as the campaign default only when it has none yet** (`!campaign.surveyTemplateId`) — a new survey never silently replaces the main; either way it returns to the Survey tab with `?created=<id>`. **Edit**: `PATCH /admin/surveys/:id`; when the template is **shared by other campaigns** it warns and offers **Duplicate** (works for leads too — `canManageSurvey` permits editing/duplicating a survey attached to their managed campaign). Loads the org tag library; passes `onCreateTag` **only when `isOrgAdmin`** so leads pick existing tags but the "Create tag" affordance is hidden (`POST /admin/tags` is admin-only). |
| [client/src/components/SurveyPreview.jsx](../client/src/components/SurveyPreview.jsx) | Read-only render of a template (intro · questions sorted by `order` · closing); choice options as radio/checkbox glyphs, text as a placeholder. **Filters out retired questions and retired options** — the preview shows what canvassers actually see in the field. |
| [client/src/lib/surveyVisibility.js](../client/src/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded) — powers the builder's live condition validity and any preview gating. |
| [client/src/pages/CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) | Survey-template dropdown (in `components/campaigns/CampaignFormDrawer.jsx`) shows a heads-up when the chosen survey already has responses (repointing reports new answers separately). Hides **archived** templates unless attached — anchored to the survey attached **when the drawer opened**, so deselecting an archived one mid-edit doesn't make it vanish from the options. |
| [client/src/components/QuestionResults.jsx](../client/src/components/QuestionResults.jsx) | Per-question result charts from `survey-results` (retired/legacy buckets included). **Row layout (2026-08-10): one line, intrinsic widths.** `OptionRow`/`TagRow` were `grid-cols-12 gap-3` split 4 label / 6 bar / 2 numbers. That failed for two compounding reasons: the tracks were fixed **proportions**, and the eleven gutters cost a flat **132px at every width** — so in a 568px card the label got ~168px (≈22 chars, hard-truncated) while the numbers needed more than their own 78px cell and painted over the bar. Now one `flex items-center gap-3` row: chevron, then the label as the **sole `flex-1`** (`line-clamp-2 min-w-0`, no `truncate` — it wraps rather than truncating, and only past ~66 chars at a 780px card), then the `Retired` `Badge`, then an `h-2 w-24` bar, then `min-w-[3.5rem] shrink-0 text-right tabular-nums` tracks for the percent and count. Because the label is the only flexible item, the bar and numbers land on the same x in every row — that, not a grid, is what makes the percentages a column. Row padding is `px-2 py-1.5` → **32px**, the tight end of the console's range (cf. `BookAssignmentPanel.jsx:402`, `OrgBillingPanel.jsx:629`).
> **The bar is a fixed 96px column, and web diverges from mobile here on purpose.** `docs/ADMIN_APP.md` records mobile's rule that `RowBar` always takes full row width because a squeezed proportional bar loses data — that is an inset-group idiom for ~44px touch rows. A web results card is scanned in bulk, and an earlier pass at this (label on one line, full-width bar on a second) cost 50px per option and made the section unreadable at two cards per screen. The web precedent for an inline fixed-width bar beside a printed number already exists: `campaigns/CampaignsTable.jsx:67` (`h-1.5 w-16`), `CoverageBar.jsx:33` and `PassManager.jsx:29` (`h-2 w-40`). **Do not "restore" the full-width bar here.** Track is **`bg-border`** not `bg-sunken` (per [THEMING.md](THEMING.md) — sunken-on-card is 1.10:1 light / 1.04:1 dark), fill is **`bg-brand-600`** not `bg-brand-500` (500 is the fixed ramp's *danger* step), and the fill carries a **3px `minWidth` floor conditioned on `count > 0`** — a px floor, not a percentage floor, so it rescues sub-pixel bars without distorting small values, and a true zero still paints nothing. A retired row keeps a **full-strength label** and lets the `Retired` `Badge` carry the state — the old `opacity-50` on the whole row measured 1.98:1 on the label and 1.50:1 on the chip (its bar goes `bg-fg-muted`, not `bg-fg-subtle`, which would sit ~1.9:1 against the track and read as empty). Row children are **`<span>`** — a `<button>`'s content model is phrasing content. Both disclosure rows carry `aria-expanded`; the caret is `IconChevronRight`, not a `▸` text node the screen reader announced. The card root is `flex h-full flex-col`, with the hint footer on `mt-auto` so a card stretched to a tall row's height reads as deliberate. The header is **one wrapping line** — `flex flex-wrap items-baseline justify-between` with the `h3` on `min-w-0 flex-1 basis-48` and the meta chip `shrink-0`, so the chip drops to its own line only when it truly cannot share. (It was briefly stacked instead; that fixed the starving but cost every card a line. The starving was never caused by sharing the line — it was `shrink-0` against a title with no width floor.) Both headings here moved to **`text-sm font-semibold`**: the bare `font-medium` they used to carry made them the only in-card headings in `client/src` still inheriting 16px from body. The counting caveat moved from a hover-only `title=` into an **`InfoHint`**, whose 16px trigger fits the `text-xs` line box without growing the row. A **`text`** question's header no longer claims "N answered": those options are the server's `$limit: 10` top-ten, so it reads **"top 10 answers"** (or "N distinct answers" under ten) — see §C. Exports **`TagResults`** — the **"Tags"** panel: one `TagRow` per `tags[]` entry showing **both voter units** ("N voters · M current"; the bar stays scaled to identified — current is text only, since these are counts, not shares; `currentVoterCount` absent from an old server renders nothing rather than a fake 0), contributing options labelled "(N answers)" (response-unit, said out loud), expandable to `TagDrill` — the **`TagTeamTable`** ([TagTeamTable.jsx](../client/src/components/TagTeamTable.jsx), the first-finder by-team split from `/tag-teams`, §I) plus an inline `VoterList` that drills via `voters-by-answer?tag=<tag>&surveyTemplateId=<id>` and opens with **its own unit line** ("N entries — one per round…"). `TagResults` also takes `onTagClick` — the Survey Explorer passes it so a row click deep-links to `?tag=` instead of expanding inline. Each expanded option/tag hosts the **answer drill-in** (`OptionDrill`/`TagDrill` — canvasser filter, Voters \| By-canvasser toggle, enriched rows, response drawer, Open-full-view link) — see §J. All drills thread `passId` (the Dashboard round picker). |
| [client/src/pages/SurveyExplorerPage.jsx](../client/src/pages/SurveyExplorerPage.jsx) | The **Survey Explorer** — the full-page answer drill-in/audit workspace (`/campaigns/:campaignId/explorer`). Filters, headline stats, voters + by-canvasser tables, mini map, CSV export. Full spec in §J. |
| [client/src/pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Renders the **Survey results** section. **Card grid (2026-08-10):** `[grid-template-columns:repeat(auto-fit,minmax(min(100%,34rem),1fr))]`, **not** `lg:grid-cols-2`. `lg:` is a *viewport* query while the cards live in `viewport − sidebar − 48px`, and the sidebar width is a localStorage preference (`sidebarCollapsed`) no media query can see — solving `V − 288 = (V − 304)/2` shows the two-up card was **narrower than the one-up card at every viewport below ~1774px**, so widening the window past 1024px truncated labels *harder*. **No full-row span.** One was tried the same day — an arbitrary grid-column span for questions above six options — and it was reverted: auto-placement left the half-row beside the preceding card empty, and stretching the tallest card across the full width made it taller still. With one-line option rows the height spread between cards is small enough that a row sized to its tallest member is fine. (`grid-auto-flow: dense` would close such a hole by pulling a later question forward, and is rejected on different grounds: survey questions are deliberately ordered.) A footnote worth keeping: that span's class string survived in the emitted CSS until it was removed from a **code comment** too — Tailwind's scanner is a regex over raw file text and does not parse JS, so a class named in a comment is still generated. `QuestionResults` is the grid item **directly** — the old per-question wrapper `<div>` existed only to populate `questionResultsRefs`, a ref map written on every render and **read nowhere** (deleted), and because the wrapper (not the card) was the grid item, `align-items: stretch` never reached the painted `bg-card` box, so bottom borders in a row never lined up. A **survey switcher** appears in the section header when the campaign has answers under a survey other than the one currently attached: `GET /admin/reports/surveys?campaignId=` now returns **every** survey with responses for the campaign (each row flagged **`current`**, current-first), and picking a past one re-queries `survey-results` with that `surveyTemplateId` and shows a "no longer attached" note — so a swapped campaign's old answers are one click away, never hidden. Accepts a **`?survey=<templateId>` deep-link** (the Surveys quick-view's results links): seeds the switcher (the *current* survey's id normalizes to `''`) and scrolls the section into view once both the switcher list and the campaign are known; per-campaign selections (template/effort/canvasser/pass) **reset when `:campaignId` changes**, since the sidebar campaign switcher re-renders the same mounted page. The section header also carries a **round picker** (`surveyPassId`: `''` \| Pass `_id` \| `'legacy'`) fed by the shared **`useRoundOptions`** hook ([lib/useRoundOptions.js](../client/src/lib/useRoundOptions.js) — sourced from `GET /admin/campaigns/:id/passes` + `legacyResponseCount`, NEVER from knocks-by-pass rows: picker options must not depend on the filters they set, and the legacy bucket must key on null-pass RESPONSES; same labels as the Explorer's picker by construction; polled under HOME_POLL per the Live-pill contract). The pass is cleared on effort switch (a pass belongs to one walk list) and threads into `survey-results`, `<TagResults>`, and every `<QuestionResults>` drill. Renders `<TagResults>` above the per-question charts when `surveyResultsQ.data.tags` is non-empty, passing `surveyTemplateId` for the tag drill. (Mobile's campaign screen keeps its knocks-by-pass-derived chips — a documented divergence.) |
| [client/src/components/AnswerFilters.jsx](../client/src/components/AnswerFilters.jsx) | The saved-search / targeted-round answer-filter chips. Beyond per-question `answerFilters`, it renders a **"By tag"** chip row from the `tags` palette prop (falling back to the case-insensitive union of option tags) and emits selected tags to the parent via `onTagChange` as **`answerTagFilters: [{ tag }]`** (case-insensitive, display-cased). |
| [client/src/pages/WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) | Saved-search builder. Wires `AnswerFilters` with `tags={surveyTags}` (from `survey-results` `tags[]`) + `answerTagFilters` into the filter (sent to `resolveWalkList`). Per saved search, **Export CSV** (`exportCsv`) does an **authenticated blob download**: `fetch` the export endpoint with `Authorization: Bearer` + `X-Org-Id` headers, read `res.blob()`, then click a synthetic `<a download>` (filename from `Content-Disposition`). |
| [client/src/components/CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx) | A canvasser's individual responses (shows template `version`). |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | The at-the-door form. Imports `makeCell` + `visibleQuestionKeys` and recomputes `visibleQuestions` live as answers change; renders single/multiple/text, inline **option scripts** on the picked option, the synthetic **`__other__`** choice with a "Please specify" box. Required-validation runs over **visible** questions only. Submits `{ optionIds, answer (snapshot), otherText, questionKey, questionLabel }` per visible answer; offline queue + optimistic recolor via `optimisticSubmit`. |
| [mobile/lib/surveyVisibility.js](../mobile/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded). |

## H. Migrations

**Stable ids.** `npm run migrate:survey-option-ids`
([migrations/migrateSurveyOptionIds.js](../server/src/migrations/migrateSurveyOptionIds.js)) — the
additive, **idempotent**, dry-run-by-default backfill that establishes stable ids. Two steps:

- **A. Templates** — convert each question's plain-string options into `{ id, text, tag, script,
  retired, order }` objects, minting a stable per-question `id` via the same slugify-collision rule
  the builder/route use. Already-object options are left untouched.
- **B. Responses** — enrich each answer with `optionIds[]` by mapping its snapshot `answer` text to
  the template's option ids (exact text match). Nothing is rewritten: the `answer` text stays as the
  legacy/display fallback; unmatched values (renamed/removed options, free text, Other) simply get no
  id and keep reporting via text.

Run `--apply` with/before the deploy that ships dual-read reporting; safe to re-run.

**Org tag library (Phase 3.1).** `npm run migrate:org-tags`
([migrations/migrateOrgTags.js](../server/src/migrations/migrateOrgTags.js)) — seeds the `Tag`
library from existing usage and canonicalizes case across surveys. Additive + **idempotent**,
**dry-run by default** (`--apply` to write). It `syncIndexes()` on `Tag`, then per org gathers every
distinct `option.tag` / palette tag (deduped by `normalizeTag`, **first-seen display casing wins**),
upserts a `Tag` doc via `ensureTags`, and runs `rewriteTag` so that display is canonicalized across
all surveys + saved-search filters (so "Supporter"/"supporter" collapse to one). Existing string tags
keep working throughout, so this is **non-breaking** — run it with the Phase 3.1 deploy.

## I. Tags (cross-question rollup, by-tag lists, CSV export)

A **tag** labels a survey **option** and groups options **across questions**, so reports and walk
lists can roll up everyone who picked **any** option carrying that tag. Tags are pure **admin
metadata** — the mobile field app is **unchanged** (canvassers never see them). As of **Phase 3.1**
tags are an **org-level managed library** (the `Tag` collection), not per-survey free text — but the
**reporting/list-building plumbing below (rollup, by-tag walk lists, CSV export) is unchanged**,
because options still store the tag's display name as a string.

**The org tag library (`Tag`).** [models/Tag.js](../server/src/models/Tag.js) is the source of truth:
`{ organizationId, name, normalizedName, color, createdBy }` with a **unique index
`{ organizationId, normalizedName }`** that makes duplicate tags structurally impossible.
`normalizedName = normalizeTag(name)` (trim+lowercase), so matching/dedup is case-insensitive.
Survey options reference a tag only by its display **`name` (a plain string** in `option.tag`).

**The three string homes.** A tag's display name is written into exactly **three** places, and that's
the entire surface rename/merge/delete must rewrite:

1. `SurveyTemplate.questions[].options[].tag` — the per-option label (what the rollup actually reads),
2. `SurveyTemplate.tags[]` — the per-survey **palette** (derived/kept-in-sync, see §A),
3. `SavedSearch.filter.answerTagFilters[].tag` — saved-search "by tag" filters.

**Library operations.** [services/surveys/tagOps.js](../server/src/services/surveys/tagOps.js)
implements the bounded bulk rewrite over those three homes:

| Helper ([tagOps.js](../server/src/services/surveys/tagOps.js)) | Role |
|---|---|
| `rewriteTag(orgId, fromKey, toDisplay)` | The primitive: rewrite every occurrence whose `normalizeTag` === `fromKey` to `toDisplay` across all three homes; re-dedups each survey's palette case-insensitively after the rewrite (so a merge collapses A+B in a survey that used both). Returns `{ surveys, options, savedSearches }` counts. |
| `renameTag(orgId, tag, newName)` | `rewriteTag` to the new display, then update the `Tag` doc's `name`/`normalizedName`. |
| `mergeTags(orgId, sourceTag, targetTag)` | `rewriteTag` all source occurrences → the target's display, then **delete the source `Tag`**. |
| `deleteTag(orgId, tag)` | Null every matching `option.tag`, drop it from palettes + `answerTagFilters`, then delete the `Tag`. Returns the cleared usage. |
| `tagUsage(orgId)` | `Map<normalizedKey, { surveys, options, savedSearches }>` — the usage counts the Tags page and `GET /admin/tags` display. |
| `ensureTags(orgId, names, createdBy)` | Idempotent `Tag.updateOne(..., { upsert: true })` per name (deduped by `normalizedName`); the unique index keeps it safe. Called on **every survey save** so the library stays complete even for API/legacy writes. |

**The Tags API.** [routes/admin/tags.js](../server/src/routes/admin/tags.js), mounted at
`/admin/tags` ([routes/index.js](../server/src/routes/index.js)), guarded by
`requireAuth, orgContext, requireOrgRole('admin')`:

- `GET /admin/tags` — list the org's tags (sorted by name) each annotated with its `tagUsage` block.
- `POST /admin/tags` — create; **upserts by `normalizedName`**, so a case-variant of an existing tag
  returns the existing one (`existed: true`) instead of fracturing. An `11000` race falls back to the
  same lookup.
- `PATCH /admin/tags/:id` — **rename** (→ `renameTag`, bulk-rewrites the three homes). If the new
  normalized name collides with another tag, returns **`409 { code: 'tag-exists', tagId }`** so the
  client can offer a **merge** instead.
- `POST /admin/tags/:id/merge { targetId }` — merge this tag **into** the target (→ `mergeTags`);
  refuses self-merge.
- `DELETE /admin/tags/:id` — delete + **cascade-untag** every option/palette/saved-search (→
  `deleteTag`); the client confirms first using the usage counts.

**Authoring (the pick-or-create combobox).** The survey builder no longer uses a free-text
`<datalist>`. Each option's tag field is a **`TagPicker`** combobox
([components/TagPicker.jsx](../client/src/components/TagPicker.jsx)) fed the org library: you filter
and pick an existing tag, or take an explicit **"Create '…'"** action (which `POST`s `/admin/tags`
and stores the canonical name) — so a typo can't silently fork the picklist (see §G).

**Case-insensitive matching + the save chokepoint.** All grouping/dedup still keys off
`normalizeTag(s) = String(s).trim().toLowerCase()`
([services/surveys/tags.js](../server/src/services/surveys/tags.js)). On every save, the authoring
routes (§B) run `canonicalizeTags(questions, declaredTags)` from the same module: it dedups the
palette case-insensitively (**first casing wins** as the display form), rewrites **every**
`option.tag` to that canonical casing, and drops tags that aren't on a real option — so
"Supporter"/"supporter" collapse to **one** tag within the survey; the route then calls `ensureTags`
to mirror those tags into the library. The other two helpers there:

| Helper ([tags.js](../server/src/services/surveys/tags.js)) | Role |
|---|---|
| `tagOptionMap(template)` | `normalizedTag → { display, members: [{ questionKey, optionId, text }] }` over **all** options — **retired included** (their historical answers still count). `display` is the first casing seen. The single source of "which options does this tag cover." |
| `paletteTags(template)` | The distinct display tags **actually applied** to options (the `tagOptionMap` displays), sorted — note this reflects what's on options, which the stored `tags` palette may exceed. |

**The cross-question match clause.** `answerTagClause(template, tag)`
([services/surveys/answerAgg.js](../server/src/services/surveys/answerAgg.js)) looks the tag up in
`tagOptionMap`, then builds **one** `$or` by reusing `voterAnswerClause(questionKey, optionId, text)`
per member and flattening their `$or`s — a **single cross-question predicate** that the per-question
`answerFilters` (one clause per question, AND/OR-combined globally) can't express. Empty/unknown tag
→ `{ _id: null }` (matches nothing). Because it composes `voterAnswerClause`, each member inherits
the **dual-read** behavior (stable id **OR** legacy answer text), so retired/renamed options keep
counting.

**Reporting rollup — two voter units per tag.** `GET /admin/reports/survey-results`
([reports.js](../server/src/routes/admin/reports.js)) appends a
`tags: [{ tag, voterCount, currentVoterCount, options: [{ questionKey, optionId, text, count }] }]`
array:

- `voterCount` (**identified**): for each `tagOptionMap` entry it runs
  `SurveyResponse.distinct('voterId', { ...match, ...answerTagClause(...) })` — **distinct voters,
  ever** (counted **once** even if they hit the tag in several questions or rounds).
- `currentVoterCount` (**current**, latest answer wins): computed by
  `currentVoterSetsByTag(match, template)`
  ([services/surveys/currentTags.js](../server/src/services/surveys/currentTags.js)) — **one**
  aggregation over the union of all tags' member questionKeys, using `latestAnswerKeyStages`
  ([answerAgg.js](../server/src/services/surveys/answerAgg.js)): per **(voter, member question)**,
  resolve the latest in-scope response **that answers the question** (branching-skipped responses
  produce no row, so they can neither current nor un-current anyone; sort
  `{submittedAt:-1,_id:-1}` + `$first`), then a voter is current when ANY member question's latest
  answer selects a tag-carrying option (`currentTagVoterSet`, dual-read: option ids ∪ member
  texts). `current ⊆ identified` by construction, and **current is scope-relative** — the same
  `match` (date/pass/crew/userId) narrows both numbers, so a later flip is invisible to an
  earlier-round scope. The service is the ONE owner of these semantics; `/tag-teams` and the
  client-report freeze call the same function so the three surfaces cannot drift.

The contributing `options` + per-option counts come from the per-question breakdown already built
(response-unit — labelled "answers" in the UIs), sorted by `voterCount` desc. Rendered by
`TagResults` ([QuestionResults.jsx](../client/src/components/QuestionResults.jsx)) inside
[DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) and
[SurveyExplorerPage.jsx](../client/src/pages/SurveyExplorerPage.jsx) (see §G).

**By-team split — `GET /admin/reports/tag-teams`** ([reports.js](../server/src/routes/admin/reports.js),
next to `/team-breakdown`). Query: `campaignId`, `tag` (**required** — missing → 400, unknown →
404, case-insensitive via `normalizeTag`), `surveyTemplateId?` (else the campaign's attached
survey; none → 404 — unlike survey-results there is no empty-200, since the tag param is
mandatory), `from/to?`, `effortId?`, `passId?` (incl. the `legacy` sentinel), `coordinatorId?`
(`none` ok). Response:

```jsonc
{ "ready": true, "tag": "Supporter", "surveyTemplate": { … },
  "teams":  [{ "coordinatorId": "…", "coordinatorName": "Lee Lead",
               "identifiedVoters": 4, "currentVoters": 4 }],
  "noTeam": { "identifiedVoters": 1, "currentVoters": 1 },   // dedicated sibling, never a null-id row
  "totals": { "identifiedVoters": 8, "currentVoters": 7 } }
```

**FIRST-FINDER attribution** (owner ruling, Aug 2026): one aggregation over the in-scope
tag-carrying responses — `teamFoldStage(leadIds)` (the standard lead fold; `leadIdsForScope`
over the **un-windowed** `baseFilter` scope, `crewFilter`'s own precedent) → `$sort
{submittedAt:1,_id:1}` → `$group {_id: voterId, team: $first}` — credits each voter to the team
on their **earliest** tagged response. That stamp follows crew re-stamps, so credit moves with
the canvasser like every other team number. Because each voter resolves to exactly ONE team,
**both units partition**: `Σ teams + noTeam === totals`, identified and current — the property
the `teamFoldStage`-only shape cannot provide (see the callout in §J and
[METRICS.md](METRICS.md) §F). Gated on `Organization.teamAttributionReadyAt` exactly like
`/team-breakdown` (`ready:false` → the clients render nothing). Pinned end-to-end by
[surveyTagUnits.int.test.js](../server/test/surveyTagUnits.int.test.js). Rendered by
[TagTeamTable.jsx](../client/src/components/TagTeamTable.jsx) inside the web tag drills and as
the mobile drill's "By team" card.

**Drill to voters by tag.** `GET /admin/reports/voters-by-answer?tag=<tag>&surveyTemplateId=<id>`
([reports.js](../server/src/routes/admin/reports.js)) — when `tag` is present it requires
`surveyTemplateId`, loads the org-scoped template, and filters with `answerTagClause(template, tag)`
(otherwise it dual-reads a single option via `voterAnswerClause`). The report's `VoterList` opens
this when you expand a tag.

**Collect by tag (walk lists).** The walk-list filter gained `answerTagFilters: [{ tag }]`
([models/SavedSearch.js](../server/src/models/SavedSearch.js) `tagFilterSchema`).
`resolveWalkList` ([services/walklist/resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js))
loads `campaign.surveyTemplateId` and, for each tag, turns `answerTagClause(template, tag)` into
**one household predicate** (`SurveyResponse.distinct('householdId', …)`) — a cross-question OR added
to `predicateSets` alongside the per-question `answerFilters`, then AND/OR-combined by the filter's
global `combine`. The UI is the **"By tag"** section of
[AnswerFilters.jsx](../client/src/components/AnswerFilters.jsx), wired from
[WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) (see §G).

**CSV export of a saved search (see also §J for the *answers* CSV).**
`GET /admin/campaigns/:campaignId/walklists/:id/export.csv`
([routes/admin/walklists.js](../server/src/routes/admin/walklists.js)) streams the saved search's
**frozen** `voterIds` (joined to their `Household`) as a CSV attachment — columns **Voter ID, First
Name, Last Name, Party, Age, Phone, Precinct, Address, City, State, ZIP** (`age` derived from
`dateOfBirth`, cells quoted via `csvCell`). It's not tag-specific (any saved search exports), but it
completes the "build a list by tag → take the list elsewhere" loop. The client downloads it as an
**authenticated blob** (`exportCsv` in [WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx)): a
plain `fetch` with `Authorization: Bearer` + `X-Org-Id` headers, `res.blob()`, then a synthetic
`<a download>` click — needed because a bare link can't send the auth headers.

## J. The answer drill-in (Survey Explorer + audit endpoints)

The "who's behind this answer" surface (Part 1 → *Auditing answers*). Four endpoints in
[routes/admin/reports.js](../server/src/routes/admin/reports.js), all behind the reports router's
gate: `requireOrgRole('admin','lead')` **plus the lead-scoping middleware** — a team lead's request
**must carry a `?campaignId` they manage or it 403s**, so every client fetch to `/admin/reports/*`
carries `campaignId` unconditionally. All date windows resolve in the **campaign timezone**
(`parseDateRange` → `zonedDayRange`, [TIMEZONES.md](TIMEZONES.md)); exact times render as
`hh:mm:ss` in that tz everywhere ([DATE_FILTERS.md](DATE_FILTERS.md)).

| Endpoint | Purpose |
|---|---|
| `GET /admin/reports/answer-canvassers` | Per-canvasser breakdown for **one option** — "who is entering Opposed the most?". Params: `questionKey` + (`optionId` and/or `option`) required, plus `surveyTemplateId`, `campaignId`, `effortId`, `coordinatorId` (`ObjectId \| 'none'` — the identical `withTeam` clause `survey-results` takes, so the counting contract below holds under a crew filter; rows stay RAW per-user), `from`/`to`. Returns `{ total, rows: [{ userId, firstName, lastName, status, count, share, questionTotal, pctOfOwnAnswers, lastAt }] }` sorted `count` desc. `share` = % of the option's total; `questionTotal` = that canvasser's **total selections on this question** (any option); `pctOfOwnAnswers` = `count ÷ questionTotal` — "12% of everything they record on this question is Opposed". Identity via `hydrateCanvassers` (`status: 'deleted'` fallback, so a departed canvasser's rows survive). **No `userId` param and no pagination** — clients render the full crew-sized table so a row click can *toggle* a filter. **`tag` → `400` by design** (see the contract below). |
| `GET /admin/reports/voters-by-answer` | The entry list. Same option/tag filter as before (§I), built by the shared `buildVotersByAnswerFilter` — **now also takes `userId`** (narrows to one canvasser's entries, works in option **and** tag mode) and **`coordinatorId`** (`ObjectId \| 'none'`, wrapped `$and`-style AFTER `userId` so the two intersect — a crew clause must never replace a canvasser drill), and each row **now carries `wasOfflineSubmission`**. Row shape: `{ responseId, submittedAt, voter{id,fullName,party}, household{id,addressLine1,city,state}, canvasser{id,firstName,lastName}, note, wasOfflineSubmission }`; paginated (`limit` ≤ 200, `skip`), plus `total`. |
| `GET /admin/reports/voters-by-answer.csv` | The same drill as a **CSV attachment** — same params (incl. `userId`, `coordinatorId` + tag mode) through the **same** `buildVotersByAnswerFilter`, so the file can never disagree with the JSON list. No pagination; hard `EXPORT_CAP = 50000`. Columns: `Submitted (ISO)`, `Date`, `Time (<tz-abbrev>)` (campaign tz), `Voter`, `Party`, `Address`, `City`, `State`, `Zip`, `Canvasser first/last name`, `Question`, `Answer` (the drilled question's **snapshots** — `questionLabel` + `answer` text + `otherText`, honest even after an option rename; tag mode collects every answer entry carrying the tag), `Note`, `Offline submission` (yes/no), `Response id`. **This is the 4th server-side CSV export** — same audience as the JSON (org admin + granted lead, campaign-scoped); recorded in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) §B8. |
| `GET /admin/reports/responses/:responseId?campaignId=` | One response in full (the detail drawer/screen): answers, note, GPS + `distanceFromHouseMeters`, voter, household (with coordinates for the dot map), canvasser, round — **now also `syncedAt`** (server receipt time; trails `submittedAt` by however long the phone stayed offline), **`editedAt`**, and **`editedBy{id,firstName,lastName}`**. Re-checks the response's own `campaignId` against the lead's grants (defense-in-depth beyond the router gate). |

> **Each drill row carries its `answer`** — the response's answer to the drilled question, rendered
> by the shared `formatAnswerCell` that also builds the CSV cell, so screen and export cannot
> disagree. This is load-bearing for the write-in bucket, where the answer IS the free text: without
> it the drill listed names and nothing about what any of them wrote.
>
> **The counting contract.** `answer-canvassers` must sum **exactly** to the option's count on
> `survey-results` for identical filters. That count comes from the `choiceKeyStages` explode folded
> by `mergeOptionRows` (id-native rows count by option id, legacy rows by text) — so the breakdown
> aggregates with the **same explode**, grouped by `userId`, matching `_answerKeys` against
> `{optionId, option text}`. It deliberately does **not** use `voterAnswerClause` +
> `countDocuments`: a dual-write edge row carrying both an id *and* a mismatched legacy text would
> double-count there. Consequences:
>
> - `total === Σ rows[].count`, and both equal the option's `survey-results` count for the same
>   filters (legacy text-only rows included).
> - On a **multiple-choice** question a response counts once **per selected option** — the unit is
>   the *selection*, and `questionTotal` is selections, not responses.
> - Counts are **RAW per-user — no team fold** (`teamFoldStage` is not applied). This is an audit
>   surface: it answers "who pressed the button", never "whose team gets credit". Contrast the
>   team-attribution model in [METRICS.md](METRICS.md).
> - **Tag mode is a `400` by design**: a tag rollup is a **distinct-voter** count across questions
>   (§I), which has no honest per-canvasser sum — three questions can feed one voter's tag. The
>   **one sanctioned exception is `/tag-teams`** (§I): FIRST-FINDER attribution assigns each voter
>   to exactly one **team**, so a per-TEAM distinct-voter split partitions honestly. No such ruling
>   exists for canvassers — the 400 here stays, and this feature must not be read as license to
>   remove it.
> - **The `'__other__'` write-in keys on the sentinel ALONE** here (`keys = ['__other__']`, not
>   `[optionId, option]`). Including its display text would count a legacy row that `mergeOptionRows`
>   files under a *different* bucket, breaking this very contract.
> - Option counts are **per RESPONSE**, and `SurveyResponse` is unique on `{voterId, passId}` — one
>   response per voter **per round**. So the same voter asked in Round 1 and again in Round 2 counts
>   **twice**: two forms, and (for a yard sign) two signs handed out. That is intended — contrast
>   `surveyedVoters`, which is a `distinct('voterId')` and counts that person **once**. A one-round
>   campaign cannot tell the two apart; see the three-units callout in [METRICS.md](METRICS.md).
> - **`?passId=legacy` selects the PRE-TURF bucket** (rows with `passId: null`). Pass pickers are
>   built from Pass documents, so without this sentinel those responses would belong to "All passes"
>   and to no selectable pass, and Σ(passes) would quietly fall short of the headline on any org
>   with pre-turf history. `GET /admin/campaigns/:id/passes` returns **`legacyResponseCount`** so a
>   client can offer the option only when the bucket is non-empty. Mirrors the "Legacy / no pass"
>   row `/knocks-by-pass` has always emitted. (The `legacy` sentinel is an API value, not a label —
>   it does not change with the wording.)
> - **`?passId=` scopes any of these to one round** (`survey-results`, `voters-by-answer`(+`.csv`),
>   `answer-canvassers`), via `passFilterOf` in [reports.js](../server/src/routes/admin/reports.js).
>   **`?coordinatorId=` scopes the same trio to one crew** (`withTeam` + `crewFilter` — the
>   campaign home's crew filter; all three take the identical clause, so option counts, drills,
>   and per-canvasser rows keep summing to each other under it).
>   Σ(rounds) === the all-rounds total. It is deliberately **not** part of `baseFilter`:
>   `/knocks-by-pass` builds its row set from every Pass while counting through the same filter, so
>   narrowing there would render every other round as a real-looking zero. A walk-list filter is no
>   substitute — `roundNumber` restarts per effort — and neither is a date range, since rounds in
>   different efforts can be active at once.
> - `voters-by-answer`'s `total` (a `countDocuments` over `voterAnswerClause`) **can diverge** from
>   the explode-based option count on the same rare dual-write legacy rows. The UIs therefore
>   present them as two numbers — the headline "Answers" stat vs the list's own "Showing N of M
>   entries" — and never equate them.

**Frontend (web).**

| File | Role |
|---|---|
| [pages/SurveyExplorerPage.jsx](../client/src/pages/SurveyExplorerPage.jsx) | Route `/campaigns/:campaignId/explorer` ([App.jsx](../client/src/App.jsx), console group — **admins and leads**; `CAMPAIGN_NAV` slug `explorer` in [navItems.js](../client/src/components/navItems.js)). **The URL is the filter state** — `?survey&q&optionId&option&userId&effortId&coordinatorId&pass&tag&view&from&to` (`pass` = a **Pass `_id`**, never a round number — `roundNumber` restarts per walk list, so the selector reads "Walk list · Pass N"; `coordinatorId` = the crew scope, `ObjectId \| 'none'`, with its own select fed by a campaign-scoped never-filtered `/team-breakdown` query — the Dashboard/Timeline picker pattern, incl. the pre-backfill `ready:false` self-hiding and a "Selected crew" fallback option for a deep-linked crew the options haven't resolved), written with `replace` so filter twiddling doesn't spam the back stack; a drill is shareable. Date range defaults to **Today** in the campaign tz (`rangeTouchedRef` + tz-ready seeding, the DashboardPage pattern); a `?from/&to` deep link seeds a custom range. The headline stats re-query `survey-results` with **identical** filters (incl. `userId`, which that endpoint accepts) so the headline can never disagree with the accordion; the By-canvasser table stays deliberately un-`userId`-filtered so a row click toggles the filter. Tag mode: **two headline StatCards** ("Voters identified" / "Still current", read off the same `survey-results` payload — zero extra fetches), the **`TagTeamTable`** by-team split (one plain fetch, still no polling; deliberately NOT narrowed by `?userId` — a team split filtered to one person would re-create the per-canvasser lie), voter list + CSV (by-canvasser hidden with an explanation, minimap hidden — the map endpoint has no tag filter). The **no-drill empty state renders `<TagResults onTagClick>`** (the same rollup panel as the Dashboard; a row click sets `?tag=`) above the pick-a-question chips. The round picker comes from the shared `useRoundOptions` hook (same options as the Dashboard's, un-polled here). CSV via authenticated `fetch` + blob (the WalkListsPage idiom). **Single-fetch, no live polling** (the repo's Live-pill contract — a page without polling carries no pill). Campaign-switch resets state (same mounted page). |
| [components/AnswerCanvasserTable.jsx](../client/src/components/AnswerCanvasserTable.jsx) | The ranked breakdown table: rank, canvasser (+ muted status), count, `share`, `pctOfOwnAnswers` (with an info hint), last entry. Row click calls `onSelect(userId)` (toggle); active row highlighted. |
| [components/ResponseDetailDrawer.jsx](../client/src/components/ResponseDetailDrawer.jsx) | The response detail — **the first lead-accessible response detail on web**. Fetches `responses/:id?campaignId=`; renders voter/household/canvasser, submitted time (`hh:mm:ss`, campaign tz), Offline badge + synced time, round, `formatDistanceImperial` distance (ft/mi rule), all Q/A pairs (+ `otherText`), note, the edited-by audit line, a small non-interactive Mapbox dot map, **View on map**, and a **Voter record** link gated on `isOrgAdmin` (mirrors the `/voters/:id` RoleGate — never offered to a lead). |
| [components/AnswerMiniMap.jsx](../client/src/components/AnswerMiniMap.jsx) | Single-fetch `GET /admin/households/map` with the drill's filters and **no `bbox`** (the filtered set is small). The map endpoint takes no `coordinatorId`, so on a crew-scoped drill the mini-map stays campaign-wide (doors don't belong to a crew — the Coverage exception); renders via the shared `mapRender` helpers. Camera `fitBounds` over the **returned features** — **never `includeBounds`**, which is the campaign-wide extent and would mis-frame a filtered subset. Pin clicks are bound ONCE at init for both `households-symbols` and `building-symbols` (a stack is otherwise inert), and read the current stacks through a ref because the handler cannot close over a later memo. **Fullscreen sets `margin: 0` alongside `inset: 0`** — the card sits in a `space-y-4` stack, and a fixed box with both a margin and `inset: 0` is over-constrained, so it rendered 16px short until that was added. |
| [components/QuestionResults.jsx](../client/src/components/QuestionResults.jsx) `OptionDrill`/`TagDrill` | The accordion quick look: enriched `VoterList` rows (exact time, note, Offline badge, row click → drawer, stop-propagation Map link), per-option canvasser select + Voters \| By-canvasser toggle + **Open full view →** (pre-seeded explorer link). `answer-canvassers` is fetched **only when the By-canvasser view is open** (one fetch saved per expanded option). `TagDrill` = same row enrichment, no by-canvasser. `effortId` + `coordinatorId` thread from [DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) into the drills so an effort- or crew-scoped chart never drills unscoped, and both **Open full view →** links carry `coordinatorId` so the explorer opens with the same crew scope. |
| [pages/MapPage.jsx](../client/src/pages/MapPage.jsx) | Seeds its answer filter from `?questionKey/&option/&optionId` (plus the existing `userId`/`from`/`to`) — the explorer's Open-in-Map target. Deep-link spec in [MAPS.md](MAPS.md). |

**Frontend (mobile — OTA-safe, JS-only).**

| File | Role |
|---|---|
| [admin/campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) | The Survey results section gains a **Tags** `InsetGroup` above the per-question cards (gated `!isLitDrop && tags.length > 0`): one `InsetNavRow` per tag — `value` "N voters", `sub` "M still current" (absent from an old server → no sub, never a fake 0) — reading the SAME `surveyResultsQ` payload, so the rows honor the round chips + crew filter exactly like the question counts; a `GroupFooter` carries the two-unit definition. Tapping pushes `answer-voters` in tag mode via `goTagVoters` (same param-carrying discipline as `goVoters`: tag, template id, passId, coordinatorId, from/to). |
| [admin/answer-voters.jsx](../mobile/app/(app)/admin/answer-voters.jsx) | The drill list, reached by tapping an answer's count on [admin/campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) (which now passes `surveyTemplateId` so the drill stays template-scoped). Adds a **Voters \| By canvasser** `TabSwitcher` (ranked rows; tap sets the canvasser filter and flips back to Voters), a canvasser filter pill fed by the `answer-canvassers` rows, enriched `VoterRow`s (exact campaign-tz time, note/Offline badges from `wasOfflineSubmission`), and a **View on map** header action: `saveActiveCampaign` first (the goTimeline idiom), then push the map with `{ questionKey, optionId, alabel, userId, from, to, scid, seedAt }`. **Tag mode** (`?tag=` + `surveyTemplateId`, pushed by the campaign screen's Tags card): the voters query swaps the option identity for `tag`, the `answer-canvassers` query is **disabled** (the server's designed 400 must never be requested, let alone render as an error) and the TabSwitcher gives way to a caption saying why; the map link hides (the map endpoint has no tag filter); a **"By team"** `InsetGroup` renders the `/tag-teams` split (rows + "No team" + Campaign line, `GroupFooter` states the first-finder partition; hidden when `ready:false` or on error). Subtitle reads "Tag · N entries — one per round". |
| [admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | Consumes those params **one-shot** (a `seededRef` nonce on `seedAt`, the household/focusAt idiom), waiting until the active campaign equals `scid` before applying; then strips them via `router.setParams` with `''` values. The map's `answerFilter` now carries and sends the option **text** alongside `optionId` (dual-read, matching web). Deep-link spec in [MAPS.md](MAPS.md). |
| [admin/response-details.jsx](../mobile/app/(app)/admin/response-details.jsx) | Now renders *"Edited by X · <exact time>"* when `editedAt`, a **Synced** row when `wasOfflineSubmission`, exact times via `formatExact` in the campaign tz, and the distance row through the shared ft/mi formatter. |

**Test.** [server/test/answerDrill.int.test.js](../server/test/answerDrill.int.test.js) (9 tests,
`npm run test:int`) pins the contract: breakdown-sums-to-option-count (legacy text included, all-time
**and** under a campaign-tz-anchored window), `userId` narrowing in option + tag mode,
`pctOfOwnAnswers`, multi-choice explode semantics, the tag/param `400`s, both lead-gating `403`
flavors, the CSV's headers/columns/timezone rendering, and the response detail's
`editedBy`/`editedAt`/`syncedAt`.
