---
slug: do-not-contact
title: Honoring "don't contact me again"
audience: admin
kind: guide
order: 21
sourceDoc: VOTERS.md
summary: Mark a voter Do not contact — they drop out of walk lists, exports, and surveys everywhere, and a fully-flagged door leaves the map.
tags: do not contact, dnc, opt out, privacy, remove, skip, complaint
---

## When someone asks to be left alone

Sometimes a person tells a canvasser — or calls the campaign — that they never want to be contacted
again. **Do not contact** is how you honor that, permanently.

> **Asking about the *house*, not the person?** If a resident says "never come to this door again",
> that's **[Do not knock](do-not-knock)** — it suppresses the whole address, including the
> housemates, which Do not contact deliberately does not.

The flag lives on the **person**, not the campaign: set it once and it follows them into every
future campaign your organization runs, on every campaign type — literature drops included.

## Marking one voter

Open the voter in **Voters** and use the **Do not contact** section on their profile. A written
reason is required — it becomes part of the voter's notes, so anyone looking later can see who set
it, when, and why. Removing the flag works the same way and is also recorded.

## Uploading a whole list

Have a suppression list from a client or a prior cycle? On the **Voters** page, open
**Do-not-contact list** and upload a CSV of Voter IDs. It works like the Early Voting upload:

1. A preview runs first — how many voters match, how many are already flagged, and how many doors
   would drop off the map, campaign by campaign. Nothing changes yet.
2. Apply to flag them. Every upload appears in the history below with an **Undo** button that
   reverts exactly the voters that upload flagged — voters you flagged by hand are never touched.
3. IDs that don't match anyone yet are remembered: if that voter shows up in a later import,
   they're flagged automatically.

## What changes in the field

- The voter disappears from **walk-list exports** (even lists saved before you set the flag) and
  is never included in new walk lists.
- Canvassers see a **Do not contact** badge on the voter at the door, and the survey button is
  disabled for them. The server refuses a survey for a flagged voter no matter what.
- The rest of the household is unaffected — one flagged voter doesn't hide the door, and canvassers
  are still routed there for the housemates. **If that's not what you want, use
  [Do not knock](do-not-knock) instead**, which suppresses the address itself. But once
  **everyone** at an address is flagged, the whole door drops off books, maps, and future turf
  cuts, and shows in reports as its own **Do not contact** coverage segment.
- Nothing historical changes: past knocks and surveys stay in your reports (marked, so an export
  can't be mistaken for a call list), and your counts and billing never move.

If a new resident is imported into a fully-flagged address later, the door comes back
automatically — only the flagged individuals stay suppressed. (Do not knock is the opposite: it
never reopens on its own.)
