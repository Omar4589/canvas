# Surveys

How surveys are built, run at the door, stored, and reported — including conditional questions,
read-aloud option scripts, "Other (specify)", **scripted surveys** (read-aloud statements, several
closings, "then go to" routing, a default closing, canvasser notes, tappable links, the
`{{canvasser}}` placeholder, one block per screen on the phone), and the (now much more permissive)
rules for editing a survey that's already collecting answers.

- **Part 1 — For everyone** is plain language: what a survey is, how to build one (including
  branching logic written as "then go to" arrows or as "Show only if" conditions, statements and
  closings, per-option scripts, notes and links for the canvasser, and **tags** that group answers
  across questions), what the canvasser sees in each of the two phone layouts, what you can safely
  change once it has answers, and **auditing answers** — drilling from any count to the voters
  behind it, who *recorded* each entry and when, and the Survey Explorer page.
- **Part 2 — Technical reference** is for developers (and Claude): the data model, dual-read
  reporting, the soft-retire reconcile, the shared visibility evaluator, answer normalization, the
  migrations, the **tags** story — the org-level `Tag` library + management API, the
  cross-question rollup, by-tag walk lists, and CSV export — the **answer drill-in** endpoints
  (per-canvasser breakdown, the voters-by-answer CSV, the response detail) with their counting
  contract (§J), and scripted surveys: the "then go to" compiler (§L) and the shared door runner and
  `{{canvasser}}` filler (§M).

Related: [METRICS.md](METRICS.md) ("Surveys" and "Surveyed voters" definitions),
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (one survey per voter **per pass**),
[EFFORTS.md](EFFORTS.md) (a **walk list can override** the campaign survey — the door's walk-list
survey wins, falling back to the campaign default),
[VOTERS.md](VOTERS.md) (editing a single response on a voter's profile),
[EXPORTS.md](EXPORTS.md) (full survey results at scale — wide + long CSVs; the in-page
voters-by-answer CSV stays as the interactive drill),
[WALK_PACKETS.md](WALK_PACKETS.md) (what a survey prints on paper, including statements and
closings on the "What to say" page),
[PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) (the design and the owner's rulings
behind scripted surveys: the client script that prompted them, the proof that "then go to" compiles
into the existing rule grammar, and the rejected alternatives).

---

# Part 1 — For everyone

## What a survey is

A **survey** is the questionnaire a canvasser runs at the door. One survey (we call it a "survey
template") belongs to your **organization** and can be attached to one or more **campaigns**. It
has:

- an **intro** — the opening the canvasser reads (the builder calls it the **Greeting**),
- a list of **blocks**, in the order the conversation runs. Most blocks are **questions**, each one
  of three types:
  - **Single choice** — pick one option,
  - **Multiple choice** — pick any number of options,
  - **Text** — free typing.

  A block can also be a **statement** or a **closing**: words the canvasser reads aloud that take no
  answer — a paragraph about the candidate, a reminder of the dates, a goodbye for one path through
  the conversation (see *Statements and closings* below),
- a **closing** — the **default closing**: the goodbye on any path that reaches none of the survey's
  closing blocks. A survey with no closing blocks (every survey built before they existed) simply
  reads it at the end, as it always has.

Each question can be marked **required** and has an **order** (where it appears in the list). Only
questions record anything: statements and closings are script, not data, so they never appear in
results, exports, client reports or a voter's record.

A survey that reads as a script — it has statements, closing blocks, or answers that say where to go
next — is a **scripted survey**. Nothing about it is a separate kind of survey: it is built in the
same builder, attached the same way, and counted the same way. What changes is how it reads at the
door, which is why a scripted survey is shown one block per screen on the phone unless you turn that
off (see *One block per screen* below).

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
  count (what canvassers actually answer; retired questions and read-aloud statements don't inflate
  it), response count, and a version badge.
- **Click a row** to open the **quick view** — a side panel with the survey's dates, everywhere it's
  used (each linking straight to that campaign's results), response totals **per campaign**, its
  question count (with "· 3 statements" beside it when it has any), and a read-only preview of every
  block, with **Try it** to walk through it as a canvasser (see *One block per screen* below). It's
  the fast way to *see* a survey without opening the builder; **View full results →** jumps to the
  campaign dashboard's Survey-results section.
- **Actions** live on each row (⋮ menu) and in the quick view: **Edit**, **Duplicate**, and
  **Archive** or **Delete** (see below).

**Creating and editing** happen on dedicated pages — **+ New survey** opens `/surveys/new` and
**Edit** opens `/surveys/<id>/edit`, both hosting the full builder; save or cancel returns you to
the library. In the builder you give the survey a name, write the **Greeting** (the intro) and the
**Closing** (the default closing), then add blocks with the three buttons under the list: **+ Add
question** (wording, type, options, required), **+ Add statement** and **+ Add closing**. The count
above the list says what you have — "6 questions · 4 statements", closings counted as statements,
retired blocks not counted. Any block can also carry a note to the canvasser and links (see
*Canvasser notes and links* below). The builder checks as you type: a misspelt placeholder, an
arrow pointing the wrong way or a link that isn't a web address turns red on its card, and Save
waits until nothing is red. A survey needs at least one question that records an answer: one made
only of statements and closings is refused, because every visit would file an empty survey. When
you attach the survey to a campaign, canvassers on that campaign start seeing it.

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

Beyond plain questions and options, the builder supports these extras:

### Statements and closings

Some of a door script isn't a question at all: a paragraph about the candidate, a reminder of the
dates, a thank-you. Those are **statements** — blocks the canvasser reads aloud that take no answer.
**+ Add statement** adds one to the end of the list; **+ Add closing** adds a **closing**, a statement
that ends the conversation on the path that reaches it. Move either one up or down like a question.

- **What you type** is the **Read aloud** text — paragraphs are fine, up to 5,000 characters — and
  an optional **Title** such as "Statement 1" or "Close 2". The title names the block in the "then go
  to" menus, on the phone and on paper; left blank, the first words of the text are used instead.
- **They record nothing.** A statement or closing never takes a question number, never counts toward
  the progress bar, can't be required, has no answers, and never appears in results, exports, client
  reports, a voter's record or the desk tools for entering answers. If the text asks the voter
  something ("what is your most important issue?"), that is conversation; to keep the answer, add a
  question after it.
- **Each closing belongs to a path.** A closing block shows only on the path that leads to it — an
  arrow (see the next section) or its own "Show only if" — so a supporter can hear the voting pitch
  while someone who already voted hears a thank-you. One closing can lead on to another ("Close 2",
  then "Close 4") with a "then go to". Which closing a voter heard is never recorded: their answers
  already say which path they took.

**The default closing.** The **Closing** box at the bottom of the builder is the goodbye for any path
that reaches none of your closing blocks — "Thank you for your time" for the voter who said no. A
survey with no closing blocks reads it at the end of every conversation, exactly as before. On a
survey with closing blocks or "then go to" arrows it also waits until every required question that is
showing has been answered, so a canvasser never reads "Thank you for your time" above a question
they're still asking. Once a survey has closing blocks, its preview captions this one "Closing — when
no closing block applies".

### Conditional questions — "then go to", or "Show only if…"

Not every voter should hear every block. There are two ways to say which ones do, and each survey
uses one of them.

**Write it as a script: each answer says where to go next.** Under every answer there's a small
**then go to →** menu: continue to the next block, any block further down the list, or **End the
conversation**. That is how door scripts are usually written ("Yes → Q4, No → Q2"), and it is the
easy way to build one with statements and several closings. The "Other (specify)" answer and every
text question have the same menu; in a script, so does every statement and closing. Setting your
first "then go to" makes the survey a **Go to** survey — a blue banner above the list says so — so
there is no setting to find first.

Three rules keep a script predictable:

- **No arrow means "carry on to the next block".** An answer left on *Continue* goes to whatever
  block sits below its question, and the menu names it ("Continue to next block (Q3 · …)"). **End the
  conversation** goes straight to the goodbye: the default closing.
- **Arrows only point down the list,** so a script can never loop. The menu offers later blocks only,
  and if you move a block so that an arrow would point backwards, the card says so in red until you
  move it back or pick another target.
- **Every block needs a way in.** A block nothing leads to is an error ("Nothing leads to …"), never
  silently hidden. Removing a block that arrows point to sends each of those arrows back to
  *Continue*, and a one-line notice says how many.

Each card in a Go to survey also shows, in grey:

- **Reached when …** — who gets this block, worked out from the arrows: *Reached when Q1 =
  "Undecided" or Q4 = "Election Day"*. It is exactly the rule the phone follows.
- **Continues to …** — where the block goes when nothing on it says otherwise. Watch this line on
  statements and closings: a closing left on *Continue* runs straight into whatever block is below
  it, so a supporter could hear Close 2 and then Close 3. That is why a new closing in a Go to survey
  starts on **End the conversation**, and why Close 2 needs an arrow to Close 4 if it should lead
  there.

A question whose answers carry arrows needs an answer to know where to go: if it isn't required and
the canvasser skips it, the conversation ends there, at the default closing. The builder warns you
on such a question ("Mark it Required or add a 'Declined to say' answer"). A question with no arrows
on any answer is different — skipping it simply carries on to the next block, as on any ordinary
survey.

**Or write conditions: "Show only if…".** The other style puts the condition on the block that
should appear. On any block (after the first), open **Show only if…** and add one or more rules. A
rule reads:

> *"`<earlier question>` **is / is not / is any of** `<option(s)>`"* — or, for a text question,
> *"is answered / is not answered."*

With multiple rules you choose **Match ALL** (every rule must hold) or **Match ANY** (one is enough).
Rules can reference **only earlier questions** — the builder won't let you point at a later or the
same question — so the survey can never tangle itself into a loop. This one mechanism covers all the
common shapes: **branch** ("show the follow-up only if they picked X"), **skip** ("hide this unless
they're a supporter"), and **skip-to-end** (the last questions simply don't appear). A statement or
closing can carry its own "Show only if" too, but a rule can only test a question: a statement has
no answer to test.

**One style per survey.** Both styles describe the same branching from opposite ends — arrows on the
answers, or conditions on the blocks they lead to — and a survey that mixed them could contradict
itself with no way to say which wins. So a survey uses one or the other, and you never pick it from a
menu:

- **Your first arrow switches the survey to Go to.** A block still carrying a hand-written "Show only
  if" then shows an error until you re-express it as an arrow or remove it (the card has a **Remove
  condition** button), and Save waits until none are left. It is never deleted for you, because some
  conditions — "is not", "Match ALL" — can't be written as arrows.
- **"Switch back to Show only if"** (the banner's button) takes the survey out of Go to. On a survey
  that was still a "Show only if" survey when you opened it — its arrows are new and not yet saved —
  it is an **undo**: the arrows are cleared and every block gets back the condition it had when you
  opened the survey (a block added since gets none), so it is never refused. On a survey already
  saved with Go to, or a new one, it **converts**: every block keeps exactly the condition its arrows
  produced, now editable by hand, and the arrows are cleared. The survey shows exactly what its
  arrows showed, so this is always allowed — except while an arrow has an error, which the banner
  names so you can fix it first. On a survey that already has answers it asks you to confirm,
  because of the next rule. Either way, a block still carrying a hand-written condition keeps it.
- **Once a survey has answers, it can't switch to Go to.** Redrawing the branching as arrows could
  change who is asked what, so later visits would record differently from earlier ones. The "then go
  to" menus are greyed out on such a survey; **Duplicate** it and build the script on the copy —
  from the **Surveys** list, or at the top of the campaign's **Edit survey** page, which is where a
  team lead finds it (see *Editing a survey* below). Every survey that existed before Go to is a
  "Show only if" survey, and stays one until someone sets an arrow.

At the door, blocks that don't apply never show, and **their answers aren't saved** — a question
someone never sees can't accidentally count in your reports.

### Read-aloud option scripts

Any choice option can carry a short **read-aloud script** — a line the canvasser sees the moment
they pick that option. Add it with **+ read-aloud script** under the option. It's perfect for
follow-up prompts ("Great — what would change your mind?") or rebuttals tied to a specific answer.
It's words to say, not data: nothing about it changes how the answer is stored or counted.

**A script or a statement?** An answer's script belongs to that one answer: it appears under the
answer, inside the question, only once the answer is picked. A **statement** is a step of its own in
the conversation, with its own place in the list, its own way in, and (on one block per screen) its
own screen. Use a script for a quick reply to one answer ("Oh great! Well thank you for
participating." under *Already voted*); use a statement for a paragraph that several answers lead
to, or anything that should be its own step. The preview shows each answer's script under it, and a
walk packet prints them all once on its "What to say" page.

### Canvasser notes and links

Any block — a question, a statement or a closing — can carry two things meant for the canvasser
rather than the voter:

- **A note to the canvasser** (**+ note to canvasser (not read aloud)** on the card), such as "Could
  share this with them if the situation feels appropriate." On the phone it sits in a blue box
  labelled **For you — not read aloud**, so it can never be mistaken for the amber read-aloud text.
  Notes never print on walk packets and never appear in results, exports or reports.
- **Links** (**+ link**, up to five per block): a label and a web address starting with `https://`
  (or `http://`). On the phone each link is a row the canvasser taps to open the page in the phone's
  browser and show it to the voter; a link saved without a label shows the site's name. Nothing is
  fetched ahead of time, and nothing about the voter or the door is added to the address. On paper a
  statement's or closing's link prints as "Label: address" on the walk packet's *What to say* page; a
  question's links don't print, so put a link your paper volunteers need on a statement or closing. A
  link row with a label but no address is an error; a row left completely blank is simply dropped
  when you save.

There is no QR code on the phone, by design: the QR code belongs on your printed literature.

### The canvasser's name: `{{canvasser}}`

Type `{{canvasser}}` in any text that's read aloud — the greeting, a statement or closing, the
default closing, an answer's read-aloud script — or in a note, and each canvasser sees their own
first name there: "Hi, my name is {{canvasser}}" reads "Hi, my name is Maria" on Maria's phone. The
preview fills in *your* first name. On a walk packet it prints as a blank line (`______`) for the
volunteer to say their own name, since a packet isn't personal to one canvasser and never prints a
name; a canvasser with no first name on file sees the same blank line.

It is the only placeholder. Dates and everything else are typed by hand, as before. A misspelling
(`{{Canvasser}}`, `{{name}}`) or a `{{` with no closing `}}` is refused when you save, so it can never
reach a phone as stray braces. And it can't go in a question's wording or an answer — both are stored
with every response and become your report labels and spreadsheet cells, where nothing fills it in —
nor in a block's title or a link's label, which show exactly as typed.

### One block per screen

A long script reads better one step at a time. With **One block per screen** ticked (in **Survey
settings** at the top of the builder), the phone shows one thing at a time in large type: the
greeting, then each question, statement or closing on its own screen, with **Next** at the bottom.
The builder ticks it for you when a survey that wasn't a script when you opened it gets a statement,
a closing block or a "then go to" — judged on the survey as it will be saved, so adding a statement
and removing it again leaves the setting as it was. Tick or untick it yourself and your choice
stands. Every survey that existed before stays on the single page it always had: one block per
screen is meant for scripted surveys. Either way the phone shows the same blocks and saves
the same answers; only the layout differs (see *What a canvasser sees (mobile)* below).

**Try it.** A survey's preview — the quick view on the **Surveys** page, or **Preview** on a
campaign's **Survey** tab — has an **Overview | Try it** switch:

- **Overview** shows the whole survey at once: the greeting, every block in order with the questions
  numbered (statements take no number), a grey **Shown when …** line over each block that doesn't
  always show, each answer's read-aloud script under it, notes in a blue **Canvasser note · not read
  aloud** box, links you can click, and the closing.
- **Try it** lets you answer as a canvasser would and walk any path — one screen at a time with
  **Back**, **Next** and **Skip** if the survey uses one block per screen, otherwise on one live page
  — using the same logic the phone runs, so it branches, numbers and closes exactly as the door will.
  Nothing is saved; **Start over** clears your answers.

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

> **Note — a refusal is the door's Refused button, never a survey answer** (owner ruling,
> 2026-10-02). When a voter won't talk, the canvasser backs out of the survey and taps **Refused** on
> the door screen: that records someone who answered the door and declined, which counts as a knock
> and a contact but never as a survey (see [METRICS.md](METRICS.md)). The one exception: a canvasser
> who already surveyed someone else at that door this round leaves the door as it is, because a
> Refused tap would replace their result there and delete those answers (the app warns first). Don't
> add an answer named "Refused" to stand in for a refusal — picking any answer and saving files a
> **completed survey**, turns the door green and raises the connection rate, the opposite of a
> refusal. A voter who takes the survey but won't answer one question is different: give that
> question an ordinary answer such as "Declined to answer". Some surveys carry a leftover **refusal
> flag** from an earlier, abandoned plan: the API still accepts it and a printed walk packet shows it
> as a faint "Refused" bubble, but the builder has no control for it, the app never shows or records
> it, and it is not a feature.

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

> **Tags on a scripted survey: "current" is decided question by question.** A later visit changes
> it only at a tagged question that visit actually asks again. So on a script with several paths, a
> voter who said *Yes* after the pitch in round one, and in round two took a path that never reaches
> that question (a *No* at the first question, say), still counts as a current supporter through the
> round-one answer. "Identified" is unaffected. Tagging the "yes" on every path that has one (the
> first support question, the one after the pitch, "already voted for our candidate") narrows this,
> because a supporter then re-earns the tag on more of the paths a later visit can take — but it is
> worth knowing before you quote the current figure on a multi-round scripted campaign.

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
  edit just this campaign's own copy. If it **has answers**, the same box offers **Duplicate** too
  — the way to change a question's answer type or make it a Go to script; this box is where a team
  lead finds Duplicate — and the copy replaces it on this campaign at once, so do it between shifts
  (see *Editing a survey* below).

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

> **Some answers were typed at a desk, not collected at a door.** An org admin can convert a door
> entry into Surveyed and enter the answers — for a canvasser who tapped the wrong button, or a
> batch recorded under the wrong outcome. Those answers are attributed to the **canvasser who
> knocked**, keep that knock's time and place, and **count in every rate exactly like a field
> answer** — but they carry a visible **"Entered by ‹admin› on ‹date›"** line on the voter's record
> and a **Desk entered** column in exports, so you can always tell the two apart. A canvasser's real
> field answer is *never* overwritten by one. See
> [CAMPAIGNS.md → Converting to and from Surveyed](CAMPAIGNS.md).
>
> On a campaign that uses **Not a target voter**, those entries can be converted too — the fix for a
> canvasser who surveyed a voter on the list and then tapped the wrong button. Check with the
> canvasser first: that entry said the person who answered was *not* one of the voters on the list
> for that address, and converting it records survey answers for voters who are. The door already
> counted as a knock and as reaching someone, so converting it changes neither; only the survey
> count and the connection rate go up.

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

At a voter, the canvasser opens the survey and works through it in one of two layouts, chosen by the
survey (see *One block per screen* above). Both show the same blocks for the same answers and save
the same answers; only the layout differs.

**The single page** — every survey built before scripted surveys, and any survey with *One block per
screen* off. The greeting sits at the top, then the blocks, then the note box and **Save Response**.

- **Blocks appear and disappear live** — answer a question and anything that depends on it reveals
  itself (or hides) immediately. On a scripted survey (one with statements, closings or "then go to"
  arrows), when a block that just appeared lands near the bottom of the screen, the page scrolls it
  up to about a third of the way down — but never while the canvasser is typing in a box. Every
  other survey's page never moves on its own, as before.
- Statements and closings sit between the questions in amber read-aloud boxes.
- The **default closing** comes last. It doesn't show at all when the path reached a closing block,
  and on a survey that uses "then go to" arrows or closing blocks it waits until every required
  question showing is answered.

**One block per screen.** Each screen shows one thing, in large type: the greeting, one question,
statement or closing, or the end. A thin progress bar runs across the top, with "Question N" on
question screens (no "of M": how long a path is isn't known until it's walked).

- **Tapping an answer selects it** — its read-aloud line, or the "Please specify" box for Other,
  appears under it — and **Next** moves on to wherever that answer leads. Next stays greyed out on a
  required question until it's answered.
- **Skip** shows on optional questions only: it clears any answer there and moves on.
- **Back** (top left, and the Android back button) steps back one screen; on the first screen it
  leaves the survey, as it always has. Changing an earlier answer drops the part of the path that no
  longer applies, and anything typed there isn't saved.
- **The last screen carries the note box and Save Response**: the closing the conversation reached,
  or — on a path that reached no closing block — an end screen with the default closing (or *Done —
  end of the survey.* when there is nothing to read). In the rare case a required question behind
  them is still blank (the survey was updated mid-walk), Save gives way to an **Answer Question N to
  finish** button that jumps back to it.
- A second tap on Back, Next, Skip or Save within a split second of the last is ignored, so a
  double-tap can't skip past a screen or save before the closing is read.

On both layouts:

- When they pick an option that has a **read-aloud script**, that line shows up right under the
  choice.
- An **Other** choice pops a "Please specify" box for free text.
- A **For you — not read aloud** note and any links sit under their block; tapping a link opens it in
  the phone's browser. `{{canvasser}}` reads as the canvasser's own first name.
- Required questions must be filled — but **only the questions that are actually showing**. A hidden
  question is never required and is never saved, and a statement or closing never is.
- **If the voter refuses partway through,** the canvasser backs out of the survey (Back, until it
  leaves) and taps **Refused** on the door screen. Nothing from the unfinished survey is saved; a
  refusal is never a survey answer (see the Refused note above). If they already surveyed someone
  else at this door this round, they leave the door as it is instead: tapping Refused would replace
  their result for the door and delete those answers (the app asks first, and **Keep my survey**
  keeps them).

They can add a free-form note and save. Surveys submitted while offline are queued and sync later.
**One survey is kept per voter, per pass** — if a canvasser re-submits for the same voter in the
same pass, the new one replaces the old. When the earlier response belongs to **another canvasser**,
the app asks before opening the survey ("Already surveyed this round") — and if they go ahead, the
replaced answers are **preserved, not lost**: they appear on the voter's profile as a read-only
preserved-response card, and an admin can **restore** them (a lossless swap — the two responses
trade places, nothing is deleted). Opening a survey at a door already marked with a different result
this round — **Not home**, say, by this canvasser or a teammate — asks first too: *"This door is
already marked Not home this round. Take a survey instead?"* (**Cancel** goes back, **Continue**
opens the survey). The office's desk **Restricted** mark is the exception, since that door's card
already says to work it normally. Only one of the two questions ever shows per visit, and a
do-not-contact voter gets neither. A house with three voters surveyed in one visit produces
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

- **Safe (do it freely):** rename the survey, edit the **greeting/closing**, **reword** a question,
  **rename** an option, toggle **Required**, **reorder** blocks, **add** a question or option,
  **remove** a question, option, statement or closing (it's retired, not deleted), add/edit
  **conditions**, **read-aloud scripts**, or **Other (specify)**, and add or edit **statements**,
  **closings**, **notes**, **links** and titles. On a survey that already uses **Go to**, adding or
  changing its arrows is safe too.
- **Blocked: changing a question's answer type** (e.g. single-choice → text). The stored answers were
  recorded in the old shape and can't be re-totaled in the new one, so the type control is locked
  and the server refuses the change. Turning a question into a statement counts as a type change as
  well (the builder never offers it; add a statement and retire the question instead).
- **Blocked: switching a "Show only if" survey to Go to.** Its first "then go to" would redraw the
  branching, so later visits could record differently from earlier ones; the menus are greyed out and
  the server refuses it. The other way — **Switch back to Show only if** — is always allowed, because
  it keeps exactly the same conditions.

**Need to change a question's type, or turn a survey with answers into a Go to script?** Use
**Duplicate** on the Surveys list. It makes a fresh, fully-editable copy (reset to v1) that keeps
everything — blocks, arrows, notes, links, tags and the one-block-per-screen setting; point your
campaign at the copy on the Campaigns page. On a campaign's **Edit survey** page the box at the top
does both in one step whenever the survey has answers or is shared with other campaigns: its
**Duplicate** button makes the copy and switches this campaign to it — the way for a team lead, who
has no Surveys list. Either way, switch between shifts: a phone keeps the survey it loaded until it
next refreshes, and once the campaign has switched the server refuses a survey saved under the old
one (one still queued offline included), so the phone drops it. The original stays intact so its
existing reports keep working. Note: after you repoint a campaign, that campaign's new answers report
under the **copy**, separate from the answers already gathered under the original — the Campaigns
page shows a heads-up when you pick a survey that already has responses.

**Change arrows and conditions between shifts, not during one.** A phone keeps the copy of the
survey it loaded until it next refreshes, so a canvasser in the middle of a shift can still be
walking the old branching. If your edit now hides a question they answered, that answer is quietly
dropped when the survey reaches the server. Re-pointed arrows, new or changed conditions, and blocks
added or moved in the middle of a path can all change which questions show; rewording, notes and
links are safe at any time.

---

# Part 2 — Technical reference

The implementation lives in
[`server/src/routes/admin/surveys.js`](../server/src/routes/admin/surveys.js) (authoring,
reconcile + rule-graph validation, the Script-flow compile step),
[`server/src/routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js) (submission), the
shared [`server/src/services/surveys/`](../server/src/services/surveys/) helpers (visibility,
normalization, dual-read aggregation, edit classification, the "then go to" compiler `routing.js`
(§L) and the `{{canvasser}}` filler `scriptText.js` (§M)), the shared door runner
[`mobile/lib/surveyRunner.js`](../mobile/lib/surveyRunner.js) (§M) that the phone and the web
preview's Try it both walk, and the `survey-results` handler in
[`server/src/routes/admin/reports.js`](../server/src/routes/admin/reports.js) (reporting).

## A. Data model

| Model | File | Fields that matter |
|---|---|---|
| `SurveyTemplate` | [models/SurveyTemplate.js](../server/src/models/SurveyTemplate.js) | `organizationId`, `name`, `isActive`, `version` (default 1), `intro` (the greeting), `closing` (since scripted surveys, the **default closing** — see the callout below the table), `questions[]` (questions **and statements**, one ordered list), **`flow`** + **`presentation`** (next row), **`tags: [String]`** (a per-survey **palette** — the distinct display casings of the tags its options use; **derived/kept-in-sync on save**, no longer the source of truth — the org-level **`Tag`** library is, see §I), **`archivedAt`** (`Date \| null`, indexed — soft-archive; hides the template from the Active list + all pickers unless currently selected, touches nothing else; no migration needed, existing docs default `null`), `createdBy`. Org-scoped, **not** campaign-scoped (a campaign points at a template via `Campaign.surveyTemplateId`). |
| `SurveyTemplate.flow` · `.presentation` | same | **`flow`** (`'list'` \| `'script'`, default `'list'`) says how the stored `visibleIf` came to be: `list` = hand-authored "Show only if" conditions, stored as sent (a route on a live block is a 400); `script` = **compiled from the routes at every save** (§L), any incoming `visibleIf` on a live block ignored and overwritten. **Stored, not inferred** from "any route exists", so one stray route can never flip recording semantics, and a GET → PATCH round-trip can tell compiled rules from hand ones. The builder sets it, never the author: the first route → `script`, the banner's **Switch back** → `list`; entering `script` is refused once the survey has responses (§B). **`presentation`** (`'scroll'` \| `'steps'`, default `'scroll'`): the phone's layout — the single page, or one block per screen (§M). Pure presentation: both walk the same evaluator-visible list, so stored answers cannot differ. The builder sends `steps` when the survey as it will be saved reads as a script and the survey as opened did not, otherwise the stored value, until the admin ticks or unticks it (`autoPresentation`, §G: worked out on every render, never latched on a keystroke); a PATCH may carry it alone (no `questions`, no version bump). Both are absent on lean reads of older templates and read as their defaults (`flow === 'script'` is the only test, never `!== 'list'`). |
| `Tag` | [models/Tag.js](../server/src/models/Tag.js) | The **org-level managed tag library** (Phase 3.1): `organizationId`, `name` (canonical display), **`normalizedName`** (trim+lowercase dedupe key), `color` (reserved for a future colored-chip UI, default `null`), `createdBy`, timestamps. **Unique index `{ organizationId, normalizedName }`** makes duplicate tags structurally impossible. Survey options still reference a tag by its display `name` **as a string** (`option.tag`); this collection is the picklist + the target of rename/merge/delete (see §I). |
| `SurveyTemplate.questions[]` | same (`questionSchema`, `{ _id: false }`) | Every **block** — questions and statements in one ordered array, so ordering, reconcile, duplicate, the bootstrap and the evaluator need no second plumbing. `key` (stable per-survey slug, **the join handle** — never reused once retired; no two blocks may share one, retired ones included; a client-sent key may not start with `__`), `label` (a question's wording, ≤1000 — or, on a **statement, the read-aloud body itself**, ≤5000: chosen over a separate `body` field so a phone on an older bundle, which prints only `label`, still reads the whole closing), `type` (`single_choice`/`multiple_choice`/`text`/**`statement`**), **`role`** (`'statement'` \| `'closing'`, statements only, **no schema default** — see below), **`title`** (≤80, default `null`; a statement's short name, "Close 2", for the phone header, the builder, the "then go to" lists, paper and every message that names it), **`note`** (≤2000, default `null`; canvasser-only, on any block; never exported, reported, printed or shown in the desk tools), **`links[]`** (`{ label, url }`, ≤5, default `[]`; on any block; `url` ≤2000 and must match `^https?://`, case-insensitive; label ≤120, optional), **`goTo`** (default `null`; a statement's or text question's route — `null` = the following live block, a later block's key, or `'__end__'`; refused on a choice question, which routes through its options), **`otherGoTo`** (default `null`; the `'__other__'` pick's route, kept only on a choice question while `otherOption` is on), `options[]`, `required`, `order`, **`retired`** (soft-retire a whole block), **`visibleIf`** (conditional display, default `null`; compiled output in Script flow), **`otherOption`** (boolean — adds an "Other: ___" choice), **`refusalOption`** (boolean — **dormant, not a feature**: the API accepts it on a question and the walk packet prints it as a muted "Refused" bubble, but no builder control sets it and the app never renders or records it; by owner ruling 2026-10-02 a refusal is the door screen's Refused button, never a survey answer). |
| `SurveyTemplate…options[]` | same (`optionSchema`, `{ _id: false }`) | **`id`** (stable per-question id — reports/conditions join on this, so `text` is freely editable), `text`, **`tag`** (cross-question group label, default `null`; canonicalized to the palette's casing on save — see §I), **`script`** (per-option read-aloud line), **`retired`** (soft-hide from the field, keep in reports), `order`, **`goTo`** (default `null`; the answer's "then go to" — `null` = the following live block, a later block's key, or `'__end__'`; on a multiple-choice question every picked answer's route is followed; read only by the compiler, §L). A client-sent `id` may not start with `__`; `text` ≤500 and, on a live answer, may hold no `{{`; a question holds at most 200 answers, retired ones included (§B). |
| `SurveyTemplate…visibleIf` | same (`visibleIfSchema`) | `logic` (`all`/`any`, default `all`) + `rules[]`. Each rule (`ruleSchema`): `questionKey` (an **earlier** question — never a statement), `op` (`is`/`is_not`/`any_of`/`answered`/`not_answered`), `optionIds[]`. In Script flow the stored value is the compiler's output and only ever `{ logic: 'any', rules: [ any_of … ] }` (§L). |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `surveyTemplateId`, **`surveyTemplateVersion`** (snapshot at submit), `answers[]`, `voterId`, `householdId`, `userId`, `campaignId`, `organizationId`, `passId`/`turfId`/`effortId` (metadata, nullable), `location`, `submittedAt`, `wasOfflineSubmission`, `editedBy`/`editedAt`, **`deskEntry`** (`{runId, byUserId, at, source:'converted_outcome', fromOutcome}` — set ONLY by an admin outcome→Surveyed conversion; **absence is the field-submission marker**, so every pre-existing reader is unaffected and `{deskEntry:{$exists:true}}` is the exact query — see §K). Unique index `{voterId, passId}` (within-pass dedup, DB-enforced); index `{householdId, passId}`; partial index `{'deskEntry.runId'}` (revert sweep). |
| `SurveyResponse.answers[]` | same (`answerSchema`, `{ _id: false }`) | `questionKey` (matches a template question's `key`), `questionLabel` (**snapshot** at submit), **`optionIds[]`** (stable id(s) chosen — the id-native tracking key; single → 1, multi → N, empty for free-text), **`otherText`** (free text typed into the `__other__` option), `answer` (Mixed — string \| string[] \| free text; **kept as a human-readable snapshot AND the legacy reporting fallback** for rows recorded before stable ids existed). |
| `SurveyResponseArchive` | [models/SurveyResponseArchive.js](../server/src/models/SurveyResponseArchive.js) | A **verbatim snapshot** of a `SurveyResponse` that a later write replaced — answers, note, `userId`, GPS, `submittedAt`/`syncedAt`, pass/turf/effort, `editedBy`/`editedAt`, the whole row — plus **server-stamped provenance**: `overwrittenBy`, `overwrittenVia` (`'submit'` = a different canvasser's field submission; `'restore'` = an admin restore displaced it; **`'outcome_convert'`** = an admin converted the door away from Surveyed, §K) and **`conversionRunId`** (set by that third producer only; revert reads it) — never accepted from a request body. **Deliberately a separate collection** so no aggregation, status recompute, or export can mistake a preserved response for a current one — by construction, not by auditing every reader. Restore **consumes** the row it promotes, so every row here is currently-archived (a second restore of the same row is an honest 404). Not unique on `{voterId, passId}` — restore flip-flops legitimately leave several. **Growth is bounded for `submit`/`restore` only:** an `outcome_convert` run nobody reverts leaves its rows in place indefinitely — that IS the recoverability promise, not a leak, and tenant deletion still reaches them. See §F, §K. |

The `key` is derived in the builder by slugifying the label, with collision suffixes
(`top_issue`, `top_issue_2`, …); option `id`s are derived the same way within a question. Both are
minted once and held immutable so conditions and stored answers keep pointing at the right thing.
A statement's key is slugged from its `title` when it has one, else its read-aloud text
(`deriveKey` in [SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx)).

> **Statements, `role` and the default closing (scripted surveys, 2026-10).**
>
> - **A statement's shape is enforced on the server**, by the zod `.transform()` (`shapeBlock` in
>   [surveys.js](../server/src/routes/admin/surveys.js)), whatever a client sends: `options: []`,
>   `required: false`, `otherOption` and `refusalOption: false`, `otherGoTo: null`, `role` defaulted
>   to `'statement'`, and an empty `title`/`note` stored as `null`. A question loses any `role` or
>   `title` sent with it, and its `otherGoTo` is nulled unless it is a choice question with
>   `otherOption` on (the only place the compiler follows one). Load-bearing: every reader of stored
>   answers relies on a statement recording nothing, and a phone on an older bundle would block Save
>   forever on a `required` statement.
> - **`role` has no Mongoose default, on purpose.** A subdocument default is stamped onto every array
>   element on hydrate, so a default would bring every plain question back as `role: 'statement'`.
>   Every reader checks `type === 'statement'` first and trusts `role` only on a statement
>   (`isClosingBlock`).
> - **`closing` is the default closing.** It renders after the last visible block only when no
>   visible block is a closing-role statement, and on a template in Script flow or with any closing
>   block it also waits until every visible required question is answered (`showDefaultClosing`,
>   §M). A template with no closing blocks — every one saved before them — renders it exactly as
>   before. Whitespace-only reads as none.
> - **`SurveyResponse` is unchanged.** A statement never produces an `answers[]` row (§E), and nothing
>   records which closing was reached: the path is inferable from the answers. Every counting
>   contract in §C/§J therefore holds by construction.
> - **No migration, no index.** The lean readers (the surveys list, the bootstrap, duplicate, the
>   conversion service, exports, the print pipeline, the voter profile) apply no Mongoose defaults, so
>   an older template arrives with every new field absent; every consumer reads absence as the
>   default (`flow ?? 'list'`, `links ?? []`, `type !== 'statement'`). A stored template's blocks gain
>   the new default keys on the first PATCH that sends questions, since that replaces the array.
> - **Reserved `__` names.** `'__end__'` (the End route, and the phone's end screen) and `'__intro__'`
>   (the phone's opening screen) can never collide with a real key, and `'__other__'` never with a
>   real option id: every generator strips leading underscores, and the route refuses a client-sent
>   key or option id starting with `__` (400 `A block key can't start with "__" — that prefix is
>   reserved.`, or `An answer id can't …` for an option id).

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
| `POST /admin/surveys` | Create (admin **or lead** — no per-survey scope needed; nothing is attached yet, `createdBy` is stamped as the caller, and the follow-on campaign/effort attach is separately campaign-manager-scoped). Zod `upsertSchema` (optional `tags: [String]` palette, `flow`, `presentation`; at most 500 blocks and 200 answers a question, retired ones included, and no two blocks sharing a key — see the scripted-survey callout below); `assignOptionIds` mints ids for any id-less option, **`applyFlow`** (a POST with `flow: 'script'` is *entering* Script flow — see the scripted-survey callout below), the one-answerable-question check, `validateVisibleIfIntegrity` checks the rule graph, then `canonicalizeTags(…, data.tags)` collapses the palette + every `option.tag` to one case-insensitive casing (see §I), and sets `version: 1`, `createdBy`. **Then `ensureTags(orgId, tags, userId)`** auto-upserts org `Tag` docs (see §I). An empty `questions` array is still accepted (a template is often created blank). |
| `PATCH /admin/surveys/:surveyId` | Update (admin, or a **lead** who passes `canManageSurvey` → else `403`). A body carrying `flow` without `questions` → `400` (*Send the questions with a flow change.*); `presentation` alone is fine (saved, no version bump). The effective flow is `data.flow ?? existing.flow ?? 'list'`, and the save is **entering** Script flow when the stored flow is not `script` and the effective one is. When `questions` are present: if the survey **has responses**, entering Script flow → its own `409 { code: 'survey-has-responses' }` (no `reasons`), and `classifyQuestionEdits` blocks a question type change → `409 { code: 'survey-has-responses', reasons }` (retyping a question into a statement is one). Otherwise `reconcileQuestions` (soft-retire absent items, mint ids for new options; it never re-appends dropped options onto a **statement**), `sizeError` (the same 500-block and 200-answer caps on the reconciled list, which also holds every block and answer the payload left out: the builder sends them all back on the next save), **`applyFlow`** (a questions-only PATCH on a Script-flow template compiles too), the one-answerable-question check, `validateVisibleIfIntegrity`, then `canonicalizeTags(…, data.tags ?? existing.tags)`, apply, and bump `version`. After save, **`ensureTags`** auto-upserts the library (see §I). |
| `POST /admin/surveys/:surveyId/duplicate` | Clone into a fresh template (`name: "<name> (Copy)"`, `version: 1`, `isActive: false`, no campaign link, questions copied verbatim — so roles, titles, notes, links, routes and compiled conditions travel — plus **`flow`**, **`presentation`** and **`tags`**, `createdBy` = caller so a lead can then edit their copy). The three template fields are copied, never defaulted: an uncopied `flow` would leave a scripted copy's compiled conditions reading as hand ones with its routes unfollowed, an uncopied `presentation` would put it back on a single page, and `tags` used to be dropped here. Admin, or a **lead** who passes `canManageSurvey` → else `403` (the answer-type-change escape hatch must work for leads on their campaign's surveys). |
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
> options is non-destructive: history is kept, reports keep counting it. The one exception: dropped
> options are never re-appended onto an incoming **statement** (the transform empties a statement's
> options), so a question retyped into a statement keeps none of its answers, not even as retired
> and tagged ones.

> **The two hard blocks once responses exist** — both `409 { code: 'survey-has-responses' }`, both
> answered with **Duplicate**. (1) `classifyQuestionEdits(old, new)`
> ([services/surveys/diffQuestions.js](../server/src/services/surveys/diffQuestions.js)) walks
> still-present questions (matched by `key`) and returns a reason **only** when a question's `type`
> changed — the stored answer shape can no longer be aggregated. Retyping a question into a
> statement is one (`Question "Why not?" changed type (text → statement).`). The builder mirrors it
> by locking the type control. (2) **Entering Script flow**, a separate check beside it because
> `classifyQuestionEdits` only compares two question arrays: `error` *This survey has responses, so
> it can't switch to Go to routing. Duplicate it to build the scripted version.*, no `reasons`.
> Re-expressing the branching as routes may compile to different rules, so later visits could record
> differently from earlier ones. **Leaving** Script flow is always allowed: "Switch back" stores the
> compiled conditions as hand ones (`switchToList`, §L), so the phone evaluates the same rules and
> recording cannot change. The builder mirrors it by disabling every "then go to" select on a
> Show-only-if survey with responses.

> **Rule-graph validation (on save, after reconcile and compile).** `validateVisibleIfIntegrity(questions)`
> enforces, over the **final** questions (reconciled, and in Script flow compiled, so a compiler bug
> fails loudly as a 400 instead of reaching a phone), that every rule on a non-retired block:
> references a **strictly earlier non-retired** question (forward/self/dangling → error, which also
> makes cycles impossible) that is **not a statement** (a statement has no answer cell: `answered` on
> one is always false and `is_not`/`not_answered` always true, so a rule on it is degenerate); uses
> an op valid for the referenced type (`text` questions support only `answered`/`not_answered`); and
> (for `is`/`is_not`/`any_of`) names `optionIds` that exist on the referenced question
> (retired-inclusive) or the `'__other__'` sentinel when it allows Other. Any violation → `400`. The
> Zod `ruleSchema` additionally requires exactly one `optionId` for `is`/`is_not` and at least one
> for `any_of`. A statement is named by its title or first sixty characters, never its full text
> (`Closing "Close 2" has a condition referencing …`); a question's messages are unchanged.

> **Scripted-survey authoring (2026-10).** Every rule below is enforced on the server; the builder
> (§G) checks the same things live as an early warning, never as the guarantee. **Save order**, POST
> and PATCH alike: zod parse (the per-block `checkBlock` refine, then the `shapeBlock` transform; on
> the questions array, the 500-block cap and `refuseSharedKeys`) → `assignOptionIds` (POST) /
> `reconcileQuestions` then `sizeError` (PATCH) → **`applyFlow`** → the one-answerable-question
> check → `validateVisibleIfIntegrity` → `canonicalizeTags`. `applyFlow` is where the design's
> separate "validate routing" step landed: in Script flow it refuses a hand condition on the way in
> and a script over 200 live blocks, then runs `compileRouting` (§L), whose errors are the route
> checks, and refuses a compile whose conditions hold more than 50,000 answer ids; in List flow it
> refuses a live route. Every cross-field rule lives in the handler rather than a top-level zod
> `superRefine`, because a `ZodEffects` has no `.partial()` and would break the PATCH parser.
>
> | Check | Where | Response |
> |---|---|---|
> | A question's wording over 1000 characters; a statement's read-aloud text over 5000 | `checkBlock` | 400 *A question's wording can be at most 1000 characters.* / *Read-aloud text can be at most 5000 characters.* |
> | `{{` anywhere in a live question's wording or a live answer's text | `checkBlock` | 400 *Placeholders like {{canvasser}} can't go in a question's wording or an answer — they're stored with every answer.* |
> | `{{` in a live statement's `title` or a live block's link label — both show on the phone exactly as typed, never filled | `checkBlock` | 400 *A title can't contain "{{" — placeholders like {{canvasser}} work only in text that is read aloud.* / the same for *A link label* |
> | An unknown or unclosed placeholder in script text (intro, closing, a statement's text, an option `script`, a `note`) — tested as "does any `{{` survive `fillScript`", so this check and the phone cannot disagree | `scriptText()` refine (intro, closing); `checkBlock` (the rest) | 400 *Unknown placeholder {{x}} — the only placeholder is {{canvasser}}.* / *Unfinished placeholder: every {{ needs a matching }} — the only placeholder is {{canvasser}}.* |
> | Any placeholder rule above, on a **retired** block or answer | `checkBlock` | **Skipped**, as in the builder: a retired entry never reaches a phone or paper, its text is already snapshotted on the answers it collected, and the builder sends it back on every save, so a survey whose retired history predates these rules stays saveable. The length caps and the `__` rule still hold for every entry. |
> | `title` over 80, `note` over 2000, more than 5 links, a link label over 120, a URL over 2000 | field refines | 400 naming the cap (*A title can be at most 80 characters.*, *A block can have at most 5 links.*, …) |
> | A link URL not matching `^https?://` (case-insensitive) — `javascript:`, `ftp:` | `linkSchema` | 400 *A link must start with http:// or https://.* |
> | A key or option id starting with `__` | refines | 400 (§A) |
> | More than 500 blocks, or a question with more than 200 answers — retired ones included, in the payload and, on a PATCH, in the reconciled list (an edit stores whatever it leaves out as retired, and the builder sends all of it back next time, so a survey stored over a cap could never be saved again). Without a bound, one request from any lead could stall or crash the server for every org | `upsertSchema` refines; `sizeError` (PATCH) | 400 *A survey can have at most 500 blocks, retired ones included.* / *A question can have at most 200 answers, retired ones included.* |
> | Two blocks sharing a key, live or retired: every reader finds a block by its key, so a statement sharing a question's key would swallow its answers, and the stepper would hold on one screen | `refuseSharedKeys` | 400 *Two blocks share the key "q1".* (naming the key) |
> | `flow` sent without `questions` (PATCH) | handler | 400 *Send the questions with a flow change.* |
> | Live blocks present, none of them answerable | handler | 400 *Add at least one question that records an answer.* An empty array stays allowed. |
> | List flow: a route on a live block, a live answer or a live Other | `applyFlow` | 400 *Go to is only available in Script flow.* Routes on retired blocks or answers are cleared silently (nobody can see or edit them, and a later switch would revive them); an `otherGoTo` is dropped by `shapeBlock` unless the block is a choice question with Other on. |
> | Entering Script flow (stored `list` or absent → `script`; every POST in Script flow) while a live block still carries a `visibleIf` | `applyFlow` | 400 *Remove the Show-only-if conditions before switching to Go to.* Never overwritten: the compiler cannot express `is_not`, `not_answered` or Match ALL. |
> | Already in Script flow: an incoming `visibleIf` on a live block | `applyFlow` | **Ignored and overwritten** by the compile, so a GET → PATCH round-trip keeps working. |
> | Script flow: more than 200 live blocks (checked before the compile), or a compile whose conditions hold more than 50,000 answer ids in all — a continue carries its source's whole condition forward, so the output grows with blocks × branching (the Burton script compiles to 20) | `applyFlow` | 400 *A survey in Script flow can have at most 200 blocks.* / *This script branches too much to save. Split it into two surveys.* |
> | A backward or self route, a route to a removed block, a block nothing leads to, a `goTo` on a choice question | `compileRouting` | 400 `{ error: <first message>, routeErrors: [{ key, optionId?, message }] }` — the messages are in §L |
> | A rule referencing a statement (either flow) | `validateVisibleIfIntegrity` | 400 `… has a condition on statement "…", which is read aloud and has no answer — condition on the answers that led there instead.` |
> | Entering Script flow on a survey with responses | handler | 409 (above) |
>
> **The 400 body changed.** A zod failure used to answer `{ error: 'Invalid input', issues }`
> regardless; `zodErrorBody` now puts the **first custom issue's message** in `error` — every zod
> rule in the table is a custom issue, because team leads author surveys and read these in the
> builder's error block — and keeps `'Invalid input'` only when every issue is one of zod's
> built-ins. `issues` is unchanged. (The handler and `applyFlow` checks answer with their own
> `{ error }` and never went through zod.) The builder (§G) runs the same placeholder checks live,
> on live blocks and answers only, title and link label included, so its warnings and these 400s
> agree. It does not check the size caps or the compile bound; those reach the author only as the
> 400's sentence in the error box under the form.

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

**Statements never appear in results.** The `survey-results` question loop `continue`s on
`isStatement(q)` before building any pipeline, so no card, no tag member and no wasted aggregation
ever exists for one (the web dashboard, the Survey Explorer and the phone's campaign screen all read
that payload); no stored answer row ever carries a statement key (§E); `computeSurveyBreakdowns`
already reads choice questions only, and `publicPointAnswer` returns `null` for a statement as a
guard against a stray stored row.

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

> **Unchanged by scripted surveys — zero bytes in the mirrored body.** The evaluator never reads
> `type`, so a statement is just another keyed block: it is visible when its `visibleIf` holds, and
> it contributes an empty cell (`buildCells` in the runner, §M) that no rule may reference (§B).
> "Then go to" arrows reach the evaluator only as the compiled `any_of` rules of §L, an op every
> shipped phone already evaluates — which is why a phone on an older bundle routes a scripted survey
> correctly. Everything scripted surveys add on top of the visible set lives in the door runner
> (§M): what counts as answerable, numbering, the Save gate, the stepper, and the default-closing
> rule, whose two predicates `isScripted` and `needsClosingGuard` are runner exports, not evaluator
> ones. The three-copy drift guard is untouched. The fixtures gained six scripted cases: a statement
> gated like a question (shown when its condition holds, with an ungated first statement always
> shown; hidden when another answer is picked; hidden while the question is unanswered) and a
> closing block reached from two sources (straight from Q1; through Q2; and with a stale hidden
> answer withheld, so Q2's old pick does not reach it). The scripted paths are also pinned against
> this evaluator by `burtonScript.test.js` and the routing fixtures (§L).

## E. Answer normalization & dropHidden modes

> **Three callers now**, not two: the mobile submit (`dropHidden:true`), the admin in-place edit
> (`dropHidden:false`, preserving recorded history), and the **outcome→Surveyed conversion**
> (`dropHidden:true` — the composer IS the field form, and there is no history to preserve).
> The conversion additionally passes **`rebuildAnswerText:true`**, which runs `snapshotAnswerText`
> to derive the human-readable `answer` from `optionIds` server-side. That flag exists because the
> conversion's writer is a **worker** with no client in the loop — until now nothing server-side
> derived the snapshot; both clients built it before POSTing. It is opt-in rather than always-on so
> the two existing write paths are byte-identical. Side benefit: on that path an `answer` text can
> no longer disagree with its own `optionIds`.


Both write paths funnel through `normalizeAndFilterAnswers(template, rawAnswers, { dropHidden })`
([services/surveys/normalizeAnswers.js](../server/src/services/surveys/normalizeAnswers.js)) so they
**can't drift**. It **never throws / never 400s**:

- Drops rows whose `questionKey` is unknown to the template.
- **Drops rows whose question is a statement** — in **both** `dropHidden` modes, with or without
  `rebuildAnswerText`, for every caller (the mobile submit, the admin edit, the conversion worker,
  and the demo generator in [demoActivity.js](../server/src/services/platform/demoActivity.js)).
  New code, not a side effect of an existing rule: a reached statement is a known, visible key, so
  no other rule here would drop its empty row. Today's clients post none (`buildSubmitRows`,
  §M; the desk composer filters statements out), so this is the backstop for a phone on an older
  bundle — which renders a statement as a numbered card and posts `{ answer: null, optionIds: [] }`
  for it — for an offline replay queued before the update, and for any hand-rolled API call. It is
  what keeps every reader of stored answers (exports, the response detail, the voter profile,
  `answerScope` counts, the conversion manifest) free of statement rows without a filter of its
  own. Pinned by [normalizeAnswers.test.js](../server/src/services/surveys/normalizeAnswers.test.js)
  and, end to end through both write routes, by
  [surveyBlocks.int.test.js](../server/test/surveyBlocks.int.test.js).
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

> ⚠️ **The invariant "every `SurveyResponse` is a field submission" is FALSE as of 2026-08.**
> A response may also be **desk-entered** by an admin converting a door outcome into Surveyed
> ([§K](#k-desk-entered-responses-outcome-conversion)). The discriminator is **`deskEntry`**:
> absent = collected at the door (every row that existed before this change, and every phone
> submission since), present = typed by an admin. Everything else on a desk-entered row still
> describes the ORIGINAL KNOCK — `userId`, `coordinatorId`, `location`, `submittedAt` and the
> pass/turf/effort tags are copied verbatim off the `CanvassActivity` row being converted.
> The `{voterId, passId}` unique index is what makes the "never overwrite a field answer" rule
> enforceable: a desk entry for a voter who already answered that round is SKIPPED, never upserted.

`POST /mobile/voters/:voterId/survey` ([canvass.js](../server/src/routes/mobile/canvass.js)):

- Validates the template exists and matches the campaign (resolving a **per-effort survey override**
  — the door's effort survey wins over the campaign default; see [EFFORTS.md](EFFORTS.md)). That
  resolution now lives in
  [services/surveys/effectiveTemplate.js](../server/src/services/surveys/effectiveTemplate.js) and
  is **shared with the admin conversion tool**, so the two cannot drift — a tool resolving it
  differently would write responses this very route rejects. Resolves
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
| [client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) | The org **Surveys library** — a pure **list + quick-view** page (authoring lives on `SurveyEditorPage`). `StatCard` row (surveys / total responses / in use / drafts), search + `Segmented` **Active/Archived/All** filter (client-side over `archivedAt`), and a `DataTable` with one row per template: name + created date, **Used in** (campaign names *and* `"{campaign} · {walk list}"` override labels from `usedByWalkLists`), **question count — answerable questions only** (`answerableQuestions(activeBlocks(s))` from the runner, §M: retired questions and statements excluded), `responseCount`, version/Archived badge, and a `RowMenu` (⋮) with **Edit / Duplicate / Archive-or-Delete** (Delete only when `responseCount === 0` and unused — the server re-checks). Row click opens the **`SurveyQuickView`** drawer. Owns the `duplicate`/`archive`/`unarchive`/`delete` mutations, all invalidating **`['surveys']`** — the one cache key every survey consumer now shares (EffortsPage/CampaignsPage previously used a divergent `['admin','surveys']`; TagsPage's post-delete invalidation had been silently pointing at that dead key). Back-compat: `/surveys?attachTo=<id>` redirects to `/surveys/new?attachTo=<id>`. |
| [client/src/components/SurveyQuickView.jsx](../client/src/components/SurveyQuickView.jsx) | The row-click **quick view**, built on the design-system `ui/Drawer` (right-side slide-over). Sections: version + In use/Draft/Archived badges; created/updated dates + question count (answerable blocks only, with "· N statements" beside it when the survey has any); **Used in** — campaign defaults and walk-list overrides, each linking to `/campaigns/:id?survey=<templateId>` (the dashboard deep-link); **Responses** — org-wide total + the per-campaign split from `responseCountByCampaign` (null-campaign bucket labeled, never linked); a `SurveyPreview` of the questions; and a sticky action bar — **Edit survey** (→ `/surveys/:id/edit`), **Duplicate**, and **Delete** (confirm; only when unused) or **Archive/Unarchive**. Surfaces a delete `409`'s `reasons[]` if one races through the client-side gate. **View full results →** renders one link per campaign in the union of current attachments and campaigns with responses. |
| [client/src/pages/SurveyEditorPage.jsx](../client/src/pages/SurveyEditorPage.jsx) | The **dedicated org builder host** — routes `/surveys/new` and `/surveys/:surveyId/edit` (both in the `requireOrgAdmin` group). Renders the shared `SurveyForm` from [components/SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx) (`QuestionCard`/`OptionRow`/`ConditionEditor`; derives question `key` via `deriveKey` and option `id` by slugify-with-collision-suffix, minted once and held immutable; per-option **read-aloud script**, **Other (specify)**, **Show only if…** with live `ruleError` validation mirroring the server, and the scripted-survey blocks and controls described in the next row; on a survey with responses the **type** control locks (and, on a Show-only-if survey, every **then go to** select) and removals soft-retire with **Restore**; surfaces the PATCH `409 reasons` and, through its existing error block, every server 400's plain-English `error`). Loads the org tag library (`['admin','tags']`) for the `TagPicker`, same as the in-campaign builder. Edit mode finds its survey in the cached `['surveys']` list (no single-survey GET; load errors render instead of silently bouncing). Two hand-off flows on the create route: **`?attachTo=<campaignId>`** — create → `PATCH /admin/campaigns/:id { surveyTemplateId }` (campaign default) → back to that Survey tab; **`?assignEffort=<effortId>&campaignId=<id>`** — create → `PATCH /admin/campaigns/:id/efforts/:effortId { surveyTemplateId }` (walk-list override) → back to that Survey tab. Plain visits return to `/surveys`. No `refusalOption` UI. |
| [client/src/components/SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx) + [client/src/lib/surveyBuilderRules.js](../client/src/lib/surveyBuilderRules.js) | The builder (`SurveyForm`), shared by the org editor and the in-campaign builder. **The rules live in `surveyBuilderRules.js`** — pure, pinned by `node --test` ([surveyBuilderRules.test.js](../client/src/lib/surveyBuilderRules.test.js)) — and the component wires them. Block palette **+ Add question / + Add statement / + Add closing** (`BLOCK_KINDS`; a statement is never one of `QUESTION_TYPES`, so it is never retyped); `StatementCard` (badge *Statement* or *Closing*, **Read aloud** textarea = `label`, optional **Title**; no number, Required or Other); `BlockExtras` on every card (**+ note to canvasser (not read aloud)** in an info-tinted box, **+ link** rows up to `MAX_LINKS` = 5). `RouteSelect` (**then go to →**: *Continue to next block (‹target›)* from `continueLabel`, every later live block from `routeTargets`, *End the conversation*, and a stored route it no longer offers shown as what it is via `staleRouteLabel`) sits on every answer, the Other row and a text question **in both styles** — setting the first one is how a survey enters Go to — and on a statement or closing in Go to only; it is disabled while `locked && flow !== 'script'`, its tooltip `routesLockedHint(duplicateAt)` saying where Duplicate is on this page (`SurveyForm`'s `duplicateAt` prop: `DUPLICATE_IN_LIST`, "from the survey list", by default; "at the top of this page" from the in-campaign builder; the locked banner says the same). State: `flow` (`flowOf`, absent → `list`; reset with the form; sent on save), `presentationChoice` (the admin's own tick or untick, `null` until they make one; reset with the form) and `questions` loaded through `questionsForEditing` (drops the stored compiled `visibleIf` in Script flow, drops a route on a choice question itself, clears every route on a List survey so a Restore can't revive one). `entersScript` flips `flow` to `script` on the first route (the blue banner); **One block per screen** is `autoPresentation({ loaded, questions, flow, choice })`, worked out on every render and never latched: the admin's choice once they make one; otherwise `steps` when the blocks as Save sends them (`blocksAsSaved`) read as a script — the compiler's `isScripted(questions)`, a live statement or arrow — and the survey as opened (`loaded`, `null` for a new survey) did not; otherwise the stored value. The checkbox shows it and Save sends it, so a statement added and removed again leaves an existing single-page survey on its single page. `surveyIssues` recomputes every live check on each change: `scriptTextError` (intro, closing, statement text, option scripts, notes), `plainTextError` (`{{` in a question label, an answer, a **title** or a **link label** — the server refuses all four too), `linkError` (a label with no address is an error, a wholly blank row is dropped by `cleanBlock`, spaces are refused, and `https?://` matches in any case, as on the server and the phone), `ruleError` (List flow; a statement is never a valid target) or `handRuleError` (Script flow: a leftover hand condition, shown with **Remove condition**), the compile preview `previewRouting` and `branchingWarning` on a non-required branching question, both over `blocksAsSaved` — the blocks exactly as `cleanBlock` will send them, so an arrow on an answer with no text yet, which Save drops, counts nowhere, as on the server (errors mapped onto the card, the answer or the Other row; stand-in keys for keyless cards) — and `NO_ANSWERABLE`, on the server's rule (live blocks, none answerable: a survey whose every block is retired still saves). `hasBlockingIssues` gates Save (warnings never do); `emptyIssues` waits for a Save attempt, whose blank-field marks are remapped when a card is removed or retired, swapped when one moves and cleared when the form resets, and a card shows one only while a fresh `validate()` still finds it, so the footer never claims an error that isn't on screen. In Go to, cards show **Reached when …** (`reachedWhen` → `formatVisibleIf`) and **Continues to: …** (`continuesToName`, on blocks the compile shows with an implicit exit; `text-fg-muted`, as is the select's label). Removing or retiring a route target runs `repointRoutes` (routes into it back to Continue, a one-line notice with the count). **Switch back to Show only if** runs `switchBack(questions, loaded)`. On a survey stored in List flow (`switchBackUndoes(loaded)`: its arrows were never saved) it is an undo: every route cleared and each live block given back the condition it was opened with, by key (none for a block added since); never refused, never confirmed. On a new survey or one stored in Script flow it converts through `switchToList` (§L): refused with the compiler's first message while one stands (the banner shows the first arrow error until none is left; one that turns up after that never reads as a refusal), and a `window.confirm` on a survey with responses, which can't return to Go to once saved. Either way a leftover hand condition is kept rather than the restored or compiled one. `blankStatement` starts a new closing on End in Go to. Save sends `cleanBlock` output — a statement with no options and never required, routes as `null` or a key, no `visibleIf` at all in Script flow — plus `flow` and `presentation`. `displayNum` and `countLabel` number and count answerable blocks only ("N questions · M statements", retired blocks excluded). |
| [client/src/components/WalkListSurveySelect.jsx](../client/src/components/WalkListSurveySelect.jsx) | The **one** walk-list survey-override picker, shared by `CampaignSurveyPage` and `EffortsPage` so the archived-hiding rule lives in a single place: first option **"Campaign default"** (`''` → `onChange(null)`), then `surveys.filter(s => !s.archivedAt \|\| String(s._id) === current)` — an effort already pinned to a now-archived survey keeps its option (labeled `· archived`) instead of silently reading "Campaign default". A stale/unknown id renders an "Unknown survey" option rather than crashing. |
| [client/src/components/TagPicker.jsx](../client/src/components/TagPicker.jsx) | The per-option tag combobox used by the survey builder's `OptionRow`. Filters the org `tags` prop case-insensitively; selecting an existing tag is the default. The **"Create '…'" action** appears only when nothing matches **and `onCreate` is provided** — so when the builder withholds `onCreateTag` (a **team lead**, since `POST /admin/tags` is admin-only) it becomes pick-only and the placeholder drops "or create one". Renders a selected tag as a clearable chip. |
| [client/src/pages/TagsPage.jsx](../client/src/pages/TagsPage.jsx) | The **org-level Tags management page** (route `/tags`, an `ORG_NAV` entry — [navItems.js](../client/src/components/navItems.js)). Lists every org `Tag` from `GET /admin/tags` with a `usageSummary` ("on M options, across N surveys, K saved searches"), plus search. **Create** (`POST /admin/tags`), inline **Rename** (`PATCH /admin/tags/:id`; a `409 { code: 'tag-exists' }` surfaces a **"merge into it"** button targeting the clashing `tagId`), **Merge** (`POST /admin/tags/:id/merge { targetId }` via a target picker), and **Delete** (`DELETE /admin/tags/:id` behind a usage-aware `confirm`). Delete also invalidates `['surveys']` since the builder reads tagged options. |
| [client/src/pages/CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) | In-campaign **Survey** tab (`/campaigns/:campaignId/survey`) — the **coverage view**. Header holds a top-level **New survey** button (→ `/campaigns/:id/survey/new`). Section 1: the **main survey card** (badge `Default`, `SurveyPreview` behind a **Preview** toggle collapsed by default so the walk-list table stays above the fold, **Change survey** / **Edit survey** → `/campaigns/:id/survey/edit`) whose response count is the **coverage count** (`intakeResponseCount + Σ responseCount` of no-override efforts — see §B), not the template's org-wide total. Section 2: the **Walk list coverage** `DataTable` — per effort: status badge, doors, a `WalkListSurveySelect` wired to `PATCH …/efforts/:id { surveyTemplateId }` (invalidates `['admin','efforts',campaignId]`, the same key `EffortsPage` reads), its `responseCount`; an **Intake** row appears when null-`effortId` responses exist. A `?created=<id>` param (set by the builder after creating a survey that isn't the main) shows a dismissible "assign it to a walk list" banner. States: no default + overrides → warning; no walk lists → pointer to the Walk Lists page; **lit-drop** unchanged. **Authoring affordances (New/Edit) gate on `canManage` = `isOrgAdmin || managedCampaignIds.includes(campaignId)`** — so campaign-managing **leads** author too; the server (`canManageSurvey`) is the real scope gate. Attach/change = `PATCH /admin/campaigns/:id { surveyTemplateId }`; the Change-survey picker hides archived templates unless attached. |
| [client/src/pages/CampaignSurveyBuilderPage.jsx](../client/src/pages/CampaignSurveyBuilderPage.jsx) | **In-drill-in survey builder** (`/campaigns/:campaignId/survey/new` and `/survey/edit`) — **now in the console route group, so campaign-managing leads reach it** (was admin-only). Renders the shared `SurveyForm` inside the campaign so authoring never bounces to the org list. **New (conditional attach):** `POST /admin/surveys`, then **attach as the campaign default only when it has none yet** (`!campaign.surveyTemplateId`) — a new survey never silently replaces the main; either way it returns to the Survey tab with `?created=<id>`. **Edit**: `PATCH /admin/surveys/:id`; when the template is **shared by other campaigns** (for a lead, also the bare `usedElsewhere`) it warns, and when it **has responses** — so a question's answer type or a switch to Go to needs a copy — it says what Duplicate does; either way the box at the top offers **Duplicate** (`POST …/duplicate`, then attach the copy as this campaign's default), with a line to do it between shifts (a phone still on the old survey has its saves refused and dropped) and the error when it fails. It works for leads too — `canManageSurvey` permits editing/duplicating a survey attached to their managed campaign — and a lead has no Surveys list, so this box is their Duplicate; `SurveyForm` gets `duplicateAt="at the top of this page"` for its hint and locked banner. Loads the org tag library; passes `onCreateTag` **only when `isOrgAdmin`** so leads pick existing tags but the "Create tag" affordance is hidden (`POST /admin/tags` is admin-only). |
| [client/src/components/SurveyPreview.jsx](../client/src/components/SurveyPreview.jsx) | Read-only render of a template, used by the library quick view and the campaign Survey tab's **Preview**. Once the survey has a live block, an **Overview \| Try it** `Segmented` switch sits above it. **Overview**: intro · blocks sorted by `order` · closing; choice options as radio/checkbox glyphs, text as a placeholder; **filters out retired blocks and retired options** — the preview shows what canvassers actually see in the field. The Overview numbers every active answerable block (`questionNumbers` over the non-retired blocks), so a statement takes no number and its Q numbers match the builder and paper; the phone and Try it number the visible path instead, so on a conditional path the two can differ, as §M says. A statement or closing renders as the italic read-aloud paragraph under a *Statement* or *Closing* caption ("· ‹title›" appended when it has one; an untitled block gets the bare caption). Every gated block carries a grey **Shown when …** line (`formatVisibleIf` with prefix *Shown when*, over `buildConditionIndex`); each answer's read-aloud script now renders under it ("Read aloud: …"); a note renders in an info box captioned *Canvasser note · not read aloud*, and links as anchors (http(s) only, re-checked here; anything else stays plain text). The template closing is captioned *Closing — when no closing block applies* once any closing block exists. `{{canvasser}}` is filled with the **viewer's own** `user.firstName` (the blank line when they have none). **Try it** (`SurveyTryIt`, exported for the smoke test) walks the **client mirror of the door runner** (§M): with `presentation: 'steps'` one screen at a time (progress bar; **‹ Back** / **Skip** / **Next**, Next disabled on a blank required question; the end screen's default closing via `showDefaultClosing`; *Done — nothing is saved.* and **Start over** on the last screen), otherwise the live single page (`ScrollTryIt`: only the reached blocks, the guarded default closing, *Answer Question N to finish.*). A tap selects and never moves the cursor; Skip computes the next screen from the new answers (`skipAnswer` → `nextScreenId`). Answers live in component state; nothing is ever saved. A survey with no statements, conditions, option scripts, notes or links renders exactly as before ([surveyPreviewRender.smoke.test.js](../client/src/lib/surveyPreviewRender.smoke.test.js) pins it against a frozen copy of the old render). |
| [client/src/lib/surveyVisibility.js](../client/src/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded) — read by the desk composer and the voter-page editor (`surveyAnswerForm.js`), and by the client door-runner mirror (`surveyRunner.js`) behind the preview's Try it. |
| [client/src/lib/surveyRunner.js](../client/src/lib/surveyRunner.js) · [surveyRouting.js](../client/src/lib/surveyRouting.js) · [surveyScriptText.js](../client/src/lib/surveyScriptText.js) | Byte-identical mirrors (below the `// ==== BEGIN MIRRORED BODY ====` marker) of the door runner (canonical on mobile), the "then go to" compiler and the `{{canvasser}}` filler (canonical on the server) — see §L and §M for what each owns and which test guards each copy. The builder compiles live with the routing mirror so its "Reached when" lines match what the server stores; Try it walks the runner mirror so it steps exactly like the phone. |
| [client/src/lib/surveyConditionText.js](../client/src/lib/surveyConditionText.js) | **One plain-English wording for a gate**, shared by three surfaces that each pick only a prefix and a text transform: paper (`Only if`, with `asciiSafe`), the builder (`Reached when`) and the preview (`Shown when`), so no two surfaces word one gate differently. Lifted out of the print model; a screen never gets `asciiSafe`, which drops what jsPDF's cp1252 faces cannot print (a non-Latin option label would come out blank). `formatVisibleIf(question, index, { transform, prefix })` follows the evaluator, not the builder's controls: `any` joins clauses with "or", anything else with "and", and `is`/`is_not` name only the first option id. `buildConditionIndex(questions, { numberAnswerableOnly = true })` numbers answerable blocks only (statements take no Q number) while `byKey` keeps every keyed block, retired ones and statements included, so a rule naming one still reads by name — a statement by its title, else its first sixty characters. Tests: [surveyConditionText.test.js](../client/src/lib/surveyConditionText.test.js). |
| [client/src/pages/CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) | Survey-template dropdown (in `components/campaigns/CampaignFormDrawer.jsx`) shows a heads-up when the chosen survey already has responses (repointing reports new answers separately). Hides **archived** templates unless attached — anchored to the survey attached **when the drawer opened**, so deselecting an archived one mid-edit doesn't make it vanish from the options. |
| [client/src/components/QuestionResults.jsx](../client/src/components/QuestionResults.jsx) | Per-question result charts from `survey-results` (retired/legacy buckets included). **Row layout (2026-08-10): one line, intrinsic widths.** `OptionRow`/`TagRow` were `grid-cols-12 gap-3` split 4 label / 6 bar / 2 numbers. That failed for two compounding reasons: the tracks were fixed **proportions**, and the eleven gutters cost a flat **132px at every width** — so in a 568px card the label got ~168px (≈22 chars, hard-truncated) while the numbers needed more than their own 78px cell and painted over the bar. Now one `flex items-center gap-3` row: chevron, then the label as the **sole `flex-1`** (`line-clamp-2 min-w-0`, no `truncate` — it wraps rather than truncating, and only past ~66 chars at a 780px card), then the `Retired` `Badge`, then an `h-2 w-24` bar, then `min-w-[3.5rem] shrink-0 text-right tabular-nums` tracks for the percent and count. Because the label is the only flexible item, the bar and numbers land on the same x in every row — that, not a grid, is what makes the percentages a column. Row padding is `px-2 py-1.5` → **32px**, the tight end of the console's range (cf. `BookAssignmentPanel.jsx:402`, `OrgBillingPanel.jsx:629`).
> **The bar is a fixed 96px column, and web diverges from mobile here on purpose.** `docs/ADMIN_APP.md` records mobile's rule that `RowBar` always takes full row width because a squeezed proportional bar loses data — that is an inset-group idiom for ~44px touch rows. A web results card is scanned in bulk, and an earlier pass at this (label on one line, full-width bar on a second) cost 50px per option and made the section unreadable at two cards per screen. The web precedent for an inline fixed-width bar beside a printed number already exists: `campaigns/CampaignsTable.jsx:67` (`h-1.5 w-16`), `CoverageBar.jsx:33` and `PassManager.jsx:29` (`h-2 w-40`). **Do not "restore" the full-width bar here.** Track is **`bg-border`** not `bg-sunken` (per [THEMING.md](THEMING.md) — sunken-on-card is 1.10:1 light / 1.04:1 dark), fill is **`bg-brand-600`** not `bg-brand-500` (500 is the fixed ramp's *danger* step), and the fill carries a **3px `minWidth` floor conditioned on `count > 0`** — a px floor, not a percentage floor, so it rescues sub-pixel bars without distorting small values, and a true zero still paints nothing. A retired row keeps a **full-strength label** and lets the `Retired` `Badge` carry the state — the old `opacity-50` on the whole row measured 1.98:1 on the label and 1.50:1 on the chip (its bar goes `bg-fg-muted`, not `bg-fg-subtle`, which would sit ~1.9:1 against the track and read as empty). Row children are **`<span>`** — a `<button>`'s content model is phrasing content. Both disclosure rows carry `aria-expanded`; the caret is `IconChevronRight`, not a `▸` text node the screen reader announced. The card root is `flex h-full flex-col`, with the hint footer on `mt-auto` so a card stretched to a tall row's height reads as deliberate. The header is **one wrapping line** — `flex flex-wrap items-baseline justify-between` with the `h3` on `min-w-0 flex-1 basis-48` and the meta chip `shrink-0`, so the chip drops to its own line only when it truly cannot share. (It was briefly stacked instead; that fixed the starving but cost every card a line. The starving was never caused by sharing the line — it was `shrink-0` against a title with no width floor.) Both headings here moved to **`text-sm font-semibold`**: the bare `font-medium` they used to carry made them the only in-card headings in `client/src` still inheriting 16px from body. The counting caveat moved from a hover-only `title=` into an **`InfoHint`**, whose 16px trigger fits the `text-xs` line box without growing the row. A **`text`** question's header no longer claims "N answered": those options are the server's `$limit: 10` top-ten, so it reads **"top 10 answers"** (or "N distinct answers" under ten) — see §C. Exports **`TagResults`** — the **"Tags"** panel: one `TagRow` per `tags[]` entry showing **both voter units** ("N voters · M current"; the bar stays scaled to identified — current is text only, since these are counts, not shares; `currentVoterCount` absent from an old server renders nothing rather than a fake 0), contributing options labelled "(N answers)" (response-unit, said out loud), expandable to `TagDrill` — the **`TagTeamTable`** ([TagTeamTable.jsx](../client/src/components/TagTeamTable.jsx), the first-finder by-team split from `/tag-teams`, §I) plus an inline `VoterList` that drills via `voters-by-answer?tag=<tag>&surveyTemplateId=<id>` and opens with **its own unit line** ("N entries — one per round…"). `TagResults` also takes `onTagClick` — the Survey Explorer passes it so a row click deep-links to `?tag=` instead of expanding inline. Each expanded option/tag hosts the **answer drill-in** (`OptionDrill`/`TagDrill` — canvasser filter, Voters \| By-canvasser toggle, enriched rows, response drawer, Open-full-view link) — see §J. All drills thread `passId` (the Dashboard round picker). |
| [client/src/pages/SurveyExplorerPage.jsx](../client/src/pages/SurveyExplorerPage.jsx) | The **Survey Explorer** — the full-page answer drill-in/audit workspace (`/campaigns/:campaignId/explorer`). Filters, headline stats, voters + by-canvasser tables, mini map, CSV export. Full spec in §J. |
| [client/src/pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Renders the **Survey results** section. **Card grid (2026-08-10):** `[grid-template-columns:repeat(auto-fit,minmax(min(100%,34rem),1fr))]`, **not** `lg:grid-cols-2`. `lg:` is a *viewport* query while the cards live in `viewport − sidebar − 48px`, and the sidebar width is a localStorage preference (`sidebarCollapsed`) no media query can see — solving `V − 288 = (V − 304)/2` shows the two-up card was **narrower than the one-up card at every viewport below ~1774px**, so widening the window past 1024px truncated labels *harder*. **No full-row span.** One was tried the same day — an arbitrary grid-column span for questions above six options — and it was reverted: auto-placement left the half-row beside the preceding card empty, and stretching the tallest card across the full width made it taller still. With one-line option rows the height spread between cards is small enough that a row sized to its tallest member is fine. (`grid-auto-flow: dense` would close such a hole by pulling a later question forward, and is rejected on different grounds: survey questions are deliberately ordered.) A footnote worth keeping: that span's class string survived in the emitted CSS until it was removed from a **code comment** too — Tailwind's scanner is a regex over raw file text and does not parse JS, so a class named in a comment is still generated. `QuestionResults` is the grid item **directly** — the old per-question wrapper `<div>` existed only to populate `questionResultsRefs`, a ref map written on every render and **read nowhere** (deleted), and because the wrapper (not the card) was the grid item, `align-items: stretch` never reached the painted `bg-card` box, so bottom borders in a row never lined up. A **survey switcher** appears in the section header when the campaign has answers under a survey other than the one currently attached: `GET /admin/reports/surveys?campaignId=` now returns **every** survey with responses for the campaign (each row flagged **`current`**, current-first), and picking a past one re-queries `survey-results` with that `surveyTemplateId` and shows a "no longer attached" note — so a swapped campaign's old answers are one click away, never hidden. Accepts a **`?survey=<templateId>` deep-link** (the Surveys quick-view's results links): seeds the switcher (the *current* survey's id normalizes to `''`) and scrolls the section into view once both the switcher list and the campaign are known; per-campaign selections (template/effort/canvasser/pass) **reset when `:campaignId` changes**, since the sidebar campaign switcher re-renders the same mounted page. The section header also carries a **round picker** (`surveyPassId`: `''` \| Pass `_id` \| `'legacy'`) fed by the shared **`useRoundOptions`** hook ([lib/useRoundOptions.js](../client/src/lib/useRoundOptions.js) — sourced from `GET /admin/campaigns/:id/passes` + `legacyResponseCount`, NEVER from knocks-by-pass rows: picker options must not depend on the filters they set, and the legacy bucket must key on null-pass RESPONSES; same labels as the Explorer's picker by construction; polled under HOME_POLL per the Live-pill contract). The pass is cleared on effort switch (a pass belongs to one walk list) and threads into `survey-results`, `<TagResults>`, and every `<QuestionResults>` drill. Renders `<TagResults>` above the per-question charts when `surveyResultsQ.data.tags` is non-empty, passing `surveyTemplateId` for the tag drill. (Mobile's campaign screen keeps its knocks-by-pass-derived chips — a documented divergence.) |
| [client/src/components/AnswerFilters.jsx](../client/src/components/AnswerFilters.jsx) | The saved-search / targeted-round answer-filter chips. Beyond per-question `answerFilters`, it renders a **"By tag"** chip row from the `tags` palette prop (falling back to the case-insensitive union of option tags) and emits selected tags to the parent via `onTagChange` as **`answerTagFilters: [{ tag }]`** (case-insensitive, display-cased). |
| [client/src/pages/WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) | Saved-search builder. Wires `AnswerFilters` with `tags={surveyTags}` (from `survey-results` `tags[]`) + `answerTagFilters` into the filter (sent to `resolveWalkList`). Per saved search, **Export CSV** (`exportCsv`) does an **authenticated blob download**: `fetch` the export endpoint with `Authorization: Bearer` + `X-Org-Id` headers, read `res.blob()`, then click a synthetic `<a download>` (filename from `Content-Disposition`). |
| [client/src/components/CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx) | A canvasser's individual responses (shows template `version`). |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | The at-the-door form, in **two presentations that share every piece of logic** through [mobile/lib/surveyRunner.js](../mobile/lib/surveyRunner.js) (§M): `visibleBlocks` recomputes the visible list live as answers change; `questionNumbers`, `progress` and `requiredPending` run over visible **answerable** blocks; `showDefaultClosing` decides the default closing; Save posts `buildSubmitRows` (`{ questionKey, questionLabel, answer (snapshot), optionIds, otherText }` per visible answerable question — never a statement row; required-validation over **visible** questions only, as before); offline queue + optimistic recolor via `optimisticSubmit`, and `router.dismiss(2)` unchanged. Renders single/multiple/text, inline **option scripts** on the picked option, the synthetic **`__other__`** choice with a "Please specify" box; a statement or closing as `StatementBlock` (the amber `scriptBlock`, captioned *Read aloud* or *Closing*, "· ‹title›" appended when set, body in the 18/26 `scriptBody` on both presentations); each block's note and links through `SurveyNoteAndLinks`, beneath the block (for a question, beneath its card); every script text through `fillScript` with `bootstrap.user.firstName`. **Single page** (`presentation` absent or `'scroll'`): the old screen with the blocks woven in, "Question X of Y · N% Complete", the note box and **Save Response** at the end. On a scripted survey only (the runner's `isScripted`), a block a tap reveals is scrolled into view only when its top lands in the bottom quarter of the viewport or below, then parked a third of the way down (a ScrollView ref, a per-block `onLayout` y-map and a visible-keys diff), and never while a `TextInput` is focused (`TextInput.State.currentlyFocusedInput()`); every other single-page survey never scrolls on its own, as before. **One block per screen** (`'steps'`): a cursor — a screen id in component state, not a route per block, so the stack depth `dismiss(2)` relies on is unchanged, read only through `clampScreenId`, and set to the clamped screen during render whenever the two differ (a template refresh), so an answer is never measured from a vanished block — over `screens()`: the opening (*Greeting*, 18/26) only when the intro has text, one screen per visible block (the question in 18px, no badge), then the end screen (the default closing in 18/26, or *Done — end of the survey.*) unless the last visible block is a closing. A docked footer inside the `KeyboardAvoidingView` holds **Skip** (`canSkip`; clears through `skipAnswer`, the next screen computed from the new answers) and **Next** (`canAdvance`; disabled on a blank required question) or, on the save screen (`saveScreenId`), the note box above and **Save Response** — replaced by an outlined **Answer Question N to finish** that jumps there when `requiredPending` finds a blank required question behind the cursor (a template refresh mid-walk). Progress reads "Question N" on question screens only, no "of M". The header **‹ Back** steps back (`prevScreenId`) and exits on the first screen; Android's hardware back does the same through `BackHandler`, registered in `useFocusEffect` and removed by its cleanup. Back, Next, Skip, Save and the jump ignore a press within **400 ms** of the last step (`STEP_GUARD_MS`; a negative gap, the clock set back, never counts), so a double-tap's second touch can't land on the next screen's control; each step also dismisses the keyboard and starts the new screen at its top. At mount, before any answer, at most **one** confirm per visit: the cross-canvasser re-survey prompt ([resurvey.js](../mobile/lib/resurvey.js)), else the door-change prompt (`changePrompt` kind `survey` → `buildChangePrompt`, [doorChange.js](../mobile/lib/doorChange.js)), checked once, the first time the door is known, so a teammate's delta can never pop it mid-survey; a DNC voter's wall suppresses both. |
| [mobile/lib/surveyVisibility.js](../mobile/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded) — read only by `mobile/lib/surveyRunner.js`; the screen never imports it directly. |
| [mobile/lib/surveyRunner.js](../mobile/lib/surveyRunner.js) · [mobile/lib/surveyScriptText.js](../mobile/lib/surveyScriptText.js) | The **canonical** door runner (its client copy is the mirror) and the phone's mirror of the `{{canvasser}}` filler — §M. |
| [mobile/components/SurveyNoteAndLinks.jsx](../mobile/components/SurveyNoteAndLinks.jsx) | A block's canvasser note and links, drawn under a statement, a closing or a question's card on both presentations, so the two can never present a note differently. The note: an `infoBg` well with a 4pt `info` left rule, the label *For you — not read aloud*, text in the new **`infoFg`** token ([theme.js](../mobile/lib/theme.js): `#1E40AF` light, 7.15:1 on `infoBg`; `#93C5FD` dark, 8.63:1 — raw `info` on `infoBg` measures 3.01:1 in light). Everything read aloud is amber, so a note can never pass for script. Links: `InsetGroup` action rows labelled with the link's label, else its host ("example.org"); http(s) only (anything else, from an older template, is dropped rather than handed to the OS); opened only on a tap with `Linking.openURL(url).catch(() => {})` — never `canOpenURL`, never prefetched or previewed, nothing appended to the URL (the two conditions that keep a link out of the privacy policy). No QR, by ruling. Renders nothing when the block has neither. |
| [client/src/lib/packet/surveyPrintModel.js](../client/src/lib/packet/surveyPrintModel.js) + [packetPdf.js](../client/src/lib/packet/packetPdf.js), payload from [buildPacket.js](../server/src/services/packet/buildPacket.js) | The walk packet's survey ([WALK_PACKETS.md](WALK_PACKETS.md)). `toPrintableSurvey` (server; a field-level picker over a lean read, every absent field read as its default) now also carries the template's `flow`, each block's `role` (type checked first), `title`, `links` (URL-bearing only) and `goTo`/`otherGoTo`, and each option's `goTo` — **never `note`**: canvasser notes never print (owner ruling). Statements stay in `questions`, in place. `buildSurveyPrintModel` numbers the **answerable** blocks only (a statement never prints beside a door) and builds the ordered `script` sequence for the **What to say** page: the opening; each statement and closing **once**, under its *Only if …* gate (`formatVisibleIf` with `asciiSafe`), its links as "Label: URL" (only a statement's or closing's: a question's links ride in the payload but never print) and, in Script flow, where it goes next; each answer's read-aloud line; then the template closing, captioned *Closing — when no closing block applies* once any closing block exists (`closingIsFallback`). `scripts` (answer lines only) keeps its old shape. In Script flow every answer of a branching question prints its arrow (`-> Q4`, `-> Close 2` — an untitled statement by its quoted first words — or `-> End`), a non-branching question prints one only when it doesn't simply continue to the next question on the page, and the List-flow skip hints are not computed; List flow keeps its skip hints and prints no arrows. `{{canvasser}}` prints as `______` (`fillScript` with no name). The dormant `refusalOption` still prints its muted "Refused" bubble, with no arrow. `drawScriptPage` prints the sequence, and its page gate now tests `script.length`, so a script of statements alone still earns the page. Fixed in passing: text continuing past a page break on that page printed in the footer's small grey type, because the new page's band and footer leave that face set; the wrapper now restores the face after every break (a statement can run to 5000 characters, longer than a page). |

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

> **The drill hands off to the remedy:** an option drill's header offers **Correct in Door
> Outcomes** (org admins), carrying the question, option, template, and the drill's own
> canvasser/walk-list/round/date scope as deep-link seeds.
>
> **This section's matching contract has a fourth consumer:** the Door Outcomes page's
> survey-answer filter ([CAMPAIGNS.md](CAMPAIGNS.md) Part 2,
> [`answerScope.js`](../server/src/services/canvass/answerScope.js)) inherits the dual-read
> (option id OR legacy text), the `__other__` sentinel rule and the template scope verbatim via
> `answerFilterClause`/`answerTagClause` — it selects the ACTIVITY rows to rewrite, where these
> endpoints select responses to read.

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

**Statements never appear in a drill.** They get no `survey-results` card to drill from (§C) and no
stored answer row to match (§E), so every endpoint above reads answerable questions only; the
voter-profile snapshot and the desk-entry conversion payloads drop them too (`isAnswerable`).

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

## K. Desk-entered responses (outcome conversion)

**Service:** [services/canvass/surveyConversion.js](../server/src/services/canvass/surveyConversion.js).
**Run doc:** [models/SurveyConversionRun.js](../server/src/models/SurveyConversionRun.js).
**Worker:** [services/canvass/conversionProcessor.js](../server/src/services/canvass/conversionProcessor.js)
on `QUEUE_NAMES.OUTCOME_CONVERT` (concurrency 1). **Routes:** eight, all on
[routes/admin/campaigns.js](../server/src/routes/admin/campaigns.js) under
`/:campaignId/survey-conversions`, all behind `loadForReclassify` (**org admins only**).
**Test:** [surveyConversion.int.test.js](../server/test/surveyConversion.int.test.js) (34 tests).

### Why this is a sibling of `reclassifyOutcomes.js`, not part of it

That module refuses `survey_submitted` in both directions, and its stated reason is correct **for
itself**: a bare `actionType` flip into Surveyed fabricates answers nobody gave, and out of it
orphans answers somebody did. The refusal is about missing machinery, not about the act being
impossible. This module funds it — an admin supplies real answers, every created row is stamped,
and the reverse direction archives. The plain reclassify path keeps refusing, and that refusal is
now precise rather than blanket. `lit_dropped` stays unconvertible in both modules.

Structurally it also could not merge: `reclassifyOutcomes` rests on "a conversion is a pure
`actionType` flip with no second ledger", which is what makes `RATE_NEUTRAL_OUTCOMES` provable, the
whole-outcome fold unbounded, and revert four lines. What IS shared (exported from that module, not
re-typed): **`convertibleMatch`** — the two provenance rules (`via: {$ne:'bulk'}`,
`reclassified: {$exists:false}`) — plus `computeImpact` and `CONVERTIBLE_SOURCES`.

### Provenance: one stamp, three artifacts

- **`CanvassActivity.reclassified`** gains `kind` (`'outcome'` | `'to_survey'` | `'from_survey'`)
  and `voterIdWas`. Deliberately the SAME field rather than a parallel one: a second stamp would
  leave a desk-surveyed row still matching `reclassified: {$exists:false}` and therefore eligible
  for a plain reclassify on top of itself — exactly the compounding the single-level rule forbids.
  `revertReclassify` is scoped to `kind ∈ {null,'outcome'}`.
- **`SurveyResponse.deskEntry.runId`** — what a forward revert deletes.
- **`SurveyResponseArchive.conversionRunId`** — what a reverse revert restores.

The poll route additionally returns, for an **open** queue session, both `doorsRemaining` (the
frozen selection minus the rows already stamped) and the run's **frozen template** — one call, so a
session survives a cold page load. The template is read from `run.surveyTemplateId` rather than
re-resolved from the selection: re-resolving would let a walk list re-pointed mid-session silently
change the questions half-way through.

No run doc carries an id manifest: 25k entries × ~2 voters ≈ 50k responses. Revert is a **sweep by
stamp**, which is exact by construction, bounded in memory, and correct for a half-finished job.

### What is copied off the knock, and the two traps

`userId`, `coordinatorId`, `location`, `distanceFromHouseMeters`, `submittedAt` (= the row's
`timestamp`), `wasOfflineSubmission` and `passId`/`turfId`/`effortId` all come **verbatim off the
`CanvassActivity` row**. `editedBy`/`editedAt` stay `null` — the response was *authored*, not edited.

1. **Never call `resolveAttribution`.** It resolves against currently-ACTIVE passes, so it would
   re-home a months-old knock into today's round.
2. **Never call `coordinatorForWrite`.** It would stamp the door with the ADMIN's crew. Copying the
   row's already-frozen `coordinatorId` is not the restamp `SurveyResponse.js` forbids — it is the
   same freeze the field path performs across both ledgers.

### ⚠ Write order is the MIRROR IMAGE of `runReclassify`'s

`runReclassify` stamps rows FIRST so a crash can't offer a Revert for a conversion that never
happened. Here the stamp is written **LAST**, because here the stamp is also what a resumed job
reads as "this row is done":

- *responses first, crash* → orphan responses, door still says `not_home`. That is the TRUE state of
  both ledgers, so the nightly reconcile agrees with it; resume finds the row unstamped, recognises
  the responses by `deskEntry.runId`, and completes the flip. **Self-healing.**
- *flip first, crash* → door says Surveyed with zero answers, a state the field also produces (two
  canvassers overlapping), so nothing detects it — and resume finds the row STAMPED and skips it
  forever. **Silently wrong.**

Same invariant as `runReclassify` (a stamp must mean the whole unit landed); only which write is
last differs. **Do not "align" the two.**

### Eligibility, skips and the template rule

- **Sources are `RECLASSIFIABLE_OUTCOMES`** (`SOURCES_FOR('to_survey')`), so an outcome that joins
  that list becomes convertible with no edit here. `not_target` did on 2026-10-02, on purpose: it is
  the remedy when a canvasser surveyed a listed voter and then tapped the wrong button. The caveat is
  the entry's own claim — `not_target` asserts that whoever answered was **not** a listed voter, and
  a desk entry asserts the opposite for every voter it writes, so the admin is overriding the field
  record rather than filling in a blank (Part 1 says so). The numbers behave: both actions are knocks
  and both are in `CONTACT_ACTIONS`, so knocks and contact rate hold and only connection rate rises;
  `reclassified.from` keeps `'not_target'`, and revert restores it exactly — pinned by "to_survey
  from Not a target voter" in [surveyConversion.int.test.js](../server/test/surveyConversion.int.test.js).
  (Each created response's `deskEntry.fromOutcome` is the row's `actionType`, so it reads
  `not_target` too.) The reverse direction is narrower: `validateConversion` lets `from_survey`
  *target* `not_target` only where `isOutcomeEnabled` does — a survey campaign with it on while
  Doorline has it released — else `TARGET_DISABLED`.
- **Eligible voters** = every `Voter` at the door in the campaign, **minus `doNotContact.flagged`**.
  There is no voter-level targeting field anywhere — walk lists own DOORS (`Household.effortId`) —
  so this is the honest reading of "who the walk list targeted", and it matches the set the mobile
  app would have let the canvasser survey.
- **A voter who already answered that round is SKIPPED**, never overwritten, and listed by name.
  `doorsNoVoters` counts only doors with nobody on file; a door whose voters are all DNC or
  already-answered lands in `doorsAllAlreadyAnswered`, because "nobody on file" and "nobody left to
  record" are different facts and the DNC count already reports the second.
- **A selection spanning two effective templates is REFUSED** (`MIXED_SURVEY_TEMPLATES`). Using the
  campaign default instead would write a response whose `surveyTemplateId` the mobile submit route
  itself 400s for that door — manufacturing data the field path forbids. The fix is one click: the
  page's walk-list filter narrows to one effort (`buildEntryFilter` already supported `effortId`).

### Reverse direction

Scope is **`{householdId, passId, userId}`** — only the converting row's own canvasser. This mirrors
the existing field inverse (`recordHouseholdAction` deletes on exactly that triple), and the fraud
case is precisely where it matters: undoing canvasser A's faked knock must not destroy canvasser B's
real answers at the same address.

We **archive** where the field path **deletes**, deliberately: there, a canvasser is correcting
themselves seconds later and the destroyed data is their own, just superseded. Here an admin is
removing what a canvasser submitted as final, potentially months later, in an investigation where
the removed content **is the evidence**. (Whether the field path's delete is also wrong is an open
question, out of scope.) Recovery needs no new UI — `POST /admin/voters/:voterId/surveys/:archiveId/restore`
works on these rows already; note that restore promotes the answers *without* re-flipping the
activity row, so a restored response sits under a `not_home` door until the run is reverted.

**Revert refuses to clobber.** Before restoring, it READS whether the `{voterId, passId}` slot is
free; a slot refilled by a later field submit is left alone and counted in `responsesNotRestored`.
The read is the guarantee, not the unique index — that index is built by a deploy step
(`autoIndex` is off in production), so a data-destroying decision must not depend on it existing.
The `E11000` catch stays as belt-and-braces for the race.

### Idempotency

`convertibleMatch` already excludes stamped rows, so a redelivered or resumed job skips finished
work for free. Two additions: an `E11000` whose existing row carries **this run's own**
`deskEntry.runId` is counted as our prior insert, not as somebody else's field answer (without
that, a redelivery inflates `votersSkippedAlreadyAnswered` with its own work); and **`bumpLive` is
the one non-idempotent write**, CAS'd exactly once on the run doc's `liveBumped`.
`recomputeCampaignStats` is used rather than `bumpCampaignStats` — the "rare admin bulk op" tier,
and idempotent under redelivery.

### Performance

`recomputeSurveyStatus` is a per-voter `exists` + `updateOne` loop — 100k round trips at 50k voters,
which would become the whole job. **`recomputeSurveyStatusesBatched`**
([status.js](../server/src/services/canvass/status.js)) is two round trips per 500-voter chunk. Its
`updateMany` bumps `Voter.updatedAt`, which matters because `/mobile/changes` ships voters whose own
`updatedAt` moved — asserted, not assumed.

### Caps

`RECLASSIFY_MAX_IMPACT_ENTRIES` (25 000) on the activity selection, both directions;
`SURVEY_CONVERT_MAX_RESPONSES` (50 000) on responses created; `MAX_VOTERS_PER_DOOR_SYNC` (50) on the
synchronous per-door path.

### Where the marker surfaces

`voterProfile.surveys[].deskEntry` and `overwrittenSurveys[].deskEntry`; `/admin/reports/responses/:id`;
`/admin/households/:id/surveys`; `/admin/activities/:id` (whose response lookup is round-scoped —
`{voterId, passId ?? null}` since 2026-08-25; the voterId-only query showed whichever round's
answers Mongo yielded first on a multi-round campaign); per-row **`deskEntered`** on
`/admin/reports/voters-by-answer` and a per-canvasser **`deskEntered` count** on
`/admin/reports/answer-canvassers`; and two export columns (**Desk entered**, **Desk entered by**)

on `survey-results`, **Desk entered** on `survey-answers`, **Desk entered** on `canvass-activity`
when **Include survey answers** is on, and — because `results-by-voter` gives each (survey, round) a
single **Survey** cell rather than a column per fact — the words **"(desk entered)"** inside that
cell. All additive.

The answer-drill pair matters most and is the easiest to skip: `/voters-by-answer` is where someone
reads *"12 people said Yes"* and acts on it, and `/answer-canvassers` is an audit surface answering
*"did this canvasser really record 40 Yeses?"* — a desk entry credits the knocking canvasser, so
without the count their total silently includes answers an admin typed.

**Client reports: the disclosure is asymmetric on purpose.** `computeWindowStats` returns
`provenance: { deskEnteredResponses, totalResponses }`, the `/preview` route ships it on the
**internal** response, and the builder renders it as *"Internal note — not shown to the client."*
It **cannot** reach the published page: `shapeReportForClient` → `shapeWindow` are strict field
whitelists, and `surveyConversion.int.test.js` asserts neither `provenance` nor `deskEntered`
survives the shaper. The reasoning both ways: a desk-entered answer is a real answer and counts
identically, so annotating the client's figures would misrepresent them in the other direction —
but the operator signing off should not learn afterwards that part of the report was typed at a
desk.

Two things that were **wrong, not merely missing**, and are fixed: the overwritten-response copy on
web and mobile said *"Overwritten … was X's"*, which for an `outcome_convert` row reads as an
accusation against a canvasser for something an admin did (now *"Removed … when this door's outcome
was changed"*); and `/admin/reports/duplicate-surveys` `$unionWith`s the archive, so conversion
archives are now **excluded** — a fraud-cleanup archive is not evidence somebody was surveyed twice,
and leaving them in dumped every reverted door into an operator's duplicate queue.

**Reporting rule: a desk-entered response counts identically to a field one** in every rate and
total. The stamp is provenance, not arithmetic.

## L. The "then go to" compiler (Script flow)

**Module:** canonical [`server/src/services/surveys/routing.js`](../server/src/services/surveys/routing.js),
mirrored byte-for-byte below the `// ==== BEGIN MIRRORED BODY ====` marker into
[`client/src/lib/surveyRouting.js`](../client/src/lib/surveyRouting.js) — **two copies, not three**:
the phone never compiles, it evaluates the stored `visibleIf`. The body takes no imports (a relative
path would resolve into two different trees), which is why it repeats `'__other__'` as `OTHER_ID`
instead of importing `OTHER_OPTION_ID` (a test pins the two equal). **Fixtures:**
[`__fixtures__/routing.fixtures.json`](../server/src/services/surveys/__fixtures__/routing.fixtures.json),
twenty cases with the final Burton graph among them. **Callers:** `applyFlow` in
[routes/admin/surveys.js](../server/src/routes/admin/surveys.js) on every Script-flow save (§B); the
builder's live preview and Switch back (§G); the print model; and, for the block predicates alone,
`normalizeAndFilterAnswers`, `/survey-results`, `templateAnswerPlan`, `voterProfile`, the conversion
payloads, `computeReport` and `buildPacket`. Design and proof:
[PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) Part 2 §C and §F.

**Why compile instead of walking a path at runtime.** The arrows become the `visibleIf` the evaluator
already reads, so the evaluator stays byte-for-byte unchanged (§D), `normalizeAndFilterAnswers`,
`dropHidden` and every report keep working untouched, and a phone on an older bundle routes
**correctly**, because the compiled rules use only `any_of`. A runtime path walker would have edited
the mirrored evaluator in three places and made every shipped phone disagree with the server about
which rows to keep. A compiled condition means exactly "the conversation reached this block": the
evaluator withholds a hidden block's answer from every later rule, so `q4 any_of […]` already carries
"and Q4 was reached", and a block reached several ways is a flat `any` with no nesting. **Only
positive `any_of` atoms are ever emitted** — `is_not` and `not_answered` are true on a block that was
never reached, and would leak a closing onto a branch that never asked the question.

**`compileRouting(questions) → { questions, errors }`** — pure, deterministic, idempotent:

| # | Rule |
|---|---|
| 1 | Walk the **live** (non-retired) blocks in list order, the evaluator's own order. The first live block is always reached. |
| 2 | A **branching** choice question (`isBranching`: a live answer carries a route, `'__end__'` included, or Other does while `otherOption` is on): each **picked** answer reaches `goTo ?? the following live block`, `'__end__'` reaches nothing, and an **unanswered** branching question reaches nothing. A **plain** choice question (no arrows): the following block is reached whenever the question was, answered or not — compiled as a copy of the question's own reach — so an optional question mid-script never ends the path when skipped, and Switch back of a linear survey produces no bogus "any of every answer" conditions. Retired answers neither fire nor count as a way in. A `goTo` on the choice question itself is an error, never a route. |
| 3 | Multiple choice is a **union**: every picked answer's route is followed, and `'__end__'` on one pick never suppresses another's. |
| 4 | A **text question or statement** continues to `goTo ?? the following block` whether or not anything was typed, by copying its own reach into the target — sound because that reach reads only earlier questions, whose answers can no longer change by the time the conversation gets there. |
| 5 | A block's condition is the OR of everything that reaches it: `{ logic: 'any', rules: [ one { questionKey, op: 'any_of', optionIds } per source question ] }`, atoms ordered by the source's list position and ids by that question's option order with `'__other__'` last — a stated order, so an unchanged survey compiles to byte-identical rules on every save and the builder's preview matches the stored document. A direct route and a passed-on reach from the same question merge into one atom. Reached unconditionally → `visibleIf: null`. |
| 6 | A route must point at a **later** live block — the mirror of the earlier-only rule for conditions, so cycles are impossible and `validateVisibleIfIntegrity` and the evaluator's fail-closed check hold by construction. An earlier, self, removed or retired target is an error. The last live block falls through to End. |
| 7 | A live block **nothing reaches** is an error — never silently hidden, never compiled to empty rules (which the evaluator would read as always visible). |
| 8 | Retired blocks pass through untouched, in place. |

An incoming `visibleIf` on a live block is ignored and overwritten, which is what makes the compile
idempotent and the GET → PATCH round-trip work. An empty string in any route field (what a cleared
select sends) reads as no route.

**The error contract.** `errors` is `[{ key, optionId?, message }]` in list order, in plain English,
because team leads read them — live in the builder, and as the server's 400 (`error` = the first
message, `routeErrors` = all of them). The questions returned **beside** errors are a preview only and
are never stored: an erring route is dropped, and an unreached block compiles as if the conversation
started there. A block is named by `blockName` — its title, else the first sixty characters of its
text on one line, never the full body; a card still being typed reads "Untitled question",
"Untitled statement" or "Untitled closing". A route's subject is the block itself,
`The answer "‹text›" on "‹block›"`, or `The "Other (specify)" answer on "‹block›"`.

| Error | Message |
|---|---|
| Route to a removed block | `‹subject› goes to a block that has been removed — pick another target.` |
| Route back to its own block | `‹subject› can only go to a later block, not back to "‹block›" itself — pick another target.` |
| Route to an earlier block | `‹subject› can only go to a later block, and "‹target›" comes before it — move "‹target›" down or pick another target.` |
| A live block nothing leads to | `Nothing leads to "‹block›". Route an answer to it, or move it where the flow reaches it.` |
| `goTo` on a choice question itself | `"‹block›" is a choice question, so its Go to belongs on each answer — remove the one on the question itself.` |

**The other exports** (both copies): `END_KEY` (`'__end__'`) and `OTHER_ID`; the block predicates
`isStatement`, `isAnswerable` (anything but a statement — deliberately not a whitelist of today's
three types, so it agrees with the server's backstop), `isChoice` and `isClosingBlock` (type first,
`role` second); `blockName`; `isBranching`; `hasActiveRoutes` (the arrows the compiler **follows** — a
`goTo` on a choice question itself is not one); `isScripted(questions)` (a live statement or a live
arrow — the builder's trigger for one block per screen, distinct from the runner's
`isScripted(survey)`, §M); `resolveDefaultTarget` (where a block falls through: the next live block's
key, `END_KEY` after the last, `null` for a retired block — behind the builder's "Continues to" line
and the print model's arrows); `clearRoutes` (every route nulled on every block and answer, retired
ones included, nothing else touched); and **`switchToList`**, the builder's "Switch back to Show only
if" on a new survey or one stored in Script flow (on a survey still stored in List flow, Switch back
is an undo that never compiles, §G): compile, then clear every route, so each live block keeps
exactly the condition its arrows produced, now as an ordinary hand condition. Lossless exactly when `errors` is empty; with errors the
kept conditions are only the preview, so the builder refuses the switch and shows the first message.

**The Burton survey** — the client door script that prompted all of this — is authored and compiled
in [PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) Part 1 and §F, and kept as the
first routing fixture. Every closing carries an explicit exit (Close 4 → End; Close 2 and Close 3 →
Close 4), because a closing left on Continue falls into the next one — the fall-through trap: a
supporter would read Close 2, then Close 3, then Close 4. Close 1 is the default closing, not a block.

**Tests.** [routing.test.js](../server/src/services/surveys/routing.test.js): one test per fixture,
well-formed output, determinism, idempotence and purity, degenerate input, the message wording,
**agreement with walking the arrows on 500 seeded random surveys**, the predicates, `blockName`,
`resolveDefaultTarget`, `clearRoutes`, `switchToList` (Burton keeps its exact conditions), and the
**two-copy drift guard** (byte-identical bodies, neither importing anything) plus "the client mirror
compiles every fixture identically". [burtonScript.test.js](../server/src/services/surveys/burtonScript.test.js):
the Burton graph compiled, then walked on the real evaluator down the twenty paths of the design's
proof (every answer, both ways into Question 4, the default closing exactly on the paths that reach
no closing block and never while a required question is blank, three changed-earlier-answer cases),
in both styles — compiled, and switched back. Both run with `npm test` in `server/`.

## M. The door runner and the `{{canvasser}}` filler (shared modules)

### The door runner — `surveyRunner.js`

**Module:** canonical [`mobile/lib/surveyRunner.js`](../mobile/lib/surveyRunner.js), mirrored
byte-for-byte below the marker into [`client/src/lib/surveyRunner.js`](../client/src/lib/surveyRunner.js),
so the web preview's **Try it** walks the same code as the phone. Its one import sits **above** the
marker on purpose: each copy reads its own sibling evaluator mirror (`./surveyVisibility.js`). Pure data
in, data out — no React, no react-native — and `answers` (`{ [key]: optionId | optionId[] | text }`)
and `otherTexts` (`{ [key]: text }`) are the screen's own state shapes, never mutated. **Tests:** the
drift guard (plus a Try-it smoke) is [client/src/lib/surveyRunner.test.js](../client/src/lib/surveyRunner.test.js),
run by CI's client unit job; the behaviour is pinned by
[mobile/lib/surveyRunner.test.js](../mobile/lib/surveyRunner.test.js), which keeps a frozen copy of
the old inline screen code as its oracle, through `npm run test:mobile` at the repo root — a step
CI's checks job runs too.

**Invariants.** (1) **One routing engine.** What shows is the evaluator's visible set over the
template's stored `visibleIf` — the same thing the server re-runs at save — so nothing here follows
`goTo`: the stepper is a cursor over the visible list, never a second path walker. (2) **A statement
records nothing:** it never takes a number, never counts toward progress, never posts a row and never
blocks Save, even if one were stored `required: true`. (3) **For a survey with no statements every
function returns exactly what the old screen computed inline** — the cell build, `isAnsweredNow`,
progress, `validate()` and the POST rows moved here unchanged.

| Export | What it decides |
|---|---|
| `isStatement`, `isAnswerable`, `isClosingBlock` | Block kinds, by `type` first; `role` is trusted only on a statement. |
| `activeBlocks(survey)` | The non-retired blocks in authoring order, the evaluator's walk. |
| `buildCells(blocks, answers)` | The evaluator's cells; a statement always gets an empty one, and `makeCell`'s no-text-on-choice contract applies. |
| `visibleBlocks(survey, answers)` | The blocks that show, in list order. A block that goes hidden keeps its answer in state (changing the earlier answer back restores it), but the answer is withheld from later rules and never posted. |
| `isAnswered(q, answers, otherTexts)` | An Other pick counts only once its typed text is non-blank (whitespace-only is blank); on multiple choice a real pick beside it already counts; a statement is never answered. |
| `answerableQuestions`, `questionNumbers` | The visible answerable blocks, numbered 1-based. Numbers follow the path, as the phone always has; the builder and paper number every active question, so the two can differ on a conditional path, as they always could. |
| `requiredPending`, `pathComplete`, `progress` | The first visible required question still blank (the old `validate()`, returned as data so the caller words it); the Save gate; `{ answered, total, percent }` over the visible answerable questions (100% when there are none). |
| `buildSubmitRows` | The POST's `answers` rows, for visible answerable questions only. Field order is part of the contract: rows are frozen into the offline queue and replayed later. An Other pick snapshots its typed text, or `'Other'` when nothing was typed. |
| `closingReached` | A visible closing block exists. |
| `isScripted(survey)` | A statement, a closing or a live route on an active block, **or `flow === 'script'`**. The phone's single page calls it to decide whether a block a tap revealed is scrolled into view, which happens on a scripted survey only; the builder's automatic one block per screen uses the compiler's `isScripted(questions)` (§L), which never reads `flow`. |
| `needsClosingGuard(survey)` | Script flow or any closing block — narrower than `isScripted` on purpose: a statement alone never changes where the goodbye renders, and an existing survey must render exactly as before. |
| `showDefaultClosing(survey, blocks, answers, otherTexts)` | Show `template.closing` when it has text (whitespace-only is none; the old screen drew an empty Closing box for it), no closing block is visible, and — when `needsClosingGuard` — the path is complete. A plain survey keeps the old rule: shown whenever it has text. |

**The stepper** (one block per screen, on the phone and in Try it):

| Export | Behaviour |
|---|---|
| `INTRO_SCREEN_ID`, `END_SCREEN_ID` | `'__intro__'` and `'__end__'`. Reserved `__` names because a block key is a slug of its label, so a question labelled "End" is keyed `end`; no generated key can start with `__`, and the server refuses a hand-sent one. |
| `screens(survey, answers)` | The opening (only when the intro has text), one screen per visible block, then the end screen — unless the last visible block is a closing, which is then the last screen. |
| `saveScreenId` | The screen that carries Note and Save: always the last one. A closing that is not last — Close 2 before Close 4, or a closing a multiple-choice union left above a later block — gets Next like any statement. |
| `screenKind(screen)` | `'intro'`, `'question'`, `'statement'`, `'closing'` or `'end'`. |
| `clampScreenId(survey, answers, id)` | The cursor for these answers: `id` while it is still a screen; otherwise the last screen **before** the block's place in authoring order (retired blocks keep their index; the opening counts as first and the end as last), so a canvasser whose block vanished under them — a template refresh — lands on the block they came from. `null` or an unknown id gives the first screen. |
| `canAdvance`, `canSkip` | Next is available unless the clamped screen is a visible required question with no answer; Skip only on an optional question. |
| `nextScreenId`, `prevScreenId` | The neighbouring screen for **these** answers; `null` on the last screen (it has Save, not Next) and on the first (where Back leaves the survey). |
| `skipAnswer(answers, otherTexts, key)` | Removes the answer and its Other text, as if never touched, without mutating. **Handlers pass the new answers:** Skip calls `nextScreenId` with `skipAnswer(…).answers`, never the render's memoized list, or a Skip that hid the following blocks would advance into one of them. |

A tap only **selects** (the read-aloud line under the picked answer and the "Please specify" box have
to stay on screen); Next advances. Advancing automatically on a single-choice tap was rejected: it
would hide the read-aloud line the moment it appeared, make Other untypable, leave a screen reached by
Back with no forward control, and let a double-tap's second touch land on the next screen.

### The `{{canvasser}}` filler — `scriptText.js`

**Module:** canonical [`server/src/services/surveys/scriptText.js`](../server/src/services/surveys/scriptText.js),
mirrored byte-for-byte below the marker into [`client/src/lib/surveyScriptText.js`](../client/src/lib/surveyScriptText.js)
and [`mobile/lib/surveyScriptText.js`](../mobile/lib/surveyScriptText.js) — three copies, no imports in
the body. **Tests:** [scriptText.test.js](../server/src/services/surveys/scriptText.test.js), with the
three-copy drift guard.

| Export | Behaviour |
|---|---|
| `PLACEHOLDER_TOKENS` | Frozen `['canvasser']` — one token by owner ruling (2026-10-02); dates stay typed by hand. Frozen because the server's save check reads it, and a stray push would make a typo legal. |
| `BLANK` | `'______'`, the client's own "say your name here" convention. |
| `fillScript(text, { canvasserFirstName })` | Replaces every `{{canvasser}}` (whitespace inside the braces tolerated) with the trimmed first name; a missing, blank or non-string name reads as `BLANK`. Unknown tokens stay exactly as typed (the save check refuses them, so one only arrives from a template saved before it existed). The name goes in through a replacer **function**, because a replacement string would expand `$&`, and filled text is never re-scanned. `null` → `''`. |
| `unknownPlaceholders(text)` | The distinct unknown names in order of first appearance, trimmed and **case-sensitive** (`{{Canvasser}}` is a typo). Only a closed pair counts; an unclosed `{{` is caught by the server's stricter "does any `{{` survive `fillScript`" test (§B). |
| `hasPlaceholderSyntax(text)` | Any `{{` at all — the test for a question's wording and an answer's text, which are snapshotted onto every stored answer row (`questionLabel`, `answer`) and become results labels and CSV cells that nothing fills. |

**Where it is filled:** the intro, the default closing, a statement's read-aloud `label`, an option
`script` and a `note` — never a question's `label` or an option's `text`. The phone fills with
`bootstrap.user.firstName` (the bootstrap's `user` already carries it); the web preview with the
**viewing** admin's own first name; paper with no name, so it prints `BLANK` — a packet is not personal
to one canvasser, and no canvasser name is ever printed ([WALK_PACKETS.md](WALK_PACKETS.md)). The demo
tenant's greeting already contained a literal `{{canvasser}}`
([seedDemoOrg.js](../server/src/services/platform/seedDemoOrg.js)); it now reads as the canvasser's
name, with no seed change.

### Compatibility and tests

**No client-version gate.** Everything is additive on the wire: new optional fields, a wider `type`
enum, a row filter; the survey POST keeps its request and response shape. A phone on an **older
bundle** given a scripted template (checked against the committed screen): a statement renders as a
numbered card showing `label` — the full read-aloud text, which is why the body lives there — with no
control; it counts as unanswered, so "Question N of M" is inflated and the percent stays below 100;
it posts `{ answer: null, optionIds: [], otherText: null }`, which the server drops (§E); the default
closing shows under every path; placeholders show as braces; notes and links are invisible. **Routing
is correct**, because the compiled rules use only `any_of`. The one hard failure — a `required`
statement, which would block that screen's Save forever — cannot be stored. The mobile change is
JavaScript only with no new dependency, so it ships over the air.

**A phone refreshes templates only with a full bootstrap** (`/mobile/changes` never carries them), so a
canvasser mid-shift keeps the pre-edit template. An in-place edit is tolerated — unknown keys are
dropped and the template id still matches the door's — but when an edit changes a gate (a re-pointed
route, a hand condition, a block added in a path), rows the phone posts for a block the new template
hides are dropped silently by `dropHidden`, with a 201. Change routes between shifts, not during one,
as Part 1 says.

**Tests for scripted surveys:**

| Test | Pins |
|---|---|
| [server/test/surveyBlocks.int.test.js](../server/test/surveyBlocks.int.test.js) (30, `npm run test:int`) | A statement stored answer-less with a role, whatever is sent; the 1000/5000 label caps; the title, note and link caps and the http(s) rule; `{{canvasser}}` only in script text, and no `{{` at all in a statement's title or a link's label; the placeholder rules skipping retired blocks and answers, so an older survey still saves; reserved `__` ids; no two blocks sharing a key, retired ones included; the one-answerable-question rule (an empty survey still allowed); no rule on a statement, and statements named by title or first words; List flow refusing live routes and clearing retired ones; an Other route kept only on a choice question with Other on; Script flow refusing an unreachable block, a backward route and a choice-level `goTo`; the size bounds (500 blocks and 200 answers a question, retired ones included, on a PATCH's reconciled list too; 200 live blocks and 50,000 compiled answer ids in Script flow); entering Script flow with a hand condition refused, never overwritten; a flow change needing the questions while `presentation` changes alone; a questions-only PATCH compiling; with responses, leaving Script flow keeping identical conditions and entering it a 409; retyping into a statement as the answer-type 409; reconcile never re-appending options onto a statement; the Burton survey built through the API compiling to the §F listing; a GET → PATCH round-trip recompiled; duplicate copying `flow`, `presentation`, `tags` and every block field; no statement rows from the phone's submit (an older-bundle body included) or the admin edit; the answerable-only voter-profile snapshot, `/survey-results` and all four conversion payloads; and a client report's breakdowns (`computeSurveyBreakdowns`, `computeWindowStats`) and public map answers (`publicPointAnswer`) carrying no statement, even from a stray stored row under its key. |
| [normalizeAnswers.test.js](../server/src/services/surveys/normalizeAnswers.test.js) | Statement rows dropped in both modes, with `rebuildAnswerText`, on lean and hydrated templates; unknown keys still dropped; retired ids still kept; statement-free surveys normalized exactly as before. |
| [routing.test.js](../server/src/services/surveys/routing.test.js), [burtonScript.test.js](../server/src/services/surveys/burtonScript.test.js), [scriptText.test.js](../server/src/services/surveys/scriptText.test.js) | §L and the filler above, with their drift guards. |
| [visibility.fixtures.json](../server/src/services/surveys/__fixtures__/visibility.fixtures.json) through [visibility.test.js](../server/src/services/surveys/visibility.test.js) | Six scripted cases on the unchanged evaluator (§D): a statement gated like a question, and a closing block reached from two sources, a stale hidden answer withheld. |
| [surveyColumns.test.js](../server/test/surveyColumns.test.js) | A statement is not an export column; `known` still covers statement keys, so a stray stored statement row never becomes an orphan column; a statement sharing a question's label doesn't decorate that question's header; template order kept. |
| [packet.int.test.js](../server/test/packet.int.test.js), [packetPdf.test.js](../client/src/lib/packet/packetPdf.test.js) | Statements reach the print payload in place with role, title, links and routes but never a note; an older template prints with every new field read as its default; the scripted print model (numbering skips statements, answers carry arrows); each statement printed once on the "What to say" page, never beside a door; statements alone earning the page; List flow keeping its skip hints with no arrows; type kept across a page break. |
| [surveyBuilderRules.test.js](../client/src/lib/surveyBuilderRules.test.js) (36) | Loading (older templates, dropped compiled conditions, routes cleared off a List survey), numbering and counts, `ruleError` and `handRuleError`, the placeholder and link checks (a link address in any case), the first-route switch, the automatic one block per screen following the survey as Save sends it (an edit taken back takes it back), the greyed-out hint naming where this page offers Duplicate, the select's targets and Continue label, "Continues to", Burton's "Reached when", where errors land, the backward-move error, the live compile over the blocks as Save sends them (an arrow on an answer with no text yet counts nowhere), the branching warning, re-pointing on retire or remove, Switch back (converting losslessly, refused on errors, keeping a hand condition; on a survey saved in Show only if an undo to its opened conditions, never refused), new closings on End, what Save sends, the answerable rule (a survey whose every block is retired still saves), `hasBlockingIssues`. |
| [mobile/lib/surveyRunner.test.js](../mobile/lib/surveyRunner.test.js) (23), [client/src/lib/surveyRunner.test.js](../client/src/lib/surveyRunner.test.js) | The runner against the old screen code on statement-free surveys; Other and whitespace; the POST rows; block kinds; statements taking no number, progress, row or Save gate; the closing guard; `isScripted`; Burton walks, numbering, the Next and Skip rules, terminal closings, the end screen's default closing, stale paths dropped and the cursor clamped, no intro screen for a blank intro; a closing left above a later block showing Next; Skip computed from the new answers; the drift guard. |
| [surveyConditionText.test.js](../client/src/lib/surveyConditionText.test.js), [surveyPreviewRender.smoke.test.js](../client/src/lib/surveyPreviewRender.smoke.test.js), `surveyAnswerForm.test.js`, `surveyChoices.test.js` | The shared gate wording (paper byte-identical to before); the preview rendering an old survey exactly as before, then statements, notes, links, gates and the default closing; the blank-name fill; Try it's first screen in both presentations; the desk composer drawing no input for a statement; statements producing no form slot, row, cell or choices. |

The design's §L also lists device checks to run before a production release (every Burton path on
iOS and Android in both presentations, a link opening in the browser, an older build still saving);
those are manual.

