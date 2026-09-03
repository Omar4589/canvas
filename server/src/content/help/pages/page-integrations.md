---
slug: page-integrations
title: The Integrations page
audience: admin
kind: page
order: 120
sourceDoc: FBTIME_INTEGRATION.md
summary: What each part of the Integrations page does — the connection bar, the two-sided mapping table, and how to link canvassers to their FbTime person.
tags: integrations, fbtime, page, mapping, linking, hours, measured
---

**Integrations** is in the main sidebar. Only org admins can open it — team leads can't, because a
connection covers the whole organization. Today it holds one integration: **FbTime**, which lets
doors-per-hour divide by hours people were actually clocked in instead of an estimate. For what
that changes in your reports, see [Measured hours from FbTime](fbtime-hours).

## Before you connect

The page shows a single card asking for an FbTime API key. Paste it, press **Test connection**, and
Doorline tells you which FbTime organization the key reads — **check the name is yours** before
confirming. That step exists to catch a key pasted from the wrong account, which would otherwise
show up weeks later as a report full of strangers' hours.

## The connection bar

Once connected, a single line across the top tells you whether it's working right now:

- **Connected** with the time of the last sync — everything is fine.
- **Refreshing** — a re-pull is running.
- **Needs attention** in red — syncing has stopped, with the reason. Replace the key from
  **Settings**.

**Refresh hours** re-pulls the last few months. Use it after fixing a timesheet in FbTime rather
than waiting for the next automatic sync.

**Settings** holds the things you set once: which hours figure divides doors-per-hour (Adjusted
hours is the recommended one — it's what payroll uses), the key you're connected with, an option to
match everyone by email in one go, and **Disconnect**.

## The mapping table

This is the page's real work. Hours only reach your reports for canvassers who are linked to their
FbTime person, so anyone unlinked is a person whose numbers are still estimates.

The table lists **both rosters at once**. A row is one of:

- a **matched pair** — an FbTime person and the Doorline canvasser they're linked to;
- **your person, not in FbTime** — nobody on the clock side to match them to;
- **an FbTime person, not in Doorline** — usually somebody who signed up here with a different
  email address.

Each row shows that person's **campaigns** next to the **FbTime project** they most recently
clocked into. That pairing is the point: if someone's campaign and their clock-in project look
unrelated, it's worth a second look before you link them. Doorline never marks either as wrong —
the two names come from different systems and different people, and "Miami Field Office" may be
exactly how your team refers to "FL-27 GOTV". The project name is **information only; it never
changes a single number**. Hours attach to campaigns from your knock records, not from what
somebody picked in FbTime.

## Finding the person you want

- **Search** matches names, emails and project names on either side.
- **Sort** starts on *needs attention*, so the rows that need doing are at the top and the people
  already set up are at the bottom.
- **Filter** by campaign, or to just the linked or unlinked.
- **Inactive people are hidden by default** — people who left either system. The line above the
  table always says how many are hidden, and **Include inactive** brings them back. Rows that
  matter are never hidden, whatever somebody's status: a linked pair, a broken link, and anyone
  with hours going nowhere always show.

## Linking

Press **Link…** on any row and search for the other half. Each choice shows the person's email and
their campaigns (or their FbTime project), which is how you tell two people with the same name
apart.

When people have the same email address in both systems, Doorline offers them as a list at the top
of the page: **Review matches** shows each pair side by side so you can untick anything that looks
wrong before applying it. You can also tick several rows in the table and link or unlink them
together — unlinking asks first, and says what happens (those people's reports go back to estimated
hours straight away).

## Two rows that mean something is wrong

- **Broken link** — the link points at somebody no longer in your organization, so their clocked
  hours are landing on an account nobody uses. Unlink it.
- **Orphan hours** — hours from somebody no longer on your FbTime roster at all. You can still link
  them to the right canvasser.

## Recent activity

At the bottom, a collapsed list of everything that has happened to this connection — connected,
key replaced, hours figure changed, people linked and unlinked, syncs that failed and recovered.
It only ever gets added to.

See also: [Measured hours from FbTime](fbtime-hours), [Why does doors-per-hour say "estimated"?](why-does-doors-per-hour-say-estimated).
