---
slug: page-integrations
title: The Integrations page
audience: admin
kind: page
order: 120
sourceDoc: FBTIME_INTEGRATION.md
summary: What each part of the Integrations page does — the connection bar, the door-count card, the two-sided mapping table, and how to link and unlink canvassers and their FbTime person.
tags: integrations, fbtime, page, mapping, linking, unlinking, hours, measured, door counts, replace key, sync now
---

**Integrations** is in the main sidebar. Only org admins can open it — team leads can't, because a
connection covers the whole organization. Today it holds one integration: **FbTime**, which lets
doors-per-hour divide by hours people were actually clocked in instead of an estimate — and, where
it's available, sends each canvasser's doors per day back to FbTime. For what that changes in your
reports, see [FbTime: measured hours and door counts](fbtime-hours).

## Before you connect

The page shows a single card asking for an FbTime API key. Paste it, press **Test connection**, and
Doorline tells you which FbTime organization the key reads — **check the name is yours** before
confirming. That step exists to catch a key pasted from the wrong account, which would otherwise
show up weeks later as a report full of strangers' hours.

## The connection bar

Once connected, a single line across the top tells you whether it's working right now:

- **Connected** with the time of the last sync — everything is fine.
- **Refreshing** — a re-pull is running.
- **Needs attention** in red — syncing has stopped, with the reason. Replace the key from **Settings**.

**Refresh hours** re-pulls the last few months. Use it after fixing a timesheet in FbTime rather than waiting for the next automatic sync. While door counts to FbTime are on, the same button reads **Sync now**, and it re-sends door counts as well.

**Settings** holds the things you set once: which hours figure divides doors-per-hour (Adjusted
hours is the recommended one — it's what payroll uses), the key you're connected with, an option to
match everyone by email in one go, and **Disconnect**.

- **Replace key** swaps the key: paste the new one, press **Test**, check the FbTime organization's name is yours, then **Use this key**. Hours keep flowing and your links are kept. A key that reads a *different* FbTime organization asks first — door counts would be turned off, and your links probably won't match its people.
- **Disconnect** puts your reports back on estimated hours and turns door counts off; your links are kept for a reconnect. If Doorline is still clearing door counts it sent, it asks first, because disconnecting abandons the clear.

## The Door counts to FbTime card

If you don't see a **Door counts to FbTime** card under the connection bar, it isn't available to your organization yet. Where it is, it sends each linked canvasser's doors per day to FbTime's doors-per-hour page — see [FbTime: measured hours and door counts](fbtime-hours) for exactly what's sent and how to turn it on.

The card shows one state:

- **Off** — not sending. **Turn on…** starts it. If something is missing, a hint says what instead: your key reads hours only, another Doorline organization already sends door counts to this FbTime organization, or (after door counts were on) your door-count key still exists in FbTime. When Doorline has sent numbers and can still remove them, **Clear the numbers Doorline sent…** is here too.
- **Starting** — turned on; the first send hasn't finished yet.
- **Sending** — working: when it last sent, and for how many people ("nobody is linked yet" when nobody is).
- **Clearing** — removing numbers you asked Doorline to clear. **Cancel** stops it.
- **Needs attention** — on, but something you can fix is stopping it: another Doorline organization sends to this FbTime organization; the key lost its permission to fill in door counts (**Replace key** with one that can); a campaign has a time zone Doorline can't use (choose that campaign's time zone again from the list in its **Edit** drawer); FbTime refused a send; or sends have kept failing for about two hours (if that doesn't clear on its own, contact Doorline support).
- **Paused** — on, but waiting on something else: the FbTime connection needs attention (the connection bar says why), Doorline has paused door counts for everyone, or FbTime needs updating.

Under the state, the card can also tell you:

- how many numbers people had typed on FbTime have been replaced by Doorline's since door counts were turned on (a typed number that already matched Doorline's isn't counted);
- that some linked people aren't in your FbTime organization — they show as **Broken link** rows in the table;
- that a day was too big for FbTime — over 2,000 doors for one person — and wasn't sent;
- that a clear is waiting and can't run yet, and why, with **Cancel**.

**Turn off…** stops sending. Tick **Also clear the numbers Doorline sent** to take them off FbTime in the same step — numbers people had typed there come back, and the rest go blank. Without it, the days Doorline sent keep its numbers.

## The mapping table

This is the page's real work. Hours only reach your reports for canvassers who are linked to their
FbTime person, so anyone unlinked is a person whose numbers are still estimates.

The table lists **both rosters at once**. A row is one of:

- a **matched pair** — an FbTime person and the Doorline canvasser they're linked to;
- **your person, not in FbTime** — nobody on the clock side to match them to;
- **an FbTime person, not in Doorline** — usually somebody who signed up here with a different email address.

Each row shows that person's **campaigns** next to the **FbTime project** they most recently
clocked into. That pairing is the point: if someone's campaign and their clock-in project look
unrelated, it's worth a second look before you link them. Doorline never marks either as wrong —
the two names come from different systems and different people, and "Miami Field Office" may be
exactly how your team refers to "FL-27 GOTV". The project name is **information only; it never
changes a single number**. Hours attach to campaigns from your knock records, not from what
somebody picked in FbTime.

## Finding the person you want

- **Search** matches names, emails and project names on either side.
- **Sort** starts on *needs attention*, so the rows that need doing are at the top and the people already set up are at the bottom.
- **Filter** by campaign, or to just the linked or unlinked.
- **Inactive people are hidden by default** — people who left either system. The line above the table always says how many are hidden, and **Include inactive** brings them back. Rows that matter are never hidden, whatever somebody's status: a linked pair, a broken link, and anyone with hours going nowhere always show.

## Linking

Press **Link…** on any row and search for the other half. Each choice shows the person's email and
their campaigns (or their FbTime project), which is how you tell two people with the same name
apart.

When people have the same email address in both systems, Doorline offers them as a list at the top
of the page: **Review matches** shows each pair side by side so you can untick anything that looks
wrong before applying it. You can also tick several rows in the table and link or unlink them
together.

A canvasser who's already linked can't be moved straight to a different FbTime person — unlink them first, then link.

## Unlinking

Unlinking one person happens straight away, with **Undo** in the banner; unlinking several at once asks first. Either way their reports go back to estimated hours straight away.

When someone you're unlinking **deleted their account**, or Doorline has **sent door counts** for them, Unlink always asks first — **Was the link right?**:

- **Yes — keep** — they left, or they'll come back with a new account. The old account keeps counting for that FbTime person: its past hours stay measured, and — with door counts — what Doorline sent stays, and corrections stop reaching FbTime for them.
- **No — the link was wrong** — Doorline clears every number it sent to FbTime for that person, brings back numbers someone had typed there, and won't suggest that pair again.

After an unlink, **Undo** cancels a clear that hasn't run yet. A deleted account, or a member who left your organization, can't be linked again once unlinked.

## Earlier accounts, and clearing one person

- **also counts** — an FbTime person's row names an earlier account you kept for them with **Yes — keep** (someone who deleted their account and came back with a new one). **Stop counting** removes it if that was a mistake: the earlier account's hours go back to the current link, so its past rates become estimated, and door counts are re-sent without it. For a deleted account that can't be undone.
- **Clear the numbers Doorline sent for …** — on the row of an FbTime person who is no longer linked but whose numbers Doorline sent. It takes those numbers off FbTime and brings back anything typed there.

## Two rows that mean something is wrong

- **Broken link** — the link points at somebody who left your organization, or at somebody who's no longer in FbTime. A row for someone who **left your organization** is usually best left alone: the link is what keeps their past hours their own, and once unlinked they can't be linked again. A row for someone **no longer in FbTime** can be unlinked.
- **Orphan hours** — hours from somebody no longer on your FbTime roster at all. You can still link them to the right canvasser.

## Recent activity

At the bottom, a collapsed list of everything that has happened to this connection — connected,
key replaced, hours figure changed, people linked and unlinked, earlier accounts kept and no longer
counted, syncs that failed and recovered, and, with door counts, door counts turned on and off,
clears, and sends that started failing and recovered. Each row says who did it, or that it happened
automatically. It only ever gets added to.

See also: [FbTime: measured hours and door counts](fbtime-hours), [Why can't I change a door count on FbTime?](fbtime-door-counts), [Why does doors-per-hour say "estimated"?](why-does-doors-per-hour-say-estimated).
