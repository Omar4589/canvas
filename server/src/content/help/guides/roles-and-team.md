---
slug: roles-and-team
title: User roles and your team
audience: admin
kind: guide
order: 17
sourceDoc: ROLES.md
summary: The admin, team lead, and canvasser roles, plus how to grant and scope a team lead.
tags: roles, team lead, permissions, canvasser, admin, coordinator
---

## The three roles

Everyone on your organization has one of three roles, and there's a platform-wide super admin above all of it.

- **Admin** — runs the whole organization: every campaign, all org settings, the voter directory, surveys, tags, and users.
- **Team lead** — a campaign-scoped admin. Runs only the specific campaigns you grant them, and nothing outside them.
- **Canvasser** — walks doors in the mobile app for the campaigns they're on. No console access.

A **super admin** sits above every organization for oversight and help — that's the platform's support team, not someone in your org.

## Signing in when you belong to more than one organization

One account, one email — but a **separate role in each organization**. Someone can be an admin in one org and a canvasser in another, and where they land depends on which surface they sign in to:

- **The web console** shows only the organizations where they're an **admin or team lead**. An org where they're a canvasser appears on the org picker greyed out under **No console access** — the work for it lives in the mobile app.
- **If there's only one org they can run from the console, sign-in takes them straight into it** — no picker.
- **The mobile app** shows *all* their organizations, because every role has a home there.

Switching organizations in the console always lands on the new org's home page — Overview for an admin, Campaigns for a team lead.

## What a team lead can do

A team lead doesn't have to be someone from your own organization. If you run a canvassing operation hired by campaigns, the lead you grant might be **the client's own campaign manager** — which is exactly why the role is walled the way it is: a lead sees their campaigns and nothing else. Their **survey library** works the same way: it shows only surveys they authored or ones already attached to their campaigns — never another campaign's scripts, names, or numbers.

Inside a campaign you grant them, a team lead is as powerful as an admin: import the voter file, build and attach a survey (leads author their own templates, from their own library), build [walk lists](walk-lists), cut [turf and books](turf-and-books), run [passes](passes), [assign canvassers](assigning-canvassers) — including putting *themselves* on a book, so a lead who also walks doesn't have to ask you for one — build the crew (including creating new canvasser accounts), print walk packets, export the campaign's data, and see all the reporting.

What they *can't* do: create, archive, or delete a campaign; archive or delete survey templates, or touch the **tag library** (leads build and edit surveys for the campaigns they manage, and can read tags); flag voters **do-not-contact** (that reaches every campaign at once, so it stays with you); or touch org settings or the voter directory. They also can't change anyone's role or identity, grant the lead role, or see any campaign you didn't hand them. A lead with no grants sees an empty console.

They build their crew from their campaign's own **Team** tab instead — and that isn't a lesser version of the org Users page. A crew belongs to a campaign, so the Team tab is where *everyone* sets one, admins included.

## Granting a team lead

1. Open the **Users** page (admins only).
2. Add or edit the person and set their role to **Team lead**.
3. Check the campaigns they should manage, then save.

You can change the checked campaigns anytime — unchecking one revokes it right away. A brand-new campaign has no lead until you grant one.

**Surveys at handoff — two habits that save headaches later.** A lead's library is only what they authored or what's already on their campaigns, and *attaching is what grants access*. So: **attach the house survey before you hand the campaign off** — if the lead later swaps it out, it leaves their library and you'll need to re-attach it for them. And if one template serves several campaigns, **duplicate a per-campaign copy first** — otherwise a lead editing "their" survey is editing every campaign's, and while the builder warns them, a separate copy removes the risk entirely.

> Tip: A lead who also walks doors is added to a campaign's roster like any [canvasser](add-a-canvasser-account) — managing and walking are separate.

## Where a team lead works

- **In the console**, they sign in the same way you do and land on **Campaigns**, showing only the campaigns they manage. Inside a campaign, every tab you see is there. The org-only areas — Overview, Surveys, Tags, Voters, Users — simply aren't in their nav.
- **In the mobile app**, they get the same admin view, scoped to their campaigns — and **More → Users** is one shared surface: a lead sees it too, filtered to the people on *their* campaigns, never the whole organization. There they create canvassers, set temporary passwords, and switch canvasser accounts off and on; roles, identity edits, and account deletion stay with you. A campaign's **Team** tile opens that same Users view pre-filtered to the campaign.

## Coordinators and crews

Within a campaign, you (or a lead) build the **crew** — the canvassers on that campaign. You can mark trusted members as **coordinators** to help lead a crew. See [assigning canvassers](assigning-canvassers) and, for leads, [getting started as a team lead](lead-getting-started).

**Crews belong to a campaign, not to your organization.** The same canvasser can be on one coordinator's crew in one campaign and a different coordinator's crew in another, so there's exactly one place to set a crew: that campaign's **Team** tab in the console, or the campaign's **Team** screen in the mobile app. The org **Users** page doesn't set crews any more — open a member there and you'll see their crews listed, one row per campaign they're on, each row linking straight to that campaign's Team tab.

A canvasser's doors count toward whoever their coordinator is **right now on that campaign**, so changing someone's crew moves the doors they already knocked *in that campaign* onto the new one — which is how you fix a crew you forgot to set at the start. Their work on your other campaigns isn't touched. See [I moved someone to another team](move-a-canvasser-to-another-team).

One thing that follows: running a crew is per campaign too. Someone who coordinates a crew on one campaign but knocks doors on another *without* a crew there lands in that second campaign's "No team" bucket — they show up as their own team only where they actually run one.
