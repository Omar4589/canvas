# Proposal: Scripted surveys — statements, several closings, and "go to" routing

> **Status: BUILT 2026-10-02 to the design agreed with the owner that day (three rounds of rulings),
> with a five-angle review's fixes folded in on 2026-10-03; committed in 5cb42b2 and deployed to the
> server 2026-10-03, with the phone's over-the-air update waiting on the owner's device checks. No
> ruling open: the team-lead lock gap at the end of §O was ruled on 2026-10-03 and fixed by
> [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md).** Where the build differs from the
> plan, the code wins: every difference
> is listed in [§O, "As built"](#o-as-built-2026-10-02) at the end, with the gaps still known, and
> §H1 carries the names the stepper shipped with. Everything else below is the plan as
> agreed, so Part 2's line references and its "today" describe the tree before the build.
>
> *As agreed:* A client handed over a door
> script (Fulton County Commission District 3, election 2026-11-03) that the survey builder cannot
> hold: it has read-aloud statements that take no answer, four different closings chosen by the
> path the conversation took, closings that chain into one another, a canvasser-only instruction
> with a web link the voter is meant to scan, and routing written as "GO TO" arrows. This document
> records what the builder can do today, exactly where each piece of that script falls through,
> the best survey the current fields can carry, the design that closes the gaps, and the decisions
> only the owner and the client can make. Every ruling is folded in (Part 1, "Rulings") and the
> Burton survey is written out block by block. The plan was then verified against the code (six
> section checks, four adversarial attacks, skeptic review; 70 findings, every one folded in or
> recorded in §N). Read it before touching anything under
> `server/src/services/surveys/`, the survey builder, or the door runner.

What this covers: how surveys branch today and why that model is one-way ("show only if", never
"go to"); the one intro and one closing; what happens to an answer-less block in every reader of
a survey template; the proof that the current rule grammar can already carry the whole client
script once statements and closings become blocks; the design; the rollout; and the questions.

Related: [SURVEYS.md](SURVEYS.md) (the survey system this extends), [METRICS.md](METRICS.md)
(why Refused stays a door outcome and is never a survey answer),
[CAMPAIGNS.md](CAMPAIGNS.md) (campaign key dates the script hard-codes),
[WALK_PACKETS.md](WALK_PACKETS.md) (the only paper surface for read-aloud text),
[EXPORTS.md](EXPORTS.md) ("one column per question", which statements must not break),
[CANVASSER_APP.md](CANVASSER_APP.md) (the door screen and its Refused button),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (items 15 and 20, the precedent for a link
opened from the app).

---

# Part 1 — For everyone

## The script the client wants

The script is a conversation tree, written the way phone-bank and door scripts are usually written:

- An **opening** the canvasser reads (three paragraphs).
- **Question 1**, the support ask, with five answers. Each answer says where to go next: *Yes* goes
  to Question 4, *No* to Question 2, *Undecided* to Statement 1, *Already voted* to Question 3,
  *Refused* straight to Close 1.
- **Question 2** asks the reason in the voter's own words, then has the canvasser read a follow-up
  line, and carries an instruction **for the canvasser only**: if it feels appropriate, show the
  voter a QR code that opens an article about the opponent.
- **Question 3** (did you vote for Paul?) sends *Yes* to Close 3 and *No* to Close 1.
- **Question 4** (how do you plan to vote?) sends *Not voting* to Close 1 and everything else to
  Close 2.
- **Statement 1** is a paragraph the canvasser reads to an undecided voter. It takes no answer,
  though it does contain a question ("what is your most important issue?").
- **Four closings.** Close 1 is a plain thank-you. Close 2 reminds them of the dates and then
  **continues into** Close 4. Close 3 thanks a voter who already voted for Paul and also continues
  into Close 4. Close 4 gives the website and the polling-place lookup, both as web addresses.

## What the builder can do today

A survey is one **intro**, a list of **questions**, and one **closing**. Every question is one of
three kinds: single choice, multiple choice, or free text. Every question wants an answer. There is
no block that is only read aloud.

Branching exists, but it points the other way from the client's arrows. Instead of an answer saying
"go to Question 4", **Question 4 says "show me only if Question 1 is Yes."** The app evaluates those
"show only if" rules live as the canvasser taps, so questions appear and disappear on the phone. A
rule can only look at an **earlier** question, so a survey can never loop. Hidden questions keep
their answers to themselves: if the canvasser changes Question 1 after answering Question 4, and
Question 4 disappears, nothing that depended on Question 4's answer can still show. That last rule
turns out to matter a great deal below.

An answer option can also carry a **read-aloud script**, a line that pops up under the option the
moment it is picked. That is the only conditional read-aloud text the builder has.

## Why the client's script does not fit

Walking the script block by block against the real code (every claim here was checked against the
files named in Part 2):

| Block | Fits today? | What goes wrong |
|---|---|---|
| Opening | Yes | Goes in the intro. The "ma'am/sir" and the blank for the canvasser's name are read literally; there are no fill-in placeholders. |
| Question 1 and its five answers | Yes, as a question | The "GO TO" arrows have to be rewritten by hand as "show only if" rules on Questions 2, 3 and 4. See the Refused note below. |
| Question 2 (reason, free text) | Partly | The reason itself is a text question. The follow-up line and the QR instruction have nowhere to live: text questions have no script slot, and a block can only follow a free-text question **if the voter typed something** (the app cannot tell "they typed nothing" from "they never saw it", so "show this after Question 2 regardless" is not writable). The only place to put them is the script under Question 1's *No* option, which shows **above** the box the voter's reason goes in, out of order. |
| The canvasser-only QR instruction | Partly | The words can be typed into an option script with a bracketed warning, but there is no "note to the canvasser" field: the phone captions an option script **Read aloud**, and every text slot a survey has (greeting, option scripts, closing) is presented as words to say, so opposition research sits under a read-aloud banner. A web address is plain text: not tappable, no QR code (the app opens links elsewhere, just not from a survey). |
| Question 3, Question 4 | Yes | Plain questions with "show only if Question 1 is …". |
| Statement 1 | Partly | No answer-less block exists. The whole paragraph has to ride as the script under Question 1's *Undecided* option. The embedded "most important issue" question is **not recorded**. Faking it as a text question adds an empty answer box, a question number, a stuck progress bar, an export column headed by a paragraph, and an empty results card. |
| Close 1, 2, 3, 4 | Partly | There is **one** closing field, shown under every path, with no condition on it. Path-specific closings only work by leaving that field empty and copying each closing into the read-aloud script of every answer that leads to it: Close 1 **four** times (three from the client's arrows plus the exit chosen after Question 2), Close 4 **six** times (five answers plus the exit chosen after Statement 1). A later wording fix is six edits. On the phone each copy appears inside the question card under the tapped answer, labelled "Read aloud", never at the end. |
| Close 2 → Close 4, Close 3 → Close 4 | Partly | A closing cannot depend on "Close 2 was shown"; rules only read answers. The chain is flattened by hand: Close 4's text is concatenated onto every copy of Close 2 and Close 3. |
| Exits after Question 2 and Statement 1 | Not written | The client's script names no next step after either. Any build has to choose. |

Two things the client's wording hides:

- **"Refused" means two different things in Doorline.** Tapping the **Refused** door button records
  a contact who declined, and is **never a survey**: it raises the contact rate and leaves the
  connection rate alone. An answer option *named* "Refused" does the opposite: it submits a
  **completed survey**, the door turns green, and the connection rate goes up. Question 1's
  *Refused* (declined the whole conversation, go to Close 1) is the door outcome in disguise.
  Question 4's *Refused* (a supporter who will not state a voting plan) is a genuine per-question
  answer. The schema carries a `refusalOption` flag from an earlier plan that was deliberately
  **not** finished: the builder, the phone and the reports ignore it, though the paper packet already
  prints a "Refused" bubble for it (a choice the app cannot record), and the docs disagree with each
  other about it. A per-question Refused was dropped in favour of the door button (see SURVEYS.md).
  This is a counting decision the owner has to make, not a UI detail. **Ruling (2026-10-02): a
  refusal is recorded only from the door screen's Refused button, never as a survey answer.** The
  Burton survey carries no Refused answer at Question 1; a canvasser who is refused backs out and
  taps Refused on the door screen, as today.
- **The dates are typed by hand.** "Election Day is Tuesday, November 3rd" and "Early voting starts
  Tuesday, October 13th" are literal text, while the campaign already stores both dates and ships
  them to every phone. Nothing fills them in; the demo survey even shows a literal `{{canvasser}}`
  to anyone who opens it, because that placeholder was written into the seed and never implemented.

## The best survey the current fields can hold

It can be built, and a copy of exactly that survey was generated and checked against the real
validation and evaluator code (Part 2 §C). (This analysis is of the script as the client wrote it,
including a Refused answer the ruling above removes.) Four questions in the client's order, the opening as the
intro, the closing field left **empty**, and every statement and closing copied into the read-aloud
script of the answers that lead to it (ten script copies, five distinct texts). The routing is right
on every path, nothing phantom reaches reports or exports, and progress reads correctly.

What the canvasser would see wrong:

- Every closing and statement appears **inside the question card**, under the answer they tapped, in
  an amber "Read aloud" block, never as a closing at the end of the form.
- On the *No* path, the follow-up line, the QR instruction, and Close 1 all appear **before** the box
  where the reason goes.
- The QR instruction sits under a **Read aloud** label, told apart only by a bracketed warning typed
  into the text.
- Web addresses are not tappable and there is no QR code; the voter types the address or scans the
  push card.
- If the canvasser leaves Question 3 blank, **no closing appears at all** on that path.
- Tapping Question 1's *Refused* and saving records a completed survey, not a refused door.
- Close 4 lives in six places and Close 1 in four.
- The web preview and the campaign Survey tab show four questions and **no closings or statements**
  (they never render option scripts), so the client cannot review their script on the web except
  inside the editor.

That is a workable stop-gap for a single campaign and a poor foundation for the next client who
brings a script like this. The design in Part 2 is what makes scripts like this first-class.

## What has to change, in plain terms

1. **A block that is only read aloud.** A new block kind, **Statement**, that sits in the question
   list, has a read-aloud body (paragraphs allowed), takes no answer, is never numbered as a
   question, never counts toward progress, and never appears in results, exports, or the response
   editor. Closings become statements placed at the end of the list, so a survey can have **as many
   closings as it has paths**, each with its own "show only if".
2. **"Then go to…" on every answer.** Authors think in arrows, so the builder gets a per-answer
   "then go to" picker (and one on each statement, for chains like Close 2 → Close 4). The app turns
   those arrows into the "show only if" rules it already understands, so the phone, the web, and the
   server keep evaluating exactly what they evaluate today. Fall-through (an answer with no arrow)
   means "the next block", "End" is an explicit target, and every block without an explicit arrow
   shows a small "Continues to …" line so a forgotten arrow is visible before it misroutes a
   conversation. The first arrow an
   author sets switches the survey into "script" mode (the builder says so and offers a one-click
   way back that keeps the conditions); nobody has to find a mode setting first. A **Try it** button
   on the web preview lets the client click through every path of their own script, one screen at a
   time, exactly as the canvasser will.
3. **A canvasser-only note, visibly different from read-aloud text,** on any block: a statement, a
   closing or a question. Notes live on blocks, not on individual answers.
4. **Links that work.** A block (statement, closing or question) can carry web links; the phone shows them as
   **tappable links** the canvasser opens to show the voter. No QR code on the phone: by ruling, the
   QR lives on the printed literature. Nothing is fetched ahead of time and nothing about the voter
   is attached (Part 2 §K says why that keeps it out of the privacy policy).
5. **The canvasser's own name filled in.** One placeholder, `{{canvasser}}`, becomes the signed-in
   canvasser's first name wherever it appears in the opening, closings, statements, option scripts
   or notes, on the phone and in the web preview; on paper it prints as a blank line for the
   volunteer to say their own name, because a packet is not personal to one canvasser and no
   canvasser name is ever printed (WALK_PACKETS.md). It is the one value an author cannot type in
   advance. Dates stay typed by hand, as the owner prefers; there are no date placeholders.
   It is not allowed in a question's wording or an answer's text, because both are stored with every
   answer and become report labels and spreadsheet cells, and a misspelt token is refused at save
   rather than read aloud as braces. The demo survey's literal `{{canvasser}}` starts reading as a
   name in the same change (ruling: fix it).
6. **Refused stays where it is.** By ruling, nothing is built here: a refusal is the door screen's
   Refused button, and no survey answer may be named or flagged "Refused" at Question 1. (An earlier
   draft proposed an option flag that filed the door outcome from inside the survey; it is recorded
   in Part 2 §N as rejected, so it is not re-proposed.)
7. **One block per screen for scripted surveys.** Instead of one long page, the canvasser sees one
   thing at a time in large type: read the opening, Next; ask a question, tap the answer (its
   read-aloud line appears under it, as today), Next moves to wherever that answer points; read a
   statement, Next; the closing the path reached is the last screen, with the note box and Save on
   it. Back returns to the previous block, and changing an earlier answer discards the path that no
   longer applies. Optional questions get a Skip. Next is always there and never advances past a
   required question that has no answer. A **scripted survey** is one with a statement, a closing
   block or an arrow; the builder turns the setting on by itself when a survey becomes one, an admin
   can turn it off, and every existing survey stays on the single page it has today. The branching logic is shared with the single page, so the
   two can never disagree about what a canvasser was shown.

Everything above is additive: an existing survey keeps working unchanged, the single intro and
closing fields stay as the opening and the fallback closing, and no migration is needed.

## Rulings (2026-10-02)

Three rounds of questions, all answered. The design in Part 2 reflects them; nothing is open.

| # | Question | Ruling |
|---|---|---|
| 1 | Which closing follows Question 2? | **Close 1**, which is the survey's **default closing** (see 6). |
| 2 | Question 1 "Refused": a door outcome or a survey answer? | **Neither in the survey.** A refusal means no conversation was had; it is recorded only from the door screen's Refused button. No answer named or flagged Refused exists at Question 1, and the option flag once proposed for it is dropped. |
| 3 | What gets recorded? | **Only the numbered questions.** Question 2's reason is typed in because it is a question. Statements and closings are read aloud and nothing is typed. Nothing new is collected about anyone. |
| 4 | Links and QR? | **Clickable link for the canvasser, no QR on the phone.** The QR belongs on the literature. |
| 5 | Arrows alongside "Show only if"? | **Yes, one style per survey**, chosen by the builder, never a setting the author has to find (plain explanation below). |
| 6 | Keep the intro and closing fields? | **Yes.** The intro is the opening; the closing field is the **default closing**, the goodbye on any path that reaches no explicit closing. For Burton it holds Close 1. |
| 7 | Placeholders? | **`{{canvasser}}` only.** Dates are typed by hand on every survey, as today. The demo's literal `{{canvasser}}` gets fixed by this. |
| 8 | Extra answers? | **Yes.** Question 3 gains "Declined to say". Question 4 gains "Vote by mail" and "Declined to answer" (both → Close 2), so a supporter who will not share a plan still hears the voting pitch and the website. |
| 9 | Rollout? | **No gate bump.** The race has not started; the server and both app lanes ship before the survey is set up. |
| 10 | Paper? | **Yes**: statements and explicit closings print once on the "What to say" page with their condition; canvasser notes are omitted. |
| 11 | Record which closing was reached? | **No.** Inferable from the answers. |
| 12 | New survey, no responses, new campaign? | **Confirmed.** |
| 13 | Required questions | **Question 1, Question 3, the post-pitch question and Question 4 are required**; Question 2 (the typed reason) is optional. |
| 14 | Statement 1 | **The pitch stays a statement and is followed by a question**: "Having heard that, can Paul count on your support?" with **Yes** (→ Question 4), **Still undecided** (→ Close 4) and **No** (→ default closing). |
| 15 | Presentation | **One block per screen for scripted surveys** (statements, closings or arrows present), on by default only for those; existing surveys keep the single page. |
| 16 | Switching authoring styles on a survey with responses | **Allow the always-safe direction (arrows → "Show only if", which keeps the exact same conditions) at any time; block the other once responses exist**, pointing at Duplicate, the same way a question's answer type is locked today. |
| 17 | Tags | The owner will tag both "yes" answers (Question 1 and after the pitch) **Supporter** — and, on the verification's suggestion, Question 3's "Yes, voted for Paul" too, so a voter who already voted for him is counted as a supporter — so the Tags panel counts each supporter once however they got there. "Current" handles a later flip **at a question the later visit asks again**; see the reporting caveat after the Burton table for the one path it does not catch. Existing feature, no build. |

**"One style per survey", in plain words.** Today a survey makes a question appear by putting a
"Show only if…" condition on that question. The new way is to put "then go to…" on each answer, the
way the client's script is written. Both describe the same branching from opposite ends, and the app
can only trust one of them at a time: if a survey mixed arrows on some answers with hand-written
conditions on other blocks, the two could contradict each other and nobody could say which wins. So
a survey is either in the "Show only if" style or in the "then go to" style. **Nobody picks this
from a menu.** The first time an author sets a "then go to" on an answer, the survey quietly becomes
an arrows survey and a banner says so; the banner has a "Switch back" button that turns the arrows
into ordinary "Show only if" conditions and removes the arrows, so nothing is ever lost. Every survey
that exists today is, and stays, a "Show only if" survey. (This is unrelated to the one existing
lock, that a question's answer type cannot change once it has responses.)

**How the phone decides what to show.** After every tap it recomputes the whole list from the top.
Block 1 always shows. Every later block shows only when its condition holds for the answers so far;
in the arrows style the condition is "an answer that points here has been picked", through the
chain. Change an earlier answer and the blocks that no longer apply vanish, and anything typed into
them is dropped when the survey is saved. A closing is a block like any other, so Close 2 appears
exactly when an answer leads there, and the default closing is the last screen only on a path that
reached no explicit closing. On the single-page presentation the same rule holds, with one guard
that applies only to scripted surveys (arrows, or any closing block): the default closing waits
until every visible required question is answered, so a canvasser never reads "Thank you for your
time" under a question they are still asking. Every existing survey renders exactly as today.

## The Burton survey, as it will be authored

Blocks in list order (arrows only point forward, which is why Question 4 sits after the post-pitch
question: both Question 1 "Yes" and the post-pitch "Yes" lead to it). "End" means the default
closing, Close 1, is the last screen.

| # | Block | Answers → where they go | Notes |
|---|---|---|---|
| — | **Opening** (intro) | — | The client's three paragraphs; "My name is {{canvasser}}". |
| 1 | **Q1** "Can he count on your support…?" single choice, **required** | Yes → Q4 · No → Q2 · Undecided → Statement 1 · Already voted → Q3 | Tag "Yes" **Supporter**. |
| 2 | **Q2** "Thank you for sharing. Is there a particular reason?" text, optional | continues to the follow-up line | Recorded. |
| 3 | **Statement** "Are you aware of how much legal and financial trouble his opponent is in?" | → End | Canvasser note: "Could share this with them if the situation feels appropriate." Link: the opponent ledger article, tappable. |
| 4 | **Q3** "If you don't mind sharing, did you vote for Paul Burton?" single choice, **required** | Yes → Close 3 · No → End · Declined to say → End | "Oh great! Well thank you for participating." goes in the read-aloud script of Q1's "Already voted". |
| 5 | **Statement 1** the pitch ("That's completely understandable… Common sense, right?") | continues to the post-pitch question | Read aloud only; the "most important issue" line is conversation, nothing is typed. |
| 6 | **Post-pitch question** "Having heard that, can Paul count on your support?" single choice, **required** | Yes → Q4 · Still undecided → Close 4 · No → End | Tag "Yes" **Supporter**. |
| 7 | **Q4** "The election is Tuesday, November 3rd. Do you plan to vote on election day, vote early, or vote by mail?" single choice, **required** | Election Day, Voting early, Vote by mail, Unsure, Declined to answer → Close 2 · Not voting → End | Date typed literally, as the client wrote it. |
| 8 | **Close 2** "Every vote matters… make a plan to vote." | → Close 4 | Dates typed literally. Canvasser note: "Dates are also on the push card." |
| 9 | **Close 3** "Great! … Do you know anyone else that would want to vote for Paul?" | → Close 4 | Read aloud only. |
| 10 | **Close 4** "For more information… Have a great day!" | → End | Links: the website and the polling-place lookup, tappable. Canvasser note: "Both links are also on the push card." |
| — | **Default closing** (closing field) | — | Close 1: "Thank you for your time today / Not a problem. Have a good day!" |

Every path was run against the real branching engine with this exact shape (Part 2 §F): 20 of 20
checks pass, including the two ways into Question 4 and three cases where an earlier answer is
changed after later answers were given.

**One reporting caveat for the owner, from verification.** The Tags panel's "current" count is
decided per tagged question: a later visit that never showed a question leaves that question's last
answer standing. So a voter who said *Undecided* then *Yes* after the pitch in round one, and in
round two takes any path that never asks the post-pitch question (*No*, or *Already voted*), still
counts as a **current** supporter through the post-pitch question, because round two never reached
it. "Identified" is unaffected. This is the rule tags were given in August 2026 (SURVEYS.md, Tags:
"A later visit that skipped the question … changes nothing — the last answer they actually gave
still stands", pinned by `surveyTagUnits.int.test.js`), and it is worth knowing before quoting the
current figure on a multi-round campaign. The alternative rule — judge "current" by the voter's most
recent visit as a whole — would catch this case but changes a ruled, test-pinned behaviour for every
campaign and has its own downside: a supporter whose later visit never asked **any** tagged question
would drop out of current. Tagging Question 3's "Yes, voted for Paul" as Supporter (row 17) closes
the most likely such path for Burton, since an already-voted supporter then re-earns the tag on
every visit.

## What the verification changed

The agreed plan was checked against the code by six readers and four attackers, with a skeptic pass
over the findings. Nothing in the rulings moved. The design changes it forced are small and are
listed here so a reader of an earlier copy can see them: on the phone an answer tap **selects** and
**Next** advances (an automatic advance would have hidden the read-aloud line under *Already voted*
and made "Other (specify)" untypable); a plain question in the middle of a script whose answers carry
no arrows no longer ends the path when skipped (only a **branching** question needs an answer to
know where to go); canvasser notes never print (ruling 10, which the technical print section had
contradicted); the single-page closing guard applies only to scripted surveys; the leftover
"ends as Refused door" control was deleted from the builder section; the new `role` field carries no
schema default (a default would have stamped every ordinary question as a statement on load); a
condition can never target a statement; the screen that carries Save is defined by position (the
last visible block when it is a closing, else the end screen); switching a survey into arrows is
guarded on the server as well as in the builder; and a dozen smaller rules the implementer would
otherwise have had to guess (the fields that duplicate copies, what a PATCH with only a flow change
does, reserved keys, how error messages name a statement, which fields are hydrated versus lean) are
now written down in Part 2.

---

# Part 2 — Technical reference

Everything below was read from the code on 2026-10-02 and, where it is a claim about behavior,
exercised against the real evaluator and validators (§C). Nothing in the tree was changed.

## A. The model today, and the exact walls

[models/SurveyTemplate.js](../server/src/models/SurveyTemplate.js):

| Thing | Shape | The wall it puts up |
|---|---|---|
| `template.intro`, `template.closing` | two flat strings (lines 69-70; zod max 5000 at [surveys.js:72-73](../server/src/routes/admin/surveys.js)) | **One** closing, rendered unconditionally after the last visible question ([survey.jsx:526-529](../mobile/app/(app)/voter/[id]/survey.jsx), [SurveyPreview.jsx:72-73](../client/src/components/SurveyPreview.jsx), [packetPdf.js:770](../client/src/lib/packet/packetPdf.js)). No visibleIf on either. |
| `questions[].type` | `enum ['single_choice','multiple_choice','text']` (line 44; zod mirror [surveys.js:57](../server/src/routes/admin/surveys.js); builder `QUESTION_TYPES` [SurveyBuilder.jsx:5-9](../client/src/components/SurveyBuilder.jsx)) | **No answer-less block.** A fourth value is a zod 400 before Mongoose ever sees it. |
| `questions[].label` | single-line `<input>`, zod max 1000 ([surveys.js:56](../server/src/routes/admin/surveys.js), [SurveyBuilder.jsx:455](../client/src/components/SurveyBuilder.jsx)) | Paragraph text cannot live on a question. |
| `options[].script` | the only conditional read-aloud slot (line 12); rendered under the picked option, captioned **Read aloud** ([survey.jsx:48-53, 91-96](../mobile/app/(app)/voter/[id]/survey.jsx)); the intro and closing blocks are captioned "Greeting" and "Closing" and share the same amber style | Exists only on **choice** options. Text questions have no script. No slot anywhere carries canvasser-only semantics: a do-not-read aside *can* be typed into any text slot today, and renders indistinguishably from words to say. Not rendered by `SurveyPreview`, so the web quick view and campaign Survey tab never show it. |
| `visibleIf` | `{ logic: all\|any, rules: [{ questionKey, op: is\|is_not\|any_of\|answered\|not_answered, optionIds }] }` (lines 21-35) | A **pull** model (the child declares its gate). One flat level; no nesting; no `none_of`; no "was reached". Rules may reference only **strictly earlier** non-retired questions ([surveys.js:164-196](../server/src/routes/admin/surveys.js), builder `ruleError` [SurveyBuilder.jsx:61-90](../client/src/components/SurveyBuilder.jsx)). |
| `refusalOption` | boolean, default false (line 53) | **Half-wired, and the docs disagree about it.** No builder control, no phone rendering, no submit handling (`normalizeAndFilterAnswers` would prune a `__refused__` id), no report consumer — but the admin API accepts and persists it ([surveys.js:67](../server/src/routes/admin/surveys.js)) and the print packet already prints a muted "Refused" bubble for it ([surveyPrintModel.js:93](../client/src/lib/packet/surveyPrintModel.js), [WALK_PACKETS.md](WALK_PACKETS.md)), a choice the app cannot record. [SURVEYS.md](SURVEYS.md) §A and [ADMIN_APP.md](ADMIN_APP.md) say "not wired"; the three statements are reconciled to ruling 2 (§M). |
| URL / link field | none | A web address in any text is inert `<Text>` on the phone; no `Linking` import in the runner, no QR library anywhere in the repo. |
| Placeholders | none | `{{canvasser}}` in the demo seed ([seedDemoOrg.js:938](../server/src/services/platform/seedDemoOrg.js)) is the only `{{…}}` in server code and nothing substitutes it. |

The evaluator ([services/surveys/visibility.js](../server/src/services/surveys/visibility.js), mirrored
byte-for-byte to [client/src/lib/surveyVisibility.js](../client/src/lib/surveyVisibility.js) and
[mobile/lib/surveyVisibility.js](../mobile/lib/surveyVisibility.js), drift-guarded by
[visibility.test.js](../server/src/services/surveys/visibility.test.js)) has three properties this
proposal leans on, all verified by running it:

1. **It never reads `q.type`.** `visibleQuestionKeys` looks at `key`, `retired`, `visibleIf` only
   (lines 61-83). A block of any new type flows through unchanged, gated by its own `visibleIf`.
2. **Hidden parents withhold their answers** (lines 76-80). Only a *visible* question's cell is
   copied into the `effective` map that later rules read. So a rule "Q4 is any of {…}" implicitly
   carries "and Q4 was reached", which implicitly carries "and Q1 is Yes". That is why a closing
   reached from several branches can be written as a flat `any` of positive atoms with no nesting.
3. **`is_not` and `not_answered` are TRUE on an absent or hidden cell** (lines 31-32, 37-38; fixture
   "is_not on unanswered upstream passes"). Any closing or statement gate built from them fires on
   branches that never reached the referenced question. Compiled gates must use positive atoms only.

Two consequences that are not obvious from the grammar:

- **"Reached but unanswered" is inexpressible.** A rule that references a text question may only
  test `answered`/`not_answered` ([surveys.js:181-183](../server/src/routes/admin/surveys.js)).
  `answered` works as expected (a follow-up gated on "they typed something" is fine today), but
  `not_answered` cannot tell a hidden text question from a shown-but-blank one, and there is no
  "reached" op. So "after Question 2, whatever they typed, go to Close 1" cannot be written as a
  rule on Question 2. It has to be re-conditioned on Question 2's own gate (Question 1 is No). A
  compiler does that mechanically by copying the source block's rules into the target; a human has
  to notice.
- **Nested boolean is inexpressible.** Brute force over every visibleIf in the single-level grammar
  for a two-question counter-example (18 atoms × 2 logics × all 262,143 rule subsets = 524,286
  candidates) finds none that equals `(P=yes ∧ Q5=a) ∨ (P=no ∧ Q5=b)`. The client's script never
  needs it (every block has exactly one parent branch), and property 2 above is why.

## B. What every reader of a template does with a block it does not recognize

Adding a block type is only safe if every consumer either ignores it or is taught about it. The
sweep below is the complete list; "(a)" means harmless today, "(b)" means junk output, "(c)" means
a hard failure.

**Server**

| Site | Today | With an unfiltered statement |
|---|---|---|
| [surveys.js:57](../server/src/routes/admin/surveys.js) zod enum; [SurveyTemplate.js:44](../server/src/models/SurveyTemplate.js) | rejects | (c) 400 — the gate that makes the script un-buildable today; both enums change together. |
| [surveys.js:181](../server/src/routes/admin/surveys.js) `validateVisibleIfIntegrity` | special-cases only `text` referents | accepts a rule *targeting* a statement; `is`/`any_of`/`answered` are then constant-false (child hidden forever), `is_not`/`not_answered` constant-true. Must refuse statements as rule targets. |
| [normalizeAnswers.js:58-98](../server/src/services/surveys/normalizeAnswers.js) | keeps every known-key row, drops only visibleIf-hidden rows | (b) a `{ optionIds: [], answer: null }` row is **stored** per response per visible statement if a client posts one (an old app bundle will). Must drop answer-less types here, the backstop for pre-OTA phones and offline replays. |
| [reports.js:1266-1465](../server/src/routes/admin/reports.js) `/survey-results` | `isText` else choice pipeline, one payload entry per question | (b) one wasted aggregation per statement per poll, then an empty card entry that every renderer below paints. Filter **here**, once. |
| [surveyColumns.js:38-70](../server/src/services/export/surveyColumns.js) `templateAnswerPlan` | every question becomes a CSV column | (b) a blank column headed by a three-paragraph label in survey-results, results-by-voter and activity-with-surveys exports. The one owner of column identity; exclude here. |
| [exportBuilders.js:1048](../server/src/services/export/exportBuilders.js) long export | one row per `answers[]` entry | (b) one junk row per response per stored null row. Fixed by the normalize backstop. |
| [computeReport.js:46, 232](../server/src/services/reports/computeReport.js), [clientReports.js:93](../server/src/routes/admin/clientReports.js), [me.js:169](../server/src/routes/mobile/me.js) | choice-only filter at 46 and 93 and 169; a text-exclusion at 232 (a statement passes it and yields null only because it has no options) | (a); §I adds a type guard at 232 so that stays true by construction. |
| [voterProfile.js:316-328](../server/src/services/voters/voterProfile.js) | whitelists `key,label,type,options,required,otherOption` per question | ships the statement to the admin editor unless filtered (§I filters it). The whitelist itself stays as it is: a canvasser note must never reach the response editor (§E1). |
| [campaigns.js:1699, 1845, 2211](../server/src/routes/admin/campaigns.js) conversion wires | ship `template.questions` whole | reaches the desk composer (below). |
| [buildPacket.js:93-113](../server/src/services/packet/buildPacket.js) | filters retired only | hands the statement to the print model as a question. |
| [tags.js:16](../server/src/services/surveys/tags.js), [currentTags.js](../server/src/services/surveys/currentTags.js), [answerAgg.js](../server/src/services/surveys/answerAgg.js), [resolveWalkList.js:119](../server/src/services/walklist/resolveWalkList.js), [households.js:300](../server/src/routes/admin/households.js), [answerScope.js:93](../server/src/services/canvass/answerScope.js) | keyed by `questionKey` / option ids | (a) — a statement has no options and is never offered as a filter. |
| [diffQuestions.js:28](../server/src/services/surveys/diffQuestions.js) | 409 on a type change once responses exist | (a); design consequence: a statement must be a **new key**, never a retyped question. |

**Web**

| Site | With an unfiltered statement |
|---|---|
| [SurveyBuilder.jsx:5-9, 376, 402-406, 455, 642-657, 757-758](../client/src/components/SurveyBuilder.jsx) | no type row; `isChoice` branch; numbered `Q#`; offered as a rule target in later blocks' dropdowns; single-line label. |
| [SurveyPreview.jsx:30-63](../client/src/components/SurveyPreview.jsx) | label + the raw type string, numbered. Never shows option scripts. |
| [SurveyAnswerFields.jsx:58-65](../client/src/components/surveys/SurveyAnswerFields.jsx), [VoterDetailPage.jsx:458-464](../client/src/pages/VoterDetailPage.jsx) | (b) the `else` branch renders a **free-text input** labelled with the statement, in the desk composer, the queue walkthrough and the admin response editor; typing into it posts `optionIds: [typedText]`, which normalize prunes to a stored null row. `VoterDetailPage`'s `SurveyCard` carries its **own copy** of the seed/build logic (lines 317-365), separate from `lib/surveyAnswerForm.js`. |
| [SurveyAnswerComposer.jsx:27-30](../client/src/components/outcomes/SurveyAnswerComposer.jsx) | "N of M answered" denominator inflated. |
| [SurveysPage.jsx:222](../client/src/pages/SurveysPage.jsx), [SurveyQuickView.jsx:71](../client/src/components/SurveyQuickView.jsx), [CampaignSurveyPage.jsx:219](../client/src/pages/CampaignSurveyPage.jsx) | "N questions" badges count it. |
| [QuestionResults.jsx:722-779](../client/src/components/QuestionResults.jsx) via [DashboardPage.jsx:913](../client/src/pages/DashboardPage.jsx) | (b) a card reading "statement · 0 answered / No responses yet." unless the server stops emitting it. |
| [surveyPrintModel.js:85-99, 126-129](../client/src/lib/packet/surveyPrintModel.js), [packetPdf.js:149-171, 313](../client/src/lib/packet/packetPdf.js) | (b) numbered, verb "Answer", empty chip row, label drawn unwrapped past the margin, **repeated beside every door** (a page multiplier under the atomic-door rule); shifts "skip to Qn" targets. Its body never reaches the "What to say" page ([packetPdf.js:744-770](../client/src/lib/packet/packetPdf.js)), which prints only Opening, option scripts, Closing. |
| [MapFilters.jsx:113](../client/src/components/MapFilters.jsx), [SurveyExplorerPage.jsx:220](../client/src/pages/SurveyExplorerPage.jsx), [WalkListsPage.jsx:181](../client/src/pages/WalkListsPage.jsx), [TurfsPage.jsx:1648](../client/src/pages/TurfsPage.jsx), [DoorOutcomesPage.jsx:306](../client/src/pages/DoorOutcomesPage.jsx), [VoterHighlights.jsx:76](../client/src/components/VoterHighlights.jsx) | (a) choice-only filters. |

**Mobile**

| Site | With an unfiltered statement |
|---|---|
| [survey.jsx:205-224](../mobile/app/(app)/voter/[id]/survey.jsx) cell build | `else` branch → `[v]`; a statement has no state → empty cell. Fine. |
| [survey.jsx:477-522](../mobile/app/(app)/voter/[id]/survey.jsx) render | (b) a **numbered question card with no control**: badge, bold label, no input. |
| [survey.jsx:261-306](../mobile/app/(app)/voter/[id]/survey.jsx) `isAnsweredNow`, progress, `validate` | never "answered" → progress capped below 100%; **(c) if `required: true`, Save is blocked forever** on that build. |
| [survey.jsx:324-343](../mobile/app/(app)/voter/[id]/survey.jsx) submit body | posts `{ optionIds: [], answer: null, otherText: null }` per visible statement; frozen verbatim into the offline queue ([offlineQueue.js:97-101](../mobile/lib/offlineQueue.js)) and replayed days later. |
| [survey.jsx:470-475, 526-531](../mobile/app/(app)/voter/[id]/survey.jsx) | intro ("Greeting") and closing ("Closing") rendered once, unconditionally. |
| [admin/campaign/[campaignId].jsx:844-873](../mobile/app/(app)/admin/campaign/[campaignId].jsx), [admin/canvasser/[id]/answers.jsx:118-146](../mobile/app/(app)/admin/canvasser/[id]/answers.jsx), [admin/canvasser/[id]/index.jsx:496](../mobile/app/(app)/admin/canvasser/[id]/index.jsx) | (b) title-only group / "No data" chart / displaces a real question from the two-card preview — all fed by `/survey-results`, so the server-side filter fixes them. |
| [admin/map.jsx:928](../mobile/app/(app)/admin/map.jsx) | (a). |

The shape of the fix follows from the table: **exclude answer-less blocks at the three owners**
(`/survey-results`, `templateAnswerPlan`, `normalizeAndFilterAnswers`) and teach the five surfaces
that render a template (builder, preview, door runner, print model, desk composer / response
editor) what a statement is. Everything else is already keyed by option id and never meets one.

## C. Proof that the current grammar carries the client's routing

> These three proofs model the client's script **as the client wrote it**, including the Refused
> answer and Close 1 as an explicit block. The agreed shape after the rulings is in §F ("final
> shape"); this section is the evidence that the grammar could carry even the larger graph.

Three throwaway scripts, kept in the session scratchpad and run from `server/` against the real
`visibility.js` (never copied), established the facts Part 1 rests on. Re-run by hand on 2026-10-02;
all green.

**1. The client graph as blocks in today's grammar.** Statements and closings modeled as blocks with
no options, in the order Q1, Q2, Q3, Q4, S1, C1, C2, C3, C4 (every GO TO points forward, so this is
a topological order and satisfies the earlier-only rule):

```
Q2  all( Q1 is no )
Q3  all( Q1 is already_voted )
Q4  all( Q1 is yes )
S1  all( Q1 is undecided )
C1  any( Q1 is refused, Q3 is no, Q4 is not_voting )
C2  all( Q4 any_of [election_day, early, unsure, refused] )
C3  all( Q3 is yes )
C4  any( Q4 any_of [election_day, early, unsure, refused], Q3 is yes )
```

Every Q1 path produces exactly the client's intended set of visible blocks; a stale Q3=Yes left in
state after Q1 is changed to Refused leaves C3 and C4 hidden (property A.2). 29 of 29 checks pass.
Also shown: `C1x := Q2 not_answered` fires on the Q1=Yes branch where Q2 is hidden (A's first
consequence), and `none_of` exists only as N `is_not` rules under `all`, which fires on a blank.

**2. The best survey today's fields can hold.** A `POST /admin/surveys` body built from the four
real questions with every statement and closing copied into option scripts was pushed through the
real `upsertSchema`, `assignOptionIds`, `validateVisibleIfIntegrity`, `canonicalizeTags` and
`SurveyTemplate.validateSync`, then through a mirror of the runner's cell build and
`normalizeAndFilterAnswers` for sixteen door paths. Validation passes; routing is correct on every
path; the defects are exactly the ones Part 1 lists (closings inside question cards, No-path text
rendered above the reason box, no closing when Q3 is blank, six copies of Close 4).

**3. GO TO compiled to visibleIf.** For every target block T: `visibleIf = any( for each earlier
choice question Q with options whose goTo === T → { Q any_of [those ids] } )`, plus, for each
earlier answer-less source S (text question or statement) whose goTo (or fall-through) is T, a copy
of S's own compiled rules. Copying is sound because S's rules reference only earlier keys whose
`effective` entries never change after their position. The compiled Burton graph:

```
Q2: any( Q1 any_of [no] )
Q3: any( Q1 any_of [already_voted] )
Q4: any( Q1 any_of [yes] )
S1: any( Q1 any_of [undecided] )
C1: any( Q1 any_of [refused], Q1 any_of [no], Q3 any_of [no], Q4 any_of [not_voting], Q1 any_of [undecided] )
C2: any( Q4 any_of [election_day, early, unsure, refused] )
C3: any( Q3 any_of [yes] )
C4: any( Q4 any_of [election_day, early, unsure, refused], Q3 any_of [yes] )
```

(assuming Q2 → C1 and S1 → C1; the chain C2 → C4 and C3 → C4 compiles to C4's two-rule `any`). This
proof predates rule 5's merge-and-order rule in §F — its C1 lists three separate Q1 atoms where the
compiler now emits one — so the §F listing, not this one, is the normative shape.
Eight path checks pass including stale-answer isolation; a backward jump is rejected at compile and,
if it ever reached the evaluator, fails closed. Every emitted rule is a positive `any_of`, so it
satisfies the zod refine and the forward-only integrity check unchanged.

**4. A fallback closing.** Modeling Close 1 as `template.closing` and showing it **only when no
visible block is a closing** gives the right closing on every one of seventeen paths — including
"Q3 left blank" and the two exits the client never wrote — with no rule authored for it at all.

## D. Authoring cost today versus with arrows

Hand-authoring the client's eight conditional blocks in today's "Show only if" editor: 11 rules,
17 option-chip clicks, 7 question-dropdown re-targets (a new rule always starts pointed at the first
question, [SurveyBuilder.jsx:221-224](../client/src/components/SurveyBuilder.jsx)), 2 op changes to
"is any of", 2 ALL→ANY toggles, and the author must work out Close 4's two-rule union and Close 1's
three-rule union themselves. With "then go to" the author types exactly what the client wrote: ten
arrows on answers, two on statements.

## E. The design — data model

Three independent designs were drafted from different angles (fewest new concepts; GO TO as a
first-class flow; the phone first) and judged from three lenses (reporting correctness, field and
OTA safety, authoring usability). They agreed on the skeleton below and disagreed on five details;
§N records the choices and the alternatives rejected. Nothing here changes the evaluator.

### E1. New block type and new fields on `questionSchema`

[models/SurveyTemplate.js](../server/src/models/SurveyTemplate.js) and the zod twin in
[routes/admin/surveys.js](../server/src/routes/admin/surveys.js) change **in the same commit**
(Mongoose strict mode and `z.object()` both strip unknown keys silently).

| Field | Type | Meaning |
|---|---|---|
| `type` | enum gains `'statement'` | An answer-less block. `options` must be `[]`, `required` must be `false`, `otherOption`/`refusalOption` must be `false` — **enforced by a zod `.transform()`/refine on the server**, not only by the builder (§J explains why this is load-bearing). |
| `role` | `'statement' \| 'closing'`, **no Mongoose default** | Only meaningful on a statement, and every reader checks `type === 'statement'` first. It has no schema default on purpose: a subdocument default is stamped onto **every** question on hydrate (verified with a probe: a plain single-choice question came back `role: 'statement'`), so zod sets `role` only on statements (`'statement'` when absent) and strips it from questions. Drives the phone caption ("Read aloud" vs "Closing"), the builder badge, the print heading, and the default-closing rule (§H). |
| `label` | unchanged field; zod cap raised to `5000` **for statements only** (a `superRefine` keeps questions at 1000) | On a statement it is the **read-aloud body itself** — paragraphs, newlines preserved on the phone (`<Text>`), in the preview (`whitespace-pre-line`) and on paper (`splitTextToSize`). Chosen over a separate `body` field for one reason: a phone still on the old bundle prints `q.label` in its numbered card, so a straggler in the OTA window reads the **full closing**, not a bare "Close 2" (§J). |
| `title` | `String`, default `null`, zod `≤ 80` | Optional short name ("Close 2", "Statement 1"), the way the client's document names blocks. Used for the phone's block header, the builder badge, the "then go to" select, the print heading, the preview caption and every validation message that has to name a statement (a message must never quote a 5000-character body). When absent the UI derives one from the first words of the label. Keys are minted from the title when present, else the label (`deriveKey`, immutable once minted; today's keys are slugs of the first keystrokes, which is fine, keys are opaque). |
| `note` | `String`, default `null`, zod `≤ 2000` | **Canvasser-only** text, never read aloud, allowed on **any** block type (never on an individual answer). Rendered in a visibly different style on the phone, in the builder and in the preview; **never rendered** by exports, results, client reports, the desk composer, the response editor or paper (ruling 10). |
| `links` | `[{ label, url }]`, default `[]`, zod `≤ 5`, `url` must match `^https?://` | Allowed on any block type. Tappable rows on the phone that open the device browser; printed as plain URLs. No QR (ruling 4). `javascript:`/`ftp:` are rejected. |
| `goTo` | `String`, default `null` | On a statement or a **text** question (which has no options): where to continue. `null` = the following active block; a later block's `key`; or the sentinel `'__end__'`. **Forbidden on a choice question** (400): a choice question routes through its options and `otherGoTo` only, so a route can never be honoured that the builder does not show; the builder clears it when a text question is retyped to a choice. On the last active block `null` means End. |
| `otherGoTo` | `String`, default `null` | Route for the synthetic `'__other__'` pick when `otherOption` is on. `null` = the following active block. |
| `key` / `options[].id` | unchanged fields, new zod refine | A client-supplied key or id may not start with `__`: the generators never mint one (they strip underscores) but the API accepted any string, so `'__end__'` or `'__other__'` could have been stored by hand and made the sentinels ambiguous. |

On `optionSchema`:

| Field | Type | Meaning |
|---|---|---|
| `goTo` | `String`, default `null` | Per-answer "then go to": `null` = following active block; a later key; or `'__end__'` (end of the conversation: the default closing shows). Multiple-choice: every picked option's route is followed (union). Survives every option-mapping spread already in the tree (`assignOptionIds`, `reconcileQuestions`, `canonicalizeTags`). No `outcome`/Refused flag on options — rejected by ruling (§N). |

On the template:

| Field | Type | Meaning |
|---|---|---|
| *(template rule)* | — | A template must keep **at least one answerable question** (400 "Add at least one question that records an answer"): a survey of statements and closings only would file empty completed surveys. |
| `flow` | enum `['list','script']`, default `'list'` | **Stored** authoring mode, so the document itself says whether its `visibleIf` is hand-authored or compiled and recording semantics can never flip by a stray route. `list` = today's Questionnaire flow. `script` = Script flow: routes on answers and blocks, `visibleIf` **derived** at save by the compiler (§F). The builder sets it, never the author: the first "then go to" flips it to `script` with a banner, and the banner's lossless **Switch back** flips it to `list`. Entering `script` is refused once the survey has responses (409 `survey-has-responses`, the Duplicate hint); leaving it is always allowed because it keeps the exact same conditions (§F). `duplicate` copies it; a PATCH that carries `flow` without `questions` is a **400** ("Send the questions with a flow change": the version bump and the compile both key off the questions array, [surveys.js:398](../server/src/routes/admin/surveys.js)), and a questions-only PATCH compiles against `data.flow ?? existing.flow ?? 'list'`. Both `flow` and `presentation` are declared inside `upsertSchema` as `.optional().default(…)`, which is what lets `.partial()` leave them alone on a PATCH that omits them. Every existing template reads as `list` with no migration: as `undefined` on the lean readers and as `'list'` on the hydrated writers (§J), which every consumer treats alike. |
| `presentation` | enum `['scroll','steps']`, default `'scroll'` | How the phone shows the survey. `scroll` = today's single page with blocks appearing in place. `steps` = **one block per screen** (§H). The builder sets `steps` when a survey gains its first statement, closing block or route; an admin can flip it either way in Survey settings. `duplicate` copies it (a copy would otherwise come up as a single page). Every existing survey stays `scroll`. Pure presentation: both read the same visible list from the same evaluator, so the stored answers cannot differ. |
| `intro` | unchanged | The unconditional opening. |
| `closing` | unchanged field, **new semantic** | The **fallback closing**: rendered after the last visible block **only when no visible block is a closing-role statement**. A template with no closing blocks (every existing one) renders it exactly as today. |

The reserved key `'__end__'` can never collide with a real key: every key and option-id generator
strips leading/trailing underscores ([surveys.js:82](../server/src/routes/admin/surveys.js),
[SurveyBuilder.jsx:11-17](../client/src/components/SurveyBuilder.jsx)), the same argument that
protects `'__other__'` ([otherOption.js](../server/src/services/surveys/otherOption.js)).

`SurveyResponse` is **unchanged**. Statements never produce an `answers[]` row, and nothing records
which closing was reached — statements are script, not data, so every counting contract in
[SURVEYS.md](SURVEYS.md) §C/§J and [EXPORTS.md](EXPORTS.md) stays true by construction. No new
indexes, so no `migrate:build-indexes` gate.

### E2. The `{{canvasser}}` placeholder

One token, by ruling: `{{canvasser}}` becomes the signed-in canvasser's first name. Dates stay
typed by hand on every survey. A small pure module, canonical
`server/src/services/surveys/scriptText.js`, mirrored to `client/src/lib/surveyScriptText.js` and
`mobile/lib/surveyScriptText.js` under the same marker-and-drift-test pattern as the evaluator:

- `fillScript(text, { canvasserFirstName })` replaces every `{{canvasser}}`; a missing name renders
  `______`, the client's own blank-line convention.
- `unknownPlaceholders(text)` backs a zod refine: any other `{{x}}` is a 400 at save, so a misspelt
  token can never reach a phone as literal braces.
- Applies to `intro`, `closing`, a statement's read-aloud `label`, option `script` and `note`.
  **Never to a question's `label` or an option's `text`**, and zod rejects `{{` in both: the question
  label is snapshotted onto every stored answer row as `questionLabel`
  ([normalizeAnswers.js:81](../server/src/services/surveys/normalizeAnswers.js)) and the picked
  option's text is snapshotted as `answer`; both become results labels and CSV cells, and none of
  those paths render script text. The refine runs on every save, so a pre-existing template that
  happens to contain `{{something}}` shows the error inline until the author removes it (the demo
  template's `{{canvasser}}` is a known token and passes).

The phone already has the value: `bootstrap.user` carries `firstName`
([bootstrap.js:403](../server/src/routes/mobile/bootstrap.js) and [User.js:94](../server/src/models/User.js)); the web preview uses the viewing
admin's name; paper prints the blank line (a packet is not personal to one canvasser). The demo
tenant's literal `{{canvasser}}` ([seedDemoOrg.js:938](../server/src/services/platform/seedDemoOrg.js))
becomes the first real use with no seed change — that is the fix the owner asked for.

## F. The compiler — "go to" into `visibleIf`

Two ways to run a GO TO script were weighed. **A runtime path walk** (a new reached-set function
following `goTo` from the first block) would edit the mirrored evaluator body in three places, need a
decision about unanswered questions that flips every existing linear template, and — decisively — an
already-shipped phone has no path walker: it would show every block while the server dropped the
rows it hid. **Compiling routes into `visibleIf` at save time** leaves the evaluator at zero bytes
changed, leaves `normalizeAndFilterAnswers`/`dropHidden`/reports untouched, and an old phone routes
**correctly** because the compiled rules use only ops it already evaluates. Compile wins.

New canonical module `server/src/services/surveys/routing.js`,
mirrored to `client/src/lib/surveyRouting.js` (two copies — the phone never compiles, it evaluates
stored `visibleIf`), drift-guarded like the evaluator, with fixtures in
`__fixtures__/routing.fixtures.json` (the full Burton graph among them).

`compileRouting(questions) → { questions, errors }`, pure, deterministic, idempotent:

1. Walk **active** (non-retired) blocks in array order. The first active block is always reached.
2. A **choice question** comes in two kinds. A **branching** question is one where at least one
   active option (or `otherGoTo`) carries an arrow: each **picked** option routes to
   `option.goTo ?? the following active block`, `'__end__'` routes nowhere, and an **unanswered**
   branching question routes nowhere (answer to proceed, because the destination is unknown until
   it is answered). A **plain** question is one with no arrows at all: it behaves like today's
   linear surveys — the following block is reached whenever the question was **reached**, answered
   or not, which compiles as a copy of the question's own reach rules (exactly the text-question
   rule in 4). This is why a required-or-not plain question in the middle of a script never ends
   the path when skipped, and why "Switch back" of a linear survey produces no bogus "Show only if
   Q is any of [every answer]" conditions. When `otherOption` is on, the synthetic `'__other__'`
   pick routes via `otherGoTo ?? following` and is emitted inside the target's `any_of` atom like
   any id (the integrity validator already admits it). **Retired options are skipped entirely**:
   `reconcileQuestions` re-appends a dropped option as `retired: true` with its `goTo` intact, and a
   retired route must neither fire nor count as an inbound edge (fixture "retired option routes
   ignored"); "Switch back" clears routes on retired options too, so a later Restore cannot revive
   one. A question-level `goTo` on a choice question is a 400 (§E1).
3. **Multiple choice** is a union: a block shows if **any** picked answer leads to it; `'__end__'`
   on one pick never suppresses another pick's route.
4. **Text questions and statements** have no options: they fall through to `goTo ?? following`
   **regardless of being answered**, by **copying their own reach rules** into the target. Copying
   is sound because those rules reference only earlier keys whose `effective` entries never change
   after their position (§A property 2).
5. A block's reach = OR of its inbound routes, emitted as `{ logic: 'any', rules: [ one
   { questionKey, op: 'any_of', optionIds } per source question, atoms ordered by the source
   question's position in the list, ids in option order ] }` — a stated order, so an unchanged
   template compiles to byte-identical rules on every save and the builder's live mirror matches
   the stored document. A copied atom takes the question it references as its source, and when a
   direct route and a copied route reference the same question they **merge into one atom**, ids in
   that question's option order (fixture: Q1 "yes" → Q3 directly while Q1 "no" falls through a text
   question into Q3 compiles to `any( q1 any_of [yes, no] )`). Reached unconditionally ⇒ `visibleIf: null`. **Only positive `any_of`
   atoms are ever emitted** (§A property 3 is why: `is_not`/`not_answered` fire on hidden parents).
6. A target must be a **later** active block (the mirror image of today's earlier-only rule, so the
   integrity validator and the evaluator's fail-closed check hold by construction and cycles are
   impossible). Earlier/self/unknown/retired targets are errors. The last active block has no
   following block, so its fall-through is End. Every compile or validation message names a
   statement by its `title` (or the first sixty characters of its text), never the full body.
7. A block **nobody routes to** is a save error — never silently hidden and never compiled to empty
   rules (which the evaluator reads as always-visible).
8. Retired blocks pass through untouched in place.

Where it runs: POST after `assignOptionIds` and PATCH after `reconcileQuestions`, before
`validateVisibleIfIntegrity` ([surveys.js:338, 392](../server/src/routes/admin/surveys.js)), in the
order `validateRouting(incoming)` → `compileRouting` → `validateVisibleIfIntegrity(compiled)`.
Every cross-field rule (a route on a List template, `flow` without `questions`, a question-level
route on a choice question, the one-answerable-question minimum, the list → script refusal) lives in
the route handler, not in a top-level zod `superRefine` — a `ZodEffects` has no `.partial()` and
would break the PATCH parser at module load. `reconcileQuestions` gains one rule: it never
re-appends dropped options onto an incoming **statement** (the zod transform empties a statement's
options, and re-appending them as retired would leave a statement carrying tagged, retired answers).
It runs
when the effective flow is `script` (`data.flow ?? existing.flow` on PATCH, so a questions-only
PATCH on a script template still compiles instead of storing ungated blocks); the integrity validator
then re-checks the compiled output, so a compiler bug fails loudly as a 400 instead of reaching a
phone. In Script flow the server **ignores and overwrites** any incoming `visibleIf` on active blocks
— the compiled output is authoritative, and a GET → PATCH round-trip (the stored document carries
compiled rules) keeps working for the builder and for API clients alike. In List flow any non-null
route is a 400 ("Go to is only available in Script flow"). In **both** flows
`validateVisibleIfIntegrity` gains "a rule may not reference a statement — condition on the answers
that led there instead" (a statement has no cell, so `answered` on it is constant-false and
`is_not`/`not_answered` constant-true — proven degenerate).

Why one mode per template: nesting `(A ∧ B) ∨ (C ∧ D)` is inexpressible in the flat grammar (§A), so
a hand `all`-rule block cannot be flattened into a compiled `any` target. The two directions are not
symmetric, and the rule follows from that (ruling 16). **Leaving Script flow is always allowed**: the
builder's "Switch back to Show only if" keeps the compiled rules as editable hand rules, clears every
route and stores `flow: 'list'`, so the phone evaluates the exact same conditions and recording cannot
change. **Entering Script flow is allowed only while the survey has no responses**: the author
re-expresses the branching as arrows and the compiled result may differ from the old hand rules,
which would make later visits record differently from earlier ones. With responses the server
answers 409 `survey-has-responses` — a separate check in the PATCH route beside the type-change one
(`classifyQuestionEdits` only sees two question arrays and its message is hard-coded to the type
change), with its own sentence: "This survey has responses, so it can't switch to Go to routing.
Duplicate it to build the scripted version." — and the builder says the same before the first arrow
is placed. Hand-authored conditions are **never silently deleted** on the way in, and the server
enforces it, not only the builder: on the `list → script` transition specifically (the stored flow is
`list` or absent and the incoming flow is `script`), any active block that still carries a
`visibleIf` is a 400 ("Remove the Show-only-if conditions before switching to Go to"), because those
rules are hand-authored and overwriting them would discard logic the compiler cannot express. The
ignore-and-overwrite rule applies only to a template that is already in Script flow, where the
stored rules are compiled output. In the builder the same thing shows as inline errors ("re-express
this as a route, or remove it") the moment the first arrow is set, and the save is refused until
none remain.

The compiled Burton template, final shape (rulings 1-17; Close 1 is the default closing and so is
not a block; Question 4 sits after the post-pitch question because two answers lead to it):

```
q2            any( q1 any_of [no] )
s_q2_opponent any( q1 any_of [no] )                                 ← copy of q2 (fall-through); goTo __end__
q3            any( q1 any_of [already_voted] )                      ← yes → close_3; no, declined_to_say → __end__
s1_pitch      any( q1 any_of [undecided] )                          ← fall-through into s1_question
s1_question   any( q1 any_of [undecided] )                          ← copy of s1_pitch; yes → q4; still_undecided → close_4; no → __end__
q4            any( q1 any_of [yes], s1_question any_of [yes] )      ← two sources; not_voting → __end__; the rest → close_2
close_2       any( q4 any_of [election_day, voting_early, by_mail, unsure, declined_to_answer] )          goTo close_4
close_3       any( q3 any_of [yes] )                                goTo close_4
close_4       any( q3 any_of [yes], s1_question any_of [still_undecided], q4 any_of [election_day, voting_early, by_mail, unsure, declined_to_answer] )   goTo __end__   ← atoms in source-question order
default       Close 1 — the last screen on every path that reaches none of close_2 / close_3 / close_4
```

This graph was run against the real evaluator (`burton_final_proof.mjs`, kept with the other proof
scripts; its `close_4` lists the same atoms in a different order, which `any` makes equivalent — the
§L fixture carries rule 5's order so it doubles as the compiler's expected output): **20 of 20 checks
pass** — every answer path, the two ways into Question 4, the
default-closing rule (shown on the No, Already-voted-No/Declined, post-pitch-No and Not-voting
paths; withheld while a required question is still blank), and three stale-answer cases (an
earlier answer changed after later answers were given never leaks a hidden block or a stale
closing).

Every closing carries an explicit exit — Close 4 `'__end__'`, Close 2 and Close 3 `close_4` —
because a closing left on "continue" would fall through into the next closing (the fall-through
trap: a supporter would read Close 2, then Close 3, then Close 4). Question 2 and the pitch are left
on "continue" so each flows into the block that follows it. The earlier, larger graph (with a Refused
answer and Close 1 as an explicit block) was the compiler's own proof: 28 of 28 checks
pass on the real evaluator: all fourteen answer paths, three stale-answer isolation cases, backward
jump rejected, unreachable block rejected, multiple-choice union, Other routing, text-first-block
unconditional, deterministic and idempotent, retired pass-through.

## G. The builder (web)

[SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx), shared by the org library editor
and the in-campaign builder (which **team leads** reach — every new 400 must read as plain English
in the existing error block, [SurveyEditorPage.jsx:128-139](../client/src/pages/SurveyEditorPage.jsx)).

- **No mode control to find.** The first "then go to" an author sets stores `flow: 'script'`; a
  banner above the block list says so ("This survey uses Go to. Each block shows based on which
  answers lead to it; Show-only-if conditions are built for you") and carries one action, **Switch
  back to Show only if**, which is lossless (§F). Removing routes one at a time instead leaves the
  answer fall through to the following block (a branching question's follower is gated on the
  answers that fall through; a block left with no route into it at all is the "nothing routes here"
  error, never *always*); only "Switch back" removes routes wholesale. The per-answer **then go to**
  select is present in **both** styles — it is how the first arrow gets set — and on a survey with
  responses it is disabled in Questionnaire style with the Duplicate hint (the server enforces the
  same 409). "Switch back" stays available at any time. While in Script flow the builder keeps each
  block's `visibleIf` in state as the **compiled** result of the client mirror, recomputed on every
  change (so an option removal or a move can never leave a stale rule in state), skips `ruleError`
  for compiled rules, and sends them along; the server recompiles and overwrites them anyway.
- **One block per screen** is a checkbox in Survey settings bound to `presentation`, with the helper
  "Canvassers see one block at a time, like a script. Turned on automatically when a survey has
  statements, closings or arrows." The builder sets it when the first statement, closing or route is
  added and never clears it on its own.
- **Block palette**: beside "+ Add question", **+ Add statement** and **+ Add closing**.
  `QUESTION_TYPES` stays the three answerable pills — a statement is created as one and never
  retyped (the type-change 409 makes question ↔ statement a Duplicate job once responses exist).
- **Statement card**: badge *Statement* / *Closing* (no Q number); **Read aloud** textarea
  (`label`, the one box an author must fill); an optional **Title** input (`title`, "Close 2") that
  the header, the select and paper use, derived from the first words when left blank; "+ note to
  canvasser (not read aloud)" (`note`); "+ link" rows (label + https URL, up to 5, validated live);
  in Script flow a **Then go to** select (*Continue to the next block* | *End the conversation* |
  every **later** active block by title). No Required, no Other, no options. New closings created
  at the end of the list default to *End*.
- **Question card**: every option row gets a **then go to →** select with the same choices; the
  Other (specify) toggle, which today is a checkbox beside Required rather than a row, gains a
  synthesised row for its own route; text questions get the select at question level, and retyping
  a text question to a choice clears that question-level route. Every block also gets the collapsed
  "+ note" and "+ link" toggles, matching the existing idiom
  ([OptionRow 159-167](../client/src/components/SurveyBuilder.jsx)). Plumbing the plan implies:
  `SurveyForm`'s reset effect also resets `flow` and `presentation`, and `onSave` sends both.
- **Conditions**: in Questionnaire flow the `ConditionEditor` is unchanged except statements are
  excluded from `priorQuestions` and from `ruleError`'s `earlier` map; in Script flow the section is
  replaced by a read-only **Reached when: Q1 = Undecided, or Q4 = Election Day / Voting early /
  Unsure / Declined to answer** line rendered from the client mirror of the compiler — what the author reads is
  byte-identical to what the server stores. Every block with an implicit exit shows a grey
  **Continues to: ‹resolved target›** line (`resolveDefaultTarget`), the UX answer to the proven
  fall-through trap (a statement with no exit flows into whatever follows it). One plain-English
  condition formatter serves all of this: `formatVisibleIf` is lifted out of
  [surveyPrintModel.js:48-54](../client/src/lib/packet/surveyPrintModel.js) into a shared lib and used
  for the builder's "Reached when", the preview captions and the printed "Only if" lines, so three
  surfaces can never word a gate differently. The lift takes two parameters the print version
  hard-codes: the text transform (`asciiSafe` on paper only — it drops every non-cp1252 character,
  so a verbatim lift would blank non-Latin option labels on screen) and the leading "Only if"
  prefix.
- **Live errors and warnings** (`routeError` beside `ruleError`, merged into the per-card `error`
  object): target not later ("move this block down or pick another target"); nothing routes here
  ("route an answer to it, or move it where the flow reaches it"); statement with no read-aloud
  text; link not http(s); unknown placeholder; fewer than one answerable question; and a **warning**
  on every non-required **branching** choice question (one whose answers carry arrows) — "If the
  canvasser skips this question the conversation ends there. Mark it Required or add a *Declined to
  say* answer" (a plain question with no arrows never needs it, §F rule 2). Server 400s surface
  through the existing block as the backstop.
- **Retire/remove** of a route target re-points every route into it to *Continue* and says so in a
  one-line notice — never a silent dangling jump. Move up/down re-runs `routeError` (a move can turn
  a forward route backward).
- **Numbering and counts**: `displayNum` counts answerable blocks only (so Q numbers match the
  phone whenever every question on a path is visible; conditional paths diverge as they do today,
  §H2); the header reads "N questions · M statements"; the quick view, library row and campaign
  Survey tab count answerable blocks ([SurveyQuickView.jsx:71](../client/src/components/SurveyQuickView.jsx),
  [SurveysPage.jsx:222](../client/src/pages/SurveysPage.jsx), [CampaignSurveyPage.jsx:219](../client/src/pages/CampaignSurveyPage.jsx)).
- **Closing section** helper copy becomes the fallback wording: "Shown after the last block when
  none of your closing blocks applies. Type the goodbye you would say when nothing else fits."
- **`SurveyPreview`** ([SurveyPreview.jsx](../client/src/components/SurveyPreview.jsx)) renders a
  statement as the italic read-aloud paragraph already used for intro/closing, titled, with the
  note in an info-tinted box and links as anchors, a "Reached when …" caption in Script flow, and a
  **Try it** toggle (the client mirror of the evaluator applied to clicked answers) so the client can
  walk every path of their script on the web — the only way to review branching without a phone. When
  the survey is one-block-per-screen, Try it steps through one block at a time with Back and Next,
  running the **same `surveyRunner` code** the phone runs (§H1's mirror), so the web rehearsal and
  the door walk cannot drift.
  Question numbering skips statements; the trailing closing is captioned "Closing — when no closing
  block applies" when any closing block exists.

## H. The door runner (mobile)

[mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) keeps its
route, its hooks-above-early-returns shape, the do-not-contact wall, the "Already surveyed this
round" and door-change confirms, the GPS gate and optimistic submit, and `router.dismiss(2)`
([survey.jsx:385](../mobile/app/(app)/voter/[id]/survey.jsx)). What changes is what sits between the
voter header and Save, and it comes in two presentations that share every piece of logic.

### H1. The shared core, `surveyRunner.js`

A new pure module, canonical at `mobile/lib/surveyRunner.js` and mirrored byte-for-byte below a
marker to `client/src/lib/surveyRunner.js` (the web "Try it" walks the same code), with a drift
guard in the client unit tests (`node --test src/`) exactly as the evaluator has. Unit-tested through
the root `npm run test:mobile`. It owns everything both presentations need: `isStatement`,
`isAnswerable` and `isClosingBlock` (the type decides; `role` is read only on a statement),
`activeBlocks` (the non-retired blocks), `buildCells(blocks, answers)` (today's cell build; a
statement always gets an empty cell), `visibleBlocks(survey, answers)` (the evaluator's visible set
in list order), `answerableQuestions` (visible minus statements), `questionNumbers` (1-based over
answerable, so numbers skip statements), `progress`, `buildSubmitRows` (answerable only — a
statement never posts a row), `closingReached` (a visible closing-role statement exists),
`isAnswered(q, answers, otherTexts)` (today's rule from `isAnsweredNow`: an Other pick counts only
once its text is non-blank; whitespace-only text is blank), `requiredPending` (the first visible
required question still unanswered, or null), `pathComplete` (= `!requiredPending`), `isScripted`
and `needsClosingGuard` (§H3), `showDefaultClosing(survey, blocks, answers, otherTexts)` (the
default closing has text, no closing block is visible, and on a guarded survey the path is
complete), and the stepper itself. A screen id is a block's key or one of two reserved ids,
`INTRO_SCREEN_ID` (`'__intro__'`) and `END_SCREEN_ID` (`'__end__'`), reserved because a block's key
is a slug of its text, so a question labelled "End" is keyed `end`. The stepper is
`screens(survey, answers)` (the ordered screen list; the opening only when the intro has text),
`screenKind(screen)` (`intro`, `question`, `statement`, `closing` or `end`),
`clampScreenId(survey, answers, id)`, `canAdvance(survey, answers, otherTexts, id)`,
`canSkip(survey, answers, id)`, `nextScreenId(survey, answers, id)`,
`prevScreenId(survey, answers, id)` (null on the first screen, where Back leaves the survey),
`skipAnswer(answers, otherTexts, key)` (Skip's state change, paired with `nextScreenId` over the
answers it returns) and `saveScreenId(survey, answers)` — the screen that carries Note
and Save is decided **by position**: the last visible block when that block is a closing-role
statement, otherwise the end screen; a closing that is not the last visible block shows Next
regardless of its own exit (a multiple-choice question can route one picked answer to End and another
onward, leaving a terminal closing visible above a later block). Handlers that change an answer and
move the cursor in one call — Skip clears and advances — compute the next screen from the **new**
answers, never from the render-closure's memoized list, or a Skip that hid the following blocks would
advance into one of them; the same rule keeps the web Try it honest. The
branching itself is untouched: both presentations call the same `visibleQuestionKeys` over the same
stored `visibleIf`, so the phone and the server can never disagree about which blocks a canvasser
was shown, and there is no second routing engine anywhere.

### H2. One block per screen (`presentation: 'steps'`)

A **cursor over the visible list**, held in component state, not a route per block (so the stack
depth `dismiss(2)` relies on is unchanged):

- **Screens, in list order of the visible blocks**: the opening (`intro`, only when it is
  non-empty — a survey with no greeting starts on its first block), then each visible block, then
  the end screen when the last visible block is not itself a terminal closing. The cursor can only
  sit on a visible block; when visibility changes under it (in practice only when a bootstrap
  refetch swaps `survey.questions` mid-walk), it clamps to the last visible block at or before its
  position.
- **Question screen**: the question in 18px type and its answers as the existing option pills.
  **Tapping an answer selects it**, and exactly as today that reveals the answer's read-aloud script
  and, for Other (specify), the "Please specify" box under the pill. **Next advances** — always
  present, disabled on a required question until it has an answer, enabled otherwise; multiple
  choice and text screens use the same Next. **Skip**, on optional questions only, clears the answer
  and advances (so Skip and Next differ when a value is present: Next keeps it, Skip discards it).
  There is **no automatic advance** on a single-choice tap: a tap that also left the screen would
  hide the read-aloud line under *Already voted* that the Burton survey relies on, make Other
  untypable, leave a screen reached by Back with no forward control, and let the second touch of a
  double-tap land on the next screen's pill. One extra tap per question is the price. A canvasser
  note and link rows render beneath the answers when present.
- **Statement screen**: the read-aloud text in the house amber `scriptBlock`
  ([survey.jsx:658-671](../mobile/app/(app)/voter/[id]/survey.jsx)), captioned "Read aloud · ‹title›",
  in a new 18/26 `scriptBody` style (read at arm's length); beneath it, when set, the **note block**
  (`infoBg` background, `info` left rule, label "For you — not read aloud", text in a new `infoFg`
  token — `info` and `infoBg` are already used in five mobile files but have no readable foreground
  pair: light `info` on `infoBg` measures 3.0:1 while the dark pair already measures 6.1:1; the new
  token is `#1E40AF` light and `#93C5FD` dark, 7.2:1 and 8.6:1) and **link rows** (label in
  `colors.brand`, `Linking.openURL(url).catch(() => {})`, never `canOpenURL` per
  [mapsLinks.js:11-17](../mobile/lib/mapsLinks.js), http(s) only, opening the device browser so the
  canvasser can show the page to the voter; no QR, ruling 4). **Next**.
- **Closing screen**: a closing-role statement, captioned "Closing · ‹title›", same styling. When
  it is the **last visible block** it **is** the last screen: the **Note** field and **Save Response**
  sit beneath the text, so a canvasser reads the goodbye and saves on one screen (Close 4 for every
  Burton path that reaches it). When a later block is still visible — Close 2 before Close 4, or a
  closing left visible by a multiple-choice union — it has Next like a statement.
- **End screen**: reached only when the last visible block is not a closing. It shows the **default
  closing** (`template.closing`) when no explicit closing was reached, or just a "Done" caption, then
  Note and Save. Because Next never passes a blank required question, the end is only reachable with
  `pathComplete` true; a disabled Save reading "Answer Question N to finish" (tap jumps the cursor
  there) is **added** as a backstop for a template refresh under the walk, and today's `validate()`
  alert on Save stays behind it for the race where Save enables before a refresh re-renders.
- **Back**: the header's existing "‹ Back" control
  ([survey.jsx:411](../mobile/app/(app)/voter/[id]/survey.jsx)) becomes the stepper Back whenever the
  cursor is past the first screen and keeps its exit meaning (`router.back()`, as today) on the first
  screen; Android's hardware back does the same through react-native's `BackHandler`, the first use
  in the app: registered in an expo-router `useFocusEffect` so it is live only while this screen is
  focused, returning `true` only when `prevCursor` has a previous screen (so `false` lets the stack
  pop on the first screen), and removed by the effect's cleanup through the subscription it returns;
  iOS swipe-back pops the route and discards the form, as it does today. Changing an earlier answer recomputes visibility; blocks that are no longer visible
  are left behind and their answers are dropped at save (today's `dropHidden` rule, nothing new).
- **Progress**: a thin bar, answered ÷ answerable visible, and a "Question N" caption on question
  screens; no "of M", because the length of a path is not known until it is walked. N counts visible
  answerable questions, as the phone numbers today; the builder and paper number over all active
  blocks, a divergence that already exists for conditional questions.
- **Keyboard**: Next and Save render inside the existing `KeyboardAvoidingView` (today it wraps the
  ScrollView and Save lives inside the content; a footer outside it would be covered).

### H3. The single page (`presentation: 'scroll'`)

Today's screen with the blocks woven in: a statement renders as the amber `scriptBlock` with its
note and links; questions keep their numbered badges over `questionNumbers`; `validate()`, progress
and the submit rows use `answerableQuestions`; the default closing hides whenever an explicit
closing is visible, and **on scripted surveys only** it also waits for `pathComplete`, so a canvasser
never reads a goodbye under a required question they are still asking — a plain existing survey
renders exactly as today. This guard keys on Script flow or any closing block — narrower than the
presentation trigger (statement, closing or arrow) on purpose, because a statement with no closing
block never changes where the goodbye renders; both predicates are named helpers in `surveyRunner.js`
(`isScripted`, `needsClosingGuard`) so no surface re-derives them. When a choice tap reveals blocks
below the fold the page scrolls to the first new block: a ScrollView ref, a per-block `onLayout`
y-map, a diff of visible keys between renders, and a skip when a `TextInput` is focused
(`TextInput.State.currentlyFocusedInput()`), none of which the screen has today.

### H4. What this does and does not change

Refused is untouched (ruling 2): a refused canvasser taps Back and the door screen's Refused button.
The survey POST body keeps its shape but is built from `buildSubmitRows` (answerable only; today's
`visibleQuestions.map` would post a `{ answer: null, optionIds: [] }` row per statement), and
`validate()`'s alert becomes a backstop behind the disabled Save. Multi-voter households, the
re-survey and door-change confirms, offline queueing and the optimistic recolor all sit outside the
two presentations. `{{canvasser}}` is filled through the mirrored `fillScript` with
`bootstrap.user.firstName` on both presentations.

## I. Consumers — the three owners and five surfaces

Exclude answer-less blocks at the **three owners** (one line each, each with a test) and teach the
five rendering surfaces:

| Owner | Change | What it fixes without further code |
|---|---|---|
| [reports.js:1321](../server/src/routes/admin/reports.js) `/survey-results` loop | `continue` on statements before the per-question pipeline | the web Dashboard card grid, the mobile campaign screen, canvasser answers, the canvasser index preview, the tag rollup at 1465; and one wasted aggregation per statement per poll |
| [surveyColumns.js:38](../server/src/services/export/surveyColumns.js) `templateAnswerPlan` | filter statements out of `cols` and out of the duplicate-label count **only**; keep `known` over **all** template keys | survey-results wide, results-by-voter, activity-with-surveys exports ("one column per question" stays true). Filtering `known` too would re-admit a stray stored statement key (an admin edit saved while the template was missing stores answers as-is, [voters.js:548-552](../server/src/routes/admin/voters.js)) as an **orphan column** labelled by its snapshot. |
| [normalizeAnswers.js:59-60](../server/src/services/surveys/normalizeAnswers.js) | `continue` on statements for every writer and both `dropHidden` modes — **new code**, nothing drops such a row today (a reached statement is a known, visible key, so the current loop keeps its empty row) | all four callers at once (the mobile submit, the admin edit, the conversion worker, and `demoActivity.js:194`): the long export, response detail views, the voter profile, `answerScope` counts, the conversion manifest, and **every ghost row an old bundle or an offline replay could post** |

Also: [voterProfile.js:316-328](../server/src/services/voters/voterProfile.js) filters statements
out of the per-response question snapshot (so `VoterDetailPage`'s `SurveyCard`, which carries its
own seed/build copy, never meets one); the three conversion payloads
([campaigns.js:1699, 1845, 2211](../server/src/routes/admin/campaigns.js)) ship answerable questions
only (desk entry records answers after the fact and shows no script);
[computeReport.js:232](../server/src/services/reports/computeReport.js) gains a defensive type guard;
[surveys.js duplicate](../server/src/routes/admin/surveys.js) copies `questions` verbatim today (so
routes, titles, notes and links travel with a copy) and **must also copy `flow`, `presentation` and
`tags`** — its hand-kept field list already drops `tags` (a pre-existing gap closed in the same
edit); an uncopied `flow` leaves a copy's routes ungated, and `SurveyTemplate.create` would default
an uncopied `presentation` back to the single page. Defensive filters in `surveyAnswerForm.js`, `SurveyAnswerFields.jsx`,
`SurveyAnswerComposer.jsx` (the "N of M answered" denominator), `QueueWalkthrough.jsx` and
`DoorOutcomesPage.jsx` keep the pure libs honest for any future caller.

**Print** ([buildPacket.js](../server/src/services/packet/buildPacket.js),
[surveyPrintModel.js](../client/src/lib/packet/surveyPrintModel.js),
[packetPdf.js](../client/src/lib/packet/packetPdf.js)): `toPrintableSurvey` is a field-level picker
(options are projected as `{ id, text, script }` today), so it must be extended to carry `flow`,
`role`/`title`/`links`/`goTo` on blocks and `goTo` on options — and **not `note`**, which never
prints (ruling 10); statements stay in the payload (the print model needs their position). The print model splits
the set: `questions` = answerable blocks (numbering and skip-hint targets over answerable only, so
paper Q numbers match the phone) and a new `script` sequence in authoring order — Opening, each
statement/closing with its gate in plain English (`formatVisibleIf`), option scripts, then the
fallback closing captioned "when no closing block applies". `drawScriptPage` iterates that sequence, and the page gate that today tests
`intro || closing || scripts.length` also tests the new sequence, or a statements-only script would
never print; statements print **once** on the "What to say" page, never beside every door (the
atomic-door page math in [WALK_PACKETS.md](WALK_PACKETS.md) is untouched); **notes never print**
(ruling 10); links print as URLs (the printed URL is the paper hand-off). The print model keeps its
`scripts` array (option scripts, so the existing `scripts.length` assertion holds) and adds the
ordered `script` sequence beside it. In Script flow the negate-based skip hints are
replaced by per-option arrows derived from `goTo`. `asciiSafe` flattens smart punctuation on paper as
it does today.

## J. Rollout, compatibility, and the client-version gate

**No data migration, and no reliance on schema defaults.** The compiler never runs for `list`;
`intro`/`closing` keep their meaning and the fallback rule is a computed predicate that is always
true for a template without closing blocks; `seedDemoOrg` is untouched; no indexes. One trap: most
template readers are **`.lean()`** reads (the surveys list, the bootstrap, duplicate, the conversion
service, the client-report builder, the exports, the print pipeline, the voter profile), and lean
reads do **not** apply Mongoose defaults, so a pre-existing template arrives there with `flow`,
`title`, `note`, `links`, `goTo`, `otherGoTo`, `role` and `presentation` simply **absent** — while
the two writers the design leans on most, the mobile survey POST and the admin response edit, load
**hydrated** documents and see the defaults applied. Every consumer therefore treats absence and
default alike (`flow ?? 'list'`, `links ?? []`, `type !== 'statement'`), which is also why `role`
carries no default (§E1). A stored document gains the default keys on its first PATCH, which
replaces the questions array.

**Deploy order is the whole compatibility story:**

1. Merge to `main`. Heroku deploys from `main`, and the web console (builder, preview, Try it)
   ships **with** the server in that one deploy — there is no separate web step. Until the server is
   live no statement can exist, so the feature is opt-in per template.
2. The mobile change is **JavaScript only, with no new dependency** (the QR package that an earlier
   draft needed is gone with ruling 4), so it ships over the air: `npm run ota:staging` from the
   feature branch, verify on TestFlight/Play internal, then `npm run ota:production` from `main`.
   `npm run ota:check` still gates each publish as it always does. No native build is cut, so the
   build-currency vars (`MOBILE_CURRENT_RUNTIME_*`) do not move.
3. **Only then** set up the Burton survey and attach it to its new campaign. The race has not
   started (ruling 9), so every phone is on the new bundle before the first shift and the straggler
   behaviour below is a safety analysis, not an expected state.

**What an already-shipped phone does with a statement-bearing template** (traced in the shipped
runner, not inferred): the unknown type renders a numbered card showing `q.label` — which is the
**full read-aloud text**, the reason the body lives in `label` (§E1) — with no control (no branch
matches at 498-521; `q.options.filter` lives only inside the choice components, which are never
mounted for it — no crash path); it is counted as unanswered, so "Question N of M"
is inflated and the percent caps below 100; it posts `{ answer: null, optionIds: [], otherText: null }`
which the new `normalizeAndFilterAnswers` drops; the default closing shows under every path, so on
a straggler a supporter would read Close 2, Close 4 **and** Close 1 (moot for Burton by ruling 9,
since no phone is on the old bundle at the first shift; worth remembering for any later campaign
that adopts statements mid-season); placeholders render as literal braces; notes and links are
invisible. **Routing is correct**,
because the compiled rules use only ops the shipped mirror already evaluates. The **only** hard-fail
path would be a `required` statement (`validate()` would block Save forever), and the server
transform makes that impossible to store. Degraded, data-clean, confined to templates that opt in.

**Gate verdict: no bump.** CLAUDE.md's rule is for changes an old app *can't handle*; this is
additive on the wire (new optional fields, a looser enum, a row filter; the survey POST keeps its
request and response shape). The gate would also be
a weak remedy: `MIN_CLIENT_API_VERSION` is cached only at **login**
([login.jsx:56](../mobile/app/login.jsx), [index.jsx:68-70](../mobile/app/index.jsx)), so a bump walls
a signed-in old build only at its next sign-in, not next launch, while walling every old build in
every org for a per-template opt-in. Re-evaluate only if the owner decides statements must be
`required` (an explicit "read it, tap Continue" acknowledgment).

Two operational facts bound the straggler window. The OTA bundle is applied only on a **restart**
([OtaUpdatePrompt.jsx](../mobile/components/OtaUpdatePrompt.jsx) offers it off the canvass screens
and refuses to reload with actions in flight), so budget at least one app restart per phone before
the first shift. And **never swap a campaign's template mid-shift**: the survey POST 400s a template
id that is not the door's effective one ([canvass.js:764-768](../server/src/routes/mobile/canvass.js));
online that is an alert and a redo, but an **offline-queued** survey is silently **dropped**
([offlineQueue.js:120-125](../mobile/lib/offlineQueue.js) drops non-auth 4xx replays). Between
shifts, once every phone has flushed its queue, a swap is as safe as the existing docs say
("swapping mid-canvass is allowed"); the hazard is a shift in progress or unsent surveys. The same
caution applies to **in-place edits that change a gate** (a re-pointed arrow, a hand condition, a
required flag, the list → script switch): a phone still on the cached template posts rows the
current template now hides, and `normalizeAndFilterAnswers` drops them silently with a 201 — today's
behaviour for hand conditions too. Change routes between shifts, not during one; wording edits are
safe any time. Attach the Burton template to its new campaign before its first shift and leave it.

Run `npm run audit:mobile-api` before deploy and read the flagged diffs by hand (the tool sees files,
not response shapes, and resolves route files only — it cannot flag
`services/surveys/normalizeAnswers.js`, the one change that alters what the mobile survey POST
stores, so review that diff deliberately). The mobile-facing files this touches are
`routes/admin/reports.js` (`/survey-results`, `/responses/:id`), `routes/admin/campaigns.js` and
`routes/admin/voters.js` (the response edit and restore routes); `routes/admin/surveys.js` has no
mobile caller. Add the mobile unit suite (`npm run test:mobile`) to the CI unit job in the same
change: nothing runs it automatically today, and the stepper's tests would otherwise go red unseen. Every change
is additive or removes phantom entries a payload never had. Templates are cached on the phone and
refresh only on a full bootstrap (pull-to-refresh, the Books tab after 30 seconds, a round or
campaign switch, a server-rejected action; `/changes` never carries templates), so a mid-shift
canvasser keeps the pre-edit template for a while — an **in-place edit of the same template** is
tolerated (unknown keys dropped; the id still matches the door's effective template,
[canvass.js:764-768](../server/src/routes/mobile/canvass.js)), a **swap to a different template** is
not (see above).

## K. Privacy

Statement bodies, notes and links are **customer-authored template content, not personal data**.
They reach exactly the readers template text reaches today — every rostered canvasser's phone (the
bootstrap ships whole lean templates), admins and leads in the builder and preview, and paper — and
never reach client reports, exports or the public share link: `computeSurveyBreakdowns` does emit
question labels and option texts to client reports, but statements are excluded from it by type, so
no statement text, note or link ever leaves the org (§I).

A link the canvasser taps is **not** a trigger under CLAUDE.md's five tests, on two conditions the
design satisfies: the URL is opened only on an explicit tap in the device browser (never fetched,
prefetched, link-previewed, embedded in a WebView or proxied by Doorline); and nothing voter- or
door-identifying is appended to the URL and no tap is logged against a voter. (An on-device QR would
have passed the same test; an external QR-image service would not have, since it would receive the
URL from every canvasser device — the ruling removed the question.) Under [DPA.md](DPA.md) §6's test ("engaged to provide the Service") Doorline engages nobody —
no contract, API key or SDK with the linked site. Same class as [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
items 15 (web Pin Fixes link) and 20 (Directions hand-off): no DPA §6 subprocessor event, no
customer notice, no `privacy.html`/ToS/DPA edit. Record the reasoning as **v6 item 26** — item 25 is
"Not a target voter" (PRIVACY_VERIFICATION.md, v6 2026-10-02). Reopen it if a later change appends
per-voter tokens, logs taps, or renders link previews server-side.

Two things the owner should weigh rather than the code: the client's note is opposition research and
is **lead-visible and lead-authorable** (the in-campaign builder is lead-reachable,
[App.jsx:170-174](../client/src/App.jsx), and a lead may be the client's own staff); and if Close 3's
"anyone else who would vote for Paul?" is ever to be **recorded**, that is new personal data
(referral names) and a Privacy Policy "what we collect" event — this design keeps it read-aloud only.

## L. Tests

- `visibility.fixtures.json` + `visibility.test.js`: two fixtures ("statement gated like a
  question", "closing block from two sources with stale hidden answers withheld"); the three-copy
  drift guard must still pass (the body is unchanged).
- `routing.test.js` (new) + `__fixtures__/routing.fixtures.json`: the final Burton graph (every
  closing's explicit exit; a probe for a supporter must reach Close 2 then Close 4, never Close 3);
  a block reached from two sources (Question 4); backward jump; unreachable block; multiple-choice
  union; Other routing; retired option routes ignored; text-first block unconditional; retired
  pass-through; fall-through trap; determinism and idempotence; two-copy drift guard with
  `client/src/lib/surveyRouting.js`.
- `scriptText.test.js` (new): `{{canvasser}}` filled, missing name → `______`, unknown token
  detected; three-copy drift guard.
- `surveyBlocks.int.test.js` (new, one `before()` per file): POST with a statement carrying
  `required: true`, stray options, `otherOption: true` comes back coerced; a question label over
  1000 → 400 while a statement label over 1000 is accepted; `javascript:` link → 400; a rule
  referencing a statement → 400; a route on a `list` template → 400; unreachable block → 400;
  backward route → 400; a GET → PATCH round-trip of a compiled template succeeds (incoming
  `visibleIf` overwritten, not rejected); a questions-only PATCH on a `script` template compiles;
  `list → script` on a survey with responses → 409 `survey-has-responses`; `script → list` on a
  survey with responses → 200 with identical `visibleIf`; PATCH retyping a text question with
  responses into a statement → 409; duplicate copies `flow`, `presentation`, `tags`, `role`,
  `title`, `note`, `links` and routes verbatim; the mobile survey POST with an old-bundle-shaped
  body (statement rows included) stores no statement keys; `/survey-results` returns only the
  answerable questions; the admin edit path (`dropHidden: false`) never stores a statement row; a
  question label containing `{{` → 400 while a statement label with `{{canvasser}}` is accepted.
- `normalizeAnswers.test.js` (new unit): statement rows dropped in both `dropHidden` modes and with
  `rebuildAnswerText`; unknown-key rows still dropped; retired ids still kept.
- `surveyColumns.test.js`: "a statement block is not a column"; `known` still covers statement keys;
  a statement sharing a question's label does not decorate that question's header; template order
  preserved.
- `voterProfile` (int) and the three conversion payloads (int): a template with statements yields
  snapshots and payloads containing answerable questions only, and the desk composer's test renders
  no text input for a statement.
- Server validation (int/unit): `title` over 80, `note` over 2000, six links, a `{{` in an option's
  `text`, an unknown `{{token}}` in intro, closing, an option script or a note → 400; a question key
  or option id starting with `__` → 400; a template with no answerable question → 400; a PATCH
  carrying `flow` without `questions` → 400; a question-level `goTo` on a choice question → 400; a
  statement arriving with options is stored with none even when the prior version had options
  (reconcile does not re-append them); `list → script` while an active block still carries a hand
  `visibleIf` → 400, while a compiled template re-saved in Script flow has its incoming `visibleIf`
  overwritten.
- `burtonScript.test.js` (new unit): the final Burton mapping as a regression fixture — the twenty
  checks of `burton_final_proof.mjs` (visible set, `closingReached`, `requiredPending`) on the real
  `visibleQuestionKeys`.
- `packet.int.test.js` + `packetPdf.test.js`: statements pass through with position and fields; the
  script sequence prints each with its gate; per-option arrows print in Script flow; a template with
  statements but an empty intro, empty closing and no option scripts still renders the "What to say"
  page (the page gate tests the script sequence); notes never appear in the PDF text; existing
  fixture assertions (5 questions, "Write in", `scripts.length 1`) unchanged for statement-free
  templates.
- Client: `surveyAnswerForm.test.js` (statements produce no slot, row or cell),
  `surveyChoices.test.js` (`choicesFor` on a statement → `[]`), a new `surveyBuilderRules.js`
  extraction so `routeError`/`ruleError`/`displayNum`, the lossless "Switch back" (compiled rules
  kept as hand rules, every route cleared including on retired options, `flow: 'list'`), the
  re-pointing of routes when a target is retired or removed, the branching-question warning
  predicate, the first-arrow inline-error predicate, the automatic `presentation: 'steps'` on the
  first statement, closing or arrow, and the "Reached when" text are pinned under `node --test`; a
  client-report assertion that `computeSurveyBreakdowns` on a template with statements emits only
  answerable questions; the `surveyRunner.js`
  drift guard (mobile canonical ↔ client mirror); and a `surveyPreviewRender.smoke.test.js` following
  the existing `*Render.smoke.test.js` pattern — that harness is a single `renderToString`, so it
  pins the initial Try-it screen only; the stepping itself is covered by the shared runner's unit
  tests.
- Mobile: `mobile/lib/surveyRunner.test.js` via `npm run test:mobile` — answerable partition,
  numbering, progress, `closingReached`, `isAnswered` (Other without text and whitespace-only text
  are blank), `requiredPending`/`pathComplete` on the twenty Burton paths, and the stepper: a tap
  selects and does not move the cursor; `nextCursor` computed from the new answers lands on Question
  2 after "No" (never the end screen); Next is unavailable on a blank required question; Skip clears
  and advances on optional questions only; `saveScreen` is the last visible block when that block
  is a closing and the end screen otherwise (a closing left visible above a later block by a
  multiple-choice union shows Next); the end screen shows the default closing exactly when no
  explicit closing is visible; `clampCursor` when a
  refreshed template hides the current block; `prevCursor` on the first screen means exit.
- Device checks before production OTA, written into the PR: every path of the Burton survey on iOS
  and Android, one block per screen; Back then a changed answer drops the stale path; a link opens
  in the browser; Save stores only answerable rows; the same survey with `presentation: 'scroll'`
  renders with blocks woven in and the default closing waits for required questions; then the same
  template on a **not-yet-updated** build still saves. Finally
  `cd server && node --test src/services/surveys/visibility.test.js` after copying any mirrored body,
  and `npm run audit:mobile-api` from the repo root.

## M. Docs and Help Center cascade

- [SURVEYS.md](SURVEYS.md) Part 1: the abstract (line 3); "What a survey is" (30-41: statements,
  closings, the fallback rule); the builder paragraph (66-70); "Conditional questions" (84-101:
  rewrite "skip-to-end means the last questions simply don't appear"; add *Script flow* with "then
  go to", the *Continues to* line, and the fall-through trap); new subsections **Statements**,
  **More than one closing**, **Canvasser notes and links**, **One block per screen**, **The
  canvasser's name**; "Read-aloud option scripts" (103-108: contrast with statements); the Refused note
  (136-138) and the two matching notes in [ADMIN_APP.md](ADMIN_APP.md) 930-932 rewritten per
  ruling 2 (final wording: a refusal is the door button, never a survey answer; `refusalOption`
  stays unwired in the app, and the three statements about it — [SURVEYS.md](SURVEYS.md) 136-138 and
  512, [ADMIN_APP.md](ADMIN_APP.md) 930-932, [WALK_PACKETS.md](WALK_PACKETS.md) 647-649 — are
  reconciled to say exactly that: accepted by the API and printed by packets as a muted bubble,
  never recorded by the app, not a feature); "What a canvasser sees" (445-464: the one-block walk;
  a voter who refuses mid-script → Back, then the door's Refused button); safe edits (480-486: adding
  statements, closings, notes, links and routes is safe; retyping is the type change; routing edits
  between shifts, not during one).
- [SURVEYS.md](SURVEYS.md) Part 2: §A table (new fields, the implied mode, the closing semantic); §B (compile
  points, validateRouting, caps, link validation, "statement is never a rule target"); §D (unchanged
  body, new fixtures, the `isAnswerable` reasoning); §E (the fourth normalize rule and why); §C/§J
  (one sentence each: statements never appear in results or drills); §G (builder, preview, runner,
  print model rows; `surveyRunner.js`, `routing.js`, `scriptText.js`).
- [CANVASSER_APP.md](CANVASSER_APP.md) 296-308 and 820-828 (door conversation: the one-block-per-
  screen walk with Back, Next and Skip; statements; the closing that the path reached; "For you"
  notes; tappable links; the single-page presentation and when a survey uses which); file list
  873-875 (`mobile/lib/surveyRunner.js`).
- [ADMIN_APP.md](ADMIN_APP.md) 620-632 builder extras; 923 mapping row.
- [WALK_PACKETS.md](WALK_PACKETS.md) 78-82, 328, 516-528, 642-658 (what prints and where; the
  script sequence; numbering over answerable blocks).
- [EXPORTS.md](EXPORTS.md) 51, 149, 623, 907, 922, 939 (every "one column per question" sentence
  means every question that records an answer; `templateAnswerPlan` excludes statements; the
  estimate/build parity note stays true because estimates count rows and statement rows are never
  stored).
- [CAMPAIGNS.md](CAMPAIGNS.md) and [METRICS.md](METRICS.md) are untouched (no date placeholders;
  Refused stays a door outcome, by ruling); [VOTERS.md](VOTERS.md) 424; [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 26 (§K);
  [README.md](README.md): the SURVEYS row, and this proposal's own row (line 59), which was rewritten
  with the verification.
- Help Center: `guides/surveys.md` (line 16 types and closing; line 40 branching; new sections for
  statements, closings, notes/links, Script flow, placeholders);
  `guides/canvasser-door-survey.md` "Answering" (amber read-aloud and Closing blocks appear between
  questions on a scripted survey you see one block at a time: tap an answer and its read-aloud line
  appears under it, then Next; Next after a read-aloud block; Back to change an earlier answer; Skip
  on an optional question; the blue "For you" box is for you; tap a link to open it for the voter;
  the last screen is the goodbye for that conversation; if a voter refuses mid-script, Back and then
  the door's Refused button); `pages/page-survey.md`; `pages/page-print-packets.md`
  line 55 and the Print studio's Design-panel hint ("your opening, closing and option scripts, once"
  gains statements and closings); `faq/_INBOX.md` gains the four questions this project surfaced
  under its "Incoming" list in the file's own form (question, then "→ covered in ‹article› — candidate
  FAQ if it recurs"): "How do I add a line the canvasser reads but the voter doesn't answer?", "Can a
  survey have more than one closing?", "How do I give canvassers a link to show the voter?", "Why
  does my closing show on some paths and not others?"; the first two become a new FAQ
  `statements-and-closings.md` (order 76, audience lead, sourceDoc SURVEYS.md) and move to the
  file's "Triaged" list; the three Help articles that say "one column per question" stay true as
  written (a statement is not a question to a user); `PROJECT_BRIEF.md`'s "intro + closing"
  sentence gains statements and several closings; `faq/restricted-vs-refused.md` one sentence on
  the survey option.
- Builder copy that doubles as a promise: the Closing helper ([SurveyBuilder.jsx:799](../client/src/components/SurveyBuilder.jsx))
  and the locked banner (673-685).

## N. Decisions and rejected alternatives

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Where statements live | In `questions[]`, as a type | A parallel `blocks[]` array would need its own ordering, reconcile, duplicate, bootstrap and evaluator plumbing; `questions[]` already has all of it and the evaluator ignores `type`. |
| Closing field | **Default closing** (owner ruling): the last screen on a path that reaches no explicit closing; on the single page, shown only once every visible required question is answered — on scripted surveys only (Script flow or any closing block); an existing survey renders exactly as today | *Hide it whenever closing blocks exist* leaves a blank gating question with no goodbye and forces an explicit route for every path; *unconditional sign-off* double-prints under every explicit closing. |
| GO TO semantics | Compiled into `visibleIf` at save | A runtime path walk edits the mirrored evaluator in three places and makes every shipped phone disagree with the server about which rows to keep. |
| Mode | A **stored** `flow` field that the **builder** sets (first route → `script`, "Switch back" → `list`); never a control the author has to find | *Inferring* the mode from "any route exists" leaves no provenance in the document, lets one stray route flip recording semantics, and makes compiled rules indistinguishable from hand-authored ones on a round-trip. *An explicit setting in Survey settings* asks a non-technical lead to decide before they understand the difference. |
| Mode switch on a survey with responses | **Owner ruling: the always-safe direction (`script → list`, identical conditions) at any time; `list → script` refused once responses exist (409 with the Duplicate hint)** | *Allow both with a warning* lets later visits record differently from earlier ones; *block both* locks away a switch that cannot change anything. |
| Incoming `visibleIf` in Script flow | Ignored and overwritten by the compiled result | Rejecting it with a 400 breaks the GET → PATCH round-trip the builder and any API client rely on. |
| Authoring model | Statements **and** compiled "then go to" | *Statements with hand "Show only if" only* carries the client's script and adds no compiler, but §D's count stands: eleven rules, seventeen chips, and the author must derive Close 4's union by hand; the client's own notation is arrows. |
| Statement text | `label` = the read-aloud text (cap 5000 for statements), optional `title` | A separate `body` field reads better in the schema, but a phone still on the old bundle prints `label` and nothing else — with `body` a straggler sees "Close 2" and cannot read the closing; with `label` it reads the whole thing. The client's block names survive in `title`. |
| Presentation | **Owner ruling: one block per screen for scripted surveys** (`presentation: 'steps'`, set by the builder when a statement, closing or arrow is added); existing surveys keep the single page | *Single page only* was the first draft; it works, but a long script becomes a long scroll, closings pop in at the bottom mid-conversation and progress stops meaning much. *Per-screen for every survey* would cost every existing short survey a tap per question per door. The per-screen walk is a cursor over the same evaluator-visible list, so it adds no second routing engine and does not touch the route stack. |
| Refused | **Owner ruling 2026-10-02: a refusal is recorded only from the door screen's Refused button; the survey carries no Refused answer at Question 1. Nothing built. Do not re-propose.** | Two drafted alternatives are closed: an `outcome: 'refused'` option flag that filed the door outcome from inside the survey (with a one-ledger rule and a server 409 belt), and wiring the dormant `refusalOption` as a tracked *survey* answer (which would record a completed survey for a refusal, the opposite of the METRICS contract). Question 4's "Declined to answer" is an ordinary answer, not a refusal. |
| QR code | **Owner ruling 2026-10-02: no QR on the phone; the QR lives on the literature.** Links are tappable only, no new dependency. | An on-device QR via the pure-JS `react-native-qrcode-svg` over the installed `react-native-svg` was verified fingerprint-neutral and privacy-neutral; it is simply not wanted. |
| Branch telemetry | None | A stored "closing reached" marker is a response-shape change every reader must tolerate and a new report surface; the path is inferable from answers. |
| Placeholders | **Owner ruling: `{{canvasser}}` only**; dates typed by hand everywhere | Date tokens (`{{electionDay}}`, `{{earlyVotingStart}}`, `{{earlyVotingEnd}}`) would keep scripts in step with the campaign's key dates, but the owner types dates on every survey and wants to keep doing so; they also brought a long-date formatting dependency on the phone's Intl support. |
| Unanswered routed question | Routes nowhere (answer to proceed). In Burton every routing question is required and the two "won't say" cases are real answers ("Declined to say", "Declined to answer"), so every path ends at a closing | Routing an unanswered question "forward" needs `not_answered`, which fires on hidden parents and would leak closings onto unreached branches; a "skipped → go to" route is nested logic the flat grammar cannot carry. |
| Burton's Close 1 | **Owner ruling 2026-10-02: Close 1 is the default closing** (the `closing` field) | An explicit Close 1 block with routes avoids a double goodbye on a phone still on the old bundle — moot, the race has not started, so no phone is on the old bundle at the first shift. |
| Burton's Statement 1 | **Owner ruling: the pitch, then a required question** (Yes → Question 4, Still undecided → Close 4, No → default closing), with Question 4 placed after it | *A plain statement* records nothing from a voter who came round after the pitch; the client wants to know support. |
| Advancing on a single-choice tap | **Tap selects, Next advances** (verification) | *Automatic advance* would navigate away in the same frame that reveals the picked answer's read-aloud line (the Burton "Oh great!…" under *Already voted*), make "Other (specify)" untypable, leave a screen reached by Back with no forward control, and let a double-tap land on the next screen's pill. |
| Skipped optional question in Script flow | A **plain** question (no arrows) never ends the path; a **branching** question needs an answer and the builder warns when it is optional (verification) | Treating every choice question as answer-to-proceed would make a harmless optional question in the middle of a script end the conversation at the default closing. |
| Question-level route on a choice question | **Forbidden** (400); choice questions route through options and `otherGoTo` | Honouring it as a default for routeless options would let a route the builder never shows (reachable through the API or a text→choice retype) change the flow silently. |
| Hand conditions when the first arrow is set | Kept as inline errors in the builder until re-expressed as routes or removed, and refused by the server (400) on the `list → script` transition while any remain; overwrite applies only to an already-compiled Script-flow template | *Silent deletion* would discard conditions the flat compiler cannot express (`is_not`, `not_answered`, Match ALL) with nothing to show for it. |

## O. As built (2026-10-02)

Built 2026-10-02; a five-angle adversarial review's fixes were folded in on 2026-10-03, and the
bullets below describe the tree with them, as committed in 5cb42b2 and deployed to the server on
2026-10-03. Where the build differs
from the text above, the code wins and this section says how; where the text above uses a name that
did not ship, read it as the shipped one. Everything else above is the plan as agreed.

**Names.** The stepper shipped as `screens`, `saveScreenId`, `screenKind`, `clampScreenId`,
`canAdvance`, `canSkip`, `nextScreenId`, `prevScreenId` and `skipAnswer` (§H1 lists them all), so
the `nextCursor`, `prevCursor`, `clampCursor`, `skip` and `saveScreen` of §H2 and §L are
`nextScreenId`, `prevScreenId`, `clampScreenId`, `skipAnswer` and `saveScreenId`. The opening and
the end screen use the reserved ids `'__intro__'` and `'__end__'` (`INTRO_SCREEN_ID`,
`END_SCREEN_ID`), because a block's key is made from its text, so a question labelled "End" is keyed
`end`.

**On the phone**

- One block per screen works as §H2 describes. A tap on an answer only selects it, and its read-aloud
  line (or the "Please specify" box for Other) appears under it. **Next** moves on, and stays greyed
  out on a required question until it has an answer. **Skip** shows only on optional questions; it
  clears the answer, then moves on. The last screen carries the Note box and **Save Response**: the
  closing block the path ended on, or else the end screen, which shows the default closing or, when
  no default closing applies, "Done — end of the survey."
- The opening gets a screen only when the greeting has text, and a default closing of spaces alone
  no longer draws an empty Closing box on either presentation. (The single page still draws its
  Greeting box for a greeting of spaces alone, as it always has.)
- On step screens, a press on Back, Next, Skip or Save within 400 ms of the last step is ignored, so
  the second tap of a double tap never lands on the next screen's button (Next on Close 2 would
  otherwise be Save on Close 4). A negative gap — the phone's clock set back after a step — never
  counts, or every step control would stay dead until the clock caught up.
- When a template refresh retires or hides the block on screen, the stepper falls back to the screen
  before it (§H2's clamp) and moves its cursor there in the same render, so the next answer is
  measured from the screen on display; left on the vanished block, a tap could jump the canvasser
  forward past screens they never saw.
- On step screens the header's **‹ Back** steps back one screen and leaves the survey only from the
  first screen; Android's back button does the same.
- If a required question is left unanswered behind the canvasser (in practice, a template refresh
  mid-walk), the last screen shows an outlined **Answer Question N to finish** button in place of
  Save, and tapping it jumps to that question. §H2 planned a disabled Save with that caption.
- On step screens the greeting and the end screen's default closing are set in the same large type
  as statements (18/26); the single page keeps their old size.
- A block's canvasser note and links sit directly under it, under a question card as well as under a
  statement or closing, on both presentations. The note is the blue "For you — not read aloud" box,
  and the mobile theme gained `infoFg` for its text (`#1E40AF` light, `#93C5FD` dark). A link shows
  its label, or the site's name when it has none, and opens in the phone's browser on a tap.
- On the single page of a scripted survey only (the runner's `isScripted`: a statement, a closing or
  a live route on an active block, or Script flow), a block that newly appears is scrolled into view
  when it lands in the bottom quarter of the screen or below it, and it then sits about a third of
  the way down. It never scrolls while the canvasser is typing in a text box. Every other single-page
  survey never scrolls on its own, as before: §H3 planned the reveal for every single page, but on an
  existing Show-only-if survey a follow-up far below the answer that showed it would drag that answer
  and its read-aloud line off the top.

**On the server**

- A survey with no blocks at all can still be saved through the API, as before (the builder still
  asks for at least one question). What is new is the refusal of a survey whose only live blocks are
  statements and closings: "Add at least one question that records an answer."
- When a save breaks a rule a person can trip, the 400's `error` now carries the first such rule's
  plain-English sentence, where it always said "Invalid input". The `issues` list is unchanged, and
  zod's own generic checks still say "Invalid input".
- Turning on Go to for a survey that already has responses is its own 409 (`survey-has-responses`)
  with its own sentence: "This survey has responses, so it can't switch to Go to routing. Duplicate
  it to build the scripted version."
- In a Show-only-if survey a route on a live block or answer is refused, as planned, but one left on
  a retired block or answer is cleared silently, since nobody can see or edit it there.
- Desk entry (survey conversion) drops statements from four payloads, not the three §I named: the
  template lookup, the dry run, a new queue session and a resumed one.
- Duplicate copies `flow`, `presentation` and `tags`. Tags used to be dropped from every copy.
- Size bounds the plan did not have, each a plain-English 400: at most 500 blocks a survey and 200
  answers a question, retired ones included ("A survey can have at most 500 blocks, retired ones
  included." / "A question can have at most 200 answers, retired ones included."), and a PATCH's
  reconciled list is held to the same caps, since it keeps whatever the payload left out; in Script
  flow at most 200 live blocks ("A survey in Script flow can have at most 200 blocks."), and a compile
  whose conditions would hold more than 50,000 answer ids is refused ("This script branches too much
  to save. Split it into two surveys."; the Burton script compiles to 20). A continue carries its
  source's whole condition forward, so without them one lead's request could stall or crash the
  shared server.
- Two blocks sharing a key are refused, live or retired: "Two blocks share the key "q1"." Every reader
  finds a block by its key, so a statement sharing a question's key would swallow its answers.
- `{{` is refused in a live statement's title and a live block's link label too, as well as in a
  question's wording and an answer, so no text that passes reaches a phone as literal braces.
- The placeholder rules skip a retired block or answer, as the builder does: neither reaches a phone
  or paper, and the builder sends it back on every save, so a survey whose retired history predates
  the rules stays saveable. The length caps and the `__` rule still hold for every entry.
- An Other route (`otherGoTo`) is kept only on a choice question with Other on, the only place the
  compiler follows one (§E1 said "when `otherOption` is on"); on any other block it is cleared at
  save.

**In the builder**

- The "then go to" select sits on every answer, on the Other (specify) row and on text questions, in
  both styles; setting the first arrow switches the survey to Go to and shows the banner with
  **Switch back to Show only if**. A statement's or closing's own select appears in Go to only.
- On a survey stored in Show only if — its first arrow set but not yet saved — Switch back is an
  undo: every route is cleared and each block gets back the condition it was opened with (none for a
  block added since), so phones go on showing what they show today; nothing can refuse it and it
  never asks. On a new survey, or one stored in Go to, it converts as §F planned: refused while any
  arrow is in error (the banner shows that error until no arrow error is left), and on a survey with
  responses it asks first, because once it is saved without Go to, only a duplicate can use Go to
  again. Either way a block still carrying a hand-written condition keeps it. §F planned the
  conversion alone; compiling arrows that were never saved would turn what they implied — an
  optional question's skip ending the conversation included — into new conditions on blocks that
  had none.
- **One block per screen** is worked out from the survey as Save would send it, never latched: until
  the admin ticks or unticks it, it is on when the blocks as saved read as a script (a live
  statement, closing or arrow) and the survey as opened did not, and otherwise it is what was stored.
  A statement added and removed again leaves an existing single-page survey on its single page; an
  admin's own tick or untick stands.
- `{{` is refused in a block's title and a link's label as well as in question wording and answers,
  live in the builder and again by the server. A link with a label but no address is an error, and a
  link's address is matched in any case (`HTTPS://` is fine), as on the server and the phone.
- The live compile, the "Reached when" and "Continues to" lines and the skip warning read the blocks
  exactly as Save sends them, so an arrow on an answer with no text yet, which Save drops, routes
  nothing.
- A survey whose every block is retired can be saved again (renamed, say), as the server allows.
- On a survey with responses, the in-campaign builder's box offers **Duplicate** (copy, then attach
  the copy as this campaign's default) — a team lead has no Surveys list to duplicate from — with a
  line to do it between shifts, since a phone still on the old survey has its saves refused and
  dropped. The greyed-out "then go to" hint and the locked banner say where Duplicate is on the page
  they're on, and on a survey not yet in Go to the campaign Survey tab's Preview banner names
  switching to Go to beside an answer-type change, as the builder's banner does.
- The header's "N questions · M statements" count leaves retired blocks out.
- In Go to the builder sends every block's condition empty and the server's compile is what is
  stored; §G had the builder send its own compiled copy along.

**In the preview**

- The overview captions every gated block "Shown when …", in either style. (§G planned "Reached when"
  captions in Go to only; "Reached when" is the builder's wording.)
- **Try it** is an Overview | Try it switch. It walks the survey with the phone's own runner in both
  presentations, one block per screen or the live single page, and saves nothing.
- A statement with no title gets the bare caption, "Statement" or "Closing". Answers' read-aloud
  scripts now show under their answers in the overview, which never showed them before.

**On paper**

- As planned: statements and closings print once on the "What to say" page, each with its "Only if
  …" gate in its heading; in a Go to survey each answer prints its arrow ("-> Q4", "-> Close 2",
  "-> End") in place of the old skip hints; notes never print; `{{canvasser}}` prints as a blank line.
- Only a statement's or closing's links print, as "Label: address", or the address alone when a link
  has no label. A question's links ride in the packet payload but never print: §E1 and §I planned
  links on any block to print, but the "What to say" sequence carries a question only through its
  answers' read-aloud lines. A link volunteers need on paper belongs on a statement or closing.
- An older bug is fixed on the way: text that ran past a page break on the "What to say" page printed
  in the footer's small grey type.

**Tests, CI and privacy.** The unit tests are `routing`, `burtonScript`, `scriptText` and
`normalizeAnswers` under `server/src/services/surveys/`, `server/test/surveyColumns.test.js`, the
client's `surveyBuilderRules`, `surveyRunner` (the copy guard), `surveyConditionText` and
`surveyPreviewRender.smoke` tests, `packetPdf.test.js` and `mobile/lib/surveyRunner.test.js`; the
integration suites are `surveyBlocks.int.test.js` and `packet.int.test.js`. Two §L items were missing
from the first build and came in with the review's fixes: §L's two visibility fixtures, as six cases
in `visibility.fixtures.json` (a statement gated like a question, three ways; a closing block reached
from two sources, three ways, one with a stale hidden answer withheld), and the client-report
assertion, which landed in `surveyBlocks.int.test.js` beside the other consumers rather than in the
client suite, because `computeSurveyBreakdowns` is server code: with a stray stored row under a
statement's key, `computeSurveyBreakdowns` gives breakdowns for the choice questions only, with no
statement text in its output, `computeWindowStats` gives them for the same questions, and
`publicPointAnswer` returns null for every statement. The review found no other planned automated
test missing; §L's device checks stay manual, for the PR and before the production OTA. CI's checks
job now runs `npm run test:mobile`, as §J asked. §K's reasoning is recorded as
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 26, whose client-report claim that assertion
now pins.

**Known gap (2026-10-03) — fixed 2026-10-03 by
[PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md).** Found by the review and not fixed
in this build. A team lead's builder locks "then go to" (and a question's answer type) from the
survey list's `hasResponses`, which `GET /admin/surveys` narrows to the lead's own campaigns, while
the PATCH checks responses org-wide: on a survey whose responses all sit on campaigns the lead can't
see, the selects stay open and Save answers the 409 instead. The same gap already existed for the
answer-type lock. (The web preview's Try it had the phone's stale-cursor bug too; it now syncs the
stored cursor to the screen shown, exactly as the phone does.)

*Investigated 2026-10-03, after the commit; ruled the same day.* Reproduced over the real API on a
throwaway database and traced through every page that reads the survey list:

- **Where it bites.** Only a team lead, only in the campaign builder (the org library and its
  editor are admin-only), and only on a campaign's main survey that has responses somewhere in the
  organization but none on the lead's campaigns: answered by a campaign the lead doesn't manage, by
  one that has since switched surveys or dropped a walk-list override, or by legacy rows with no
  campaign. The lead branch of `GET /admin/surveys`
  ([surveys.js](../server/src/routes/admin/surveys.js)) drops all of these; the PATCH's
  `SurveyResponse.exists` sees them.
- **What the lead meets.** No banner, open answer-type pills and open "then go to" selects; Save then
  answers the 409, and the edits stay on the page. When no other campaign currently uses the survey
  (`usedElsewhere` reads current attachments only), the page shows no Duplicate at all, while the
  409 says to Duplicate. Switch back on a Go to survey skips its confirmation, so a lead can leave Go
  to for good without warning. The Survey tab prints the lead's own count followed by "across all
  campaigns".
- **What it never does.** Lock a survey that has no responses anywhere: the lead's buckets are a
  subset of the same aggregate, so the narrowed flag can only under-lock. Nothing unsafe is stored,
  because the server refuses both changes.
- **The fix, if ruled in.** The lead branch sends `hasResponses` from the org-wide count the handler
  already computes for every caller (`counts`, from the org-scoped aggregate), while
  `responseCount` and `responseCountByCampaign` stay narrowed. A lead's numbers then read "in your
  campaigns", and a locked survey with none of their own says it has responses in the organization,
  with no count and no campaign. Tried on a patched copy: the lead's list and the PATCH agreed on all
  six test surveys, and the one with no responses stayed unlocked. No new query, no index, no phone
  change.
- **The ruling it needs.** The 2026-08-08 client-lead scoping, ruled strict by the owner, derived
  `hasResponses` from the narrowed buckets and recorded "0 responses, yet the 409 fires" as by design
  ([SURVEYS.md](SURVEYS.md) Part 1, [ROLES.md](ROLES.md) Part 2). The fix lets a second bare yes/no
  cross that line beside `usedElsewhere`. A lead already learns the same bit from the 409, and can
  learn it without saving anything; a lead may be the client, so it is judged as customer-facing. It
  would get a dated [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) stamp for the owner to
  confirm. No Privacy Policy, Terms or DPA text changes.
- **Found on the way, older than this build.** Commit 16b0c87 (2026-06-27) swapped the builder's
  per-question lock (`locked && !!original`) for a lock on every card, so a locked survey's new
  questions can't pick a type the server would accept; the unused `originalByKey` memo is what is
  left of it. In a locked builder, removing an answer added in the same session stores it retired,
  and a blank one fails the save with a 400. The refusal box renders under the form, behind the
  fixed Save footer on desktop. Duplicate from the campaign builder can briefly land on the Create
  survey page while the lists refetch. A save-as-copy on refusal was considered for the load-to-Save
  race, which reaches admins too: it must never switch the campaign itself, because surveys queued on
  phones under the old one would be refused and dropped.

*Fixed 2026-10-03* (owner rulings 2026-10-03: *"as long as its part of their campaigns, yes"* and
*"sure why not?"*). A lead's survey list now says whether a survey on their campaigns has answers
anywhere in the organization — a bare yes/no, counts still theirs — so the builder locks up front.
As ruled, that is only for a survey attached to a campaign the lead manages: one they only wrote
keeps the narrowed yes/no, and its save still refuses
([PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md) §K.2), which is narrower than the
*"fix, if ruled in"* above, where every lead row widened. The lead's banner, Survey-tab note, picker
and campaign drawer word the count as theirs; the type lock and Retire cover only what the survey
was saved with (`16b0c87`'s per-question rule restored); a refused save shows its reason above the
footer with **Save my changes as a copy** (library only); Duplicate's swap waits instead of landing
on *Create survey*; and a duplicate's name is capped at 200 characters.

**Rulings that stand as built.** Refused is never a survey answer: a refusal is the door screen's
Refused button. There is no QR code on the phone; the QR is on the printed literature. Dates are
typed by hand; `{{canvasser}}` is the only placeholder. The default closing is the goodbye on any
path that reaches no closing block. One block per screen is for scripted surveys only, and every
existing survey keeps its single page. Leaving Go to is always allowed; entering it is blocked once
a survey has responses (Duplicate instead). The reporting caveat after the Burton table stands too:
a tag's "current" count is decided per tagged question, so a later visit that never asks that
question leaves the voter's last answer to it counting.
