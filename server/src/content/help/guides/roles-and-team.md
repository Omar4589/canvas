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

- **Admin** — runs the whole organization: every campaign, all org settings, the org-wide voter directory, surveys, tags, and users.
- **Team lead** — a campaign-scoped admin. Runs only the specific campaigns you grant them, and nothing outside them.
- **Canvasser** — walks doors in the mobile app for the campaigns they're on. No console access.

A **super admin** sits above every organization for oversight and help — that's the platform's support team, not someone in your org.

## Signing in when you belong to more than one organization

One account, one email — but a **separate role in each organization**. Someone can be an admin in one org and a canvasser in another, and where they land depends on which surface they sign in to:

- **The web console** shows only the organizations where they're an **admin or team lead**. An org where they're a canvasser appears on the org picker greyed out under **No console access** — the work for it lives in the mobile app.
- **If there's only one org they can run from the console, sign-in takes them straight into it** — no picker.
- **The mobile app** shows *all* their organizations, because every role has a home there.

Switching organizations in the console always lands on the new org's home page — Overview for an admin; for a team lead, their campaign if they run just one active campaign there, otherwise Campaigns. Each browser tab keeps its own organization: switching in one tab doesn't move your other open tabs.

## What a team lead can do

A team lead doesn't have to be someone from your own organization. If you run a canvassing operation hired by campaigns, the lead you grant might be **the client's own campaign manager** — which is exactly why the role is walled the way it is: a lead works inside the campaigns you grant them. Their **survey library** works the same way: it shows only surveys they authored or ones already attached to their campaigns — never another campaign's scripts, names, or numbers. Two things about a survey in that library do reach them, each a plain yes or no, never which campaign or how many: whether a campaign they don't manage has it attached (an archived one counts), and — for a survey on one of their campaigns — whether it already has answers anywhere in your organization. The second decides whether its answer types and Go to are locked; the save would refuse those changes anyway.

Inside a campaign you grant them, a team lead is as powerful as an admin: import the voter file, build and attach a survey (leads author their own templates, from their own library), build [walk lists](walk-lists), cut [turf and books](turf-and-books), run [passes](passes), [assign canvassers](assigning-canvassers) — including putting *themselves* on a book, so a lead who also walks doesn't have to ask you for one (taking a book puts them on the team, which counts as coming back: any earlier doors they have there move to No team until their crew is set) — build the crew (including creating new canvasser accounts), print walk packets, export the campaign's data, and see all the reporting.

What they *can't* do: create, archive, or delete a campaign; archive or delete survey templates, or touch the **tag library** (leads build and edit surveys for the campaigns they manage, and can read tags); flag voters **do-not-contact** (that reaches every campaign at once, so it stays with you); turn **Not a target voter** on or off (the optional door button for someone who answers but isn't on the voter list for that address and won't give a name — with no name, an entry can't be checked, so it starts off on every campaign, and once you turn it on, anyone they add to the crew gets the button too); or touch org settings or the org-wide voter directory — inside a campaign they manage, the campaign's own **Voters** tab is theirs, as read-only profiles (this campaign's answers and notes, contact details, the do-not-contact reason) plus the ability to add a note. They also can't change anyone's role, grant the lead role, or see any campaign you didn't hand them (one exception: when they switch a canvasser off, the warning names that canvasser's other campaigns, because switching off reaches all of them) — and while they can fix a **canvasser's** name, email, or phone, or take a canvasser off their campaign, admins and fellow leads are out of their reach: a lead can't set their password, edit their details, switch them off, or take them off a campaign. A lead with no grants sees an empty console.

They build their crew from their campaign's own **Team** tab instead — and that isn't a lesser version of the org Users page. A crew belongs to a campaign, so the Team tab is where *everyone* sets one, admins included. Clicking a person there opens the same panel the Users page uses, with the login fixes a lead is allowed for canvassers right at the top.

## Granting a team lead

1. Open the **Users** page (admins only).
2. Add or edit the person and set their role to **Team lead**.
3. Check the campaigns they should manage, then save.

You can change the checked campaigns anytime — unchecking one revokes it right away. A brand-new campaign has no lead until you grant one.

**Their Team page is the campaign's, not the organization's.** A lead sees the people on the campaign you granted them — not your whole roster — and adds someone by typing an **email address**, which either finds the colleague it belongs to or creates a new account. You keep the searchable directory of everyone in the organization on that same page; they don't. So if you want a lead to be able to pull from a pool of your existing canvassers, either add those people to the campaign yourself or make sure the lead has their addresses.

**Surveys at handoff — two habits that save headaches later.** A lead's library is only what they authored or what's already on their campaigns, and *attaching is what grants access*. So: **attach the house survey before you hand the campaign off** — if the lead later swaps it out, it leaves their library and you'll need to re-attach it for them. And if one template serves several campaigns, **duplicate a per-campaign copy first** — otherwise a lead editing "their" survey is editing every campaign's, and while the builder warns them, a separate copy removes the risk entirely.

> Tip: A lead who also walks doors is added to a campaign's roster like any [canvasser](add-a-canvasser-account) — managing and walking are separate.

## Where a team lead works

- **In the console**, they sign in the same way you do. With one active campaign they land straight in it; otherwise on **Campaigns**, showing only the campaigns they manage. **‹ Campaigns** at the top of the sidebar always opens their list. Inside a campaign, every tab you see is there. The org-only areas — Overview, Surveys, Tags, the org-wide Voters directory, Users — simply aren't in their nav; the campaign **Voters** tab is.
- **In the mobile app**, they get the same admin view, scoped to their campaigns (with one active campaign, **Overview** is that campaign's screen) — and **More → Users** is one shared surface: a lead sees it too, filtered to the people on *their* campaigns, never the whole organization. There they create canvassers, set temporary passwords, switch canvasser accounts off and on, edit a canvasser's name, email, or phone, and (with an app update) take canvassers and themselves off a campaign; roles and account deletion stay with you. A campaign's **Team** tile opens that same Users view pre-filtered to the campaign.

## Coordinators and crews

Within a campaign, you (or a lead) build the **crew** — the canvassers on that campaign. You can mark trusted members as **coordinators** to help lead a crew. See [assigning canvassers](assigning-canvassers) and, for leads, [getting started as a team lead](lead-getting-started).

**Crews belong to a campaign, not to your organization.** The same canvasser can be on one coordinator's crew in one campaign and a different coordinator's crew in another, so a crew is always set on the campaign itself: its **Team** tab in the console, or **Users** on that campaign in the mobile app (the campaign's **Team** tile opens it). The org **Users** page doesn't set crews — open a member there and, under **Everywhere in your organization**, you'll see their crews listed, one row per campaign they're on, each row linking straight to that campaign's Team tab with them open.

A canvasser's doors count toward whoever their coordinator is **right now on that campaign**, so changing someone's crew moves the doors they already knocked *in that campaign* onto the new one — which is how you fix a crew you forgot to set at the start. Someone who comes back to a campaign works the same way: their earlier doors there move to the crew they rejoin, or to No team if none is picked, whatever their role. Their work on your other campaigns isn't touched. See [I moved someone to another team](move-a-canvasser-to-another-team).

One thing that follows: running a crew is per campaign too. Someone who coordinates a crew on one campaign but knocks doors on another *without* a crew there lands in that second campaign's "No team" bucket — they show up as their own team only where they actually run one.
