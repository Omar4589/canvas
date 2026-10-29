---
slug: passes
title: Passes
audience: lead
kind: guide
order: 15
sourceDoc: PASSES.md
summary: A pass is one planned sweep through a walk list's doors — how they're numbered, created, closed, and brought back.
tags: passes, walk lists, billing, activate, archive, bring back, undo, follow-up, target doors
---

## What a pass is

A **pass** is one planned trip through a single [walk list](walk-lists)'s doors — Pass 1, then a follow-up Pass 2, and so on. Each pass is cut into books on the Turf Cutting page and handed to canvassers.

Knocking a door in Pass 1 and again in Pass 2 counts as two door-knocks — so each new pass adds knocks. See [Coverage vs. knocks](coverage-vs-knocks) for how that adds up.

Pass numbers **restart per walk list**, so you'll have a North Pass 1 and a South Pass 1 — they don't share a counter.

## Where you manage them

Passes live *inside* a walk list, not on their own page. Open the **Walk Lists** page, open a walk list, and use the **Passes** panel. Everything — create, activate, archive, bring back — happens right there.

## Each pass shows its numbers

The passes table shows each pass's own count of **books**, **knocks**, **survey doors** (lit drops on a lit-drop campaign), and its **connection rate**. They're counted exactly like the campaign Home's **By pass** section — one knock per door per pass. One difference to know: the passes table always shows **all-time** numbers, while the Home's By pass table follows the **date range** you've picked there — set the Home range to "All time" and the two match exactly. For what each number means, see [Understanding the numbers](metrics).

## Pass 1 is made for you

When you create a walk list, **Pass 1 is created automatically**, so your usual flow (walk list → [cut books](turf-and-books) → activate) needs no extra step. To add a follow-up, click **New pass** — it numbers itself. A name is optional: leave it blank for "Pass 2," or type one like "GOTV" to label it.

## Follow-up rounds: cut only the doors you want

A follow-up pass doesn't have to walk every door again. After **New pass**, go to [Turf Cutting](turf-and-books) as usual — but before you generate, open the **Target doors** panel (it's available until the pass has published books). Tick the door statuses you're chasing — say **not home** and **unknocked** to sweep what you missed — and on a survey campaign you can target [survey answers](surveys) too, like every door that answered **Undecided**. Using both kinds at once? Choose whether a door must match **all** of them (AND) or **any** of them (OR).

You can also say which doors to **skip**: the **Exclude doors** panel just below works the same way, but in reverse — a door matching **any** of its conditions is removed from the cut, *even if it matches the target above*. The classic use is a sign-drop round: target your supporters and undecideds, then exclude everyone who already answered **Yard Sign Delivered** — you go back to persuadable doors without re-knocking yards that already have a sign. One thing to know: excluding by a survey answer removes the **whole door** if *anyone* there gave that answer, from any round.

As you tick, a live count shows how many doors and voters match (and how many the exclusions removed), and the map dims everything else — so you see the exact universe before you cut. Then generate: only the matching doors go into books, and canvassers see only those doors in the field.

> Heads up: The status boxes read each door's **whole history across every round**, not just this pass and not just its latest entry. Each door gets one status, checked in this order: **Restricted** if any round ever recorded it, from the desk or at the door — it wins over everything, even a later survey or knock, until you **Unmark** the desk mark or **Unknock** the entry on Door Outcomes; otherwise **Surveyed** if surveyed in any round; otherwise **Refused**, **Wrong address**, **No soliciting** or **Not a target voter** if any was ever recorded (the most recent of them); otherwise **Not home** if the only entries are not-homes, so nobody has ever answered; otherwise **Unknocked**, never visited. So a door that refused once and was not-home'd later counts as *Refused*, and a gated home your crew got into once still counts as *Restricted*. This rule only decides what a follow-up cut or a new walk list includes, and the two exclude checkboxes above Generate read it too; the Map page, coverage and your canvassers' phones keep showing the latest visit. While the panel is open the map colors every house by this all-rounds status, so what you tick is what you see.
>
> Faded doors say why. The three checkboxes above **Generate** (restricted-access, no-soliciting, no reliable map spot) are applied on top of your target and are on by default. The count line names each one's share, clicking a faded house tells you the exact reason, and the panel warns before you cut into nothing — for instance ticking **Restricted** while **Exclude restricted-access homes** is on, or AND-ing a survey answer with statuses that can never carry one (a door with an answer reads Surveyed, or Restricted if it also carries a mark).

## The lifecycle

A pass goes **draft → active → archived.**

- **Draft** — build it: cut its books and [assign canvassers](assigning-canvassers).
- **Active** — live in the field. Each walk list has **at most one active pass**, so activating a new pass archives that walk list's previous one. (Other walk lists keep running their own active passes independently.)
- **Archived** — ended. Knock history is kept. A pass ends when you archive it, when you archive its walk list, or when the next pass on its walk list goes live.

> Heads up: To activate a pass it needs at least one published book, plus a [survey](surveys) attached if it's a survey campaign. You can delete a draft that has no history, but anything live or with recorded knocks must be archived instead — you'll confirm first, and type `archive` once the pass has knocks. That includes a draft that still holds knocks after a Discard or a snapshot restore: it shows **Archive** instead of **Delete**. Deleting a draft pass also deletes its saved Discard snapshots, knocks you cleared into them included — restore one first if you want it back ([Recut books mid-pass](recut-books-mid-pass)).

## Archiving a pass, and bringing it back

**Archive** asks first, and says what it means. For a live pass: canvassers lose its books the next time their map refreshes. For a draft that holds knocks: nobody has its books. Either way, its knocks are kept. Right after, an **Undo** link brings it straight back.

An archived pass says how it ended — by hand, when its walk list was archived, or when the next pass went live — and offers **Bring back**:

- **Bring back works until a newer pass on that walk list has gone live.** A pass that ended because the next pass went live never comes back; its row says why instead of showing the button. To keep going after that, start a new pass.
- **A pass that was live comes back live** — the same books go back to the same canvassers the next time their map refreshes. **A pass that was a draft** comes back as a draft.
- **A pass with no doors left in its books comes back as a draft**, since there would be nothing to walk — say every door was moved into another walk list. The box tells you before you confirm.
- **It can't come back** while another pass on the walk list is live (archive that one first), on a survey campaign with no survey attached, or on an archived campaign. If its walk list is archived, use **Unarchive** there — it offers to bring back the pass archiving ended (see [Walk lists](walk-lists)).
- **Someone removed from the campaign** in the meantime doesn't get their book back; it comes back unassigned.

On [Turf Cutting](page-turf-cutting) an archived pass is view-only: you see its books as they were, and the banner offers **Bring back** when it can come back. Archiving a pass and bringing one back both show in the campaign's [History](who-changed-the-door-goal). Archived something by mistake? See [I archived a walk list or a pass by mistake](undo-archive).

Knocks a canvasser recorded on a pass with no signal, and sent after it ended, still count in that pass — after the app update. So a finished pass's numbers can keep growing for a little while as phones catch up. A late survey follows the usual rule for two canvassers who survey the same voter in one pass: the one that reaches Doorline last is kept, and the other is preserved on the voter's profile, where an admin can restore it.
