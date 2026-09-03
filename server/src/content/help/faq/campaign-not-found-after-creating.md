---
slug: campaign-not-found-after-creating
title: I created a campaign and it said "Campaign not found"
audience: lead
kind: faq
order: 67
sourceDoc: CAMPAIGNS.md
summary: A brief flash right after creating was a display bug, fixed 2026-09 — you now get a grey loading placeholder; a "Campaign not found" that stays put means something else.
tags: campaign, not found, create, loading, error
---

**Your campaign was created.** If you saw *"Campaign not found"* flash for a moment right after clicking **Create campaign**, and then the dashboard and its **Setup progress** card appeared normally, nothing went wrong — that was a display bug, and it's **fixed as of September 2026**.

What was happening: creating a campaign opens it for you immediately, and for a split second the page was still working from the campaign list it had loaded a moment earlier — a list written before your new campaign existed. Not finding it there, the page said so. It was asking the wrong question, not reporting a real problem.

Now that moment shows a plain grey **loading placeholder** instead, and the wording is reserved for what it actually means.

## If "Campaign not found" stays on screen

Then the campaign genuinely isn't available to you, and it's one of these:

- **It was deleted**, or is still being deleted (the Campaigns page shows a **Deleting…** badge while that finishes).
- **It belongs to another organization.** If you work in more than one, check the organization you're in — a link or bookmark to a campaign in Org A won't open while you're in Org B. See [Why can't I see my other organization?](why-cant-i-see-my-other-org).
- **You're a team lead and this campaign isn't one of yours.** Leads only see the campaigns they've been given. Ask an admin to add you — see [Team lead vs. admin](team-lead-vs-admin).
- **The link is mistyped**, or it's an old bookmark from before a campaign was removed.

Use **Go to Campaigns** (or **Go to Overview**) on that screen to get back to the list of campaigns you can open.
