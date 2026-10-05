---
slug: surveys
title: Building and assigning surveys
audience: lead
kind: guide
order: 11
sourceDoc: SURVEYS.md
summary: Build a survey or a door script, attach it to a campaign, run different surveys per walk list, and edit it safely.
tags: surveys, questions, branching, tags, walk lists, editing, results, percentages, script, statements, closings, default closing, go to, canvasser notes, links, one block per screen, try it, placeholder
---

A **survey** is the questionnaire your canvassers run at the door. You build it once, then attach it to a campaign — and canvassers on that campaign start seeing it.

## Build a survey

Open a campaign and pick **Survey** in the sidebar, then click **New survey**. Give it a name, write a short **Greeting** for the canvasser to open with and a **Closing** to end on, then add questions. Each question is **single choice**, **multiple choice**, or **text**, and can be marked **required**. Working from a client's door script — lines to read that take no answer, or a different goodbye for different answers? See *Scripted surveys* below. The builder opens right inside the campaign and returns you here when you save.

If the campaign has no survey yet, the one you build becomes its default. If it already has one, your new survey is added to your library so you can assign it to specific doors — a new survey never silently replaces the default.

## Letting people answer in their own words: "Other (specify)"

On any choice question, tick **Other (specify)**. At the door the canvasser gets an extra **Other** choice, and picking it opens a small box to type what the person actually said. You keep the clean option counts *and* the verbatim wording.

Those write-ins are tracked like any other answer:

- Survey results show an **Other** row next to your real options.
- Click it and you get the list of people who wrote something in, **each row showing what they typed**.
- You can filter the map to Other, and exports spell it out as `Other — potholes`, so a write-in is never confused with a real option that happens to use the same word.
- On a voter's page you can read the typed text, and change or clear it like any other answer.

**Clients never see the words.** On a client report, every write-in is merged into a single **Other** row with its count intact — a client learns how many people said something else, never what any of them said.

Two things worth knowing:

- It's a **question setting, not an option** — you won't find "Other" in the list of options you typed, and you don't need to add it there.
- If you also create your own option called "Other", both work and stay separate; the write-in then reads **Other (specify)** so you can tell them apart. Usually that means you want one or the other, not both.

## Branching and tags

Any question after the first can be set to **Show only if...** an earlier answer matches — the app builds branch, skip, and skip-to-end flows from that one rule. Hidden questions never show at the door and their answers aren't saved. Working from a script written as arrows ("Yes → go to Q4")? You don't have to turn it around: set **then go to** on the answers instead — see *Scripted surveys* below.

**Tags** are short labels (like "Supporter") you stick on answer options across different questions, so a report or a [saved search](saved-searches) can roll up everyone who matched — no double-counting. Each tag shows **two numbers**: how many voters were **ever identified** (each person once, even across rounds) and how many are **still current** — their most recent answer still carries the tag, so someone who flipped to Opposed in a later round drops out of this one. The report also splits each tag **by team** — the team that found the voter first gets the credit, so the team rows add up exactly to the campaign total. Canvassers never see tags. See [How do I count our supporters?](how-do-i-count-supporters).

## Scripted surveys

Some clients hand you a door script rather than a list of questions: lines the canvasser reads that take no answer, a different goodbye depending on how the conversation went, and arrows like "Yes → go to Q4". The builder holds all of it.

### Questions, statements and closings

Under the question list are three buttons:

- **+ Add question** — single choice, multiple choice or text. Questions are the only blocks that record an answer, take a number, and show up in results, exports and on a voter's page.
- **+ Add statement** — words the canvasser reads aloud that take no answer: a pitch, a follow-up line. It records nothing and never takes a question number.
- **+ Add closing** — a goodbye for the conversations that lead to it. A survey can have as many closings as its script has endings.

A statement or closing can have a short **Title** ("Close 2", "The pitch"). That's how it's named in the builder's lists, on the phone and on paper; left blank, its first words are used. A survey still needs at least one question — one made only of statements and closings can't be saved, because it would record nothing. More in [How do I add a line the canvasser reads but the voter doesn't answer, or more than one closing?](statements-and-closings)

### The default closing

The **Closing** box at the bottom of the builder is your **default closing**: the goodbye on any path that doesn't reach one of your closing blocks. A survey without closing blocks ends on it, just as before. Put your plain "Thank you for your time" there, and use closing blocks for the goodbyes only some conversations get.

### Building a script with "then go to"

Every answer has a **then go to →** picker: **Continue** to the next block, jump to any later block, or **End the conversation**, which ends on the default closing. A text question has one too, and so does **Other (specify)** when it's ticked. Once a survey uses Go to, every statement and closing gets one as well — that's how one closing runs into the next.

- **The first arrow switches the survey to Go to.** A banner says so, and from then on the app writes each block's *Show only if* for you from the arrows. Each block shows **Reached when…** (the answers that lead to it) and, when nothing on it says where to go, **Continues to…**.
- **Arrows only point down the list.** If answers on two different questions lead to the same block, put it below both of those questions.
- **Give every closing an exit.** A closing left on *Continue* runs straight into the block under it, which is why a closing you add to a Go to survey starts on *End the conversation*. Point one closing at another to chain them.
- **Every block needs a way in.** A block nothing leads to is marked until you route an answer to it or move it.
- **A question whose answers carry arrows needs an answer.** If it's optional and the canvasser skips it, the conversation ends there, on the default closing — the builder warns you: mark it **Required**, or add an answer like "Declined to say". A question with no arrows on its answers carries on to the next block whether it's answered or not.

### One style per survey

A survey uses either *Show only if* or *then go to*, never both: they describe the same branching from opposite ends, and a mix could contradict itself. You never pick the style from a menu. The first arrow switches the survey to Go to, and the banner's **Switch back to Show only if** takes it back. If it was a *Show only if* survey when you opened it — you set an arrow and haven't saved — Switch back simply undoes that: the arrows go, and every block gets back the condition it had when you opened the survey. On a survey already saved with Go to, or a new one, Switch back turns every arrow into the condition it stood for, so canvassers see exactly the same survey; it waits until any arrow the builder has marked is fixed. If the survey already had *Show only if* conditions when you set its first arrow, each one is marked, and the survey won't save, until you re-create it as an arrow or remove it — nothing is deleted behind your back.

### Notes and links for the canvasser

Any block — question, statement or closing — can carry a **note to canvasser (not read aloud)**. On the phone it sits in a blue box labelled *For you — not read aloud*, so it's never mistaken for the script. A block can also carry up to five links (**+ link**: a label and a full web address, https://…). On the phone each link is a button that opens the page in the phone's browser, so the canvasser can show it to the voter; nothing about the voter is added to the address. There's no QR code in the app — if you want voters to scan something, put the QR on your printed literature.

Notes stay with your team: they never appear in results, exports, client reports or printed packets. A statement's or closing's links print on paper with their web address; a question's links don't print, so put a link your paper volunteers need on a statement or closing.

### One block per screen

With **One block per screen** ticked (under Survey settings, at the top of the builder), canvassers get the survey like a script: the greeting, then one question, statement or closing at a time in large type, with **Next**, **‹ Back**, **Skip** on optional questions, and **Save** on the last screen with the goodbye. It turns itself on when you add a statement, a closing or an arrow to a survey that had none, and back off if you take them out again before saving; once you tick or untick it yourself, your choice stays. Every other survey keeps the single page it has always had. It only changes how the survey is shown — the answers recorded are the same either way.

### Try it

Open the survey's **Preview** on the campaign's Survey tab and switch from **Overview** to **Try it** to click through it as a canvasser would, one block per screen or on one page, whichever the survey uses. Nothing is saved. It's the quickest way to walk every path of a script before it reaches a door — see [The Survey page](page-survey).

### The canvasser's name

Type `{{canvasser}}` and it reads as the canvasser's own first name on their phone: "Hi, my name is `{{canvasser}}`" becomes "Hi, my name is Ana". It works in the greeting, the default closing, statements, closings, an answer's read-aloud line and a note. In the preview it shows your own first name, and on a printed packet it's a blank line, so each volunteer says their own. It's the only placeholder — type dates and everything else as words. It can't go in a question's wording, an answer, a title or a link label, and a misspelt one is caught before you can save.

### A refusal is never a survey answer

Don't add a "Refused" answer to a question. Any answer saves a completed survey, so the door would count as surveyed, not refused. When someone won't talk, the canvasser backs out of the survey and taps **Refused** on the door screen — unless they've already surveyed someone else at that door this round. Then they leave the door as it is: tapping Refused would replace their result for the door and delete the answers they took there. If one question is the sticking point, give it an answer like "Declined to say".

### Counting supporters

> Tip: Scripts often ask for support twice — once up front, and again after a pitch to an undecided voter. Tag **both** "Yes" answers with your **Supporter** tag (and an "Already voted for her" answer too, if your script has one), and the Tags panel counts each supporter once, however they got there.

On a campaign with more than one round, know that *still current* is decided question by question: a voter who said Yes after the pitch in round one, then took a path in round two that never reached that question, still counts as a current supporter through it. See [How do I count our supporters?](how-do-i-count-supporters).

## Different surveys for different groups

Most campaigns use one survey for everyone. When a group needs different questions, a **walk list can override the campaign default** with its own — set it on the Survey tab's coverage table or on the Walk Lists page. Each door gets the right questions automatically. See [Running more than one survey](multiple-surveys).

## Reading the results

Each question gets its own card on the campaign's **Home** page, with one row per answer.

The answer's wording comes first and takes as much of the row as it needs, then a short bar, then the percentage and the count. A long answer isn't cut off mid-word — it fits on one line at normal window sizes and wraps onto a second in a narrow one — and the percentages read down the card as a column you can compare by eye. A bar is only ever as long as the percentage printed beside it, so the two can't disagree; an answer only one or two people gave still shows a visible sliver, and an answer nobody gave shows nothing. The bar is short on purpose: it's there so you can see the shape of the answers at a glance, with the exact figure right beside it.

**Click any row** to see the people who chose that answer.

An answer you removed after people had already given it keeps its real wording and is marked **Retired** — it still counts toward the question's total, because those people really did give it.

**About the percentages.** On a **single choice** question they're a share of the people who answered and they add up to 100%. On a **multiple choice** question one person can pick three answers, so they're a share of *picks*, not of people — which is why no single bar gets very long when a question has a lot of options. The small **(i)** beside the card's heading tells you which one you're looking at.

**Free-text questions** group identical wording together and show the most common answers. When more than ten different things were typed, the heading says **top 10 answers** — the card is showing the ten most common, not everything.

## Auditing answers — who chose it, who recorded it

Counts tell you *how many* picked an answer; the drill tells you **who**. On the campaign Home, click any answer in the survey results: every entry shows the voter, the address, **which canvasser recorded it and exactly when**, any note, and an Offline badge if it synced later. Click an entry for the full response — including an *"Edited by …"* line if an admin changed it. A **tag** drill works the same way, with one difference in the numbers: the list counts **entries** (one per round — someone surveyed in two rounds appears twice), while the tag's own number counts **people, once** — the list says so right at the top. Tag drills have no per-canvasser view (several questions can feed one voter's tag, so "who recorded it" has no single answer) — the **By team** table is the split that adds up.

For the full workbench, open the campaign's **Survey Explorer** tab: filters (question, answer, canvasser, walk list, dates), a **By canvasser** ranking ("who's entering Opposed the most, and how much of their own answers is that?"), a map of exactly the matching doors, and a CSV export of the drill. See [The Survey Explorer page](page-survey-explorer) and [How do I see who recorded a survey answer?](who-entered-an-answer).

## Who can edit what

If you're a **team lead**, you can build new surveys and edit or duplicate the ones you authored or that are attached to a campaign you manage — that covers everything above. **Your library is exactly that set**: the survey list and every picker show your own surveys and the ones already on your campaigns, nothing else in the organization.

Two things follow from that. **Be careful swapping away an admin-built survey**: once it's detached from your last campaign using it, it leaves your library and only an admin can bring it back — if you just want different questions, **Duplicate** it first and edit your copy. And if a survey you share shows "**also used elsewhere in your organization**," edits apply there too — same answer: Duplicate before you change it.

And when a survey on your campaign says it **has responses in your organization**, with no number, none of its answers are counted in your campaigns. They belong to another campaign (one that uses it now or used it before), or they're older records that aren't tied to any campaign, which can even be your own campaign's from back then. You won't see whose or how many, but they count: its answer types are locked and it can't switch to Go to, so **Duplicate** it (at the top of its **Edit survey** page) to make either change. When your campaigns do have answers, the counts you see are yours: *10 responses in your campaigns*.

Two things stay with org admins: **archiving or deleting** a survey template, and the **tag library** — you pick from existing tags in the builder but can't create new ones. If an option is missing a tag you need, ask an admin to add it.

## Editing a live survey

Once a survey has responses you can still edit almost everything freely — rename it, reword questions, rename options, reorder, add, or remove. Removed items are quietly retired, so past answers keep reporting. Adding statements, closings, notes and links is safe too, and so is changing the arrows on a survey that already uses Go to. If you remove a block an arrow points to, that arrow goes back to *Continue* and the builder tells you so. Anything you add stays fully editable until you save it: a new question can still change its answer type, and **Remove** takes a new question or answer straight out. It's what the survey was saved with that's protected.

A canvasser's phone keeps the survey it loaded until it refreshes, so change arrows and *Show only if* conditions between shifts rather than during one: a phone still on the old version can save answers to questions the new version no longer asks, and those answers are dropped. Wording changes are safe any time.

> Heads up: Two changes need a fresh copy once a survey has responses — responses anywhere in your organization, not just your campaign's: a question's **answer type** (like single-choice to text), and **switching to Go to** — on a *Show only if* survey with responses, the *then go to* pickers are greyed out. Use **Duplicate** to make a fresh copy (it brings the whole script with it — arrows, notes, links and all) and point your campaign at that: on the campaign's **Edit survey** page, the **Duplicate** button in the box at the top does both at once. Do it between shifts — a phone keeps the survey it loaded until it refreshes, and any survey it sends under the old one after the switch, even one saved earlier and still waiting to upload, is refused and lost. Switching the other way, back to *Show only if*, is always allowed and keeps exactly the same conditions, but once it's saved only a duplicate can use Go to again, so the builder asks first. And if a survey gets its first responses while you're editing it, **Save** can't make those two changes and says why at the bottom of the page, with your edits still there: set that change back and save again, or click **Save my changes as a copy** to keep everything on a new survey in your library. Nothing switches to the copy on its own — use **Change survey** on the campaign's Survey tab, or put it on a walk list, between shifts.
