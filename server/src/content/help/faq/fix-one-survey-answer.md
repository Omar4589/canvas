---
slug: fix-one-survey-answer
title: A canvasser picked an answer they should have skipped. Can I remove just that answer?
audience: admin
kind: faq
order: 65
sourceDoc: CAMPAIGNS.md
summary: Yes — filter Door Outcomes to that canvasser and the wrong answer, then Edit answers… takes out just those picks, keeps every voter surveyed, and can be undone.
tags: survey, answers, edit answers, take out, wrong answer, skip, skipped question, yard sign, volunteer, door outcomes, corrections, undo, earlier answers
---

Yes. **Edit answers…** on the **[Door Outcomes page](page-door-outcomes)** (org admins only) changes just the answers you pick. The knock, the Surveyed status, the note and every other answer stay as recorded — except a later answer your change would leave no longer asked, which goes too and is listed in the review — so no door, knock or billing number moves and every voter stays surveyed.

The usual case: question 3 of your survey is *Could you help us by taking a yard sign?*, asked only after a Support answer, and canvassers can pick several answers — *Yard Sign Delivered*, *Candidate Follow-Up*, *Volunteer Request*. One canvasser didn't know a question can be skipped, so when voters said no to a sign they picked *Volunteer Request* or *Candidate Follow-Up* instead. Those picks are wrong; their *Yard Sign Delivered* picks, and every other answer on those surveys, are real.

1. **Check the numbers in the [Survey Explorer](page-survey-explorer), and save the lists.** It opens on *Today*, so set the dates to **All time** first — or, if some of their later picks are real, choose **Custom**, leave *From* blank and set *To* to the last wrong day (the **Last entry** column under **By canvasser** shows when they last picked each answer). Pick the yard-sign question, click **Volunteer Request**, then **By canvasser**, and click their row so it stays selected. **Export CSV** now gives you the list to send your volunteer coordinator, so they know who to drop. Then click **Candidate Follow-Up** and export again for your follow-up team.
2. **Press Correct in Door Outcomes.** The page opens with that canvasser, your dates and *Candidate Follow-Up* already set.
3. **Add the other wrong answer.** In the **Survey answers** filter, under the yard-sign question, tick **Volunteer Request** as well — *Candidate Follow-Up* is already ticked, and clicking it again would untick it. Two ticks on one question mean "either". A row where someone else was surveyed at the same visit reads *1 other surveyed at this visit, not matched*; that person is left as they are.
4. **Select them all.** Tick the box at the top of the table (and **Select all N matching**, if the entries run past one page), then press **Edit answers…** — not *Review removal*, which takes every answer and turns the doors to Not home.
5. **Take out just those two picks.** Under the yard-sign question, press **Take out just Candidate Follow-Up and Volunteer Request**, and leave every other question on **Leave as recorded**. A survey left with no picks reads exactly as if the question was skipped; one that also had *Yard Sign Delivered* keeps it.
6. **Press Review changes.** It opens with *No door, knock or billing number changes*, then how many surveys lose which pick, your campaign's results for that question before → after, and the name of everyone whose survey changes.
7. **Press Change N surveys** (the red button). The change runs in the background with a progress card, then shows under **Survey answer changes** — *Answers edited · Could you help us by taking a yard sign?: took out Candidate Follow-Up, Volunteer Request* — with **Details** and **Undo**.
8. **Check it.** In the Survey Explorer, that canvasser no longer appears under *Volunteer Request* or *Candidate Follow-Up* for those dates, and their *Yard Sign Delivered* count hasn't moved.

**Every one of their picks wrong?** Leave the dates off — choosing the canvasser is enough. **A pick-one question?** Step 5 offers **Clear the answer** instead, and with your answer filter on it clears only their wrong answers, because only those surveys matched. **Each survey needs a different fix?** Choose **One person at a time** in the form and go survey by survey.

**Changed your mind?** **Undo** on its row puts every survey back. A survey someone re-surveyed or edited since keeps the newer answers: the row names it, and the answers your change replaced stay on that voter's profile under **Earlier answers**, where you can restore them.

**Lists made before the change don't update.** Saved searches, walk lists and rounds already cut, files already exported, and a published client report (until you publish it again) keep what they had. The CSVs from step 1 are how you tell whoever holds those lists who to drop.

If the surveys themselves were fake, not just one answer, see [A canvasser faked surveys — how do I get those doors back into play?](faked-surveys-cleanup)
