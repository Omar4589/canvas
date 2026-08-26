---
slug: page-door-outcomes
title: The Door Outcomes page
audience: admin
kind: page
order: 117
sourceDoc: CAMPAIGNS.md
summary: Correct what a canvasser recorded at a door — relabel it, record or remove survey answers, or unknock it entirely.
tags: outcomes, corrections, surveys, quality, page, admin, filter, date, date range, answers, walk list, search, export, csv, unknock, fraud, remove entries
---

**Door Outcomes** (in the sidebar's **Quality** group, next to Audit) is where you change what a recorded entry *says*. It's **org admins only** — leads decide what canvassers can record going forward, but changing the record itself sits one level up.

Filter by outcome, canvasser, walk list, round, date range — or, on a survey campaign, by a **specific survey answer** — then tick the entries you want: one row to fix one door, or **Select all N matching** for a whole batch, then pick what they should become. Dates mean the campaign's own days, the same way they do on the dashboard.

**Filtering by answer** (open **Survey answers** in the filter bar) finds the doors where someone gave a particular answer — "everyone this canvasser surveyed who answered *Opposed*." It needs one other filter set first (a canvasser, walk list, round or date range), it only ever matches Surveyed entries, and if your campaign has used more than one survey you pick which survey's answers you mean. The table then shows who matched at each door — and who else answered at the same visit, because changing a Surveyed entry takes **every** answer recorded at that visit, not just the matching one. The review step names them all before anything happens.

There's also an **address search** (street, city or ZIP — it narrows the selection like any other filter), a newest/oldest **sort**, a running **entries · doors** count, and **Export CSV**, which downloads exactly what the table shows — survey evidence included — for handing off to whoever needs the worksheet.

You can also arrive here with the filter already set: the **Audit** page's drilled-canvasser view and the **Survey Explorer**'s answer drill each offer a *Correct in Door Outcomes* link that carries their filter over.

## Every change is priced before it runs

That review step is the whole safety model, so it's never skippable.

- A change that can't move any number says so: *"No reported numbers change."* True for any mix of **Not home**, **Wrong address** and **No soliciting** — each is one knock, and none means you reached a person.
- A change that *can* shows your campaign's real before-and-after — knocks, billable doors, contact rate, survey rate, restricted doors — with the changed figures in red. **Refused** moves your contact rate; **Restricted** moves billable doors. You can still make the change. You just can't make it by accident.

Entries keep their time, GPS location, canvasser, round and turf. Only the label changes — door colors follow, and phones pick them up on the next sync.

## Recording survey answers (→ Surveyed)

A canvasser who tapped the wrong button can't always fix it themselves: doing it away from the door flags their GPS. Select those entries, choose **Surveyed**, and enter the answers.

- **Enter answers** — one answer set for everyone at every selected door. Right for "that whole batch was really *Undecided*."
- **Door by door** — steps through the selection one address at a time so each household gets its own answers — and at a multi-voter door, tick **Different answers for each person** to record each voter separately. Leave part-way with **Finish later**; the session shows under **Survey answer changes** as *Unfinished — 3 of 40 done*, with **Resume** to carry on and **Stop here** to keep what you've done and close it. Closing the tab is the same as Finish later.

You can leave questions blank. Record only what you actually know.

**Who gets an answer:** every voter at that address, except anyone marked do-not-contact and anyone who already answered that round. **A real field answer is never overwritten by one you type** — the review step names everyone who'll be skipped and why.

**Who gets the credit:** the canvasser who knocked. The knock keeps their name, time, location, round and team, so their numbers reflect their work. The answers carry a visible **"Entered by ‹you› on ‹date›"** stamp on the voter's record and in exports, so a desk entry is never mistaken for a doorstep conversation. They count in your rates like any other answer.

If the selected doors use **different surveys** (a walk list with its own survey), you'll be asked to filter by walk list first — the walk-list filter at the top of the page — one survey at a time.

## Removing survey answers (Surveyed → something else)

This is the cleanup direction. When a canvasser's surveys turn out to be fake, select those entries and change them to **Not home** so the doors go back into play.

The review step lists **exactly whose answers are about to be removed, by name**. The answers are **kept, not destroyed** — they stay on each voter's record and can be restored, because in an investigation the answers you're removing are the evidence.

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
  couldn't restore.

Only the selection is affected: another canvasser's honest visit to the same door survives, a
restricted mark the office placed survives (that door reads Restricted, not Unknocked), and notes
survive. One difference from relabelling: an unknock by filter **can take Lit dropped entries** —
a faked lit drop counts and bills like any other knock, so the cleanup takes it too, and the
review step says so. Runs are listed under **Removed entries** with the filter that produced them.

Three honest limits, all named in the review step: a billing statement already issued for a past
month stays as issued (it will show a drift warning when read); a published client report keeps
its frozen numbers; and a phone that recorded one of the struck knocks before the cleanup can't
sneak it back in afterward — the server drops the replay quietly.

## Seeing exactly what a change did

Every row under **Past changes** and **Survey answer changes** has a **Details** button. It opens
the itemized history: each door that changed (what it said before, what it says now, who knocked
it, which round, when) and — for survey conversions — each answer that was recorded or removed,
voter by voter, with the answers themselves. Big changes are paged; skipped voters are listed with
their reasons.

One honest limit: **undoing a change also removes the markers this detail is built from** — that's
what makes the undo exact — so an undone change keeps its summary line but not its door-by-door
itemization. The exception is answers an undo couldn't put back (a newer field answer had taken
the spot); those stay listed, since they're exactly what you'd need to find.

## Undoing

Each change also remembers the filter that produced it — a change made under "Cara Canvasser · answered Opposed · Aug 1 – Aug 7" says so on its row, so a narrow correction is never mistaken for a whole-campaign fold.

Every change is listed with an undo that reverses it exactly — including a selection that spanned several outcomes, and a door-by-door session, which undoes as one unit. Changes and undos both appear in the campaign's History.

A large batch runs in the background with a progress bar. If it stops part-way, everything that landed is correct — you can either undo it or pick up where it stopped.

## What you won't see here

Doors an admin marked restricted from the desk — a whole book with **bulk restrict**, or a single home from its popup (desk marks, each with its own undo where it was made), and entries an earlier change already converted, until you undo that one. **Lit dropped** entries never appear in the table — a lit drop has no answers to move either way, so there's nothing to relabel — but an **unknock by filter** does take them, since a faked lit drop counts and bills like any other knock.
