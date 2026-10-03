---
slug: low-connection-rate
title: Our canvassers are talking to people — why is the connection rate low?
audience: lead
kind: faq
order: 34
sourceDoc: METRICS.md
summary: Connection rate is survey doors ÷ doors knocked, so talking to people who aren't the voters on your list doesn't lift it. With Not a target voter turned on, those conversations show on the client report and in Contact % — the connection rate itself doesn't change.
tags: connection rate, low, survey rate, contact rate, not a target voter, voter file, out of date, moved, client report, conversations
---

Because the connection rate only counts **surveys**. It's **survey doors ÷ doors knocked** — of the doors your crew knocked, the share where at least one survey was taken. A conversation that doesn't end in a survey counts in the bottom number like any other knock, however long it was.

A common reason a crew talks to plenty of people and still surveys few is an **out-of-date voter file**. People move and households change, so whoever opens the door often isn't one of the voters listed at that address — and a canvasser can survey only the voters on the list, or someone added at the door.

## When the person isn't on the list

- **They give their name** — they can be added to that address with **＋ Add person** and surveyed like anyone else, and that survey counts toward the connection rate. See [Someone answered who isn't on my list — can I add them?](add-a-person-at-the-door).
- **They won't give a name** — that's what **Not a target voter** is for. It's an optional door button on survey campaigns, off on every campaign until an org admin turns it on: no name is taken, so an entry can't be checked, and it's meant for crews you trust. On the campaign's **App Customization** page a team lead can see whether it's on, but only an org admin can switch it. (No *Off until you turn it on* section there means it isn't available on that campaign yet.)

## What changes when Not a target voter is on

- **The client sees why.** The client report's voter-contact breakdown gains a **Not a target voter** row beside *Declined to participate* and *Didn't answer*: "Doors where someone answered, but it wasn't one of the voters on our list for that address and they didn't share their details. We reached a person there, just not a voter we could survey." It appears only in a report that has at least one such door. See [Client reports and share links](client-reports).
- **Contact % counts those conversations.** They count as reaching a person, like a refusal, so they show up in each canvasser's **Contact %** on Home and the Timeline.
- **The connection rate doesn't move.** A door where your canvasser spoke to someone who isn't on the list was always a knocked door with no survey. Recording it as Not a target voter instead of Not home or Refused leaves the connection rate exactly where it was — what changes is that you can now show the reason.
- **You can watch it per canvasser.** The canvasser tables on Home and the Timeline gain a **Not target** column — each person's count and the share of their doors. There's no automatic flag, because a stale voter file honestly produces a high share; one canvasser far above the rest of the crew is still worth a look.

Turning it on changes what canvassers can record from then on — doors already recorded keep their result.

See [Understanding the numbers](metrics) for how each rate is counted.
