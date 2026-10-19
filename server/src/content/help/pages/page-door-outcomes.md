---
slug: page-door-outcomes
title: The Door Outcomes page
audience: admin
kind: page
order: 117
sourceDoc: CAMPAIGNS.md
summary: Correct what a canvasser recorded at a door — relabel it, record, edit or remove survey answers, or unknock it entirely.
tags: outcomes, corrections, surveys, quality, page, admin, filter, date, date range, answers, walk list, search, export, csv, unknock, fraud, remove entries, not a target voter, offline, edit answers, take out, change an answer, earlier answers, one person at a time
---

**Door Outcomes** (in the sidebar's **Quality** group, next to Audit) is where you change what a recorded entry *says*. It's **org admins only** — leads decide what canvassers can record going forward (all but the optional **Not a target voter** button, which only org admins switch), but changing the record itself sits one level up.

Filter by outcome, canvasser, walk list, round, date range — or, on a survey campaign, by a **specific survey answer** — then tick the entries you want: one row to fix one door, or **Select all N matching** for a whole batch, then pick what they should become. Dates mean the campaign's own days, the same way they do on the dashboard.

**Filtering by answer** (open **Survey answers** in the filter bar) finds the doors where someone gave a particular answer — "everyone this canvasser surveyed who answered *Opposed*." It needs one other filter set first (a canvasser, walk list, round or date range), it only ever matches Surveyed entries, and if your campaign has used more than one survey you pick which survey's answers you mean. The table then shows who matched at each door — and who else was surveyed at the same visit (*1 other surveyed at this visit, not matched*). Which of them a change touches depends on the change: changing a Surveyed entry to another outcome, or unknocking it, takes **every** survey recorded at that visit, not just the matching one, and its review step names them all before anything happens. **Edit answers…** changes only the surveys that matched and leaves the others as they are.

There's also an **address search** (street, city or ZIP — it narrows the selection like any other filter), a newest/oldest **sort**, a running **entries · doors** count, and **Export CSV**, which downloads exactly what the table shows — survey evidence included — for handing off to whoever needs the worksheet.

**Entries recorded offline are tagged.** An entry a phone saved while it couldn't reach Doorline — no signal, usually — and sent later shows a small **Offline** tag beside its outcome, and **Export CSV** ends with a matching **Offline** column (*Offline*, or blank). On this page it's a label only: there's no filter for it, and no number here changes because of it.

You can also arrive here with the filter already set: the **Audit** page's drilled-canvasser view and the **Survey Explorer**'s answer drill each offer a *Correct in Door Outcomes* link that carries their filter over.

## Every change is priced before it runs

That review step is the whole safety model, so it's never skippable.

- A change that can't move any number says so: *"No reported numbers change."* True for any mix of **Not home**, **Wrong address** and **No soliciting** — each is one knock, and none means you reached a person.
- A change that *can* shows your campaign's real before-and-after — knocks, billable doors, contact rate, survey rate, restricted doors — with the changed figures in red. **Refused** moves your contact rate — and so does **Not a target voter**, on campaigns that use it, since both mean someone answered; **Restricted** moves billable doors. You can still make the change. You just can't make it by accident.

Entries keep their time, GPS location, canvasser, round and turf. Only the label changes — door colors follow, and phones pick them up on the next sync.

## Recording survey answers (→ Surveyed)

A canvasser who tapped the wrong button can't always fix it themselves: doing it away from the door flags their GPS. Select those entries, choose **Surveyed**, and enter the answers.

- **Enter answers** — one answer set for everyone at every selected door. Right for "that whole batch was really *Undecided*."
- **Door by door** — steps through the selection one address at a time so each household gets its own answers — and at a multi-voter door, tick **Different answers for each person** to record each voter separately. Leave part-way with **Finish later**; the session shows under **Survey answer changes** as *Unfinished — 3 of 40 done*, with **Resume** to carry on and **Stop here** to keep what you've done and close it. Closing the tab is the same as Finish later.

You can leave questions blank. Record only what you actually know.

**Who gets an answer:** every voter at that address, except anyone marked do-not-contact and anyone who already answered that round. **Recording answers never overwrites a real field answer** — the review step names everyone who'll be skipped and why. Changing an answer a canvasser did record is a different tool, **Edit answers…** (next section), and it keeps the earlier answers.

**Who gets the credit:** the canvasser who knocked. The knock keeps their name, time, location, round and team, so their numbers reflect their work. The answers carry a visible **"Entered by ‹you› on ‹date›"** stamp on the voter's record and in exports, so a desk entry is never mistaken for a doorstep conversation. They count in your rates like any other answer.

If the selected doors use **different surveys** (a walk list with its own survey), you'll be asked to filter by walk list first — the walk-list filter at the top of the page — one survey at a time.

## Editing survey answers (Edit answers…)

Sometimes the visit and the survey were real and only an answer is wrong. Say question 3 is *Could you help us by taking a yard sign?*, and a canvasser who didn't know a question could be skipped picked *Volunteer Request* or *Candidate Follow-Up* every time a voter said no to a sign. Changing those entries to Not home would throw away every real answer along with the wrong ones. **Edit answers…** changes only the answers you pick. The knock, the Surveyed status, the note, the time, the GPS location, the canvasser, the round and the team stay exactly as recorded, and so does every answer you leave alone — so knocks, billable doors, contact rate and survey rate don't move, and every voter stays surveyed.

It's the first button in the bar whenever everything you've selected is Surveyed, on a survey campaign. The form goes question by question:

- **Pick one:** **Leave as recorded**, **Clear the answer**, or **Change it to** another answer.
- **Pick several:** **Leave as recorded**, **Take out picks**, or **Clear every pick**. Take out removes only the picks you tick and leaves the rest of that person's picks alone; **Replace them with** can put a different pick in, but only on surveys that just lost one. Clear every pick removes them all, and the form warns in red what that would also remove.
- **Written answer:** **Leave as recorded** or **Clear the answer**. Typed text is never copied onto many surveys at once.
- **Retired questions** sit under their own heading: you can clear them, or take picks out, but nothing new goes in.

Every count on the form is over the surveys you selected — *answered on 214 of 214*, *Now on these surveys: Volunteer Request 139 · Candidate Follow-Up 97 · Yard Sign Delivered 12*. When the page's answer filter is on a pick-several question, the form offers one button for exactly that job: **Take out just Candidate Follow-Up and Volunteer Request**. The whole walkthrough is in [A canvasser picked an answer they should have skipped](fix-one-survey-answer).

**Who changes:**

- **With an answer filter on, only the surveys that matched it change.** Anyone else surveyed at the same visit is left alone, and the form counts them: *9 other people surveyed at these visits didn't match and stay as they are.* On a matched survey your change applies to the whole question, which is why **Take out** exists.
- **With no answer filter, every survey at the selected entries changes.**
- **A blank stays blank.** *Change it to* only touches surveys that have an answer to that question, and *Replace them with* only touches surveys that just lost a pick. Nothing gets filled in that nobody recorded.
- **Later questions follow the survey's own logic.** If, after your change, the survey would never have asked a later question, that later answer goes too — it's what the phone would have stored. The review lists them under *Later answers that go too*, and Undo brings them back. On a scripted survey a blank answer can end the script early, and the review says so in red.
- **Your dates apply to the surveys too**, and the review counts any matching survey they left out. If the entries hold answers from two surveys (a walk list with its own), the form asks which one you're editing.

**Two ways to apply it.** **Same change for everyone** applies your choices to every selected survey. **One person at a time** opens each survey with its recorded answers and follows the survey's logic as you fix it, showing what each changed answer *was*; press **Save & next**, **Skip**, or **Finish later** to stop for now. An unfinished session waits under **Survey answer changes** as *Unfinished*, with **Resume** and **Stop here**, and the whole session undoes as one change. It's also the one place you can fill in a blank, for the person in front of you.

**Limits:** one edit takes up to 50,000 surveys, from up to 25,000 selected entries, and One person at a time takes up to 500. An answer filter that matches more than 20,000 answers has to be narrowed — a canvasser, round, walk list or dates — or you tick the rows you mean.

**The review step** opens with *No door, knock or billing number changes*, then says what does move, in numbers you can check against what you saw: *Taking out Volunteer Request from 139 surveys and Candidate Follow-Up from 97. That's 214 surveys: 22 had both. 202 are left with no answer, as if skipped; 12 keep Yard Sign Delivered.* Then your campaign's survey results for that question before → after, pick by pick; any tag counts that move; what's left as it is, and why; and the name of everyone whose survey changes. The red **Change 214 surveys** button makes it. If one of those surveys changed after you reviewed it, the button refuses — *Something changed since you reviewed this — review again* — and nothing is written.

**After it lands,** survey results, the Survey Explorer, tag counts, exports of survey answers, the map's answer filter, and walk lists and rounds you cut from then on all read the edited answers. **Copies made before don't update:** saved searches, walk lists and rounds already cut keep the people they had, a file already exported keeps the old answers, and a published client report keeps its numbers until you unpublish it and publish it again. Each changed survey reads *Edited by ‹you› on ‹date›*, and its earlier answers are kept on the voter's profile as an **Earlier answers** card. An edit never shows on the [Duplicate Surveys page](page-duplicate-surveys) — it's still one person surveyed once.

**Undo** puts every survey back, including any later answers that went with the change — except a survey someone changed afterwards (re-surveyed it, or edited it again), which keeps the newer answers and is named: *Undone · 212 put back · 2 kept newer answers*. If a later change holds some of the surveys — say an entry was unknocked after your edit — the row reads *Partly undone · 211 put back · 3 waiting on a later change*: undo that later change first, then press **Undo again** here. An edit that stops part-way reads *Stopped*: everything it already changed is correct, and you can **Pick up where it stopped** or **Undo what landed**. Once an undo has started, the edit can never be picked up again.

**One change at a time.** An answer edit can't start while a survey conversion, an unknock or another answer edit is still running on the campaign, or while a round is being re-cut, and conversions and unknocks wait for it in turn. An open One person at a time session counts as running until you press **Stop here**, and it can be undone once it's stopped.

Team leads on the campaign — who may be your client — see these edits the way they see every other correction: the *Edited* line, the earlier answers on the voter's profile, and the row in the campaign's History. Only org admins can make them, and the phone app has no Edit answers.

## Removing survey answers (Surveyed → something else)

This is the cleanup direction. When a canvasser's surveys turn out to be fake, select those entries and change them to **Not home** so the doors go back into play.

The review step lists **exactly whose answers are about to be removed, by name**. The answers are **kept, not destroyed** — they stay on each voter's record, marked **Removed**, because in an investigation the answers you're removing are the evidence. To bring them back, **undo the change** here: that puts the answers and the Surveyed entry back together. The profile's Restore stays off for them while the door reads Not home, so a removed survey can't come back as a counted survey at a door that says nobody answered.

Only that entry's own canvasser is affected. If a second canvasser genuinely surveyed the same door in the same round, their answers survive untouched.

## Unknocking (removing entries entirely)

Relabelling keeps the knock. Sometimes the knock itself is the lie — a canvasser fabricated a run
of visits, or a batch was recorded by mistake — and then you don't want it relabelled, counted, or
billed. **Unknock…** (the red button beside the outcome picker) removes the selected entries from
the record:

- **Every number they touched gives them back** — campaign totals, that canvasser's totals,
  billable doors, contact and survey rates. The review step prices it in red first, like every
  other change here.
- **The doors read Unknocked again, in their own round.** A real knock at one of them counts
  once, as the first knock — no new round needed, and the round's history stays honest about what
  was actually worked.
- **Answers are archived by name, and the struck entries are kept on the change** — that's the
  evidence, and it's what makes **Undo** exact. Undo puts everything back; if a door was genuinely
  re-knocked in the meantime, the newer real work is kept and the change says exactly what it
  couldn't restore. The struck answers stay on the voter's profile, marked **Removed**, and can't be
  restored from there while the visit is unknocked — so they can never be put back over a real
  survey taken since. They don't show on the [Duplicate Surveys page](page-duplicate-surveys)
  either.

Only the selection is affected: another canvasser's honest visit to the same door survives, a
restricted mark the office placed survives (that door reads Restricted, not Unknocked), and notes
survive. One difference from relabelling: an unknock by filter **can take Lit dropped entries** —
a faked lit drop counts and bills like any other knock, so the cleanup takes it too, and the
review step says so. Runs are listed under **Removed entries** with the filter that produced them.

Three honest limits, all named in the review step: a billing statement already issued for a past
month stays as issued (it will show a drift warning when read); a published client report keeps
its frozen numbers; and a phone that recorded one of the struck knocks before the cleanup can't
sneak it back in afterward — the server drops the replay quietly.

## Not a target voter entries

**Not a target voter** is an optional door button for someone who answers but isn't on your list
for that address and won't give a name. It stays off until an org admin turns it on for a
campaign, and an entry with no name can't be checked, so this page is where you look them over.
Its filter chip appears only on campaigns that have had it turned on.

- **Changing one is always priced.** It counts as reaching a person, so the review step shows what the change does to your contact rate before anything runs.
- **It's a *Change to* choice only where canvassers can record it right now** — a survey campaign that has it on, while Doorline has it available. Its entries stay listed here even after it's switched off, so cleaning up never waits on the switch.

To clean up one canvasser's suspect entries, filter to that canvasser and a date range, tick the
**Not a target voter** chip, select the entries, and then:

- **Change them** — to **Not home**, say, when they were real visits with the wrong label. The review step prices what moves.
- **Convert them to Surveyed** if the answers really were taken (see *Recording survey answers* above). Bear in mind what the entry itself said: that whoever answered was *not* one of the voters listed at that address. The answers you enter go to the voters on file there, so convert one only when you know a listed voter really answered.
- **Unknock** them, so they stop counting and billing.

**Switched it off while a canvasser's phone was offline?** That phone keeps the button until it
reconnects, and what it records in the meantime still syncs and counts — real door work is never
thrown away. To review those entries, filter by the canvasser and the dates since you switched it
off, and look for the **Offline** tag.

## Seeing exactly what a change did

Every row under **Past changes** and **Survey answer changes** has a **Details** button. It opens
the itemized history: each door that changed (what it said before, what it says now, who knocked
it, which round, when) and — for survey conversions — each survey that was recorded or removed,
voter by voter, with the answers themselves. An answer edit's Details lists each survey it changed,
question by question, before → after. Big changes are paged; skipped voters are listed with
their reasons.

One honest limit: **undoing a change also removes the markers this detail is built from** — that's
what makes the undo exact — so an undone change keeps its summary line but not its door-by-door
itemization. The exception is answers an undo couldn't put back (a newer field answer had taken
the spot); those stay listed, since they're exactly what you'd need to find. An undone answer edit
works the same way: its Details lists only the surveys the undo didn't put back, each with the reason.

## Undoing

Each change also remembers the filter that produced it — a change made under "Cara Canvasser · answered Opposed · Aug 1 – Aug 7" says so on its row, so a narrow correction is never mistaken for a whole-campaign fold.

Every change is listed with an undo that reverses it exactly — including a selection that spanned several outcomes, and a door-by-door or one-person-at-a-time session, which undoes as one unit. (An answer edit's undo leaves alone any survey changed since; see *Editing survey answers* above.) Changes and undos both appear in the campaign's History.

A large batch runs in the background with a progress bar. If it stops part-way, everything that landed is correct — you can either undo it or pick up where it stopped.

An undo can stop part-way too — say the server restarts in the middle. The change then reads **Undo stopped**: everything it already put back is correct, and **Retry undo** finishes putting the rest back. It never offers *pick up where it stopped*, because that would make the change again. If an undo seems stuck on *Undoing*, give it about ten minutes: one that died with the page shows **Undo stopped** by then, ready to retry.

## What you won't see here

Doors an admin marked restricted from the desk — a whole book with **bulk restrict**, or a single home from its popup (desk marks, each with its own undo where it was made), and entries an earlier change already converted, until you undo that one. **Lit dropped** entries never appear in the table — a lit drop has no answers to move either way, so there's nothing to relabel — but an **unknock by filter** does take them, since a faked lit drop counts and bills like any other knock.
