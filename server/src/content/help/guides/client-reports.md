---
slug: client-reports
title: Client reports and share links
audience: lead
kind: guide
order: 21
sourceDoc: CLIENT_PORTAL.md
summary: Build a report for any period, publish exactly what you previewed, change it later with Edit or Refresh numbers, and send it on a password-protected link.
tags: client reports, share link, client link, publish, refresh numbers, edit, take down, next report, team reports, continue this team, area view, password, expire, logo, history, PDF, map, doors near here, weekly report, walk list, contact breakdown, not a target voter, keep mine, use theirs, changed elsewhere
---

## What a client report is

It's the update you used to put together by hand and email: headline numbers, a voter-contact breakdown, your support and survey breakdowns, your written observations, and a map of where the team has been. You build it for a period, check the preview, and publish it. Your client opens a link, types the password you gave them, and reads every report you've put up for that campaign, newest first. There's no account for them to create.

**A published report is frozen.** The team can keep knocking and late answers can arrive; the report doesn't move. Its numbers change only when you press **Refresh numbers**, and the report then says "Numbers refreshed" with the date. Next week's report simply appears on the same link.

## What your client sees

- **A password screen** that shows nothing about the campaign until the password is right. **Keep me signed in on this device** keeps them signed in for up to 30 days; left unticked, it lasts until the tab closes. Once in, **Sign out on this device** is always there.
- **Your logo** at the top, if you've added one, with a small "Powered by Doorline" at the foot.
- **Tabs** when you have more than one kind of report: Whole campaign, each team, each walk list. Each tab shows its latest report, a small chart of doors knocked in each report, and every report newest first.
- **Each report** reads top to bottom: the headline cards with "+412 this week" (or "+812 in these 14 days" on a two-week report), door-goal progress if you ticked it, the voter-contact breakdown, the support breakdown, voter groups, survey breakdowns, your observations, and the map. It shows when it was published and last edited or refreshed, as dates.
- **Download PDF** gives them the same report as a PDF, with your logo and without the map.

The **voter-contact breakdown** puts every door knocked into exactly one outcome — *Surveyed*, *Declined to participate*, *Didn't answer*, and so on — so it always adds up to Doors knocked. On a campaign that uses the optional **Not a target voter** door button (an org admin has to turn it on), it gains a **Not a target voter** row, explained to your client as: *"Doors where someone answered, but it wasn't one of the voters on our list for that address and they didn't share their details. We reached a person there, just not a voter we could survey."* It appears only in a report that has at least one such door.

The **map** shows only the doors the team reached, colored by how each one went, with **no canvasser names or locations**. Your client can filter it by result and by the questions you put on the map. On a phone it fills the width, moves with two fingers, and shows a tapped door's address and answers below the map. Several doors at one spot, like an apartment building, show their results one by one, never with apartment numbers. A tap that catches several neighbouring spots at once (easy when the map is zoomed out) reads "12 doors near here — zoom in to pick one" instead of calling them one building.

The map keeps up with the report. When your client comes back to the tab, or opens the report again after a minute, and you've refreshed its numbers, switched it between exact doors and areas, or added or taken off a map question, the map reloads with it.

Your client can also use the map **from the keyboard**: Tab to it, move it with the arrow keys and zoom with + and −. A red ring marks the centre; **Enter** shows the doors inside it (or the area under it) and **Escape** closes them again. A screen reader explains this and reads out what was opened.

A report can also carry a short note when it applies: **"Numbers as of Oct 24 — the period was still running"** when you built it before the period ended, and **"Earlier totals were updated by −120 doors since the Oct 13 – Oct 19 report"** when the previous report's totals changed after you sent it (a late knock, an edited answer, a canvasser moved between teams). That line never says why. If you refresh the earlier report's numbers after this one was built, the line disappears rather than compare two different sets of numbers; building this report's numbers again compares afresh.

## Build a report

1. Open the campaign and go to its **Client Reports** tab, then press **New report**.
2. Choose what it **covers**: the **Whole campaign**, **A team**, and optionally **Only one walk list**. A walk list's name shows on your client's report, so a colorful internal name is worth a second look.
3. Pick the **period**. Any run of days works. It suggests the day after your last report of the same kind, for the same length. After a long gap it suggests the same length ending yesterday instead, and says which days no report covers ("Your last Paid team report ended Sep 13. No report covers Sep 14 – Oct 16 — change the dates to cover it."). A period that isn't over yet can be built now and refreshed later.
4. Press **Create draft**. The numbers build in the background ("Building the first numbers…"), and you can leave the page while they do.

In the builder, the left side is your settings and the right side is the **preview, exactly what your client will see**, updated as you go. Changes save on their own.

- **Title** and **Canvasser observations**: sections with a heading and a paragraph each.
- **Survey questions**: one row per question, with a **Chart**, **Map** and **Headline** box. **None** really means none: a question whose chart you hide can't go on the map or be the headline. It can still be hinted at elsewhere: a ticked voter group can count its Yes answers, and a follow-up's chart shows how many people took the path through it. **Before you publish** warns you when a voter group or a follow-up chart hints at a question you've hidden.
- **Voter groups** (your survey tags) are **hidden until you tick them**, so an internal label like "Hostile" can't reach a client's page by accident. A ticked group shows as *Supporter — 400 identified · 380 still current*.
- **Door goal**: tick **Show door-goal progress to the client** to show the campaign's door target as of that period. It's **off unless you tick it**, it shows progress only (no pace, no "behind", no finish date), and it isn't offered on a walk-list or team report.
- **Map**: **Show the map**, then **Exact doors** or **Areas** (see below).

**Follow-up questions go on the map only with the question they follow.** Say "Could we put a yard sign up?" is asked only after a Yes to "Back the recall?". If the yard-sign answers were on the map, anyone could see which homes said Yes to the recall, even with that question hidden. So the builder keeps the follow-up off the map unless "Back the recall?" is on it too, and says why. Usually it's best to leave the follow-up off the map; its chart is still your call.

The header shows **Numbers as of** with a time, and **Recompute** builds the numbers again from today's records. If someone is fixing answers, changing or removing door entries, or re-cutting a round on the campaign, the build waits for them to finish and says so. Changing the map after the numbers were built (turning it on, adding a map question, switching between exact doors and areas) needs a Recompute before you can publish; taking something off never does.

## Before you publish

The builder lists what's worth a look before the report goes out. Nothing here stops you publishing:

- open **mock-location flags** in this report's doors, with a link to review them in the [GPS audit](audit);
- knocks that arrived while the numbers were being built, or numbers more than an hour old (press **Recompute**);
- a period that isn't over yet;
- a follow-up chart, or a voter group, that hints at a question you've hidden;
- answers given under an earlier version of your survey, from before Doorline kept a record of its follow-up questions, when a chart is hidden and the map is on, so you can check your map questions;
- no link your client could open, and how to fix it;
- notes copied from last week that you haven't reviewed;
- an earlier report whose totals changed since you sent it, and why (or, if that report's numbers were refreshed after these were built, that the "earlier totals" line is hidden, with **Recompute** to compare again);
- on a team report, **Door visits this period**: a row for each team, this report's team first, and "Together" when there are two or more; then the door visits in the whole campaign (or the walk list) this period, how many of them more than one team made (they count in each team's report), and how many no team made (canvassers with no crew in a team, or doors entered in bulk); and how many canvassers knocked for the team (it warns when it's one, since the report then shows one person's work);
- how many surveys an admin edited after they were recorded, or entered at the office instead of at a door. They count like any other answer.

None of this is ever shown to your client.

## Publish

Press **Publish…**. The confirm repeats anything important, says "Your client sees exactly the preview", and names the links it will show on. **Publishing freezes exactly what your screen shows, at once.** Pressing it while you're still typing waits for your last change to save. If the report or its numbers changed somewhere else since your screen last read them, nothing is published: the page and the preview update and say why, so you can look again and press Publish once more, with no reload.

**If someone else works on the same report while you have it open**, nothing either of you saves overwrites the other. Every save checks that the report is still the version your screen shows; if it changed elsewhere, the builder merges the two and sends only your changes:

- with nothing of yours unsaved, your screen simply updates and says what changed;
- with your own unsaved changes in other places, both are kept;
- **lists of choices never clash**: which charts, map questions and voter groups show are merged one by one, so a chart someone else hid stays hidden unless you tick that very chart again;
- **observation sections** are matched by their content, so a section either of you added is kept and one you deleted goes;
- when you both changed the same thing (the title, the headline question, the map or its view, the door goal, or the same section), a yellow banner names only that and asks you to choose **Keep mine**, which says exactly what it replaces (for example "their title “Week 3 final”"), or **Use theirs**. Anything else either of you changed is kept;
- if they publish the draft you're editing, your change never goes to your client on its own: it opens as an unsent edit, kept on this device, for you to review and send with **Update report**.

**If you leave the page mid-change**, the last change is still sent on the way out, and a copy is kept on this device first. If it didn't land (say someone changed the report in that moment), the draft offers it back next time: "A change you made didn't save before you left." **Restore it** puts it back on top of whatever the report holds now; **discard it** throws it away. If the report was published meanwhile, it comes back as **Restore your unsent edit** instead.

> Tip: Closing the tab with a change still waiting to save only makes the browser ask first; it doesn't save it. Give it a second, or press **Publish…**, which waits for the save.

When it's published with no link your client can open yet, the builder says "Published — create a link so your client can open it." and takes you to **Client links**.

Then press **Copy the message for your client**: a ready-to-paste message with the report's dates, its headline numbers and a link straight to it. It never includes the password, which you send separately.

## Change a report after it's published

A published report never goes back to being a draft. Instead:

- **Edit** fixes the title, the notes, which charts and voter groups show, and the headline question, and can take questions or the whole map off. Press **Update report**; your client sees it right away, marked "Edited". Update sends only what you changed since you pressed Edit, so a change someone else made meanwhile stays. **The numbers don't change.** Team leads on the campaign can still read the earlier text in History. Turning the map off deletes the frozen map but remembers which map questions you'd picked; bringing it back means refreshing the numbers.
- **Your edit is kept on this device** until you press **Update report** or **Cancel edit**. Leave with it unsent and **Restore your unsent edit** offers it back next time; pressing **Edit** opens it too. **Cancel edit** asks before it throws your changes away.
- **Refresh numbers** rebuilds the report from today's records, for the same dates, and shows you **Now** and **After** side by side. Nothing changes for your client until you press **Apply**; **Discard** throws the new numbers away. It's also how you add to the map: turn it on, add a question, go back to exact doors, or change the area size. **Turning the map back on** offers the map questions the report had picked, already ticked; untick any you don't want, and the review says which questions will be on the map before you apply. Your client sees "Numbers refreshed".
- **Take down** hides the report from your client but keeps it exactly as it was. **Put back up** shows it again, unchanged, with its original publish date.
- **Delete** removes it for good. If your client can still see it, the warning says which links it's on and suggests Take down instead.

> Tip: Fixed a canvasser's wrong survey answers after a report went out? The published report keeps the old answers until you open it and press **Refresh numbers**, then **Apply**.

**Worth a look.** Once a report is published, a small **Worth a look** box keeps the checks that can still matter: a map question that shows no answers by area, answers from an older version of your survey, and an earlier report whose numbers were refreshed after this one was built (with **Refresh numbers** to compare again). It appears only when one applies, and your client never sees it.

## Next report

On the newest report of each tab, **Next report** makes the next draft in one click: the same number of days, starting the day after the last one ended. It copies your notes (marked as copied until you tick **I've reviewed the copied notes**), your question choices, the map, your voter groups and the goal tick, and starts building the numbers right away.

## Team reports

If your client wants separate reports for a volunteer team and a paid team, make a **team**: a name your client sees plus one or more crews. "Paid team" can be Sam's crew and Dee's crew together. Each crew can be in only one team, and canvassers with no crew lead aren't in any team's report.

- **A team name can't include a canvasser's name**, because your client reads it. A walk list that happens to share a name with one ("Marco Island") gets a warning you can confirm.
- **Each team report counts that team's own work.** A home both teams visited counts in each team's report, and the report says so, so team reports don't add up to the whole campaign. Team reports never show a door goal.
- **Edit team** renames a team, changes its crews, or ends it. Its published reports stay exactly as they were sent. Ending it can also delete its open drafts; only reports that are still drafts go, and each one is recorded in History.
- **Continue this team** brings an ended team back: its tab offers it instead of Edit team. Pick the crews it covers from now on (a crew you leave unticked leaves the team); its published reports stay exactly as they were sent. Picking an ended team in **New report** offers **Continue the team** first, and afterwards New report reopens on that team with your dates and title kept.

If a crew lead leaves the campaign, the team's next draft stops and asks what to do. By default her crew's past doors **stay in the team** while those canvassers have no crew; you can also remove them (the card says how many doors the team's totals would drop, up to the end of that report), change the team's crews, or end the team. Moving one of those canvassers onto another crew moves their past doors with them, and on the web the confirm that moves them names the client report whose numbers change (the phone doesn't show that line yet).

## Exact doors or areas

**Exact doors** shows each home your team reached, with its street address when tapped. **Areas** shows shaded hexagons instead, small (about 1,100–1,400 ft across) or large (about 0.55–0.7 mi across), each with how many doors were reached and how they went. **Areas never show an address.**

In area view, a single-choice question shows its answers area by area only when **every** area has at least five answers to it; otherwise your client sees just that question's overall chart. Large areas usually fix that. Even so, an area where every home gave the same answer tells your client how each of them answered, and other reports on the same link can narrow things down. The hexagons are see-through so the streets show, and the legend's colours match them as they look on the map.

On a published report, **Switch to areas** is part of Edit: your client keeps seeing exact doors until the areas are ready. Its confirm names any map question that may end up with no answers by area, and once the areas are up, **Worth a look** says which ones did. Going back to exact doors means refreshing the numbers.

## Client links

On the **Client Reports** tab, the **Client links** panel holds the campaign's links. Each link opens every report you've put up.

- **+ New link**: give it a label only you see, pick how long it lasts (30, 90, 180 or 365 days), and either let the app **generate a strong password** or set your own of **at least 12 characters**. The password is shown **once**, so copy it then.
- Send the link and the password **separately**. The **Copy message** button gives you the link with a note that the password follows.
- **Extend** a link before it expires, up to a year from when it was made. An **expired** link is **Renewed**: it gets a **new address**, and you send your client the new link.
- **Change password**, **Rotate** (a new address, same password), **Renew** and **Disable** all sign everyone out, so your client has to sign in again. A password can be changed but never removed.
- You can keep more than one link (say one for the candidate and one for a consultant), each with its own password.

**Wrong passwords.** The panel shows a link's wrong passwords for the last day, the week and in total, whenever there are any, even on a locked or expired link. No link accepts more than **50 wrong passwords in any 24 hours**: at 50 it locks, though anyone already signed in keeps reading. Fifty wrong passwords is never your client, so the panel suggests **Rotate**. **Unlock now** lets the right password work again straight away.

A link made before passwords were required may show **No password** or **Never expires**; adding a password fixes both. An older link whose password turns out to be shorter than 12 characters is flagged so you can change it.

## Who opened it

Each published report's row says how often it was opened, for example "Opened via Candidate: about 2 visits". A visit is counted once per browser per day, so treat it as an estimate. Visits by people signed in to your organization are listed separately, so checking your own work doesn't inflate your client's number. **Last opened** on a link is the last time someone signed in to it opened it.

## Your logo

An org admin can put your organization's logo on every client report and PDF from the **Report branding** card: **Upload** takes any common image, and the app turns it into a clean, small picture first. Removing it removes it from every campaign's reports. Team leads see the logo but can't change it.

## History

**History** on the Client Reports tab lists every publish, edit, refresh, take-down and delete, every team change, and every link change, with who did it and when. Each row names its report's tab or its team, so "Oct 12 – Oct 18, 2026 · Paid team report · Published" and "Volunteer team · Team continued" read apart from the rest. It doesn't appear in the campaign's general History or in the phone app. Team leads on the campaign can read it, including the earlier text of edits, and can **Restore** an earlier text. An org admin can **Erase** that text for good.

For where the numbers come from, see [Understanding the numbers](metrics) and [surveys](surveys). For a quick tour of the tab, see [the Client Reports page](page-client-reports).
