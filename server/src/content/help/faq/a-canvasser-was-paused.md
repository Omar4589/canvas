---
slug: a-canvasser-was-paused
title: A canvasser was paused for review — what do I do?
audience: lead
kind: faq
order: 78.5
sourceDoc: AUDIT.md
summary: Open the review from the email or the Audit page, talk to the canvasser, have an org admin fix any doors, then unpause — the pause removed nothing.
tags: automatic pause, paused, paused for review, unpause, audit, review, fake, fraud, car, email, alerts, door outcomes
---

If your organization uses **automatic pause**, Doorline pauses a canvasser's recording once their doors stop being physically possible — doors saved from a moving car, or a stack of doors saved at once from one spot. Their phone says *"Recording is paused for review. Call your team lead."*, the people your organization chose get an email, and the doors behind it are laid out for you to review.

**It pauses recording only.** It never deactivates anyone, signs anyone out, removes a door or hides a number. Their doors stay in every count, export, report and invoice until someone changes them.

## How Doorline decides a door was too fast

Each time a canvasser saves a door, Doorline compares it with the last thing they saved **at a different house**: the seconds between the two, and the straight-line distance between the two GPS stamps, allowing for each stamp's GPS accuracy. A door is **too fast** when there wasn't time to get there from the last house — even driving on a neighborhood street — and still knock. A survey needs more time at the door than a Not home. When too many of a canvasser's recent doors that day are too fast, recording pauses.

Everything a canvasser saves at one house close together counts as one visit and is judged once — a second voter surveyed, a changed result, or a Not home followed by a survey when someone finally answers. Saving a door again can't hide it. An honest canvasser who knocks, waits and walks to the next house is far inside the line: the rule catches what can't be done on foot, not someone who was a little quick.

Only Not home, Refused, Surveyed and Not a target voter visits are judged. Wrong address, No soliciting, Restricted access, doors at an apartment or unit address or in a condo complex, and lit drops aren't — the review marks those **Not judged** and says why. And only canvasser accounts are ever paused: an org admin's or a team lead's never is, which is why paper results belong in a lead or admin account ([We canvassed on paper](paper-canvass-and-your-reports)). Everyone's doors, judged or not, still show in the [GPS audit](audit)'s flags as usual.

## The email

Each person chosen gets their own email: **A canvasser was paused for review**. It names the campaign, your organization and when — never the canvasser, and never an address. **Review the pause** opens the review once you sign in, switching you to the right organization if you belong to more than one.

## The review

**On the web**, open the campaign's **Audit** page. A **Paused canvassers** panel at the top lists who is paused; **Review** opens the pause. You'll also see a red badge on **Audit** in the campaign's sidebar and a banner on the campaign home: *A canvasser is paused for review.* The review shows:

- who, when, on which campaign, and whether the email went out;
- a plain sentence saying what kind of fast it was — at **vehicle speed** (the phone moved like a car between doors), **saved from one spot** (usually several doors saved at once), or at **walking pace** (moving on foot, but with too little time at each door);
- the doors behind the pause, the too-fast ones highlighted: the time, the address, the result, the seconds since the last house, the distance, the speed, and the time it needed;
- how far their phone usually was from each house that day — a hint, not a verdict;
- every door they saved that day, marked *Part of the pause*, *Saved after the pause*, *Too fast*, *OK* or *Not judged*;
- **Unpause**, **See the day on the map**, and for org admins **Open these doors in Door Outcomes**.

If some hops are faster than any car could manage, the review says so: two phones may be signed in to one account.

**On the phone**, open Admin → **More → GPS audit**. A **Paused for review** section at the top lists everyone paused across the campaigns you manage, whichever campaign the chip names. Tap one for its summary, **Unpause** and **See their day**. Doors are fixed on the web.

**A team lead sees only their own campaigns' doors.** A door the canvasser saved on another campaign that day shows only as *A door on another campaign*, with its time and whether it was too fast. If one of your canvassers is paused on a campaign you don't manage, you'll see them as *Paused for review — an org admin can unpause*, and nothing more.

## Talk to them, fix the doors, then unpause

1. **Call the canvasser** — they've been told to call their team lead. The plain sentence usually tells you what happened: tapping from the car, saving a batch of doors at the end of the street, or rushing.
2. **Fix any doors that need it.** That's an org admin's job, on the **Door Outcomes** page — the review's **Open these doors in Door Outcomes** button opens it already filtered to that canvasser and day. **Unknock** the fake entries so they stop counting and billing and can be knocked for real this round, or change a result or an answer. Org admins: the *A canvasser faked surveys — how do I get those doors back into play?* article in your Help Center walks through it. Team leads: ask an org admin.
3. **Unpause.** Press **Unpause** on the review — org admins can, and so can the team leads who manage the campaign where the pause happened. Their phone picks it up on its own shortly, or at once when they tap **Check again** on the red notice, and they can record again. Their count starts over, so the doors that caused this pause can't pause them again. Nothing they saved is changed.

An honest mistake? Coach, fix what needs fixing, and unpause. A pause that turns out to be a false alarm can be tidied away once it's resolved: an org admin presses **Delete record** on its review. Deleting it doesn't bring the old count back.

## Who gets the email

By default, your organization's **billing admins** — the org admins with billing access. A billing admin can add others on the **Settings** page in the web console (the last item in the org sidebar), in the **Automatic pause** card: type part of a name under **Add a person** and pick any org admin or team lead. A team lead is only emailed about the campaigns they manage — and a team lead may be your client. **Billing admins (always)** is a choice of its own, so a billing admin added later is included without anyone editing the list. Someone you picked who is no longer an admin or team lead shows as *Not emailed: no longer an admin or team lead*, and saving drops them. The canvasser is never emailed about their own pause. If nobody could be emailed, the review says *The email didn't go out*.

## Turning it off

The setting starts out **On** for every organization; a billing admin can turn it off on the same **Automatic pause** card on the **Settings** page. Turning it off unpauses anyone who is paused, right away; turning it back on starts everyone's count fresh. While the card says *Automatic pause isn't running for your organization right now*, it isn't stopping anyone in your organization from recording.
