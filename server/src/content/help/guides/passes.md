---
slug: passes
title: Passes
audience: lead
kind: guide
order: 15
sourceDoc: PASSES.md
summary: A pass is one planned sweep through a walk list's doors — how they're numbered, created, and closed.
tags: passes, walk lists, billing, activate, archive, follow-up, target doors
---

## What a pass is

A **pass** is one planned trip through a single [walk list](walk-lists)'s doors — Pass 1, then a follow-up Pass 2, and so on. Each pass is cut into books on the Turf Cutting page and handed to canvassers.

Knocking a door in Pass 1 and again in Pass 2 counts as two door-knocks — so each new pass adds knocks. See [Coverage vs. knocks](coverage-vs-knocks) for how that adds up.

Pass numbers **restart per walk list**, so you'll have a North Pass 1 and a South Pass 1 — they don't share a counter.

## Where you manage them

Passes live *inside* a walk list, not on their own page. Open the **Walk Lists** page, open a walk list, and use the **Passes** panel. Everything — create, activate, archive — happens right there.

## Each pass shows its numbers

The passes table shows each pass's own count of **books**, **knocks**, **survey doors** (lit drops on a lit-drop campaign), and its **connection rate**. They're counted exactly like the campaign Home's **By pass** section — one knock per door per pass. One difference to know: the passes table always shows **all-time** numbers, while the Home's By pass table follows the **date range** you've picked there — set the Home range to "All time" and the two match exactly. For what each number means, see [Understanding the numbers](metrics).

## Pass 1 is made for you

When you create a walk list, **Pass 1 is created automatically**, so your usual flow (walk list → [cut books](turf-and-books) → activate) needs no extra step. To add a follow-up, click **New pass** — it numbers itself. A name is optional: leave it blank for "Pass 2," or type one like "GOTV" to label it.

## Follow-up rounds: cut only the doors you want

A follow-up pass doesn't have to walk every door again. After **New pass**, go to [Turf Cutting](turf-and-books) as usual — but before you generate, open the **Target doors** panel (it's available until the pass has published books). Tick the door statuses you're chasing — say **not home** and **unknocked** to sweep what you missed — and on a survey campaign you can target [survey answers](surveys) too, like every door that answered **Undecided**. Using both kinds at once? Choose whether a door must match **all** of them (AND) or **any** of them (OR).

You can also say which doors to **skip**: the **Exclude doors** panel just below works the same way, but in reverse — a door matching **any** of its conditions is removed from the cut, *even if it matches the target above*. The classic use is a sign-drop round: target your supporters and undecideds, then exclude everyone who already answered **Yard Sign Delivered** — you go back to persuadable doors without re-knocking yards that already have a sign. One thing to know: excluding by a survey answer removes the **whole door** if *anyone* there gave that answer, from any round.

As you tick, a live count shows how many doors and voters match (and how many the exclusions removed), and the map dims everything else — so you see the exact universe before you cut. Then generate: only the matching doors go into books, and canvassers see only those doors in the field.

> Heads up: The status boxes read each door's **current** status — "not home" means the door reads not-home *now*, not "was not-home in Pass 1." For a follow-up that's usually exactly what you want: a not-home door that someone has since surveyed drops out of the target on its own.

## The lifecycle (one-way)

A pass moves in one direction only: **draft → active → archived.**

- **Draft** — build it: cut its books and [assign canvassers](assigning-canvassers).
- **Active** — live in the field. Each walk list has **at most one active pass**, so activating a new pass archives that walk list's previous one. (Other walk lists keep running their own active passes independently.)
- **Archived** — done. This is one-way; a pass is never reopened. Knock history is kept, and you add a new pass to keep going.

> Heads up: To activate a pass it needs at least one published book, plus a [survey](surveys) attached if it's a survey campaign. You can delete a draft that has no history, but anything live or with recorded knocks must be archived instead — you'll type `archive` to confirm.
