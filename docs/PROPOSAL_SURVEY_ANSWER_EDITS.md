# Proposal: Edit survey answers on Door Outcomes — change or clear an answer, keep the survey

> **Status: BUILT 2026-10-19, committed in `589c1c0`; code review rounds 1–9's fixes, and the leftovers closed after round 9, uncommitted**
> ([§V](#v-review-log)) — server, web, the phone's history labels (next
> over-the-air update), docs, Help Center and PRIVACY_VERIFICATION item 32. Pinned by
> `answerEdit.test.js`, `answerEdit.int.test.js`, `answerEditRender.smoke.test.js` and the opt-in
> `answerEditScale.int.test.js`, whose 10 s gate failed first (an 18 s review) and passed after the tag
> pass was rebuilt — see §E *Tags* and §S. The plan below is v4 as approved; where the build differs,
> the section says so.
>
> **Found while building, fixed in the same change:** the client report builder's internal notes had
> never rendered (`ClientReport`'s stats schema dropped `provenance` — CLIENT_PORTAL.md *The numbers*);
> History logs a run that stops part-way, then *N more surveys* after Pick up (§G as written — the
> first build logged only completion), and names whoever pressed Undo; a wrapped Help Center bullet
> renders as one item (`markdownBlocks.js`). **Not built as written:** the Erase and blocked-Restore
> messages are generic — they don't name the change or its date (§7), and the *canvasser recorded a
> different result* reason reads *This visit no longer reads Surveyed*.
>
> **Plan and design v4, 2026-10-19.** v4 follows three review
> rounds (ten reviewers; every finding checked against the code, most reproduced on a throwaway
> database; see [§V](#v-review-log)). Round 3 reviewed v3's landing-mark model and found one blocker
> (two deliveries of one chunk could delete the only copy of an original) and four majors; the fixes
> are in [§G](#g-the-writer) and [§H2](#h2-round-3-amendments). The owner's rulings are in
> [§B1](#b1-the-owners-rulings-2026-10-19) and their answers to every open question in
> [§B3](#b3-the-owners-answers-2026-10-19). The six live bugs found along the way are **fixed, tested and
> uncommitted**, ahead of this feature ([§P](#p-found-along-the-way)). Line references are to HEAD
> `bbdaa4b`, before those fixes. The feature itself: a server deploy plus the web build and an index
> build; no data migration; nothing ships to phones. *[As built: the review fixes add two one-time
> console steps — `migrate:removal-strikes` and `repair:answer-edit-words` — and the phone's history
> labels and response wording ride the next over-the-air update; OPERATIONS.md.]*

Related: [CAMPAIGNS.md](CAMPAIGNS.md) (*Door Outcomes*, *Converting to and from Surveyed*, *Unknock*),
[SURVEYS.md](SURVEYS.md) (§E answer normalization, §F submission invariants, §K desk-entered
responses), [VOTERS.md](VOTERS.md) (the profile's survey edit),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (items 12, 13, 14, and 31 for the fixes in §P).

# Part 1 — For everyone

## The problem

Door Outcomes can change what an entry says (Not home → Refused), record answers for a door
(→ Surveyed), take a survey's answers away (Surveyed → Not home), and strike entries (Unknock). Every
one of those works on whole surveys. None of them can change **one answer**.

The case that exposed it. Question 3 of the survey is *Could you help us by taking a yard sign?*. It
is asked only after a *Support* or *Likely Support* answer, and the canvasser can pick several
answers: *Yard Sign Delivered*, *Candidate Follow-Up*, *Volunteer Request* (your survey may call it
*Volunteer interest*). One canvasser didn't know a question can be skipped, so when voters said no to
a sign she picked *Volunteer Request* (139 times) or *Candidate Follow-Up* (97 times) instead. Those
picks are wrong. Her *Yard Sign Delivered* picks, and every other answer on those surveys, are real.

Today an admin has two bad choices. **Surveyed → Not home** removes every answer, and the door stops
counting as surveyed. **Edit on each voter's profile** works one voter at a time, and the old answer
is gone the moment you save, with no undo.

A word on wording. Here a **survey** is one person's answers from one visit, an **answer** is their
reply to one question, and a **pick** is one ticked choice on a pick-several question (one survey can
hold two picks for the same question). One entry in the Door Outcomes table can hold several surveys,
one per person surveyed at that door.

## What changes

**1. A fifth tool on Door Outcomes: Edit answers…** Select Surveyed entries the usual way, press
**Edit answers…**, and choose, question by question:

| Question type | Choices |
|---|---|
| Pick one | **Leave as recorded** · **Clear the answer** · **Change it to …** |
| Pick several | **Leave as recorded** · **Take out picks** (optionally **Replace them with …**) · **Clear every pick** |
| Written answer | **Leave as recorded** · **Clear the answer** |
| A retired question | **Leave as recorded** · **Clear** (pick several: **Take out** too) |

**Take out** removes only the picks you tick and leaves the rest of that person's picks alone.
**Replace them with …** puts a different pick in, but only on surveys that just lost one. **Clear
every pick** removes all of them, so the form warns in red what it would also remove. When you
filtered by answers, the form offers one button: **Take out just Candidate Follow-Up and Volunteer
Request**.

Apply it the same way to everyone, or **one person at a time** (each survey opens with its recorded
answers and you fix what's wrong).

**2. Everything else is kept, exactly.** The knock, the Surveyed status, every answer you didn't
touch, the note, the time, the GPS location, the canvasser, the round and the team stay as recorded.
The voters stay surveyed, so **knocks, billable doors, contact rate and survey rate don't move**.

**3. Questions that follow on from the one you change follow the survey's own logic.** If, after your
change, the survey would never have asked a later question, that later answer goes too. That is what
the phone would have stored. Each one is named in the review and comes back with undo. On a survey
built as a script with "then go to" arrows, a blank answer can end the script early, and the review
says so in red. On the yard-sign survey nothing follows question 3, so nothing else moves.

**4. Who changes.** With an answer filter on, only the surveys that matched it change. On those
surveys the change applies to the whole question, which is why **Take out** exists. Anyone else
surveyed at the same visit is left alone and counted. With no answer filter, every survey at the
selected entries changes. A date range applies to the surveys themselves too, and the review counts
any matching survey your dates left out. If the entries hold answers from two different surveys (a
walk list with its own), the form asks which survey you're editing.

**5. Nothing gets filled in that nobody recorded.** "Change it to …" only touches surveys that have
an answer to that question, and "Replace them with …" only touches surveys that just lost a pick. A
blank stays blank. One person at a time is different: there you can fill in a blank for the person
in front of you.

**6. Priced before it runs,** in numbers you can check against what you saw: *"Taking out Volunteer
Request from 139 surveys and Candidate Follow-Up from 97. That's 214 surveys: 22 had both. 202 are
left with no answer, as if skipped; 12 keep Yard Sign Delivered. Recorded by: Cara Canvasser (214)."*
Then what moves in your survey results campaign-wide, pick by pick, and in any tag counts; what's left
alone and why; and the names of everyone who changes.

**7. The earlier answers are kept, and undo is exact.** Before a survey changes, its earlier answers
are saved on the voter's record ("Before Ada's change on Oct 19"). **Undo** puts every survey back.
It never overwrites newer work: a survey someone re-surveyed or edited afterwards keeps the newer
answers, and the undo names it. If some surveys are held by a later change (an entry was unknocked
in between, say), the change reads *Partly undone*, and you can undo again once that change is
undone.

**8. The voter profile gets the same safety net.** Editing a survey on a voter's profile keeps the
earlier answers the same way, follows the survey's logic like the walkthrough does, and warns if
someone changed the survey while you were editing. Each earlier-answers card has **Restore** and, new,
**Erase** for removing a version for good (for example when a voter asks you to remove something).

**9. "Edited" shows on the survey, and only there.** A changed survey reads *"Edited by ‹admin› on
‹date›"* on the voter profile, the response detail, the activity detail and the map's door panel, and
the exports gain an *Answers edited* column. A survey's **note** reads edited only when someone
changed the note. Today any edit marks it, and this cleanup would have marked about 200 notes.

## Fixing the yard-sign question, step by step

1. **Check the numbers, and save the lists.** Open the **Survey Explorer**. It opens on *Today*, so set
   the dates to **All time** first. If some of her later picks are real, choose **Custom**, leave
   *From* blank and set *To* to the last wrong day; the **Last entry** column shows when she last
   picked each answer. Pick the yard-sign question, click **Volunteer Request**, then **By canvasser**:
   *Cara 139*. Click **Cara's row** so she stays selected, and press **Export CSV**: that's the list to
   send your volunteer coordinator so they know who to drop. Then click **Candidate Follow-Up**: the
   card reads *97*. **Export CSV** again for your follow-up team.
2. **Press Correct in Door Outcomes.** It opens with Cara, your dates and *Candidate Follow-Up*
   already ticked.
3. **Under the yard-sign question, tick Volunteer Request as well.** Candidate Follow-Up is already
   ticked, and clicking it again would untick it. Two ticks on one question mean "either". The count
   reads **205 entries · 203 doors**. A row with a second person at that visit reads *1 other surveyed
   at this visit, not matched*.
4. **Tick the box at the top of the table, then Select all 205 matching → Edit answers…** Not
   *Review removal*, which takes every answer and turns the doors to Not home.
5. **The form** reads *214 surveys matched your filter, at the 205 entries you selected. 9 other
   people surveyed at these visits didn't match and stay as they are.* Questions 1 and 2 stay on Leave
   as recorded. Question 3 reads *Now on these surveys: Volunteer Request 139 · Candidate Follow-Up 97 ·
   Yard Sign Delivered 12*. Press **Take out just Candidate Follow-Up and Volunteer Request**.
6. **Review changes.** *No door, knock or billing number changes.* Then the sentence in point 6 above,
   then *Volunteer Request 412 → 273 (−139) · Candidate Follow-Up 301 → 204 (−97) · Yard Sign Delivered
   520, unchanged*, then the names.
7. **Change 214 surveys.** It runs in the background with a progress card, then appears under
   **Survey answer changes**: *Answers edited · Could you help us by taking a yard sign?: took out
   Candidate Follow-Up, Volunteer Request — 214 surveys changed · 139 Volunteer Request and 97
   Candidate Follow-Up picks taken out*, with **Details** and **Undo**.
8. **Check it.** In the Survey Explorer, Cara no longer appears under Volunteer Request or Candidate
   Follow-Up for those dates, and her Yard Sign Delivered count hasn't moved.

If every one of her picks is wrong, set no dates at all: choosing the canvasser is enough. If your
question 3 is **pick-one**, step 5 offers **Clear the answer** instead, and with the step-3 filter on,
it clears only her Volunteer Request and Candidate Follow-Up answers, because only those surveys
matched.

## Copies made before the change don't update

Saved searches, walk lists and rounds already cut from these answers keep the people they had. A file
already exported keeps the old answers. A published client report keeps its numbers until you
unpublish it and publish it again. The review says this above the confirm button; the per-answer
Export CSV in step 1 is how you tell whoever holds a list who to drop.

## What stays the same, and what moves

| Stays exactly the same | Moves to match the edited answers |
|---|---|
| Knocks, billable doors, contact rate, survey rate, door colors | Survey results on the web and the phone, and the Survey Explorer |
| Each voter's Surveyed status, invoices and statements | Tag counts (*identified* and *current*) |
| Door and survey counts per canvasser and team, the Timeline, FbTime door counts | Each answer's per-canvasser split in the Survey Explorer, and a canvasser's own answer tallies for that day on their phone |
| Published client reports | The client report builder's live preview |
| The phone app: no update is needed (its *Edited* badges and History labels arrive with the next app update) | Exports of survey answers, the map's answer filter, and walk lists and rounds cut after the change |

## Who can do it, and who sees it

**Org admins only**, like everything else on Door Outcomes, and the profile's Edit, Restore and Erase
stay admin-only. Each change and its undo appear in the campaign's **History**.

**Team leads.** Your standing rule is that a lead may be the paying client and sees that campaign's
data, and today leads see every correction an admin makes, read-only. So under this plan a lead on
this campaign would see: on each of the 214 voters' profiles, a card *Before Ada Admin's change on
Oct 19 · recorded by Cara Canvasser* listing her original picks, fake ones included; *Edited by Ada
Admin on Oct 19* on the profile, the response detail, the activity detail and the map door panel;
the History row; the export column; and the client report builder's note. You confirmed that on
Oct 19: leads see these corrections exactly as they see every other correction today.

## Before Election Day

Your GPS and error-recovery plans freeze deploys from **Oct 27 through Nov 4**, except emergency fixes.
You asked for this as soon as possible, done right. So there is no date promise: if the feature isn't
passing its checks (Part 2 §T) by **Oct 26**, it ships on **Nov 5**, not as an emergency fix. The lists
you'd act on before then need no new code: the Survey Explorer CSVs from steps 3 and 4 below already
name every fake pick, so your coordinators can take those names off the volunteer and follow-up lists
today. Nothing is needed after the deploy for a 214-survey job: no migration, and the index build can
follow.

Six problems found while planning this are already fixed, separately: a removed survey that could be
restored as a counted survey, an undo that could be "picked up" into making the change again, survey
copies that could be lost without a trace, and two phone-upload cases. Part 2 §P has them.

## Design

Text sketches of each screen that changes, with real copy where it matters, built from the page's
existing pieces (Modal, Badge, Button, the chip style, the run cards, the before → after rows).

### 1. Action bar, with Surveyed entries selected

```
 205 selected   Clear
        [ Edit answers… ]  │  Change to [ Not home ▾ ] [ Review removal ]  │  [ Unknock… ]
```

**Edit answers…** comes first, as a quiet (secondary) button fenced off by the divider the page
already uses for Unknock. It appears only when every selected entry is Surveyed, and never on a
lit-drop campaign. (Before *Select all N matching* is pressed, the bar reads "50 selected · Select all
205 matching", as it does today.)

### 2. The edit form

```
┌ Edit survey answers ────────────────────────────────────────────────────── × ┐
│ 214 surveys matched your filter, at the 205 entries you selected               │
│ Support Survey · Filtered to: Cara Canvasser · answered Candidate Follow-Up /  │
│ Volunteer Request                                                              │
│ 9 other people surveyed at these visits didn't match and stay as they are.     │
│                                                                                │
│ Pick what to change. Every other answer, the note and the knock itself stay    │
│ exactly as recorded, and these voters stay surveyed.                           │
│                                                                                │
│ ( • ) Same change for everyone      (   ) One person at a time                 │
│                                                                                │
│ 1  Can we count on your support?  (pick one)          answered on 214 of 214   │
│    (•) Leave as recorded   ( ) Clear the answer   ( ) Change it to [      ▾]   │
│                                                                                │
│ 2  What is your top issue?  (pick several)             answered on 201 of 214  │
│    (•) Leave as recorded   ( ) Take out picks   ( ) Clear every pick           │
│                                                                                │
│ 3  Could you help us by taking a yard sign?  (pick several)                    │
│    asked only after Support or Likely Support          answered on 214 of 214  │
│    Now on these surveys: Volunteer Request 139 · Candidate Follow-Up 97 ·      │
│                          Yard Sign Delivered 12                                │
│    [ Take out just Candidate Follow-Up and Volunteer Request ]                 │
│    ( ) Leave as recorded   (•) Take out picks   ( ) Clear every pick           │
│       Take out  [✓ Candidate Follow-Up 97] [✓ Volunteer Request 139]           │
│                 [  Yard Sign Delivered 12]                                     │
│       Replace them with  [ none ▾ ]   (only on surveys that lose a pick)       │
│       A survey left with no picks reads exactly as if the question was         │
│       skipped. Yard Sign Delivered stays on the 12 surveys that have it.       │
│                                                                                │
│ ▸ Retired questions (1)                                                        │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                [ Cancel ]  [ Review changes ]  │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Every count on the form is over the selected surveys only.
- **Take out** lists every pick those surveys actually hold, each with its count. That includes
  retired options, "Other (specify)", and any answer saved in an old format that no longer matches an
  option (shown as *old answer: "Volunteer interest"*).
- **Replace them with** offers live options only.
- With **Clear every pick** chosen, the "Now on these surveys" line turns red: *Clearing removes every
  pick on these surveys: Volunteer Request 139 · Candidate Follow-Up 97 · Yard Sign Delivered 12. To
  keep Yard Sign Delivered, use Take out picks.*
- When the entries hold answers from more than one survey, a line at the top reads *These entries hold
  answers from two surveys. Edit answers from: [ Support Survey (214) ▾ ]*.
- **Change it to** lists live answers only, and never "Other (specify)". A written question offers
  Leave / Clear only.
- **Review changes** stays disabled until some question is set to something other than Leave.
- **One person at a time** replaces the questions with **Start**.

### 3. The review step

```
┌ Change answers on 214 surveys ──────────────────────────────────────────── × ┐
│ Survey answers only · Support Survey                                           │
│                                                                                │
│ No door, knock or billing number changes. Knocks, billable doors, contact      │
│ rate and survey rate stay exactly where they are, and every one of these       │
│ voters stays surveyed.                                                          │
│                                                                                │
│ Taking out Volunteer Request from 139 surveys and Candidate Follow-Up from     │
│ 97. That's 214 surveys: 22 had both. 202 are left with no answer, as if        │
│ skipped; 12 keep Yard Sign Delivered.  Recorded by: Cara Canvasser (214).      │
│                                                                                │
│ YOUR SURVEY RESULTS, WHOLE CAMPAIGN                                            │
│  Could you help us by taking a yard sign?                                      │
│    Volunteer Request        412   →   273   (−139)                             │
│    Candidate Follow-Up      301   →   204   (−97)                              │
│    Yard Sign Delivered      520   · unchanged                                  │
│    All picks              1,233   →   997                                      │
│  Tag "Volunteer" (only shown when the changed answers carry a tag)             │
│    Identified               401   →   268      Current   388   →   259         │
│                                                                                │
│ LEFT AS THEY ARE                                                               │
│    9  people at the same visits who didn't match your filter                   │
│                                                                                │
│ WHO CHANGES (214) · the earlier answers stay on each voter's record            │
│  Jane Doe    12 Oak St · Aug 4 · Cara C.   Yard sign?: Volunteer Request → blank│
│  Raj Patel   14 Oak St · Aug 4 · Cara C.   Yard sign?: Yard Sign Delivered;    │
│                                    Volunteer Request → Yard Sign Delivered     │
│  …                                                     Showing 50 of 214.      │
│                                                                                │
│ Copies made before this change don't update: saved searches, walk lists and    │
│ rounds already cut from these answers, files already exported, and a published │
│ client report until you publish it again. Each changed survey reads "Edited by │
│ you". Undo puts every answer back, except on a survey someone changes          │
│ afterwards; those are named.                                                    │
├────────────────────────────────────────────────────────────────────────────────┤
│                                     [ Back ]   [ Change 214 surveys ]  (red)   │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Changed figures are red, unchanged ones read "· unchanged" (the page's before → after row). The
  confirm is red because survey results are reported numbers. Picks are joined with "; " on these
  screens, as the entries table already does (the profile and the response drawer join with ", "
  today, VoterDetailPage.jsx:27 and ResponseDetailDrawer.jsx:154; they keep that).
- When a change drops later answers, a block lists each question and count: *How big a sign? · 87
  answers removed (no longer asked)*. A script ending early gets a red line: *A blank answer to
  question 3 ends this script, so the answers after it on that path go too.*
- A written question shows how many answers are cleared on the selected surveys, without a
  campaign-wide figure (the results card shows only the top ten written answers).
- "Left as they are" lists only the reasons that apply:
  - no answer to change;
  - already that answer;
  - had none of the picks you're taking out;
  - an old answer this tool can't safely adjust;
  - taken outside your dates;
  - recorded under another survey;
  - *N more surveys matched at visits whose latest survey falls after your dates — widen the dates to
    include them*;
  - *N entries an earlier change converted aren't included — undo that change first, or edit those
    surveys on the voter's profile*.
- **Back** keeps every choice. If one of these surveys changed between this review and the confirm,
  the confirm refuses with *Something changed since you reviewed this — review again*, and nothing is
  written. Surveys recorded after the review are simply not included.

### 4. The run list and the live run

Edits are listed in the existing **Survey answer changes** card, newest first, beside the
conversions. The conversion rows and cards change "answers recorded / removed" to "surveys recorded /
removed", because "answer" now means one reply.

```
 Answers edited · Could you help us by taking a yard sign?: took out Candidate Follow-Up, Volunteer Request
 214 surveys changed · 139 Volunteer Request and 97 Candidate Follow-Up picks taken out · Ada Admin · Oct 19, 2:14 PM
 Filtered to: Cara Canvasser · answered Candidate Follow-Up / Volunteer Request
                                                                          [ Details ]  [ Undo ]
```

| What happened | The row reads | Its buttons |
|---|---|---|
| Waiting to start | *Waiting to start*; after 10 minutes, *Waiting for the worker* | after 10 minutes, **Start again** |
| Running | *Working · 120 of 214 surveys* | none |
| Finished | the summary above | **Details**, **Undo** |
| Stopped part-way | *Stopped · 120 of 214 changed* | **Pick up where it stopped**, **Undo what landed** |
| Undone | *Undone · 214 put back* | none |
| Undone, with some surveys changed since | *Undone · 212 put back · 2 kept newer answers* | **Undo again** (those two may come back if the newer change is undone) |
| Partly undone | *Partly undone · 211 put back · 3 waiting on a later change* | **Undo again** |
| Undo stopped | *Undo stopped* | **Retry undo** (never "Pick up") |
| One person at a time, unfinished | *Unfinished — 12 of 30 done* | **Resume**, **Stop here** |

Once an undo has started, the change can never be picked up again.

### 5. Details

```
┌ Answers edited · Could you help us by taking a yard sign?: took out … ─── × ┐
│ Ada Admin · Oct 19, 2:14 PM                                                  │
│                                                                              │
│ Jane Doe · 12 Oak St · Round 1 · recorded by Cara Canvasser · Aug 4          │
│   Could you help us by taking a yard sign?: Volunteer Request → blank        │
│ Raj Patel · 14 Oak St · Round 1 · recorded by Cara Canvasser · Aug 4         │
│   Could you help us by taking a yard sign?:                                  │
│     Yard Sign Delivered; Volunteer Request → Yard Sign Delivered             │
│ …                                                          Previous   Next   │
│ ▸ Left as they are (9)                                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

After an undo, the list shows only what the undo didn't put back, each with its reason: *kept newer
answers*, *waiting on Unknock (Oct 20) — undo that, then Undo again*, or *no longer on file (deleted
on the profile, or re-recorded at the door)*.

### 6. One person at a time

```
┌ Jane Doe ─────────────────────────────────────────────────────────────── × ┐
│ 12 Oak St · Round 1 · recorded by Cara Canvasser · Aug 4, 3:12 PM           │
│ Survey 3 of 30   ███████░░░░░░░░░░░░░░░░░░░                                  │
│                                                                             │
│ 1  Can we count on your support?          [ Support            ▾]           │
│ 2  What is your top issue?                [x] Healthcare  [ ] Schools …     │
│ 3  Could you help us by taking a yard sign?                                 │
│                                           [ ] Yard Sign Delivered           │
│                                           [ ] Candidate Follow-Up           │
│                                           [ ] Volunteer Request  was: ticked│
│                                                                             │
│ Also on file, not asked on this path:  Volunteer?: Maybe                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ [ Finish later ]                               [ Skip ]  [ Save & next ]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

- The form opens with this person's recorded answers and follows the survey's logic live. A changed
  field shows "was: …". Answers on file for questions this path doesn't ask are listed read-only and
  kept. An old-format answer that matches no option is shown read-only with its own **Clear**.
- **Skip** moves on and changes nothing; Resume starts from where you left off. **Save & next** with
  nothing changed counts as a skip.
- If the survey changed since this screen opened, **Save & next** refuses and reloads it: *This survey
  changed while you were editing. The latest answers are shown — make your change again.*
- The whole session undoes as one change.

### 7. The voter profile

The current card after an edit:

```
 Support Survey · Aug 4, 2026 · Cara Canvasser                          Edit   Delete
   Can we count on your support?: Support
   What is your top issue?: Healthcare
   Could you help us by taking a yard sign?: —
 Edited Oct 19, 2026 by Ada Admin · the earlier answers are kept below.
```

The earlier answers, beneath it, in the style preserved answers already use:

```
┌ Support Survey · Before Ada Admin's change on Oct 19 · recorded by Cara Canvasser ─┐
│                              [ Earlier answers ]   Restore these answers…   Erase…   │
│   Can we count on your support?: Support                                             │
│   What is your top issue?: Healthcare                                                │
│   Could you help us by taking a yard sign?: Volunteer Request                        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Restore** asks *"Put back the answers and the note from before Ada Admin's change on Oct 19? The
  current ones are kept the same way, so you can swap back."*
- **Restore is offered only while the visit still reads Surveyed** (any kind of preserved answers).
  Otherwise the card reads *This visit no longer reads Surveyed, so there's no survey to put these
  answers into*, followed by the reason when it is known: *It was changed on Door Outcomes (Unknock,
  Oct 20). Undo that change first.* Or: *The canvasser recorded a different result at this door.*
- **Erase…** asks *"Erase these earlier answers for good? This can't be undone."* If the card belongs
  to a Door Outcomes change that is still in effect, it adds what that means: *If the Oct 20 Unknock
  is undone later, this door comes back as Surveyed without these answers.* Or: *Undo on Ada's Oct 19
  change won't put this survey back.*
- A card a desk entry produced says *entered by ‹admin›* rather than *recorded by*.
- **Edit** opens the same per-person editor as the walkthrough. It follows the survey's logic, shows
  off-path answers read-only, and keeps the earlier answers. When a voter asked you to remove
  something, save the edit, then **Erase** every earlier card that still holds it: each kept version is
  a full copy, so a note can sit on several.

### 8. The entries table

At a visit with several people, the row's second line becomes neutral and muted for every action:
*1 other surveyed at this visit, not matched*. The old red *their answers go too* was true only for
Review removal and Unknock, whose own review steps already say it.

### 9. History

```
 Survey answers edited: Could you help us by taking a yard sign? — took out Candidate Follow-Up,
 Volunteer Request on 214 surveys                                          Ada Admin · Oct 19
 Survey answer edit undone: 212 surveys put back, 2 kept newer answers     Ada Admin · Oct 20
```

Answer-edit rows get their own sentence (as team moves already do) instead of "changed from … to …",
and are highlighted. So are Surveyed conversions and Unknock rows, which today aren't highlighted and
print raw keys (§P F3).

# Part 2 — Technical reference

## A. What the design rests on (checked at `bbdaa4b`)

1. **Every existing Door Outcomes act works on whole rows** (reclassify, the conversions at
   [surveyConversion.js:402, :560](../server/src/services/canvass/surveyConversion.js), unknock). Only the
   profile PATCH ([voters.js:530](../server/src/routes/admin/voters.js)) writes inside `answers[]`.
2. **Selections reach responses** through the visit triple `(householdId, passId ?? null, userId)`
   ([doorKey.js](../server/src/services/canvass/doorKey.js)). Stamped entries (any `reclassified`,
   including every desk-entered visit) are excluded from every selection
   ([reclassifyOutcomes.js:99-109](../server/src/services/canvass/reclassifyOutcomes.js)). `q.answerMatch`
   ([entryScope.js:165](../server/src/services/canvass/entryScope.js)) holds the response-side clauses
   without the template constraint. The date window filters entries by the activity's `timestamp`, and
   a door re-surveyed in a round keeps one activity row carrying the latest survey's time
   ([canvass.js:933-956](../server/src/routes/mobile/canvass.js)).
3. **A skipped question, as stored.** The phone posts a row for every visible answerable question
   ([SurveyForm.jsx:421](../mobile/components/SurveyForm.jsx)): skipped pick-one or written as
   `{ answer: null, optionIds: [], otherText: null }`, skipped pick-several as `{ answer: [], … }`;
   off-path questions post no row. Every reader treats `[]`, `null` and `''` alike (verified in round 1).
   The phone stores an "Other" text untrimmed ([surveyRunner.js:173](../mobile/lib/surveyRunner.js)); the
   web editor trims it ([surveyAnswerForm.js:76](../client/src/lib/surveyAnswerForm.js)).
4. **Pick-several totals count picks** ([reports.js:1420](../server/src/routes/admin/reports.js)); a
   written question's results are its top ten texts (:1344). The Door Outcomes chips carry
   campaign-wide counts.
5. **An answer edit cannot move money.** Knocks, rates and billable doors read activity rows only;
   surveyed status is existence-based ([status.js:27](../server/src/services/canvass/status.js)); no
   `Campaign.stats` key reads answers ([campaignCounters.js:130-139](../server/src/services/reports/campaignCounters.js)).
6. **The profile PATCH today** (voters.js:530-565) re-normalizes the whole posted set (dropping rows
   whose key the template no longer has), stamps `editedBy/editedAt` on a no-op save, has no
   compare-and-swap, and destroys the earlier answers. The profile wire omits each question's `retired`
   flag ([voterProfile.js:318-333](../server/src/services/voters/voterProfile.js)), so retired questions
   are editable.
7. **`editedBy/editedAt` is also the note's edited stamp** in the Notes hub (reports.js:4894, :4972) and
   the Notes export ([exportBuilders.js:1759, :1868](../server/src/services/export/exportBuilders.js)).
8. **The archive** holds verbatim snapshots from four producers
   ([SurveyResponseArchive.js:68](../server/src/models/SurveyResponseArchive.js)). Restore is a swap that
   archives the displaced response as `via:'restore'` (voters.js:599-632) and writes `editedBy/editedAt`
   back verbatim. The erase route (voters.js:637) exists, but no screen calls it. The archive helpers'
   `insertMany(ordered:false)` silently skip an invalid snapshot
   ([archiveOverwrite.js:32-46](../server/src/services/surveys/archiveOverwrite.js)), and their callers
   then delete the original (§P F9).
9. **Mongoose re-casts** every answer row it writes: an old row gains `optionIds: []` and
   `otherText: null`, and keys take schema order. The unknock and conversion reverts recreate responses
   with `SurveyResponse.create` (unknock.js:296, surveyConversion.js:890), so raw bytes don't survive
   them (verified in round 2).
10. **Surveys can vanish with no archive copy:** the profile Delete (voters.js:567-588), and a
    canvasser's later door result at the same visit, which deletes their surveys there (canvass.js:429-433).
11. **Delete cascades filter by `campaignId` / `organizationId` per model**
    ([deleteCampaign.js:189](../server/src/services/campaigns/deleteCampaign.js),
    [deleteOrganization.js:211](../server/src/services/platform/deleteOrganization.js)) under `strictQuery:
    true` ([db.js:26](../server/src/config/db.js)): a model without the field would be wiped across
    tenants, which is why [UnknockRunChunk.js](../server/src/models/UnknockRunChunk.js) carries both ids.
12. **The worker** registers `OUTCOME_CONVERT` with concurrency 1 ([worker.js:147](../server/src/worker.js));
    its failure reconcile and boot `syncIndexes` know only `SurveyConversionRun` (:251-264, :66); every
    job retries (`attempts: 3`, [queues/index.js:36-41](../server/src/queues/index.js)) and BullMQ
    redelivers a stalled job under the same id. On SIGTERM the worker drains for 25 s (:268-296).
13. **The survey version** goes up on every save that includes questions
    ([surveys.js:745](../server/src/routes/admin/surveys.js)), and leads can save surveys on their
    campaigns (:693).
14. **The Survey Explorer** opens on Today unless a range is in the URL
    ([SurveyExplorerPage.jsx:91-94](../client/src/pages/SurveyExplorerPage.jsx)), has a per-answer Export CSV
    (:351) and a *Last entry* column per canvasser, and its *Correct in Door Outcomes* link carries one
    option, the selected canvasser and the dates (:667-688). Door Outcomes seeds exactly that one option
    ([DoorOutcomesPage.jsx:110-120](../client/src/pages/DoorOutcomesPage.jsx)), and its chips toggle.
15. **Leads see corrections today** (History at campaigns.js:340-346; every archive producer in the
    lead-scoped profile at [campaignVoters.js:133](../server/src/routes/admin/campaignVoters.js) and
    [mobile/voters.js:213](../server/src/routes/mobile/voters.js); *Edited by* and *Desk entered* in the
    response drawer; the lead-runnable answer exports), and the owner's standing ruling is that a lead may
    be the paying client.

## B. Decisions

### B1. The owner's rulings (2026-10-19)

1. **Who changes:** with an answer filter on, only the responses that matched it; with none, every
   response at the selected visits. The review counts the others.
2. **Follow-ups:** an answer the edit makes hidden (visible before, hidden after) is dropped, archived,
   counted and restored by undo. Answers already hidden before the edit are untouched.
3. **Blanks:** a bulk change applies only where the question has an answer. Blanks stay blank.
4. **The profile edit** archives the earlier answers the same way, as a restorable card.

### B2. Settled by the plan

| # | Settled as | Why |
|---|---|---|
| D2 | An `Answers edited` column (yes or blank), appended after the last column, in Canvassing activity (one row per visit); "(answers edited)" in a Results by voter round's Survey cell beside "(desk entered)"; the backup README's "the as-recorded snapshot" ([exportTypes.js:178](../server/src/services/export/exportTypes.js)) reworded. Survey results (wide) already has `Edited` (exportBuilders.js:901). **Not** on the one-row-per-answer files (Survey answers (detailed), the voters-by-answer CSV), for §L's reason: there it reads as "this answer was altered". | Appending follows the `Offline` precedent ([campaigns.js:1178](../server/src/routes/admin/campaigns.js)), so no column a client's spreadsheet reads moves. |
| D3 | "K of these N responses were edited by an admin" beside the builder's desk-entered line ([computeReport.js:209-220](../server/src/services/reports/computeReport.js)); never on the published report. | Mirrors the existing desk-entry line. |
| D4–D5 | Bulk writes no free text: written answers can only be cleared, "Other (specify)" only cleared or taken out. Per person can write either. | The same text on many surveys is fabrication. |
| D6 | One person at a time is kept, up to 500 surveys a session. | It is the page's house pattern (door by door); 500 is a size guard. |
| D7 | On a Script-flow survey a blank answer that ends the script drops the later answers on that path, named in red. | Ruling 2 as written. |
| D8 | The profile Edit follows ruling 2 through the same per-person editor. | Ruling 4 says "the same way". |
| D9 | **Erase** on every earlier-answers card, with the warnings in Part 1 Design §7. No "keep the earlier version" switch. | Erase covers a removal request in one more click, without a second write path. |

### B3. The owner's answers (2026-10-19)

- **Q1. Team leads:** keep it. Leads see this change exactly as listed in Part 1 (*Who sees it*), as
  they see every other correction today.
- **Q2. Timing:** "as soon as possible but we need to do things right." No date promise: it deploys by
  Oct 26 if §T passes, otherwise on Nov 5, never as an emergency fix.
- **Q3. The fix-now change** (F1, F5, F7, F9): yes. **Built** (§P).
- **Q4. The phone upload fixes** (F2, F4): now. **Built** with Q3 (§P).
- **Privacy:** approved (the message said "item 21", read as this plan's privacy item, then numbered
  31). The fixes in §P ship first and took item 31 in PRIVACY_VERIFICATION, so this feature's entry is
  **item 32**; the approval covers its content as written in §Q.

## C. The edit plan and the applier — `services/canvass/answerEdit.js`

### C1. The plan

```js
// One entry per question the admin set to anything but "Leave". Validated against the run's frozen template.
[
  { questionKey: 'support', op: 'clear' },
  { questionKey: 'support', op: 'set', optionIds: ['undecided'] },                 // pick one: one live id
  { questionKey: 'yard_sign', op: 'adjust',                                         // pick several
    remove: ['candidate_follow_up', 'volunteer_request'], removeTexts: [], replaceWith: [] },
]
```

**Bulk refusals** (each a code, never silently ignored): an unknown or statement key →
`PLAN_UNKNOWN_QUESTION`; a key twice → `PLAN_DUPLICATE_QUESTION`; `set` on anything but pick-one,
`adjust` on anything but pick-several, or anything but `clear` on a written question → `PLAN_OP_TYPE`;
on a retired question anything but `clear` or a remove-only `adjust` → `PLAN_RETIRED_QUESTION`; a
`set` or `replaceWith` id that is not a live option, or is `__other__` → `PLAN_OPTION_INVALID`; an id
in both `remove` and `replaceWith` → `PLAN_ADJUST_OVERLAP`; an empty plan → `PLAN_EMPTY`. `remove` may
name any id the question has ever had, retired ones and `__other__` included; `removeTexts` names old
answer texts that match no option.

**Per-person plans** (a walkthrough step, the profile Edit) are built from the posted answer set by a
per-question diff against the stored answers:
- Unanswered on both sides is no change, whether the row is missing, empty, `null`, `[]` or `''`.
- Otherwise compare the ids as a **set** (old text mapped to ids by exact text, as the editor seeds
  them), the written text trimmed, and the "Other" text trimmed with `''` read as `null`.
- Label and snapshot-text drift, and posted keys the template doesn't know, are ignored.
- A changed question becomes `clear` or `set` (`optionIds`, or `answer` for a written question, plus
  `otherText`).
- Per person may write free text and "Other", and may fill a blank.

### C2. `applyEditPlan(questions, answers, plan, { mode })`, pure

Returns `{ answers, changed, rows: [{ questionKey, kind: 'cleared'|'changed'|'dropped', before, after,
removedIds, addedIds }], skipped: [{ questionKey, reason }], endsScript }`. Each rule is pinned by a
unit test.

1. **Untouched rows are carried exactly**: never re-normalized, relabelled or dropped, in their
   original order. Edited and new rows are emitted in schema key order (`questionKey, questionLabel,
   answer, optionIds, otherText`) with no `undefined` anywhere.
2. **`clear`** writes the phone's skip literal for the question's type (§A3), with the template's
   current label. An unanswered row is a no-op (`already_blank`). A clear applies whether or not the
   question is on that person's path, because a hidden answer still counts in results.
3. **Bulk `set` and `adjust`** apply only to a row answered the way `/survey-results` counts it:
   `keysOf(row)` non-empty, where `keysOf` is the JavaScript twin of `choiceKeyStages`' key
   (`optionIds` when non-empty, else the `answer` text or texts, `null` and `''` dropped).
   - No row, or an empty row → `not_answered` (ruling 3). The same value → `same_answer`.
   - An `adjust` that removes nothing on a survey → `no_matching_picks`.
   - `replaceWith` is added only on a survey where something was removed. The result is the current
     ids minus `remove`, then `replaceWith` in option order; if empty, the skip literal.
   - `answer` text is rebuilt from the ids by `snapshotAnswerText`
     ([normalizeAnswers.js](../server/src/services/surveys/normalizeAnswers.js)); `otherText` survives only
     while `__other__` stays.
4. **Old rows** (empty `optionIds`, a text answer):
   - `set` replaces them with an id-native row.
   - `adjust` maps each text to an id by exact text over every option, retired ones included, and
     drops any text named in `removeTexts`.
   - A text that still matches nothing makes the row skip (`legacy_answer`) rather than lose part of
     the answer.
5. **Follow-ups (ruling 2):**
   - Compute `before = visibleQuestionKeys(questions, cells(stored))` and `after =
     visibleQuestionKeys(questions, cells(edited))`, with cells built by `makeCell`, exactly as
     `normalizeAndFilterAnswers` does.
   - Every **answered** row whose key is in `before` and not in `after` is removed (the phone posts no
     row for a question it never showed) and reported `dropped`.
   - `endsScript` is set when a dropped question was reachable only through an edited one.
6. **Ghost guard (per person only):** a `set` that fills a blank on a question hidden in `after` is
   discarded and reported `hidden_on_path`.
7. `changed` is false when nothing differs: the survey isn't written, archived or counted.

### C3. Unit tests — `answerEdit.test.js` (node:test, no database)

**Fixtures:**
- the demo yard-sign survey (pick-several, `visibleIf` on question 1);
- a Script-flow survey compiled by `routing.js` with arrows on question 3;
- a three-level chain (sign → size → color);
- a retired question and option;
- an "Other" write-in;
- a written question;
- old 3- and 4-key rows, including an unmappable text.

**Asserted:**
- rules 1–7, one by one;
- Take out leaves the skip literal on fake-only surveys and `['yard_sign_delivered']` on mixed ones;
- Clear on a mixed survey removes the sign;
- `replaceWith` lands only where a pick was removed;
- the script tail drops and sets `endsScript`;
- an answer hidden beforehand is kept;
- untouched rows are deep-equal, key order included;
- every emitted row passes `answerSchema.validateSync()`;
- every refusal code.

**Diff tests:** an untouched save (including an "Other" text with a trailing space, and ids
re-ticked in another order) is no change; a pick-several cleared in the editor is `clear`.

## D. Which surveys an edit touches

1. Resolve the scope once (`resolveEntryScope`). Refuse a truncated answer or search scope without ids
   (`ANSWER_SCOPE_TRUNCATED`, `SEARCH_SCOPE_TRUNCATED`, campaigns.js:1746-1758). Resolve over
   `CONVERTIBLE_SOURCES`, refuse `SELECTION_SPANS_DIRECTIONS`, and narrow to `['survey_submitted']`.
   Empty → `EMPTY_SELECTION`; more than 25k entries → `SELECTION_TOO_LARGE`.
2. **Held by earlier changes:** the same entry filter with the stamp rule inverted
   (`reclassified: { $exists: true }`, every other clause kept, the answer clause included), so the
   count matches the filter the admin set.
3. **Responses at the selected visits**, 2,000 rows at a time:
   - The rows are folded with `tripleClause` (answerScope.js:46) into `{ passId, userId, householdId:
     { $in } }` groups. Measured in round 1: 25k visits in 1.9 s folded, against 61–77 s for a
     per-visit `$or`. *Built differently since code review round 8:* one clause per batch, its doors
     and rounds (`visitsClause`), each batch's own visits kept by `doorKey` — the groups were one per
     round and canvasser, and a crew of hundreds made every read a fresh plan (§V, round 8).
   - Constrained further by `surveyTemplateId` (the chosen survey), the scope's date window on
     `submittedAt`, `createdAt ≤ asOf` (from the dry run), and `$and: q.answerMatch` under an answer
     filter.
   - Each pass counts what it leaves out: `notMatched`, `outsideDates`, `otherSurvey`.
4. **Matched but not selected:** under an answer filter, `q.answerScope.responses` (matched responses
   in the window) minus the matched responses found at the selected visits counts the surveys at visits
   whose latest entry falls outside the dates (§A2).
5. **Which survey:** the dry run lists every survey among the targeted responses with its count; with
   several, the form asks (default: the most), and the plan carries `surveyTemplateId`. A missing
   template is a 404; an archived one is allowed (nothing new is authored against it).
6. **Caps**, on its own env-overridable cap so tuning it never moves the conversions':
   - 25k entries;
   - `answerEditCap()` responses (50k) → `TOO_MANY_RESPONSES`;
   - one-person sessions 500 → `QUEUE_TOO_LARGE`.

   The scale test (§S) measures the dry run, the create and the job at the caps on a 79k-response
   dataset; the caps ship only if the dry run and create finish under 10 s there.
7. **Bounded memory:** every pass streams and keeps only counters, per-key deltas, the affected voter
   ids for tags, and the first 50 manifest rows.

## E. Pricing — one dry-run route

`POST /answer-edits` with `dryRun: true`. Without a plan it feeds the form; with one it prices the
change, so the form's numbers and the review's come from one computation.

- **Always:**
  - the surveys present, with counts;
  - the chosen survey's answerable questions (retired ones flagged);
  - each question's answered count in surveys;
  - each pick's count (every pick present, retired, "Other" and old texts included);
  - `notMatched`, `outsideDates`, `otherSurvey`, `matchedNotSelected`, `heldByRuns`;
  - `responses`, the template `version`, `asOf`, and the selection `digest`.
- **With a plan,** per survey `applyEditPlan` folds into:
  - surveys changed, each skip reason, and per pick the counts removed and added;
  - per question, campaign-wide pick rows before → after: `before` is the `/survey-results`
    aggregation for that question over `{ campaignId, surveyTemplateId }` (`choiceKeyStages` + `$group`
    + `mergeOptionRows`), and `after` is `before` plus the in-memory delta keyed by `keysOf`, compared
    as keyed maps with a missing key counting as 0;
  - written questions: answers cleared on the selection only;
  - dropped follow-ups per question, and `endsScript`;
  - the share of each canvasser (`recordedBy`);
  - the manifest: first 50 changed surveys, newest first, with voter, address, round, recorded-by and
    each changed question's before → after through `formatAnswerCell`.
- **Tags:** for every tag carried by an option in the actual diffs (removed, added or dropped),
  *identified* and *current* before → after, for the affected voters only, since no other voter can
  move.
  - Their template responses are read in one query, the edits substituted in memory, and run through
    the real stages with `$documents`: `answerTagClause` + a voter `$group` for identified, and
    `latestAnswerKeyStages` + `currentTagVoterSet` for current. A probe in round 2 matched the
    production rollup this way, including an older genuine pick becoming the latest.
  - After = before − the affected voters' before + their after.
  - **As built:** one `$documents` call per 1,000 affected voters carries both versions of every touched
    tag as one `$facet` (identified and current, before and after), and ships only what those stages
    read — each survey's id, voter, time and its answers to the tag questions — split by voter while a
    call is over 8 MB. The first build made four calls per tag per batch with whole surveys; at the 50k
    cap that took 15 of the review's 18 s. **And the answers go in `$literal`:** `$documents` evaluates
    its documents as expressions, so a bare answer text starting with "$" ("$50 or more") was read as
    a field path and dropped — on MongoDB 7.0.2 a plain `{ a: '$50 or more' }` comes back as `{}`, and
    inside an array as `null`. An old text-only answer under a tagged "$…" option would have been
    priced wrong; `answerEdit.int.test.js` pins it (it fails on the first build).
  - **Precondition:** MongoDB 5.1 or later on the cluster (check the version on the Atlas cluster card
    before building). If it is older, a JavaScript mirror that copies `answerTagClause`'s text lane
    exactly, with the same oracle test.
- **The digest:** the targeted responses' `(responseId, fingerprint)` pairs (§G) folded
  order-independently, plus their count, as of `asOf`. The create call sends the digest, `asOf` and the
  template version back; it re-resolves under the same `asOf` and refuses `409 REVIEW_STALE` on any
  difference, writing nothing. A survey recorded after the review is excluded rather than refused, so
  new surveys never cause a refusal; re-surveying a voter already in the selection does (its
  fingerprint changed), which is the point.
- **Money** is not simulated: provably nothing moves (§A5). The integration test asserts it.
- **The oracle:** the integration test runs the real edit and asserts that `/survey-results` (keyed
  maps, missing = 0) and the tag rollups afterwards equal the previewed `after`.

## F. The run records

**Why its own model.** `SurveyConversionRun`'s callers branch two ways and every `else` means
from_survey (surveyConversion.js:97, :679, :732, :792, :858; campaigns.js:1613, :2151;
DoorOutcomesPage.jsx:1026; ConversionRunCard.jsx:14; RunDetailModal.jsx:80). `bumpPlatformOnce`
(:679) would even subtract an edit's archived count from the platform total. The house pattern is
one run model per act.

```js
// AnswerEditRun
{
  organizationId, campaignId, byUserId,
  mode: 'bulk' | 'queue',
  template: { surveyTemplateId, version, questions },  // FROZEN at create: the applier and evaluator use it
  plan: [{ questionKey, questionLabel, op, optionIds, remove, removeTexts, replaceWith }],   // bulk
  planSummary: String,      // frozen; for a queue session, built from its steps as it goes
  selection: { scope: Mixed, byIds: Boolean, digest: String, asOf: Date, total: Number },
  scopeSummary: String,     // describeScope(), frozen
  editedAt: Date,           // set ONCE at create; every response a bulk run edits carries it
  status: 'open' | 'pending' | 'running' | 'completed' | 'failed',   // the apply phase
  queueJobId: String, cursor: Number /* queue */, error: String,
  undo: {
    status: null | 'pending' | 'running' | 'done' | 'failed', jobId, lastRunAt, error,
    summary: { restored, changedSince, waiting, gone, names: [{ voterId, voterName, reason }] },
  },
  counts: { …, byOption: [{ questionKey, optionId, label, removed, added }] },   // sum of the chunks'
  samples: [{ voterId, voterName, reason }], samplesTruncated, samplesTotal,     // capped at 200
  startedAt, completedAt,
}

// AnswerEditRunChunk — the frozen selection, written by the create call
{ runId, campaignId, organizationId, seq,       // campaignId and organizationId REQUIRED, indexed (§A11)
  items: [{ r: responseId, h: fingerprint }], done: Boolean, counts: Mixed }
```

- **Phase rules.**
  - *Pick up* (resume) is a compare-and-swap on `{ status: 'failed', 'undo.status': null }` → once an
    undo has started, the change can never be applied again.
  - *Undo* is allowed only when `status` is `completed` or `failed` (never `pending`, `running` or an
    open session) and no undo is running.
  - *Retry undo* only from `undo.status: failed`.
  - The processor re-checks the same rules before every chunk.
- **Jobs.**
  - Every enqueue gets a fresh custom job id (`answer-edit-<runId>-<phase>-<ms>`; BullMQ refuses `:`),
    written to the run **before** `add`. BullMQ's own retries and stall redeliveries reuse it, and the
    processor is idempotent (§G), so they finish the work rather than being turned away.
  - The `failed` listener matches `{ _id, queueJobId: job.id }` (or `undo.jobId`) and fires only after
    the last attempt, as the conversion listener does (worker.js:252-264).
  - A run still `pending` after 10 minutes reads *Waiting for the worker* and offers **Start again**,
    which re-enqueues under a new id. A late original job then finds the work done.
- **Stops.** Before every chunk the processor checks the campaign's and organization's
  `deletion.requestedAt` and stops if either is set, so an in-flight job never re-inserts copies into a
  tenant being deleted. The survey's version is checked only at create; the run edits against its
  frozen template, so a survey saved mid-run changes nothing.
- **One change at a time per campaign.**
  - An edit refuses `409 ANOTHER_CHANGE_RUNNING` while a conversion on the campaign is `pending`,
    `running` or `reverting`, or an unknock started in the last ten minutes is still `pending`, or an
    unknock revert is in flight (UnknockRun has no running state and reverts inline,
    campaigns.js:1542, so the revert route takes a short campaign lock the check reads), or a pass
    discard or snapshot restore holds `Pass.recutLock`.
  - Conversions, unknock and its revert, discard and restore-snapshot refuse the same way while an
    edit's apply or undo is pending or running. An open one-person session counts as running.
  - Neither of those acts writes through a compare-and-swap (they read, archive, then delete by id), so
    this keeps the two from interleaving on one survey.
- **Counts** live on each chunk, written together with its `done` flag, so re-processing a chunk
  overwrites rather than adds. An item found already done is re-counted from its archive row's
  snapshot through `applyEditPlan`, so the per-pick totals stay exact after a resume.
- **Indexes:** run `{ campaignId, createdAt: -1 }` and `{ organizationId, status }`; chunk
  `{ runId: 1, seq: 1 }` unique, plus `campaignId` and `organizationId`. Both models join both delete
  cascades and the worker's boot `syncIndexes`.

## G. The writer

One per-survey writer serves bulk runs, walkthrough steps, the profile Edit and Restore.

**The canonical fingerprint.** `fingerprint(r) = sha1(BSON.serialize({ a: rows, u: ObjectId(r.userId),
eb: r.editedBy ? ObjectId(r.editedBy) : null, ea: r.editedAt ? new Date(r.editedAt) : null },
{ ignoreUndefined: false }))`, where `rows` maps each stored row to `{ questionKey, questionLabel,
answer: answer ?? null, optionIds: optionIds ?? [], otherText: otherText ?? null }` in that order.

- **Stable across a Mongoose round trip.** A re-cast row, a string id cast to an ObjectId, or keys
  re-ordered all hash the same. Round 2 showed a raw-bytes hash breaks on exactly those.
- **Changes whenever** anyone changes the answers, who recorded them, or the edit stamp. Every phone
  re-survey resets the stamp (canvass.js:882), every profile edit sets it, and a team re-stamp (only
  `coordinatorId`) leaves it alone.
- **Leaves out the note.**
- **The editors' version** is the fingerprint plus the note and its own stamp
  (`sha1(fingerprint ‖ note ‖ noteEditedAt)`), so an editor left open can't write back a stale note or
  answers.

**The landing mark.** `SurveyResponse` gains `answerEditMarks: [ObjectId]` (`default: undefined`;
also on the archive's verbatim schema, so it travels with every copy). The writer's update pushes the
new archive row's `_id` onto it in the same atomic write that changes the answers, and the undo pulls
it when it puts them back. The phone's survey route `$unset`s it with `deskEntry` (a field re-survey is
a new submission, not this edit's output), and a profile Restore writes the snapshot's marks back with
the rest of it, or `$unset`s them when the snapshot has none (§H2). So "did this edit land?" is a fact
about the survey, not a guess.

**Finding the live survey.** Always by its slot, `{ voterId, passId }`, never by `responseId`. The
unknock undo, the conversion undo and a profile restore into the gap re-create a survey under a new
`_id`, because the archive keeps no `_id` (archiveOverwrite.js). Frozen items carry `v` and `p` for the
same reason, so Pick up after one of those reverts still finds the survey.

**Classifying an archive row against the live survey.** This is used by the writer, by redelivery and
by the undo, in this order:

| Live survey | Reading | Writer / redelivery | Undo |
|---|---|---|---|
| missing | not on file | skip; reported | *waiting* if a later change holds it (below), else *gone* |
| row id in its marks, fingerprint = the row's `appliedHash` | this edit is what's on file | done | put back |
| fingerprint = the fingerprint of the row's own snapshot | the edit never landed, or was already put back | a row **this delivery inserted**: delete it, but only after its own write missed. A row found **already there** (another delivery's): adopt it (`$addToSet` its id onto this delivery's set), never delete it. Then write again if the frozen fingerprint still matches | delete the row (only the undo deletes rows it didn't write) |
| anything else | changed since | leave the row (history) | leave the row; re-checked on every later undo |

*Held by a later change* means an `outcome_convert` or `unknock` archive row for the same
`{ voterId, passId }` whose snapshot's marks contain this row's id, **whose fingerprint equals this
row's `appliedHash`, and whose run can still be reverted** (not reverted, and not a revert that left it
behind because a re-survey took the slot, unknock.js:288-292). That change's revert will bring the
survey back, mark and all, and **Undo again** then finishes it. Anything else missing is *gone* (a
profile Delete, a canvasser's later door result, a desk entry undone), or *cleared with a re-cut* when
the round's snapshot holds it (§H2). Gone ends the wait; *cleared* waits for a snapshot restore.

**The bulk path, per chunk of 500 frozen items.**

1. One raw read of the chunk's responses (the driver collection, a single shared projection that
   includes the stamps).
2. Per survey:
   - an existing row for this run is classified first;
   - else the live fingerprint must equal the frozen `h`, otherwise `changedSinceReview` (named,
     untouched);
   - then `applyEditPlan(template.questions, …)`, and an unchanged result counts its reason.
3. One raw `insertMany` of the archive rows: the snapshot exactly as read, plus `responseId`,
   `overwrittenVia: 'answer_edit'`, `overwrittenBy`, `overwrittenAt: run.editedAt`, `answerEditRunId`
   and `appliedHash`.
4. One raw `bulkWrite` of `updateOne({ _id, answers: <as read>, userId: <as read>, editedBy: <as read
   or null>, editedAt: <as read or null> }, { $set: { answers: next, editedBy, editedAt: run.editedAt,
   updatedAt, …noteCarry }, $push: { answerEditMarks: rowId } })`. The raw content filter matches only
   an untouched survey; it sidesteps `updatedAt`'s same-millisecond and missing-field gaps, and the
   driver's `updateOne` reports `matchedCount` where `findOneAndUpdate` no longer returns `.value`.
5. One raw re-read of the changed surveys, then the table: a row **this delivery inserted** whose id
   isn't in the marks never landed, so it is deleted and the survey counted `changedSinceReview` —
   unless the re-read carries another row of this run at that row's `appliedHash` (another delivery
   landed it), which counts as changed. A survey that missed only because of a byte difference
   (fingerprint still equal) is retried once on its own.
6. The chunk's counts and `done` in one update.

**`noteCarry`.** The first time the writer stamps a survey that has no `noteEditedAt` field, the same
`$set` copies the old `editedBy/editedAt` into `noteEditedBy/noteEditedAt`, unless this save changes
the note. "Has no field" means `=== undefined` on the raw read, never a `??` fallback, or a note the
phone reset to `null` would be marked by the next bulk edit. Whenever the carry is in the `$set`, the
bulk filter adds `noteEditedAt: { $exists: false }`, so a note-only profile save landing between the
chunk read and the write makes this survey miss (and be retried) instead of having its new mark
overwritten. The Notes hub and Notes export read `noteEdited*` when present, and `editedBy/editedAt`
when absent. So every older note mark survives, an answers-only edit never marks a note, and no
migration is needed. The phone's survey route resets both note fields with the others: `surveyFields`
([canvass.js:864-884](../server/src/routes/mobile/canvass.js)) gains `noteEditedBy: null,
noteEditedAt: null`, and the `$unset` the F2 fix added gains `answerEditMarks`. Both paths must be
declared on `SurveyResponse` in the same change: strict mode drops an unknown `$set` path silently.
That is the feature's only change to code the phone calls, and it lands on F2's and F4's lines, so
those are the starting point.

**History.** Each `CampaignChange` row records the actual numbers:
- `field: 'answerEdit'`, `source: 'answer_edit'` (a new enum value, CampaignChange.js:48), `fromValue:
  null`, `toValue: '<planSummary> (<n> surveys)'`;
- written when a run completes, or stops having changed something;
- one more row per undo pass, saying what it put back.

The values are frozen English, like `scopeSummary`: they quote the survey's own wording as the admin
saw it, which a client-side label can't rebuild later. The web drawer gives these rows their own
sentence (Part 1 Design §9). A phone without the new label reads the row through the fallback.

**The worker.**
- Bulk runs and every undo go to a **new queue**, `answer-edit-queue` (`QUEUE_NAMES.ANSWER_EDIT`,
  concurrency 1), processed by `answerEditProcessor.js` with job names `apply` and `undo`.
- worker.js gains its `failed` listener (exported, so a test drives it) and boot `syncIndexes` for both
  new models; connection.js's budget comment goes from 8 to 9 connections.
- A queue of its own means a worker still on the previous deploy never sees these jobs; the old
  conversion processor would have "completed" one as a missing run.
- Undo always runs on the queue: a 214-survey undo takes about a second, and nothing is left stranded
  in a web request.

**Nothing to settle.** No door status, survey status, `Campaign.stats` key or platform counter moves.

## H. Undo

The sweep walks the run's archive rows (`{ answerEditRunId }`) and the frozen items, and classifies each
by the table in §G:

- **Put back:** a raw compare-and-swap over the bytes as read. It writes the snapshot's `answers`,
  `editedBy` and `editedAt` (only those, so a later team re-stamp or note edit stays) and pulls the
  mark, then deletes the row.
- **Never landed or already put back:** delete the row.
- **Changed since:** leave the row; it stays as an earlier-answers card, and it is re-checked on every
  later undo, so when a newer change on top of it is undone, **Undo again** finishes it.
- **Waiting / gone:** as in §G. Frozen items with no row and no live survey are reported as *cleared
  with a re-cut, or erased*.
- The pass stores `undo.summary` (restored, changed since, waiting, gone, with names, capped). The run
  card and Details read the stored summary, never the mere presence of rows (a re-cut or an Erase
  removes rows without undoing anything).

| After an edit, this happens | Result |
|---|---|
| The canvasser re-surveys that voter in the same round | New fingerprint: the run skips it if not yet written; the undo leaves the field answers and names the voter. |
| A teammate re-surveys that voter in the same round | The phone keeps the same `_id` with the teammate's id; new fingerprint, same result. |
| An admin edits that survey on the profile | New fingerprint and a new mark of its own; the run's undo leaves it (*changed since*). |
| An admin restores an earlier card on the profile | Into the survey's own visit only (the restore guard). The swap writes the card's marks back or clears them; the run's row for this survey is consumed if it was the card restored, and the undo reports *restored on the profile* rather than *gone*. |
| A second edit run changes the same surveys | Newest first, both undo exactly. Oldest first: its surveys read *changed since*, and finish on **Undo again** after the newer one is undone. |
| Surveyed → Not home, or Unknock | The edited survey leaves with its marks; the undo reads it as *waiting* and finishes it after that change is undone (the fingerprint survives the Mongoose round trip). |
| A re-cut with "clear knocks" | The round's surveys and archive rows leave together and come back together on a restore. |
| The desk entry the survey came from is undone, or the profile Delete, or a later door result | *Gone*: reported, and the wait ends. |

### H2. Round-3 amendments

These settle what round 3 found in §F–§H; where an earlier sentence disagrees, this section wins.

- **Clear-knocks re-cuts.** `snapshotPass` reads the round's surveys, then its archive rows, in two reads
  (snapshot.js:41-43). An undo landing between them left a snapshot holding the edited survey and no
  row, so a restore brought the edit back with the original nowhere. Discard and restore-snapshot join
  one change at a time both ways (§F; the processor checks `Pass.recutLock` before each chunk). A run
  undone while its round is cleared reports *cleared with a re-cut — after a snapshot restore, Undo
  again finishes it*, never "deleted on the profile". (The conversion and unknock reverts have the same
  two-read gap today; the same lock closes it for them.)
- **A stalled undo.** *Start again* covers `undo.status: 'pending'` too (re-enqueue under a new id; a
  late original job then finds the work done), and the undo route answers `503 QUEUE_UNAVAILABLE` with
  the status it had when the queue is unreachable — the fix the conversion undo got in §P.
- **A crash between the put-back and the row delete (C6).** The undo stamps `undoStartedAt` on the row
  before its compare-and-swap; on the next pass, a stamped row whose mark is gone from the live survey
  is deleted (the put-back landed). Without it a fully undone run read *kept newer answers* forever.
- **The Restore swap** `$unset`s `noteEditedBy`, `noteEditedAt`, `answerEditMarks` and `deskEntry` when
  the snapshot lacks them (`deskEntry` is already built, §P F2), so restoring a pre-feature row neither
  keeps the displaced survey's note mark nor shows another note's.
- **One list of reasons**, used by §F's counts, §H's `undo.summary`, §J's cards and sketches §4 and §5:
  *put back*, *changed since* (with who), *restored on the profile*, *waiting on ‹change›*, *cleared
  with a re-cut*, *erased* (the row was erased on the profile), *gone* (a profile Delete, a later door
  result, a desk entry undone). `undo.summary` stores each bucket with names, capped. A run that has
  *changed since*, *waiting* or *cleared* items reads **Partly undone** and keeps **Undo again**; plain
  **Undone** only when none are left.
- **§M's entries route** reads the stored `undo.summary` once a run is undone, never the archive rows
  (§H's rule: a re-cut or Erase removes rows without undoing anything).

## I. One person at a time (`mode: 'queue'`)

- **Create** freezes the chunks like a bulk run (up to 500 surveys), sets `status: 'open'` and
  `cursor: 0`, and returns the first survey.
- **Step GET** `…/answer-edits/:runId/response/:responseId` returns:
  - the voter, address, round, recorded-by and `submittedAt`;
  - the `deskEntry` and edit stamps;
  - the stored answers, with `optionIds` and `otherText`;
  - the answers off the current path, and old texts that match no option;
  - the editors' `version`.

  It calls `addAuditSubjects` for the voter (the single-record rule, supportAccess.js:140-147).
- **Step POST** `…/response` `{ responseId, version, answers }` → per-person plan (§C1) → the writer,
  checked against `version` (not the frozen fingerprint, so a voter re-surveyed since can still be
  edited after a reload) → advance `cursor` and fold the step into `planSummary`. A step already done is
  a no-op 200; a stale `version` → `409 RESPONSE_CHANGED`, and the screen reloads that survey.
- **Skip** advances the cursor. **Close** completes the run and writes the history row if anything
  changed. Resume opens at the cursor; "12 of 30 done" counts surveys with a landed mark.

## J. The voter profile — edit, restore, erase

- **New fields.** `SurveyResponse` (and the archive's verbatim schema) gain `noteEditedBy`,
  `noteEditedAt` and `answerEditMarks`, each `default: undefined`, so their absence keeps its meaning.
- **Edit (PATCH)** goes through the shared writer:
  - The posted answers become a per-person plan with ruling 2 (§C1).
  - A changed note is written too, with `noteEditedBy/noteEditedAt`.
  - Changed answers set `editedBy/editedAt`; the archive row keeps the whole earlier survey, note
    included.
  - A save that changes nothing writes nothing.
  - `version` is captured when Edit opens. A mismatch → `409 RESPONSE_CHANGED`: the card itself
    re-seeds the editor with the latest answers and says so.
  - The profile wire gains each question's `retired` flag and each survey's `version`.
- **The editor** is one component, `components/surveys/PerPersonAnswerEditor.jsx` (wrapping
  `SurveyAnswerComposer` with `seedFromAnswers` and carry-through), shared with the walkthrough.
- **Restore of an `answer_edit` row:**
  - **When the live survey is that row's own visit** (same `userId` and `submittedAt`), Restore is an
    answer edit through the writer. It writes the row's answers and note (stamping `editedBy`, and
    `noteEdited*` if the note differs), archives the current version as `answer_edit`, and deletes the
    restored row.
  - **When the live survey is someone else's** (a teammate re-surveyed the voter), it is today's full
    swap via `'restore'`. Otherwise the canvasser's answers would land in the teammate's survey
    (reproduced in round 2). There the voter does appear on Duplicate Surveys, truthfully.
  - **When no live survey exists** (the designed "delete the current one, restore the preserved one"
    swap), it re-creates the survey from the snapshot and counts it, as today's route does
    (voters.js:621-623).
- **Restore of every other producer** stays today's swap.
- **The restore guard, every producer (F5).** Restore refuses `409 RESTORE_VISIT_NOT_SURVEYED` unless
  the archived survey's own visit (`householdId, passId, userId`) still has a `survey_submitted` entry.
  - Each profile card carries `restorable` and, when it isn't, the reason: a Door Outcomes change
    holding it, named; or the canvasser recorded a different result.
  - The phone's Duplicate surveys screen calls the same route and shows the server's message, so it
    degrades to a readable refusal.
- **Erase:** the web's earlier-answers cards gain **Erase…** (admins), calling the existing route
  (voters.js:637), with the warnings in Part 1 Design §7. Erasing a run's row ends that survey's undo;
  the run's next summary reports it as erased.

## K. Every reader and writer, and what changes

Review round 1 inventoried every reader and writer of `SurveyResponse.answers`, `editedBy/editedAt`
and `SurveyResponseArchive`. The changes:

| Where | Change |
|---|---|
| [SurveyResponse.js](../server/src/models/SurveyResponse.js) | `noteEditedBy`, `noteEditedAt`, `answerEditMarks` (`default: undefined`). |
| [SurveyResponseArchive.js](../server/src/models/SurveyResponseArchive.js) | `overwrittenVia` gains `'answer_edit'`. New fields: `answerEditRunId` (no default, so the index is truly partial), `responseId`, `appliedHash`, and the three response fields. Partial indexes `{ answerEditRunId: 1, responseId: 1 }` and `{ answerEditRunId: 1, overwrittenAt: -1 }`. Comments updated ("five producers", the growth note). |
| [archiveOverwrite.js](../server/src/services/surveys/archiveOverwrite.js) | A raw-insert helper for the writer. `snapshotFromArchive` strips `answerEditRunId`, `responseId` and `appliedHash` but keeps `noteEdited*` and the marks. The F9 fix lives here. |
| [voterProfile.js](../server/src/services/voters/voterProfile.js) | `overwriteByKey` (:133) skips `answer_edit`, `outcome_convert` and `unknock`. Archive rows identical to the live survey are hidden. Each survey gains `version`, `editedEarlier` and its questions' `retired`. Each card gains `restorable` and its reason. Desk-entered archive cards carry `deskEntry`. |
| [reports.js](../server/src/routes/admin/reports.js) | Duplicate surveys (:2853) excludes `['outcome_convert', 'answer_edit', 'unknock']`. `/responses/:id`'s `replacedEarlier` (:1905) excludes the same, adds `editedEarlier`, and gains the wording fields for `answer_edit` and `unknock` archive rows. The Notes hub (:4894 projection, :4972) reads `noteEdited*` with the fallback. The voters-by-answer CSV gains the D2 column. |
| [voters.js](../server/src/routes/admin/voters.js) | PATCH and Restore as in §J; the guard. |
| [activities.js](../server/src/routes/admin/activities.js), [households.js](../server/src/routes/admin/households.js) | `edited` beside `deskEntry` (:96, :781). |
| [exportBuilders.js](../server/src/services/export/exportBuilders.js), [exportTypes.js](../server/src/services/export/exportTypes.js) | D2. The Notes export (:1759 projection, :1868) reads `noteEdited*` with the fallback. The backup README line. |
| [computeReport.js](../server/src/services/reports/computeReport.js), ClientReportBuilderPage.jsx (:551-559) | D3. |
| [canvass.js](../server/src/routes/mobile/canvass.js) | `noteEditedBy/noteEditedAt: null` in `surveyFields`. |
| [queues/index.js](../server/src/queues/index.js), [worker.js](../server/src/worker.js), connection.js | The new queue, its processor and listener, boot `syncIndexes`, the budget comment. |
| campaigns.js; surveyConversion and unknock create routes | The routes (§M); the one-change-at-a-time refusal both ways. |
| Both delete cascades | `AnswerEditRun` and `AnswerEditRunChunk` added. |
| Unchanged | Overlaps (`via:'submit'` only); turf snapshot and clear-knocks (raw copies by round carry the new fields); the voter delete (by voter); import undo (existence only); the conversion and unknock reverts; currentTags; FbTime; account deletion. |

## L. Where "Edited" shows

**On the survey only.** Server payloads ship `edited: { by, at }` where they ship `deskEntry` for a
survey: the voter profile, `/responses/:id`, the activity detail and the map door panel. The web renders
an **Edited** badge beside **Desk entered** there, and D2 covers the exports.

**Deliberately not** on the per-answer lists (voters-by-answer rows, the answer-canvassers counts):
- A per-option, per-canvasser "edited" count reads as "this many of these answers were altered". After
  this cleanup, *Support → By canvasser* would show Cara with "214 edited", though no Support answer
  changed.
- Old no-op profile saves stamped surveys "edited" too.

The phone already shows *Edited by* on its response details; its map door sheet badge and History
labels follow in the next over-the-air update.

## M. Routes — [routes/admin/campaigns.js](../server/src/routes/admin/campaigns.js)

All behind `loadForReclassify` (org admins, mid-delete quarantine) and scoped `{ _id, campaignId,
organizationId }`, so a foreign run id is a 404. Like the page's other acts, not blocked on an archived
campaign.

| Route | Does |
|---|---|
| `POST /:campaignId/answer-edits` `{ scope, actionIds?, surveyTemplateId?, mode?, plan?, dryRun?, digest?, asOf?, templateVersion? }` | `dryRun` → §E. Otherwise: one-change-at-a-time check; re-resolve under `asOf`; refuse `REVIEW_STALE` on a digest or version mismatch; write the run (template frozen) and its chunks; bulk → enqueue `apply` (201, or 503 `QUEUE_UNAVAILABLE` with **Pick up**); queue → an open run with its first survey. |
| `GET /:campaignId/answer-edits` | Newest 50 runs with their stored states; finished runs that changed nothing are hidden, as the conversions list does. |
| `GET /:campaignId/answer-edits/:runId` | Poll (with *Waiting for the worker* after 10 minutes pending); a queue run adds the cursor's survey. |
| `GET /:campaignId/answer-edits/:runId/entries` | Itemization from the archive rows joined to the live ones, paginated; after an undo, only what wasn't put back, with reasons. |
| `GET /…/:runId/response/:responseId`, `POST /…/:runId/response`, `POST /…/:runId/skip`, `POST /…/:runId/close` | One person at a time (§I). |
| `POST /…/:runId/resume` | The apply phase: `failed` and no undo started, or *Start again* after 10 minutes pending. |
| `POST /…/:runId/revert` | Enqueue an undo; again for *Undone except*, *Partly undone* and *Undo stopped*; `RUN_BUSY` while any phase runs. |

**What the phone sees.** `npm run audit:mobile-api` flags campaigns.js, reports.js, voters.js,
activities.js, households.js and canvass.js, because the phone calls routes in each. The services
(voterProfile.js, archiveOverwrite.js, the export builders) go on its read-by-hand list, and the
phone's survey POST isn't in `--list` (its path is built in mobile/lib/doorPaths.js:37), so read the
canvass.js diff by hand.
- The activity detail and household survey routes, and the profile, gain optional fields.
- The Duplicate surveys report narrows.
- The restore route can now refuse with a 409, which the phone shows as its message.

Released phones are safe; no client-version bump.

## N. Web — files

- [DoorOutcomesPage.jsx](../client/src/pages/DoorOutcomesPage.jsx):
  - the action and its divider;
  - the dry-run / create / resume / revert / close mutations;
  - edit runs merged into *Survey answer changes*, with the state table;
  - the neutral visit line;
  - conversion rows say "surveys".

  New helpers are declared above every memo (the TDZ rule doorOutcomesRender.smoke.test.js guards).
- New components: `components/outcomes/AnswerEditForm.jsx`, `AnswerEditReviewModal.jsx`,
  `AnswerEditWalkthrough.jsx`, `AnswerEditRunCard.jsx`.
- `RunDetailModal.jsx` gains an `answerEdit` type and "surveys" wording (:43, :80);
  `ConversionRunCard.jsx` gets the same wording (:71).
- `components/surveys/PerPersonAnswerEditor.jsx`; `lib/answerEditPlan.js` (form → plan, the diff, the
  unanswered equivalence) with tests; `lib/useAnswerEditRunPoll.js`.
- [VoterDetailPage.jsx](../client/src/pages/VoterDetailPage.jsx):
  - the editor swap and `version`;
  - the in-card 409 re-seed;
  - Restore's `restorable` text, and Erase with its warnings;
  - `answer_edit` and `unknock` card wording;
  - "—" for an empty pick-several (`answerText([])` prints blank today, :25-28).
- [ResponseDetailDrawer.jsx](../client/src/components/ResponseDetailDrawer.jsx): the `answer_edit` and
  `unknock` wording, `editedEarlier`, "—" for `[]` (:154).
- HouseholdDetailPanel.jsx and the activity pane: the Edited badge. ClientReportBuilderPage.jsx: D3.
- [campaignHistory.js](../client/src/lib/campaignHistory.js) and CampaignHistoryDrawer.jsx:
  - `answerEdit` rows get their own sentence;
  - labels for `surveyConversion` and `unknock`, with value formatting through `ACTION_LABELS`;
  - all three are notable.

## O. Phone

Nothing required. In the next over-the-air update:
- `mobile/lib/campaignHistory.js` mirrors the web labels;
- the admin map door sheet shows the Edited badge;
- admin/response-details.jsx and voters/[id].jsx print "—" for an empty pick-several.

## P. Found along the way

**Built 2026-10-19, uncommitted:** F1, F2, F4, F5, F7, F9, plus F10 below. Pinned by
[correctionSafety.int.test.js](../server/test/correctionSafety.int.test.js) (20 tests; each new one was
run against HEAD's code first and failed there). Docs, Help Center and PRIVACY_VERIFICATION item 31
followed in the same change. What was built differs from the fixes sketched below in these places,
each for a reason found while building or in round 3:

- **F9:** raw driver inserts (a verbatim copy, never validated), not `throwOnValidationError`. Mongoose
  inserts every valid row and only then throws (model.js:3163-3183), which leaves partial copies and
  never gets past the bad row (round 3). The way back changed too: the profile restore, the unknock
  undo and the conversion undo now put a copy back unvalidated, or an old row the archive kept would
  fail its undo on every retry.
- **F5:** the visit rule, plus one more for answers an admin **removed** (`unknock`,
  `outcome_convert`): only a survey entry recorded **before** the removal counts. Round 3 showed a
  same-canvasser re-survey after an unknock passed the plain visit rule and let Restore swap the
  struck answers over the real survey. Its suggested fix (the entry's time must equal the survey's) is
  wrong: at a two-voter door the second survey replaces the visit's entry with a newer one
  (`REPLACEABLE_ACTIONS` includes `survey_submitted`, canvass.js:219), so the first voter's survey has no
  entry at its own time. Both directions are pinned.
- **F7:** more than the `revert_failed` status.
  - The undo is **re-entrant**. Its stamps come off last, so a retry finds every door it must settle;
    every voter at those doors is recomputed; and a reverse undo's retry recognises its own put-back
    (same canvasser, same `submittedAt`) instead of counting it *not restored*.
  - An inline undo that throws parks as `revert_failed` and answers `500 REVERT_FAILED` with the run.
  - One that died with its request reads `revert_failed` after 10 minutes, instead of *Undoing* forever.
  - A large undo that can't reach the queue keeps the status it had.
- **F10 (new, fixed):** a resumed or redelivered conversion never settled the doors its dead attempt
  converted, because `touched` holds only the current pass. The final settle now unions the run's
  stamps.
- **F2's copies join Duplicate Surveys** as *Same round · overwritten*. That is correct: the desk
  answers and the re-survey are two responses in one round, the earlier preserved and restorable.
  Documented.
- **Residual, not fixed:** an unknock whose archive insert fails part-way (a real write error, not
  validation) stays `pending`, with copies of still-live surveys left in the archive. They show on the
  profile as *Removed* cards whose Restore is a harmless swap. It needs a database failure mid-unknock;
  a sweep of `pending` runs would clear them.

**The "fix now" change (Q3): independent of this feature. Server, plus small web wording changes (the
profile card, the response drawer, the run card and list).**

- **F1. Struck surveys read as overwrites** (reproduced).
  - Duplicate Surveys includes `unknock` archive rows (reports.js:2853), so once anyone surveys that
    voter again (in any round) the pair reads "Same round · overwritten".
  - The profile card, the web drawer and `replacedEarlier` word it the same way.
  - Restore swapped the struck fake answers over a real survey.
  - Fix: exclude `unknock` (and `outcome_convert`, already excluded in the report) in all three places;
    `unknock` wording on the web; the F5 guard.
- **F5. Restore can give a struck or converted visit a survey back** (reproduced in F1): the guard in
  §J.
- **F7. Picking up a failed undo re-applies a conversion** (reproduced).
  - The failed listener turns `reverting` into `failed` (worker.js:257), and the card then offers *Pick
    up where it stopped*, which re-enqueues the forward job (campaigns.js:2012-2020). Both desk responses
    were re-created and the counts doubled.
  - Fix: a `revert_failed` status on `SurveyConversionRun`, which the listener sets for a revert job.
    Its only action is *Retry undo*; the resume route refuses it; ConversionRunCard shows it.
- **F9. The archive helpers silently drop an invalid snapshot, and the caller then deletes the
  original** (reproduced: one of two inserted, no error).
  - Fix, as built: raw verbatim inserts (above), and an unvalidated way back.

**With this feature.**

- **F3. History shows raw keys and no highlight** for conversions and unknock: §N.

**The phone upload change (Q4): built with the fix-now change. Server only; no phone release.**

- **F2. A re-survey keeps the desk-entry stamp, and undoing that desk entry deletes the real answers**
  (reproduced).
  - The replace path never clears `deskEntry` (canvass.js:907, the fallback at :924), so the profile
    labels the canvasser's field answers "Entered by ‹admin›".
  - Undoing the conversion (surveyConversion.js:861) then deletes them with no archive copy. A
    teammate's re-survey is lost the same way, and a restore over a desk-entered row (voters.js:619)
    keeps the stamp too.
  - The replace path also never updates `syncedAt`.
  - Fix:
    - unset `deskEntry` on both phone paths, and in the restore when the snapshot has none;
    - archive a desk-entered row even when its own canvasser re-surveys it;
    - set `syncedAt`.
- **F4. A duplicate offline replay silently reverts an edit** (reproduced).
  - `supersededByNewer` compares with a strict `>` (canvass.js:279), so a re-sent offline submission
    with the same timestamp re-applies its answers over an admin's edit.
  - Fix: an equal timestamp from the same canvasser counts as already delivered. That is safe because
    the activity row is written after the response.

**Later.**

- **F6. The removal and unknock previews time out on large selections** (reproduced: 77 s for 25k
  visits). `computeSurveyImpact` (surveyConversion.js:193-205) and unknock (unknock.js:87-88, :198-199)
  send one `$or` branch per visit. Fix: the §D fold. Not on today's cleanup path; a conversion of that
  size is rare. *[Done: the unknock's in round 4; the conversion review's in round 7 (§V) — it was sized
  wrong here: 14 s at 2,500 entries and 47 s at 5,000, past the router's 30 s well short of the cap, and
  its undo's slot read 87 s at 50,000.]*
- **F8. The archive's run-id indexes index every row**, because the schema defaults the run ids to
  `null` (SurveyResponseArchive.js:71-84). Fix: drop the defaults and unset existing nulls. No user
  effect.
- **Known and left alone:**
  - A TurfSnapshot holds a whole round's surveys and archive rows in one document (snapshot.js:42-71),
    so edits move a very large round closer to the 16 MB limit. A re-cut is then refused, and nothing is
    lost.
  - CLAUDE.md's count of the phone's `/admin` endpoints is stale: it says 56, and the audit lists 76.

## Q. Privacy

**This change is privacy-affecting:** it changes retention, it lets an admin rewrite many field-collected
answers at once, and it adds an erasure path to the screen. Nothing published becomes false.

- **Retention.**
  - Today the profile edit destroys the earlier answers. After this change every admin edit keeps them
    in `SurveyResponseArchive` until they are restored, erased, or the campaign or organization is
    deleted.
  - Each kept version is a full copy, so it also copies the GPS reading, the note and the canvasser's id.
  - The copy outlives the canvasser's own later deletion of that survey (a different door result
    deletes their surveys with no archive).
  - Copies also travel inside a round's TurfSnapshot on a clear-knocks re-cut until that snapshot is
    deleted. Restoring that snapshot brings back a version erased after it was taken.
  - §B6's stamp ("only `outcome_convert` accumulates", stale since unknock) was corrected for
    `unknock` in item 31; this feature adds `answer_edit`. §C10's "surveys persist the coordinate twice" gains a
    note that kept versions add copies.
- **Correction and deletion.** DPA §7 promises help with correction and deletion, and §H16(d) lists the
  admin tools. **Erase** puts the existing erase route on screen; the help copy says to edit, then Erase
  the earlier version, when a voter asked for something to be removed. The editors' `version` covers the
  note, so a stale editor can't write back a scrubbed note.
- **Source.** A bulk edit is item 12's category (statements an admin enters about a voter) at batch scale,
  with one bound that does **not** hold here: item 12 promises "a field-collected answer is never
  overwritten". This feature exists to change field-collected answers; what replaces that promise is that
  the earlier version is always kept and the change is stamped, audited in `CampaignChange` and undoable.
- **Exposure.** The kept versions are new stored copies of answers already held. As the owner
  confirmed (Q1), leads, who can be clients, see edits exactly as they see every other correction today,
  and item 32 says so in those words. No new export destination (D2's column describes data already held), no
  subprocessor, no new external flow.
- **Run records.** `AnswerEditRun` stores voter names in `samples` and `undo.summary`, and answer text in
  `planSummary` and `scopeSummary`, as item 13 recorded for the other run models. Both new models are in
  both tenant cascades. The one-person step routes add record-level audit subjects.
- **Published text checked:**
  - privacy.html: "When a canvasser records activity at a door…", "We retain account and campaign
    information for as long as the related customer account is active, or as otherwise instructed…",
    and "The doors you knocked and the survey answers you recorded stay with the campaign";
  - DPA §7 and §9;
  - the ToS.

  **No Privacy Policy, ToS or DPA edit is needed; the owner confirms.**
- PRIVACY_VERIFICATION gains item 32 with all of the above.

## R. Docs and Help Center (same change)

- **Sentences this change makes false,** fixed in the same change:
  - a tag's *identified* count "never goes down": guides/metrics.md:51, faq/how-do-i-count-supporters.md:28,
    faq/two-survey-numbers.md:44, docs/SURVEYS.md:397;
  - "a real field answer is never overwritten/replaced by one you type": faq/record-a-missed-survey.md:19,
    pages/page-door-outcomes.md:42, guides/campaigns-manage.md:95;
  - "changing a Surveyed entry takes every answer at the visit", now true of Review removal and Unknock
    only: pages/page-door-outcomes.md:16, docs/CAMPAIGNS.md:462-464, faq/faked-surveys-cleanup.md.
- **docs:**
  - CAMPAIGNS.md: Part 1 *Editing survey answers* and the page's list of acts; Part 2 routes and
    invariants.
  - SURVEYS.md: §E, a caller that never re-normalizes untouched rows; §F, the fifth producer; §K; the
    models table; a new §N *Editing recorded answers*.
  - VOTERS.md: PATCH, Restore and Erase.
  - METRICS.md: §Surveys — the duplicate report's exclusions, and that tags can go down.
  - EXPORTS.md (D2), CLIENT_PORTAL.md (D3), ADMIN_APP.md (the phone's Duplicate surveys, response details
    and Notes), MAPS.md (the door panel badge).
  - CANVASSER_APP.md: done with the fixes (the equal-timestamp replay).
  - PRIVACY_VERIFICATION.md: item 32, §B6 (`answer_edit`), §C10, §H16(d).
  - README.md: this row, marked built.
- **Help Center:**
  - pages/page-door-outcomes.md: a new section;
  - guides/campaigns-manage.md: a new section;
  - faq/faked-surveys-cleanup.md: when the survey was real but one answer is wrong;
  - pages/page-voters.md: an edit keeps the earlier answers, plus Restore and Erase;
  - pages/page-duplicate-surveys.md: edits never appear there (struck surveys: done with the fixes);
  - faq/who-entered-an-answer.md: the Edited line;
  - guides/surveys.md;
  - guides/exports.md, faq/survey-answers-in-my-export.md and pages/page-exports.md: D2;
  - pages/page-notes.md: a note reads edited only when the note changed;
  - faq/who-changed-the-door-goal.md: its "What's recorded" list gains Door Outcomes changes;
  - **New:** faq/fix-one-survey-answer.md, "A canvasser picked an answer they should have skipped. Can I
    remove just that answer?", written from Part 1's step-by-step.

## S. Tests

- **Unit:** answerEdit.test.js (§C3); answerEditPlan.test.js on the web; the fingerprint's stability
  across a Mongoose re-cast, a string id and re-ordered keys.
- **Integration** (`server/test/answerEdit.int.test.js`, the real app over a throwaway mongod):
  1. **The owner's case end to end** on the demo survey: two-option filter, Take out. Sign + volunteer
     keeps the sign; both fakes go blank; questions 1 and 2 byte-identical; the review's numbers
     reconcile; the Clear warning's numbers.
  2. **Untouched rows and money.** Untouched rows stay byte for byte (old 3- and 4-key rows, "Other",
     a retired row, an orphan key). Door status, `surveyStatus`, `computeCampaignStats` and
     `knocksPipeline` are identical.
  3. **Follow-ups and the Script-flow tail;** an answer hidden beforehand is kept.
  4. **Who changes.** Ruling 1 both ways; ruling 3; `replaceWith`; the date window in both
     directions; another survey left alone; held-by-runs counted exactly.
  5. **The pricing oracle** (results and tags, keyed maps).
  6. **Review to run.** `REVIEW_STALE` on a changed survey and on a version change; a survey recorded
     after `asOf` is excluded without a refusal; a survey saved mid-run changes nothing.
  7. **Round 2's reproductions, each passing:**
     - a crash after the write, then a profile edit, then Pick up and undo (the original survives);
     - two applies racing one item;
     - Restore over a teammate's re-survey (a full swap, the teammate's survey intact);
     - Pick up after *Undo what landed* (refused);
     - two runs undone oldest first, then **Undo again** after the newer one;
     - an edit of an old-format row, then Unknock and its revert, then **Undo again** (put back).
  8. **Write misses.** A compare-and-swap miss names the voter and leaves no archive row; a re-cut
     reports *cleared*; a profile Delete reports *gone* and ends the wait.
  9. **Jobs.** The failed listener marks the right phase; a retried job finishes the work; *Start
     again*; one change at a time per campaign, both ways.
  10. **One person at a time.** Step, skip, a double-submit no-op, a stale `version`, a cold resume,
      close, undo as one, the ghost guard.
  11. **The profile.** The edit archives first; a no-op save writes nothing; note-only and note+answers
      saves; the in-card 409. Restore of an edit on the own visit, over a teammate, and into the void;
      the guard and its reasons; Erase.
  12. **Notes.** An answers-only edit leaves the note unmarked; a note edit marks it; an older mark
      survives the carry; a phone re-survey resets both.
  13. **Readers.** Duplicate Surveys and `replacedEarlier` exclude `answer_edit` and `unknock`; the
      lead-scoped profile; the Edited fields on every §L payload.
  14. **Lifecycle.** History rows with the actual numbers. Both cascades take both models and leave
      another campaign's and another org's chunks intact. An organization deletion stops a running job;
      a foreign run id is a 404.
  15. **The fixes already built** stay pinned in correctionSafety.int.test.js; this suite keeps it
      passing.
  16. **Round 3's reproductions, each passing:** two deliveries of one chunk racing (W1, W3: the
      original survives, counts exact); an undo after the unknock revert and the conversion revert
      re-created the survey under a new `_id` (found by slot, put back); an undo racing a clear-knocks
      discard (refused, then finished); *Start again* on a stalled undo; a re-survey's marks never read
      as *held*; a crash between the put-back and the row delete (C6); a note-only profile save landing
      mid-chunk (N1); Restore of a pre-feature row over an edited survey (N2).
- **Scale test** (`answerEditScale.int.test.js`, opt-in): 20k doors, 36k voters, 79k responses. The dry
  run and create finish at the caps under 10 s, and the job's time at 50k is reported.
  - **Run 2026-10-19** (`ANSWER_EDIT_SCALE=1 npm run test:int -- test/answerEditScale.int.test.js`, local
    mongod 7.0.2). At the caps — Cara's 25,000 entries holding exactly 50,000 surveys, 37,500 of them
    changing: form 1.7 s, review 5.8 s, create 3.6 s; the job 10.6 s; the undo of 37,500 surveys
    31.9 s. The owner's filtered case (one round, 18,750 matched): form 1.5 s, review 5.2 s. The landed
    results equal the review's numbers, Otto's genuine picks all survive, and the undo puts every
    pick back.
  - The first run failed the gate: the review took 18 s, 15 s of it in the tag pass's `$documents`
    calls. Rebuilt as §E *Tags* describes.
- **Existing suites:** surveyConversion, unknock, surveyOverwrite, reclassifyOutcomes, answerDrill, the
  phone submit suites, campaign history, then the full `npm run test:int` marathon on the finished tree.
- **Web render:** doorOutcomesRender.smoke.test.js with Surveyed rows selected, plus render smokes for
  the form, the review and the profile editor from fixture payloads.

## T. Verify

1. Server `npm test` and `npm run test:int`; client `npm test` and the production build.
2. A scripted run of the yard-sign case on a local mongod seeded from the demo survey: through the API,
   then the profile, then undo, with every number checked against `/survey-results` and the tag rollups
   at each step.
3. The running console in a browser (headless Chrome screenshots) for every sketch in Part 1.
4. `npm run audit:mobile-api`, then read every flagged diff, canvass.js by hand.

## U. Release and build order

**Build order: one release, with no cut in scope.**
1. Write the bulk path and the safety it needs first:
   - the applier, writer and undo;
   - the run models, queue and routes;
   - the Door Outcomes screens;
   - the Duplicate Surveys exclusion;
   - the note stamp;
   - Restore of `answer_edit` rows and the profile card wording.
2. Prove it with §T step 2.
3. Then the rest, still in the same release: the profile editor through the writer, Erase, one person
   at a time, the badges, D2, D3, the History labels, and the docs and Help Center.

**Before building:** check the cluster's MongoDB version on its Atlas card (§E's `$documents`
precondition).

**Release:**
1. The fixes in §P (Q3 and Q4): built. One server and web deploy from `main`, now. No migration, no
   index build, no config var, no client-version bump, no phone release.
2. This feature: server and web deploy from `main` (the owner), by Oct 26 if §T passes, otherwise
   Nov 5 (Q2). The worker restarts with the new queue and builds the two new collections' indexes at
   boot.
3. Heroku dashboard → More → Run console: `npm run migrate:build-indexes` (the dry run lists the two
   archive indexes), then `npm run migrate:build-indexes -- --apply`. A 214-survey job doesn't need it;
   run it before large undos or Details pages.
4. Badges, History labels and "—" on the phone ride the next over-the-air update, with the response
   detail hiding Restore up front from the `restorable` flag the fixes added.

No data migration, no config var, no client-version bump.

## V. Review log

**Round 1 (2026-10-19): four reviewers.** Their lenses were the write and undo mechanics (simulated),
the owner's case and the screens, every reader and writer plus privacy and release, and a pre-mortem
with scale and simplicity.

- **Blockers in v1.**
  - The worked example led to **Clear**, which wipes real *Yard Sign Delivered* picks.
  - A resumed job could undo over a re-survey.
  - Failed runs would sit at "Working" forever.
  - Answer edits marked survey notes edited.
  - A profile Restore of an edit put the voter on Duplicate Surveys.
  - Five help sentences would turn false.
- **Majors.** Pick versus survey counts; the "their answers go too" copy; copies made before the edit;
  D1's premise; the profile vs walkthrough rules; Script-flow tails; unreviewed changes; the date window;
  mixed surveys; the `$or` planner cost; order-dependent undo; a failed undo picked up as the change; the
  correction gap; Edited provenance; and the docs list.
- **Result:** v2.

**Round 2 (2026-10-19): four reviewers.** Their lenses were v2's new mechanisms (simulated against the
real routes, unknock and snapshots), an end-to-end walkthrough as the owner, consistency and coverage of
round 1, and simplicity with a pre-mortem.

- **Blockers in v2's own additions.**
  - The chunk model had no tenant ids, so a campaign delete would have wiped every org's chunks
    (`strictQuery`).
  - An undo could be re-applied by *Pick up*.
- **Majors, all reproduced or confirmed in code.**
  - A raw-bytes fingerprint that breaks on a Mongoose round trip.
  - Pending rows deleted on ambiguous evidence, destroying the only copy of the original.
  - Restore writing one canvasser's answers into a teammate's survey.
  - Out-of-order undo stuck under "Undone".
  - Claim tokens that turned BullMQ's own retries away.
  - A note migration that wasn't order-independent.
  - The template-version stop that would block undo after any survey save.
  - "Undone" derived from rows that re-cuts and Erase remove.
  - The step-by-step not matching the Survey Explorer and Door Outcomes as they behave, which would have
    missed the Candidate Follow-Up-only surveys.
  - A permanent "Partly undone".
  - Note edits with no write path.
  - The privacy record's item-12 bound.
  - The election-season freeze.
- **v3's changes.**
  - The write and undo path becomes one model, a landing mark plus a canonical fingerprint.
  - Five mechanisms are removed: claim tokens, heartbeats, pending/applied/kept row states, the note
    migration, and the keep-the-earlier-version switch.
  - The template is frozen at create, the digest gains `asOf`, the undo state is stored, and one change
    runs at a time per campaign.
  - Badges are kept to survey-level surfaces, Add becomes Replace, and tags are priced through the real
    stages.
  - Eight decisions are settled in the plan, leaving four questions.
  - The four live bugs go into a fix-now change.
- **Not yet reviewed:** v3's landing-mark model (§G, §H).

**Round 3 (2026-10-19): two reviewers.** One built v3's model literally from the plan's sentences and
ran it on a throwaway mongod against HEAD's phone route, profile Delete and Restore, unknock and its
revert, the conversion processor and the turf discard and restore-snapshot routes. The other checked
v3 against round 2, the code and the owner's answers.

- **Blocker.** Two deliveries of one chunk at once (allowed by §F: *Start again* beside a late original
  job, or a second worker while the old one drains): a delivery could classify the other's row against
  a survey read before that row's write landed, delete it, and then its own row on a miss. The live
  survey was edited and no copy of the original was left. Fixed in §G.
- **Majors.**
  - The survey was looked up only by `responseId`, but the unknock revert, the conversion revert and a
    profile restore into the gap re-create it under a new `_id`. Fixed: by slot (§G).
  - An undo racing a clear-knocks discard could leave the snapshot holding the edited survey and no
    row (snapshot.js:41-43). Fixed: one change at a time covers discard and restore-snapshot (§H2).
  - The undo could stall with no button. Fixed: *Start again* for a pending undo (§H2).
  - The plan didn't reflect the owner's answers. Fixed throughout (Part 1, §B3, §P, §Q, §R, §U).
  - D2 put an *Answers edited* column on per-answer exports, against §L. Fixed in §B2.
  - Against the fixes then in progress: F9's sketched fix still left partial copies, and F5's guard
    missed a same-canvasser re-survey after an unknock. Both fixed as built (§P), F5 with a different
    rule than suggested.
- **Minors**, all folded into §G, §H2 and Part 1 §7: *held by a later change* wrong both ways; two more
  mislabels (C6, W2); `noteCarry` in the bulk race and the Restore swap; the reason lists disagreeing;
  F7's touchpoints (built); one change at a time missing inline unknock reverts and open one-person
  sessions; the Restore prompt silent about the note; Erase naming one card when several hold a note.
- **Confirmed sound:** strict mode drops `answerEditMarks` unless both schemas declare it (they do in
  the plan); the canonical fingerprint is stable across every round trip tried, and every difference
  it reports is a real one; the happy-path crash points and both undo orders finish correctly.
- **Result:** v4. The model is not re-reviewed after these fixes; §S16 reproduces each finding.

**Code review round 1 (2026-10-19, on the build as committed in `589c1c0`): five reviewers.** Their
lenses were the writer and the undo under races (reproduced on a throwaway mongod), pricing and the
plan engine, the run lifecycle and one change at a time, the screens as the owner, and privacy and
the documents. Every finding was checked against the code; the blockers were reproduced first.

- **Blockers.**
  - The bulk writer decided a survey had landed by re-reading its mark. A profile Restore or another
    undo lifting the mark in between made it delete a landed copy, the only record of the original.
    Each survey's own write (`matchedCount`) now decides (SURVEYS.md §N).
  - An undo's put-back that missed left `undoStartedAt` on the copy, so *Undo again* read it as put
    back and deleted it. A put-back now writes its own receipt (`answerEditUndone`) in the same atomic
    write, a miss lifts the stamp, and only a receipt counts as proof.
  - Tag pricing skipped tags whose current answer moved when an older answer was re-exposed (net-zero
    keys, the *Other* text). Every tag with a member on a touched question is priced now.
  - One change at a time was a peek: two admins' creates seconds apart could both start, and a
    conversion then undid an edit silently. The edit, conversion and unknock creates insert their
    run, then check again.
  - Restore let a struck visit's answers back through an edit's earlier version or a teammate's
    overwrite copy once anyone was surveyed at the door. A removal now stamps the visit's copies, and
    the guard reads the stamp or the removal's own copy.
  - The live card froze after an action on one's own run, and the conversion card did too.
  - Four sentences of the privacy record were false: item 31 F2's audience, *kept until undone*,
    item 32(c)'s stored names, and the chunk and export wording.
- **Majors.** The undo was not re-entrant (labels and counts on *Undo again*). An own-visit Restore
  left a stale mark. Runs stuck *running* after a tenant stop or a lost job; they get *Start again*
  after 10 minutes now. The phone's re-survey and the profile's full swap archived, then wrote blind;
  both compare-and-swap now. A late job after a queue timeout still applied; a parked run forgets its
  job. A one-person step crossed templates. The conversion undo's own-put-back check could delete a
  different copy. Duplicate Surveys still said *two canvassers* after F2. *Identified* could drop on
  a same-round re-survey, unsaid. Create errors hid behind the modal, Details after an undo misread
  past 200 names, *N keep* was wrong with Replace, and the queue's stale review stuck.
- **Minors**, all fixed: the dry run says up front when another change blocks it; Undo on a run that
  changed nothing is refused; a PATCH with no template is refused; Erase waits for an undo in
  flight; History survives a crash and a redelivery; a tenant delete sweeps late writes; the replay
  rule matches `reclassified.from` and the voter; the walkthrough's save is audited; ghost option ids
  can be taken out; the dash for an empty pick-several; the bar during an undo; a typed note kept on
  conflict.
- **Owner flag, not a code fix:** `scopeSummary` keeps canvasser names that account deletion does
  not remove, against privacy.html's *aim to remove your name*. It predates this feature (item 13)
  and is recorded in item 32(c).
- **Result:** fixed as a follow-up to `589c1c0`, each blocker and major pinned by a test in
  `answerEdit.int.test.js`. Round 2 reviews the fixes.

**Code review round 2 (2026-10-19, on round 1's fixes): five reviewers, same lenses**, told what round
1 fixed and asked to break it. Every finding was re-run on a separate database before it was fixed;
each fix is pinned in `answerEditRound2.int.test.js`, and twenty of the fixes were checked by taking
each back out in turn: its test failed every time.

- **Blockers.**
  - Round 1's own writer fix let two deliveries of one chunk lose originals: a delivery deleted the
    copy another delivery had adopted and landed the edit through. Copies now carry the `writerToken`
    of the delivery holding them; an adopter claims one first, and a delete names its own token.
  - A delivery still running when its change was undone wrote the edit back over the put-back, whose
    bytes matched what it had read. The undo now raises `answerEditFence` on each survey before reading
    it, and no write of that run lands past it.
  - One change at a time was a claim only on the creates. Pick up, Undo, a door-by-door step, the
    unknock undo and the conversion resume and undo still peeked then wrote; an Undo pressed while an
    unknock was mid-write lost the original. Every start now claims, then checks. A conversion's late
    job after "Nothing has been changed" still ran; it now runs only under the run's own job id.
  - Restore's strike rule missed every strike made before round 1's stamps, and the stamps outlived an
    undo. A strike is now read from the removal run's own record of the visits it struck
    (`UnknockRunChunk`, the new `ConversionStrike`), held while the run stands and, after an undo, only
    where the undo couldn't put the visit back.
  - A cleared written answer was stored word for word in the run's pick counts.
  - The undo deleted a copy whose answers matched the survey although its note didn't.
  - Two sentences of the privacy record were false (deleted-account names; the phone's re-survey).
- **Majors.** History lost a row whose insert failed, and logged a cut-off undo wrong (now a ledger:
  claim, write under a derived id, then count). An Erase just before the undo reached a copy was
  honoured on screen and then written back. An undo the first build left running could never be
  started again, and its put-backs (no receipts) read *restored on the profile* on Undo again. One
  failed poll froze both live cards. A skipped walkthrough save was silent. The conversion card went
  stale after a door-by-door session. Details said *No survey was changed* when its request failed.
  Help omitted a canvasser re-recording a door as a way *identified* drops.
- **Minors**, all fixed: a campaign switch mid-action showed the old campaign's card; the blocked
  notice could only be cleared by reopening (now *Check again*); a note-only save on a survey whose
  questions are gone was refused; a never-started run offered Undo (now *Didn't start*); the phone's
  refused Restore didn't refresh; overlaps dropped a real collision over desk answers; the org
  cascade's last sweep missed three collections, and both cascades now wait (bounded) for an
  answer-edit batch in flight; tag pricing grew about a second per tag on the edited question (now one
  pass); *matched but not selected* counted another survey's matches; the script-ending warning fired
  on a re-route beside an unrelated blank; the scale gate couldn't run its job after round 1.
- **New one-time steps** (OPERATIONS.md): `migrate:conversion-strikes` and `repair:answer-edit-words`,
  each a dry run, then `-- --apply`. (Round 3 renamed the first `migrate:removal-strikes`.)
- **Result:** fixed and pinned. Round 3 reviews these fixes.

**Code review round 3 (2026-10-19, on rounds 1 and 2's fixes): five reviewers** — the writer and undo,
selection and pricing, clients, guards and lifecycle, and Restore with the privacy record — each told
what the earlier rounds fixed and asked to break it, with about 450 randomized runs among them. Every
finding was re-run on a separate database first. Each fix is pinned in `answerEditRound3.int.test.js`
(25 tests, most of them the reviewers' own reproductions), and 23 of the fixes were checked by taking
each back out in turn: its test failed every time. The reviewers' reproductions, re-run against the
fixed code, all hold, and their three randomized stress runs (36 rounds) found nothing.

- **Blockers.**
  - Undo missed an edit on a survey re-created under a new id when the delivery's landing was never
    recorded: copies were read by the frozen ids only. The undo now reads the run's copies by slot
    (voter and round), newest first.
  - A fence lived only on surveys on file when the undo raised it, so a survey written back later — an
    unknock or conversion undo, a re-cut round's snapshot restore, a profile Restore into a gap — came
    back without it, and a delivery still running landed the edit after the undo. Every path that
    writes a survey back from a copy now carries the fences of the runs whose undo reached that slot.
  - An Erase of the change's copy between its insert and its write left an edited survey with its
    original nowhere. Erase now refuses (`COPY_IN_USE`) while the change can still write.
  - Review priced one plan and Confirm wrote another (the plan was rebuilt from the form at the click,
    and the form stayed editable while Review loaded). The review's digest now covers the plan, the
    page sends exactly the plan it priced, and the form is disabled while a review is on its way.
  - Unknock, re-label and the Surveyed conversion wrote the selection as it stood at Confirm, and an
    empty list of ticked rows read as *the whole filter*: a cleared selection unknocked everything that
    matched. An explicit empty list now selects nothing everywhere, and every confirm sends the body its
    review priced, to the campaign it was priced on; a reply after a campaign switch is dropped.
  - The one-time strike backfill skipped a conversion that already had any record (one that ran across
    the deploy lost its earlier visits) and gave a door-by-door session one time window for all its
    visits. It now works per visit, each with its own time.
  - An unknock undone before this build left no record of the visits it couldn't put back, so a struck
    visit with no copy came free. The same script now records them.
  - Two privacy sentences were false: the GPS retention line (an undo keeps copies of surveys changed
    since, and org deletion was missing), and *the itemization adds audit subjects*, which two reads
    did not.
- **Majors.**
  - A delivery that lost a claim wrote its chunk last and dropped an edit another delivery had landed:
    the run read *0 changed* and Undo said nothing was on file. A chunk's counts are now recounted from
    the database and written by compare-and-swap, and a recorded landing is never written away;
    *nothing to undo* and the list's empty rows are decided by copies on file, never by counts.
  - Put-backs were recounted each pass, so History could miss one and the card's count could drop.
    Each proven put-back is now recorded on its frozen item.
  - A one-person session that saved one survey twice left the first step's edit after one Undo.
  - The first build's put-back rule credited put-backs never made (a same-picks re-survey, a full-swap
    Restore); it now applies only to runs whose undo began under that build, and those runs' earlier
    put-backs count as already logged.
  - Tag pricing was still over the 10 s gate in heavy shapes — 16 tags on 9 questions at the cap took
    28 s, close to the router's 30 s cut. The campaign-wide counts are now read while the scan runs,
    the questions in one pass, the changed voters' share before from those counts, and only their edited
    surveys are shipped, four batches at a time, from the scan's own edits. That shape now reviews in
    7.4 s on a laptop, every tag priced, and lands as reviewed (a new case in the scale test); the
    plan's own shape in 2.7 s. Past 20 s the review goes out without tag counts and says they can't be
    previewed — measured on a laptop, not on the two-core production database, so this guard is what
    keeps a heavy review on a slow day inside the router's limit.
  - Conversion jobs never checked for a deletion, and both cascades waited for answer edits only after
    their first sweep: an organization deleted while a conversion batch was in flight kept its surveys.
    Conversions now stop at their next batch, both cascades wait for every Door Outcomes writer before
    they sweep, and every writer sweeps after itself however it ends when its tenant's cascade is
    running (`lateWriteSweep.js`) — a batch that stalls past the wait included. A deletion only asked
    for, which the route undoes when its job can't be queued, sweeps nothing.
  - A door step's stamp was one value per run; two admins stepping one session cleared each other's.
    It is now a counter.
  - Two Undo presses on one unknock both ran; the second now reads *already being undone*.
  - Both undos put answers back into a free slot even where the visit's entry couldn't come back,
    counting a survey under a door that read Not home. They now put an answer back only where its
    visit's entry is back, and the visits they couldn't put back are read from what is on file, so a
    retry records the same truth.
  - An unknock that crashed after it began removing read *nothing was removed* and refused its Undo.
    It is marked before its first removal, reads *Stopped part-way*, is held by Restore and the replay
    guard, and can be undone; *not restored* counts only entries not on file.
  - The refusal for a strike that holds after its removal was undone told the admin to undo it again
    (now `kept_after_undo`, worded as what happened).
  - A first-build run that landed surveys read *Didn't start* with no Undo; *nothing on file* is now
    read from copies, not counts.
  - The deploy window: the previous build saved a conversion undo's job id only after queueing it, so
    a job taken before that save was skipped and the run read *Undoing* forever. A previous-build job
    is now its run's own while no undo of this build has claimed the run.
- **Minors**, all fixed: the walkthrough's notice was lost on the last survey, said *deleted or
  replaced* for a deletion and fired with nothing changed, and the walkthrough could close mid-save;
  Details showed a stale list with no word when its refresh failed; a poll answering after an action
  repainted the card's older state; a campaign switch left the walkthroughs open and let late replies
  clear the next campaign's selection; the conversion card said *press Resume* (its button reads *Pick
  up where it stopped*) and offered Undo on an open session; a card frozen on a refused poll had no
  Dismiss; the undo's *waiting* line always said *Not home*; a survey re-recorded under another survey
  was written; a pick stored twice counted twice and two unmatched old texts counted once; the words
  repair folded option texts into *unlisted*; the phone and the Duplicate Surveys report named a
  Restore's admin as a survey's author.
- **New one-time steps** (OPERATIONS.md): `migrate:removal-strikes` (the renamed strike backfill, now
  also for older unknock undos) and `repair:answer-edit-words`, each a dry run, then `-- --apply`.
- **Result:** fixed and pinned. Round 4 reviews these fixes.

**Code review round 4 (2026-10-19/20, on rounds 1–3's fixes): five reviewers** — the writer and undo,
selection and pricing, lifecycle and deletion, clients, and Restore with the privacy record. Every finding
was re-run first. Each fix is pinned in `answerEditRound4.int.test.js` (33 tests), and 35 of the fixes
were checked by taking each back out in turn: its test failed every time (two tests were tightened until
they did). The reviewers' reproductions, re-run against the fixed code, all hold — one, written to show
an Undo pressed mid-step going ahead, now reads the refusal that replaced it.

- **Blockers.**
  - Undo was offered while a large unknock was still removing. Round 3 treated every pending unknock past
    its first removal as stopped, and a 25,000-entry strike ran for minutes on one slow read; the strike
    then finished over the undo — struck answers live under unknocked doors, or the removal never
    undoable and a Restore swapping struck answers over a real later survey. An unknock now beats a
    heartbeat between every step: one heard from in the last ten minutes reads *Removing…* with no Undo,
    and its Undo is refused; it beats and completes only while no undo has begun, so one that comes back
    to life stops before its next removal. Its reads go by round and canvasser instead of one clause per
    visit: a whole 5,000-entry unknock takes 1.2 s (it took 24–28 s), 25,000 take 5.4 s (410–452 s), and
    the preview's answer read 0.2 s at 10,000.
  - A door-by-door step still saving when another admin pressed Close and then Undo converted its door
    under the reverted run — stamped by it, so neither another undo nor any other tool could reach that
    door again. A step now counts in only while its session is open, and Close and Undo wait out a step
    still counted in (*a door in this session is still saving — try again in a moment*).
  - A Door Outcomes change created while its organization was being deleted outlived the deletion — a
    conversion's run, and a one-person answer edit's run and chunk, whose scope line names a canvasser.
    Each create now checks once its run is on file and goes with the tenant's rows; a conversion job
    whose campaign is gone takes its run with it; and relabels sweep after themselves too.
  - A privacy-record sentence was false: item 32 said its pseudonymous ids join §A3's list, which didn't
    name them (it does now).
- **Majors.**
  - The early before-counts priced every question the plan could reach — for a gate question, a Script
    flow's first, which every follow-up's condition names, that is the whole survey: 35 tags at once for a
    change that moved 2, 9.8 s at 50,000 surveys (over the 10 s gate) with the connection pool full. Only
    the plan's own questions are priced up front now, and a follow-up's the moment the scan sees its
    answers dropped: that review takes 4.8 s, and the heavy Clear still 7.4 s.
  - The time budget stopped the waiting, not the work: on a slow database a review's counts ran on past
    its answer, three presses deep, or it answered past the router's 30 s cut. Every read a review sends
    now carries the time it has left; results or tags that can't finish are said to be unavailable, a scan
    that can't is refused (*Working out this review is taking too long*); the same review pressed again
    joins the one running; the identified counts run two at a time.
  - An Undo pressed while a one-person session's own step was saving went ahead: the step then wrote its
    chunk over the undo's record of what it had put back, and logged its survey after the undo. The undo
    now waits for the step; the step records its copy by position, never over a chunk an undo reached,
    and writes its History line before it counts out.
  - Two copies of one original made at one moment — a delivery that died beside the one that landed: the
    dead one was read first, the survey put back read *kept newer*, and History *0 put back*. The landed
    copy is read first now, the dead twin goes, and a note stamp equal to the survey's own reads as none.
  - Erase of a change's copy was refused for good once the change stopped responding; it follows the
    card's ten-minute rule now.
- **Minors**, all fixed:
  - Undo: one the first build began and that stopped inside its first pass counted its put-backs as
    restored on the profile (and one whose copy it never deleted, not at all); a survey a stopped-part-way
    unknock held read *gone*, with no Undo again; a survey put back read *kept newer* when an older copy
    of the same change held; a put-back whose copy and survey both left read *restored on the profile*.
  - Clients: the walkthrough warned of a lost change after a pick ticked and unticked again; a review that
    arrived after its form was reset opened over the reset page, and a refusal then said nothing; the
    profile, the response drawer and the phone named the admin whose Restore set answers aside as a
    canvasser who overwrote them; a finishing conversion closed another change's preview and cleared the
    selection; a first-build run that went through surveys and stopped empty read *Didn't start*.
  - Lifecycle: a campaign delete the worker claimed and then refused let a writer's sweep remove that
    campaign's Door Outcomes records (writers now sweep only once its cascade has begun); a previous
    build's Pick up was skipped in the deploy window; a step count a crash left behind held the campaign
    busy after every later step; two Closes at once logged two History rows.
  - Restore and the backfill: Restore judged only the latest strike holding a copy (now every one must be
    lifted); a conversion undo put answers back under an entry another conversion owned; a stopped
    strike's window ended at its freeze; older crashed unknocks read *nothing was removed*, and the
    backfill marks them; the backfill over-held a visit an older undo did put back; the answer-edit run
    list was missing from the access log.
  - Pricing: a pick stored twice in one row counted as two surveys, and a question an old survey held
    twice was priced from one row.
- **Not changed, stated:** a strike or a step that stalls longer than its lease (ten minutes for an
  unknock, two for a step) and is undone meanwhile can still write once when it wakes — each lease is long
  against any real stall; when the counts can't tell an older unknock undo's put-back visit (re-recorded
  since) from a held one, the backfill holds both, the safe direction; joining identical reviews works
  within one web server.
- **Result:** fixed and pinned. Round 5 reviews these fixes.

**Code review round 5 (2026-10-20, on rounds 1–4's fixes): five reviewers**, the same five lenses. Every
finding was re-run first. Each fix is pinned in `answerEditRound5.int.test.js` (31 tests; two more in
`correctionSafety.int.test.js` and round 4's W4), and 41 of the fixes were checked by taking each back
out in turn: its test failed every time (two missed at first — the Restore tests only tried the removal's
own copy — until a teammate's earlier copy of the same visit was tried too). The reviewers' own
reproductions, re-run against the fixes, all read fixed; two that hooked the old one-at-a-time write-back
were covered on the new path instead. No reviewer rated a finding a blocker; one major is
counted as one here, because it made a privacy-record sentence false while it lasted.

- **Blocker (by that rule).** Restore passed while a removal was still writing. The test was "the
  visit's own entry is back", and the entry was simply not deleted yet — an unknock between its answers
  and its entries, a Surveyed → Not home step between taking the answers and flipping the entry — so
  struck answers came back counted under a door that then read Unknocked or Not home, or the strike then
  deleted what Restore had put back and its Undo reported nothing missing. A removal still writing (an
  unknock still beating, a conversion record with no finish whose run is running or has a step in flight)
  now holds every copy of its visits, whatever the entries read.
- **Majors.**
  - An Erase pressed during an unknock's or a Surveyed → Not home Undo was honoured, and the undo then
    wrote the erased answers back from what it had read — the voter-erasure path (item 32). Both undos
    now claim each copy before writing it back, the stamp Erase and Restore already wait on: pressed
    meanwhile, they wait (*An undo is putting these answers back right now*); a copy erased before the
    claim stays erased and is counted not put back.
  - An unknock or its Undo could outlast its request (the router cuts at 30 s; a 25,000-entry undo took
    24 s on a laptop, one write per survey) and never resolve on screen. The undo writes surveys back
    500 at a time; the list reads *Undoing…* and keeps polling while one runs, refreshes the table when a
    row lands, and a 5xx or network failure says the server may still be working on it.
  - The console step stretched every door-by-door session's visits to the session's Close (round 4), so
    a copy of the canvasser's real later survey read struck. Each visit ends at its own moment again;
    only a bulk run's visit known by its entry alone ends when the run finished.
  - The Undo of an unknock that stopped part-way put back what a later unknock had removed since — fake
    knocks billed again under a run that still read completed. It leaves those entries and their answers
    to the later one, and the console step marks no older unknock whose removals a later one made.
  - An undo the first build began and that died inside its first pass wasn't recognised (round 4 looked
    for a start time the first build never managed to write), so its put-backs read restored on the
    profile. It is recognised by what the first build left (running or failed, no heartbeat, no
    receipts), kept on the run when Retry undo overwrites that status; and a put-back a dying
    first-build pass made is logged, never assumed logged — after one finished pass, that pass's own
    summary is exactly what History holds.
  - A different review waited behind one still working, inside its own time budget, and could be refused
    for it. Only the same review joins now; the same rows ticked in another order are the same review.
- **Minors**, all fixed:
  - Removals: a failed undo cleared the mark a strike that woke after its lease checked, so it completed
    over the partial undo (the undo's claim now marks the run for good, and the strike beats between
    archiving answers and deleting them); a strike that failed read *Removing…* for ten minutes (it reads
    stopped at once); an unknock's Undo put answers back under an entry another admin had converted since;
    a refusal named the later of two removals when the earlier could never lift; a strike that stopped
    after its deletes was never settled or listed in History (it settles each batch as it goes and is
    listed when it begins removing), and an undo that died just before reading undone left its doors
    unsettled for good (History and the settle now come first); the preview counted a survey twice when
    two entries of its visit fell in different batches.
  - The console step marked an older unknock that had died before removing anything. It now needs a
    removal: an entry gone with its visit empty, or — found writing this round's tests — the answers gone
    from a visit whose entry it never reached (one that died between its two deletes, which the first cut
    of this fix missed). A run it marks is listed in History at the moment it began.
  - Answer-edit undo: a survey saved twice whose original's copy was erased read put back (it reads
    erased); a survey with no note, edited before notes had their own stamp, read *Note edited* after an
    undo; an undo a re-cut outlasted said to press *Pick up*, which refuses it (*Retry undo*); a survey
    saved twice in one session counted as two surveys changed.
  - Pricing: a review's tag counts kept starting after it had answered (they stop at the tag deadline,
    and the current-tag read is aborted there — the first cut of this pulled that read a row at a time,
    which made the heavy review 9.3 s; reading in the driver's batches put it back at 7.9 s); a change
    that re-routed every survey kept every reachable question in the scan's stash (8 s now, was 10–12 s);
    counts found while scanning ran beside the up-front ones (one limit covers both). The Help Center said a review names everyone it changes (the
    first 50).
  - Clients: the unknock list polled a refused list forever; the door-by-door walkthrough read finished
    when its own Close was refused, and a step refused because the session had closed kept offering the
    same door; a refusal on a run's card landed in the page banner far above it (it scrolls into view); a
    preview priced while a watched change ran outlived its finish (it closes, with a notice); unfinished
    unknock rows counted every frozen entry as unknocked; a queued conversion undo ending in *revert
    failed* didn't refresh the table.
  - Lifecycle: the conversion queue's failure listener marked a run another job was executing as failed.
  - Docs: four sentences overstated a fix (the strike's stop, the backfill's certainty, which writers a
    delete waits for, the review count) and the conversion undo's round-4 rules were missing.
- **Not changed, stated:** with an answer or tag filter, the shared selection reads carry no time limit
  (the review's own reads do); after two or more finished first-build passes, a put-back a dying later
  pass made and whose copy it deleted is back but missing from History (the first build kept only its
  last pass's summary); a first-build unknock that removed only entries with no answers before it crashed
  still reads *Did not finish*; an older unknock the console step marks keeps the door statuses it left
  until its Undo; a pick changed back and forth in one session counts each change in the pick counts
  (the survey counts once).
- **Result:** fixed and pinned. Round 6 reviews these fixes.

**Code review round 6 (2026-10-20, on rounds 1–5's fixes): five reviewers**, the same five lenses. Every
blocker and major was reproduced by the reviewer and re-run here first. Each fix is pinned in
`answerEditRound6.int.test.js` (25 tests), and 35 of the fixes were checked by taking each back out in
turn: 33 tests failed as they should; the other two are equivalent changes (a retry's read already
selects its copies by the run's own claim; a later unknock's copies have already left the write-back by
the time the answers check runs) and stay as backstops. Two of the blockers were regressions of round 5's
own fixes.

- **Blockers.**
  - An unknock's Undo whose write-back failed as a whole — a dropped connection, a failover — deleted
    every copy it had claimed with no survey written, and reported success. The driver reports such a
    failure as a bulk error with no write errors at all, and an empty list read as "nothing clashed"
    (round 5 batched the write-back through that reading). A failure now stops the Undo with every copy
    kept and let go, Retry undo finishes it, and a copy is deleted only once its survey is read back on
    file. The same reading in the Not home → Surveyed conversion (since `80acabe`) stamped entries
    Surveyed over desk answers never written; it throws now too.
  - An unknock that failed in process ended its hold on the struck visits in 1970: round 5 marked it
    stopped by setting its heartbeat to the epoch, which the restore guard read as the end of its
    strike. A teammate's earlier copy of the struck answers read restorable, and Restore swapped them
    over the canvasser's real later survey. The stop is recorded on its own now (`stoppedAt`), the
    heartbeat stays the last real beat, and the hold ends when the strike stopped — also for one undone
    after it stopped, which ended at its freeze.
- **Majors.**
  - An Undo that failed after claiming its copies left them claimed for ten minutes, and the Undo
    offered again at once counted them "not restored" and closed the run without them — for that window
    the profile's Restore and Erase said an undo was writing them. The claim is the run's own now (a
    retry takes back what an attempt left), and whatever didn't land is let go however the batch ends.
  - Two overlapping unknocks undone earlier-first left every survey off the record, and an Undo beside a
    later unknock or a conversion step still writing put answers back under a door the other was
    clearing. A later unknock now keeps what it struck — its entries, and the earlier run's copies there,
    which its own Undo writes back — and unknocks and conversions wait for each other: none starts, takes
    its next door, or is undone while another is still writing on the campaign.
  - An unknock Undo that stopped part-way looked like one never pressed. Its row reads *Undo stopped
    part-way* with **Retry undo**, and a request the server answered with an error says the undo
    stopped, rather than that it may still be working.
  - An answer-edit Undo read a survey it had put back as erased when a note-only profile edit's copy had
    been erased since (the documented erasure flow). It counts only this run's own copies now, and a
    survey left at its reviewed answers reads put back.
  - On a run the first build undid in one pass, a put-back of this build went unlogged when one of the
    first build's had changed since. History now credits that pass with no more than it can still prove.
- **Minors**, all fixed:
  - The removal undos: a slot already holding the same submission (a strike that stopped before
    deleting what it copied) counted "not restored" and left a duplicate copy; the refusal words named an
    undone unknock when a later one held the visit; the strike re-settled every door and voter at its end
    (a 25,000-entry strike takes 7.4 s now, its undo 8.5 s); the conversion undo made three round trips a
    survey (it writes back 500 at a time).
  - Answer edits: this build's own undo whose job died before its first claim was read the first build's
    way; a one-person session open across the deploy counted a re-saved survey's questions twice.
  - Reviews: one whose change moved nothing left its campaign-wide counts running after it answered (it
    stops them now); any number of different reviews could work at once on a server (two now — the next
    is refused at once, *Another review is being worked out*).
  - Clients: a finished change closed reviews priced after it, and the one whose own Confirm was
    writing, and missed one still being priced (each review now carries the server's `asOf`); an unknock
    landing closed another review with no word and cleared the selection; Stop here and a door step
    refused because the session had closed elsewhere kept offering themselves; profile refusals landed
    far above the card, and a copy an undo had used read *Preserved response not found*; a reverted
    unknock that never finished counted every frozen entry as unknocked.
  - The console step judged older unknocks oldest first (so its dry run and its apply disagreed), read a
    later conversion's removal or an emptied slot from a profile change as the run's own, missed a
    removal a teammate's re-survey hid, and could leave a marked run without its History line.
  - Docs: the late-write sweep's comment said the unknock stops on tenant deletion at its next batch;
    two sentences still described the pricing of round 4.
- **Not changed, stated:** a removal undo running past its ten-minute claim can be pressed again and run
  twice at once (the second's inserts collide and are counted, unlikely at the measured speeds); the
  console step can't tell answers an admin deleted on the profile from answers the run removed (nothing
  records that delete); the shared selection reads with an answer or tag filter, and the current-tag and
  results passes, sit outside the two-at-a-time limit; a stuck conversion (a lost job) now holds unknocks
  and other conversions as well as answer edits — the safe direction, as before; a survey the first
  build put back and someone changed since reads *restored on the profile* on this build's Undo again
  (nothing on file tells the two apart). The reviewers' own reproductions, re-run against the fixes,
  read fixed — the real first build's undo hand-over included — and the stress runs that hit the false
  *erased* in 15 of 50 rounds hit it in none.
- **Result:** fixed and pinned. Round 7 reviews these fixes.

**Code review round 7 (2026-10-20, on rounds 1–6's fixes): five reviewers**, the same five lenses. Every
finding was reproduced or traced in the real code, fixed, and pinned in `answerEditRound7.int.test.js`
(30 tests, 29 of them failing on round 6's code — the other guards the old reading kept for removals
with no record).
- **Blocker — Restore swapped struck answers over a real later survey (every round's guard).** A
  removal's hold on a visit lifted whenever an entry recorded before the removal read Surveyed there:
  one an unknock that stopped part-way never deleted, one a Surveyed → Not home step that died before
  its flip left, or an older entry an earlier unknock's Undo brought back under a later unknock of the
  same visit. A teammate's real survey was then swapped out for the struck answers (reproduced, three
  ways). A hold now lifts only through the removal's own undo: its undo begun, and one of its own
  entries back at the visit (an unknock's frozen entries; a conversion's converted entries, back
  Surveyed). A removal with nothing on record to read its own entries by is read the old way.
- **Majors:**
  - The removal undos left copies claimed for ten minutes when the claim's own read failed, or the
    delete of copies already written back failed. Every batch lets go of its claim however it ends now;
    only a database that can't take the release, or a process that dies, leaves it to lapse.
  - The Surveyed → Not home Undo read the slots it writes into with one query clause per copy: 87 s of
    planning at 50,000, past the worker's socket timeout, so a large undo could never finish. It reads
    them by voter now.
  - An unknock or conversion Undo landing while a clear-knocks discard ran was lost from every tool.
    Removals wait while a round is being re-cut, and the discard and a snapshot restore wait for removals.
  - The Surveyed → Not home review read its surveys with one query clause per entry: 14 s at 2,500
    entries, 47 s at 5,000, nothing at the 25,000 cap — F6, sized wrong. It reads a batch of visits at a
    time now, and a relabel's pricing tells its selection apart in a `$match`, not an `$in` test on every
    ledger row (10 s at 25,000 ids over 100,000 entries).
  - Undo again on a first-build one-person session whose one undo pass had put back a survey's later
    copy logged that survey put back a second time.
  - The voter profile lists a person's surveys and earlier answers from every campaign of the
    organization, but its Edit, Delete, Restore and Erase went to the open row and answered *not found*
    for a card from another campaign's row — Erase among them. Each card names its row now.
  - An unknock's own request that ended before its Undo did skipped that Undo's landing for good: no
    refresh, a review left open over moved numbers, and *may still be working* left up.
- **Minors**, all fixed:
  - Removal undos: a refused Undo read *Undo stopped part-way*; Retry undo after a hand-off stopped
    counting the answers it had handed on; an older visit with two entries, one struck later, came back
    with its answers handed away for good, and the undo of one of a visit's two entries could never put
    it back (only an entry recorded since the unknock counts as newer work now); a busy check that failed once the strike's run was on file
    left it reading *Removing…* for ten minutes; a campaign-numbers refresh failing after a strike
    finished answered "stopped"; a conversion batch archived twice listed a voter whose answers couldn't
    go back; every JSON 5xx read as stopped part-way (the routes answer `UNKNOCK_STOPPED` /
    `UNDO_STOPPED` with the run now); undone first-build unknocks read "N entries selected".
  - Answer-edit undo: an Erase landing while a pass worked, or of a session's later copy, read "put back"
    or "kept newer answers" instead of erased; a put-back recorded only at its batch's end went uncounted
    after a pass died and the survey was deleted (each is recorded as its copy goes now — an undo of 37,500
    surveys takes 43 s, against 36 s); a first-build save's earlier copies, and its counted
    questions read against the survey now, misread sessions open across the deploy.
  - Reviews: each dry run stamped `asOf` as it answered, not as it began; a refused review read the whole
    selection first (up to 13 s); a heavy review shared the server with another; the review's stop
    covered only the up-front counts (one that answered 500 started 146 more reads); a Node memory-leak
    warning on heavy reviews.
  - The console step: a profile edit's copy from before the run hid a real removal; a run whose entries a
    later unknock struck again was never marked; one was marked for an entry a later run removed.
  - Clients: a refusal in the edit form showed at the end of its scrolling body; "answers not put back"
    counted surveys and said "kept" of erased copies; own Undo, Revert and Stop here closed a review
    opened meanwhile with no word.
- **Not changed, stated:** a first-build save whose copy was erased before this build saved the survey
  again counts its questions again; a same-picks re-survey the first build deleted as redundant reads
  put back on this build's Undo again; the console step reads a later unknock whose copy was erased as
  the older run's removal. The reviewers' reproductions, re-run against the fixes, read fixed.
- **Result:** fixed and pinned. Round 8 reviews these fixes.

**Code review round 8 (2026-10-20, on rounds 1–7's fixes): five reviewers**, the same five lenses. Every
finding was reproduced or traced in the real code, fixed, and pinned in `answerEditRound8.int.test.js`
(24 tests, 21 of them failing on round 7's code — the other three guard the undo order round 7 already got
right and two of round 8's own mechanisms, a redelivered pass's count and a joining press's place; 36
mutants of round 8's fixes, all caught); three of round 7's tests changed with the fixes, and one of round
3's hooks.
- **Blocker — an answer-edit undo left a survey at a session's first save for good (round 7's
  regression).** A one-person session that saved a survey twice keeps two copies of it. Round 7 recorded
  the put-back on the item at the first copy it put back, so a pass that died before the second treated
  the survey as done on every retry and every Undo again: it kept the session's first save, its original
  only an earlier-answers card. A put-back is provisional until its pass finishes the survey (`us`), and
  a survey with a copy of this run still landed on it goes through its copies again.
- **Majors:**
  - A settled put-back read erased once the original's copy was erased later, and another survey's
    put-back on Undo again lost its History row. Only a provisional put-back is read for erased now.
  - Two unknocks of one visit undone oldest first put two Surveyed entries at one visit: the canvasser
    counted twice on the timeline, the reports, the activity export and the campaign's numbers. An entry
    put back there since now blocks the insert too. The strike records the visit's other entries at its
    freeze (`coEntryIds`), to tell that apart from a visit that held two, and takes its moment before its
    read.
  - A database error in a conversion's checks after its claim (its create, Pick up or Undo) left it
    *Working…* or *Undoing…* with no job and no button. Every removal, answer edit, snapshot restore and
    clear-knocks discard on the campaign then waited behind it for good. Each gives its claim back now.
  - Both undos read every round's surveys of each voter, answers and all, to find who holds the slots
    they write into. The conversion undo ran the worker out of memory at the cap where voters were
    surveyed in two other rounds too; the unknock undo, on the web dyno, peaked 850 MB above its start
    with three. They read the copies' own rounds now: +251 MB under the worker's 384 MB cap, and +502 MB,
    as with no other rounds.
  - A removal's Undo pressed between a clear-knocks discard and the restore of its snapshot found
    nothing and read undone. The restore then brought back a door stamped by an undone conversion, its
    copy kept after the undo, out of every tool's reach; an unknock's entries went back into the cleared
    round without their answers. An Undo now waits until that snapshot is restored (`ROUND_CLEARED_SINCE`).
  - A conversion Undo that failed together with its own stop write recorded no finish time, and the page
    then refused every later review on the campaign until a reload.
  - Reviews built one query branch per round and canvasser in every batch, and each read was planned
    afresh. At the 25,000-entry cap, the Surveyed → Not home review took 2.3 s for one canvasser and 22 s
    for 400; the priced answer-edit review lost its tag prices, or was refused on a slowed database. They
    read one clause per batch now (`visitsClause`): with 200 canvassers, the form opens in 1.9 s (8.8 s
    before), the priced review answers in 3.4 s (10.3 s) and the Surveyed → Not home review in 1.1 s
    (6.2 s), the same as for one canvasser (laptop, 25,000 entries).
- **Minors**, all fixed:
  - Removals: Restore read a conversion's undo as begun at its claim, before the checks and the enqueue
    that can give the run back. A Restore in that window (five seconds for an enqueue in a Redis outage)
    swapped removed answers over a real survey: round 7's blocker class, narrowed. An unknock Undo's
    checks after its claim left the claim on file for ten minutes on a database error. A strike whose
    check failed before it touched anything pointed at a row that wasn't there (`UNKNOCK_NOT_STARTED`
    now). Any re-cut lock held every removal back, a big campaign's claim re-carve for minutes, and a
    books-only snapshot restore waited for removals; only a lock that clears or restores knocks counts now.
  - Answer-edit undo: a first-build credit written after its put-back logged a survey twice when a pass
    died between them; a first-build copy erased before this build's first save left the undo reading
    put back; a profile Restore's full swap read as the first build's put-back, so a real put-back went
    unlogged; the comment on the put-back's record claimed an order the driver doesn't keep.
  - Reviews: places were taken only after a press had read its selection, so the form's first open, or a
    heavy press beside one other review, was refused after all its reads; a review of a big campaign
    counted as light whatever its campaign-wide pricing cost (two one-entry reviews of a 50,000-survey
    campaign took as much memory as one heavy one); a priced review could join One person at a time's dry
    run of the same selection and answer with no price.
  - The console step missed an older first-build unknock that took the answers when a later one, which
    never stood, froze and removed its entries.
  - Clients: an own unknock Undo or strike that stopped part-way left a review priced mid-undo open; a
    second identical refusal on the edit form or the profile didn't scroll into view; a landing watched
    on one campaign could carry to the next; the Help page overstated when a review is turned away.
  - Docs: the privacy record misquoted item 31's F5 and left out the first-build window; VOTERS.md's
    restore refusals missed `kept_after_undo`; Help said removed answers can never go over a real survey
    taken since, though Restore offers that swap after the undo.
- **Not changed, stated:**
  - An unknock made before this build, undone after it, can't put back one of a visit's two entries: it
    reads the other as put back since, counts its entry not put back, and leaves its answers on the
    profile. Where a visit held two entries and another unknock's undo put one back, a later run's undo
    reads it as put back since, and does the same.
  - After a later run's Undo puts back answers an earlier run handed it, the earlier run's row still
    counts them not put back, and the later run's counts them archived.
  - A first-build unknock with no copy that removed only entries still reads *Did not finish*.
  - A heavy review can be turned away when a lighter one takes the second place while it counts its
    surveys.
  - At the 25,000 cap, an unknock Undo still peaks about 500 MB above its start on the web dyno, as it
    has since before round 6.

  The reviewers' reproductions, re-run against the fixes, read fixed.
- **Result:** fixed and pinned. Round 9 reviews these fixes.

**Code review round 9 (2026-10-20, on rounds 1–8's fixes): five reviewers**, the same five lenses — the last
round: the owner asked to finish once its fixes landed, since the remaining finds were mostly older bugs in
neighbouring Door Outcomes tools. Every finding was reproduced or traced in the real code, fixed or stated
below, and pinned in `answerEditRound9.int.test.js` (17 tests, 16 of them failing on round 8's code — the
other guards round 9's paging; 21 mutants of round 9's fixes, all caught). Round 8's two cleared-round tests
now use a round its discard really emptied, and five older tests hold the strike at its new delete.
- **The privacy record (a blocker by the brief's rule):** round 8's lift — an older entry put back at a struck
  visit since lifts the hold, the removal's own entry staying off — was described nowhere; item 31 and round
  7's paragraph said a hold lifts only where the removal's own entry is back. Corrected.
- **An earlier version lost (since before `589c1c0`; a blocker by the letter):** a profile Restore that
  swapped a teammate's card into a voter's slot while an unknock or a Surveyed → Not home step was removing
  the survey there was deleted with it — read, copied, then deleted by id — and the restored answers were
  on file nowhere. A removal now deletes a survey only while it still holds the submission it read.
- **Majors:**
  - Round 8's cleared-round wait held an Undo for good once the round was deleted or archived, and sent the
    admin to a restore that, on a round knocked again since, put the old entries beside the new and failed
    part-way, on every try. Only a snapshot its round can still take back — on file, not archived, knocked
    nowhere since — holds an Undo now; past any other, the undo goes ahead and leaves that round alone.
    The restore refuses old knocks over new ones, and a snapshot holding the work of a change undone after
    it. The refusal names the round and the day, and Turf Cutting always lists such a snapshot.
  - A relabel's Undo had the same hole as round 8's removals (since before `589c1c0`); it waits the same way.
  - An answer-edit undo pass that died, its survey then taken by an unknock, a conversion or a re-cut before
    Retry undo, was counted put back and settled — round 8's blocker again, by another road. The counting
    path now needs the survey on file; off file, a later change holding a copy of the run reads waiting,
    and a snapshot holding the session's copies reads cleared.
  - Both undos loaded every copy of the run at once: the conversion undo ran the worker out of memory with
    twelve-question surveys at the cap, and the unknock undo took the web dyno's heap 833 MB up. They read
    1,000 voters a page now: the conversion undo of 50,000 twelve-question copies finished in 14 s at
    +85 MB under the 384 MB cap.
- **Minors**, all fixed:
  - Answer-edit undo: a put-back proven only by its receipt went uncounted while another copy remained.
  - Removals: the stopped unknock Undo's reply carried its start time, so round 8's close-the-review fix
    missed the review priced while the undo ran; a strike whose busy check and own run delete both failed
    read *Removing…* for ten minutes; a books-only snapshot restore waited for an answer edit, an open
    one-person session included; a conversion's Retry undo held again, for its whole run, what its first
    attempt had freed (it has begun once its job has claimed it now); the conversion job's chunk read built
    one `$or` branch per row — slow on a big crew, and the shape a MongoDB 7.0.0–7.0.5 query-engine bug
    answers short — and reads like the review now.
  - Reviews: a priced review of a big campaign took its second place only after reading its selection; a
    heavy review that found its twin finished ran on one place, beside a light one.
  - Docs and Help: the re-cut wait as round 8 narrowed it, what Restore offers after an unknock undo, the
    reasons behind `kept_after_undo`, and round 8's own residual wording.
- **Not changed, stated:**
  - Two identical heavy reviews pressed at the same moment: one can be refused instead of joining, and its
    retry joins. A heavy review pressed first can be refused by any review pressed while it counts.
  - Round 8's restore-copy exclusion logs a first-build deploy-window shape twice (a full-swap Restore after
    the first build's logged put-back) that leaves the same state as the one it fixes; the gone-mark seed
    reads a teammate's erased profile card as a first-build session's own.
  - A conversion whose claim's give-back fails along with its checks (two database failures in a row) stays
    pending or reverting with no job: the known stuck-conversion class. A `589c1c0` server's discard during
    the deploy takes its lock without `knocks`.
  - A deleted round's knock-clearing snapshot is shown nowhere and goes only with the campaign (an owner
    flag in PRIVACY_VERIFICATION).
  - The local test database (MongoDB 7.0.2 on its newer query engine) answers some `$or` reads short
    (SERVER-84338, fixed in 7.0.6), and rounds 4–9's crew timings are that engine's; on the classic engine the
    old reads' crew cliff is 3–7 times smaller, and the one-clause reads faster on both. The production
    cluster's version is recorded nowhere — the owner checks it on the Atlas cluster card.

  The reviewers' reproductions, re-run against the fixes, read fixed.
- **Result:** fixed and pinned; the review loop ends here at the owner's call.

**After round 9 (2026-10-20): the leftovers, closed at the owner's call.** The owner asked for the gaps the
hand-off named to be closed before the deploy; two reviewers then tried to break the fixes (privacy, and
races and state), and their findings were fixed or, in one case, the fix taken back. Pinned in
`answerEditFollowup.int.test.js` (14 tests; 11 fail on round 9's code — the other 3 guard what round 9
already got right: a queued job keeps a conversion busy, a twin gets its first press's failure, and an older
unknock never doubles a visit) and `retention.int.test.js` (two more).
- **Privacy (both flagged to the owner in round 9):** a deleted round's snapshots are deleted with it — on
  `DELETE /passes/:id` and the walk-list delete, after the round — and a nightly maintenance job
  (`sweep-orphan-snapshots`) deletes every snapshot whose round is gone; the identity purge rewrites a
  purged canvasser's name off every run's `scopeSummary` (the line's first part), per record, and each
  night over every record purged before and every account deleted past the window that no record holds
  (the review: an organization's deletion drops a record, and the person's work can sit in another
  organization's run lines); `describeScope` never freezes an email (PRIVACY_VERIFICATION item 32 and the
  round-9 paragraph).
- **The round delete (found by the review, older than this feature):** `DELETE /passes/:id` deleted any
  draft round, though a discard that keeps the knocks and a snapshot restore both leave a draft holding
  them — its entries, surveys and copies then belonged to no round — and it took no re-cut lock, so a
  restore landing mid-delete put knocks back under a deleted round and, with the snapshot now deleted
  beside it, failed. It refuses `has-history` (field entries, surveys or copies; desk marks still go with
  the round) and runs under the round's lock (`recut-locked`); the walk-list delete counts copies too and
  locks each round; the Passes page offers Archive for a draft with knocks.
- **L9-m5, a stuck conversion:** a run `pending`, `running` or `reverting` ten minutes after its last write
  with no live job is settled on every read and before every busy refusal — forward to `failed`, a begun
  undo to `revert_failed`, an undo claimed but never begun back to `revertFrom` (written by the claim), so
  a kept change never reads as an undo begun; the inline undo stamps `revertClaimedAt` before it writes.
  It replaces round 7's inline-only `expireDeadInlineRevert`, whose rule it keeps.
- **P9-m2, the same review pressed twice at once:** a named dry run registers its key on arrival
  (`reviewsAnswering`); a second press with that key takes no place, reads nothing and answers with the
  first press's answer or error. Round 9's P9-m3 test now presses its first review unnamed — the one path
  where a press of the same review can still find it running and then finished.
- **Taken back — round 8's older-unknock residual:** a first try read an older entry at a visit as
  standing there all along unless a record of another unknock's undo or of a restored snapshot named it.
  The review found the records can go — a restored snapshot deleted on Turf Cutting, a restore that
  stopped before its stamp, an undo that stopped twice — and then the Undo put its entry back beside one
  put back since: two Surveyed entries at one visit, the canvasser counted twice. Nothing on file proves
  an older entry stood there when a run from before `coEntryIds` froze, so such a run keeps reading every
  older entry as put back since (the follow-up file pins the review's case).
- Also: `migrate:build-indexes`' dry run no longer builds indexes as it lists them on a non-production
  database (`connectDb`'s autoIndex outranked by the connection's own option), so it lists all of them.
- **Not changed, stated:**
  - An unknock made before this build, undone after it, still can't put back one of a visit's two
    entries: counted not put back, its answers restorable (above).
  - A heavy review can still find its second place taken by a *different* review pressed while it counted:
    it is refused, and its retry runs. Reserving two places on arrival for every review that might turn out
    heavy would refuse ordinary reviews on mid-sized campaigns instead.
  - The first-build shapes (round 9's double-logged deploy-window put-back and the gone-mark seed, and the
    first-build items of rounds 5–7): nothing on file tells them apart, and they exist only for runs
    `589c1c0` made in production — `repair:answer-edit-words`' dry run reading 0 runs means there are none.
  - A `589c1c0` server's discard during the deploy takes its lock without `knocks`: deploy outside field
    hours. The production cluster's MongoDB version stays the owner's check (Atlas applies patch releases;
    SERVER-84338 was fixed in 7.0.6).
- **Result:** fixed and pinned.
