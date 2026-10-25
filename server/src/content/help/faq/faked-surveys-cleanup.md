---
slug: faked-surveys-cleanup
title: A canvasser faked surveys — how do I get those doors back into play?
audience: admin
kind: faq
order: 65
sourceDoc: CAMPAIGNS.md
summary: Unknock the fake entries from Door Outcomes — the knocks stop counting, the answers are archived, and the doors are knockable again in the same round.
tags: fake, fraud, cleanup, remove answers, unknock, door outcomes, corrections, integrity, billing, not a target voter, offline, edit answers, wrong answer, automatic pause, paused
---

The full cleanup is **Unknock**, on the **[Door Outcomes page](page-door-outcomes)**: filter to that canvasser (a date range narrows it further, and on a survey campaign you can filter to a **specific answer** — "everyone they marked *Supporter*"), select the entries, and press **Unknock…**. The fake entries are removed from the record entirely:

- **The knocks stop counting** — your campaign totals, that canvasser's totals, and your billable doors all drop by exactly what the review step showed you first.
- **The doors read Unknocked again, in the same round** — a real knock at one of them counts once, as the first knock, because now it is.
- **The answers are archived, never destroyed** — they stay listed by name on the change, and undoing it brings them back, because in an investigation the removed answers are the evidence. The struck entries themselves are kept on the change too, which is what makes **Undo** exact. (The voter's profile shows them as **Removed**, without a Restore button: an unknocked visit has no survey to put them into.)

Only that canvasser's work is touched. A second canvasser's honest visit to the same door survives, and so does a restricted mark the office placed. The change is listed under **Removed entries** with the filter that produced it and a one-click Undo.

**Caught by automatic pause?** If your organization uses it and the canvasser was paused for review, start from the pause: its review on the Audit page has **Open these doors in Door Outcomes**, which opens this page already filtered to that canvasser and day, and the review's list of doors shows which ones were too fast. The pause itself removed and held nothing, so there is nothing about it to undo. Clean up here, then **Unpause** them on the review — an org admin can, and so can a team lead on that campaign. More in [A canvasser was paused for review — what do I do?](a-canvasser-was-paused)

**If you want to keep the knock and only fix the label** — the canvasser really was at the door, they just recorded the wrong thing — change the entries to **Not home** instead. That's the lighter tool: the review step still names whose answers are removed (archived the same way), but the visit stays counted, and the doors come back into play with the next round rather than this one.

**Why removing answers can touch more people than matched your filter:** the entry being corrected is the whole visit — one canvasser, one door, one round. If they recorded two people at a door and only one gave the answer you filtered by, Unknock or a change to Not home takes both surveys, and both are named in the review.

**The surveys were real, but one answer is wrong?** Then don't remove anything. Say a canvasser picked *Volunteer Request* every time a voter turned down a yard sign: the visits happened and the other answers are genuine. Select those Surveyed entries and press **Edit answers…** instead. It takes out just the wrong picks, keeps every voter surveyed and moves no knock or billing number, and with an answer filter on, only the surveys that matched it change. Step by step: [A canvasser picked an answer they should have skipped](fix-one-survey-answer).

**Suspect *Not a target voter* entries instead?** That's the optional door button — only on campaigns where an org admin has turned it on — for someone who answers but isn't on the list for that address and won't give a name. With no name, nothing about an entry can be checked, so a canvasser could tap it to cover for not surveying. The **Not target** column in the canvasser tables on Home and Timeline shows each person's share of their doors; one person far above the rest of the crew is the one to look at, though a stale voter file gives an honest crew a high share too. The cleanup is on the same page: filter to that canvasser, a date range and the **Not a target voter** chip, then **Unknock** the entries so they stop counting and billing. If they were real visits with the wrong label, change them instead — to **Not home**, say; that's always priced, because Not a target voter counts as reaching a person, so changing it can move your contact rate — or convert them to **Surveyed** if the answers really were taken (only when you know a voter on the list there really answered: the entry itself said whoever answered wasn't one of them, and the answers you enter go to the voters on file at that address).

**Switched that button off while a canvasser's phone was offline?** The phone keeps the button until it reconnects, and what it records in the meantime still syncs and counts. Filter by that canvasser and the dates since you switched it off, and look for the **Offline** tag beside each entry; **Export CSV** has a matching **Offline** column.
