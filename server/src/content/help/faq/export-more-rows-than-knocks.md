---
slug: export-more-rows-than-knocks
title: Why does my Canvassing activity export have more rows than my Knocks?
audience: lead
kind: faq
order: 73.5
sourceDoc: EXPORTS.md
summary: The file lists entries, and Knocks counts each door once per round. Tick One row per knock, leave the outcome boxes unticked and set the same dates, and the file's knocks match.
tags: export, csv, activity, knocks, rows, one row per knock, per knock, overlaps, survey answers, home page, client report, doesn't match, more rows
---

Because the file and the number count different things. **Knocks** counts each door **once per
round**. A plain **Canvassing activity** export lists **entries** — everything canvassers recorded —
so it usually has more rows. The usual reasons:

- **Two canvassers recorded the same door in the same round.** Partners at one door both tapping
  it, or a door that sat in two people's books. That is one knock and two rows. Those doors are on
  the [Overlaps](page-overlaps) page.
- **Restricted marks and notes are rows.** A Restricted access mark (including one made from a desk
  over a whole book) and a Note added entry are both in the file, and neither is a knock.
- **Survey answers add rows.** With **Include survey answers** ticked, surveying three people at one
  door in one round is one knock and three surveys, so the other two surveys get rows of their own,
  marked **Row source: survey**.
- **One row per voter at the door repeats knocks.** With it ticked, a knock that named nobody
  repeats once per registered voter at the address.
- **You're comparing different things.** Different dates (the Exports page starts on *All time*, a
  live campaign's Home page on *Today*), a crew picked on the Home page (exports have no crew
  filter), or a team's client report, which counts only that team's work.

## Get a file that matches

1. Press **Queue export** on **Canvassing activity** and tick **One row per knock**, at the top of
   the dialog (on a phone with the latest update, the **One row per knock** switch above **Door
   outcome**).
2. Leave the **Door outcome** boxes unticked. Ticked, they pick doors by their result for the round —
   handy for a re-knock list, but then the file isn't every knock.
3. Set the same dates (and walk list, if you picked one) as the number you're checking. On the Home
   page, leave the crew on *All coordinators*.

The file then lists each door once per round and leaves out Restricted marks and Note added entries (a knock's own note stays), so its knocks
match your Knocks. With survey answers on, the extra people surveyed come after all the knock rows,
at the end of the file, and the export history shows the split — for example **4,683 knocks + 14
more people surveyed**: 4,683 rows that are knocks, then 14 rows that are another person surveyed at
a door already listed.

Where two canvassers recorded the same door in a round, the file keeps one entry — the door's
result: Surveyed if anyone surveyed there (on a lit-drop campaign, Lit dropped if anyone dropped
literature), otherwise the later visit — under that canvasser's name. **So don't total this file by canvasser**: a shared door counts
for only one of them. For each canvasser's numbers, pick them in the canvasser filter, or use the
canvasser table on the Home page, which credits both.

## Still a door or two off?

- **On *All time* with nothing picked**, the Home page reads a running total Doorline re-checks every
  night. Pick *Custom* on the Home page, from the campaign's first day through today, for a fresh
  count.
- **A client report for the whole campaign:** for its "doors knocked so far", leave *From* empty and
  set *To* to the report's last day; for its "+N this week", use the report's own dates. For a walk
  list's report, pick that walk list too. **A team's report can't be matched from this file**, because
  exports have no crew filter — read those numbers on the report, or on the Home page with that crew
  picked. See [How do team reports work?](how-do-team-reports-work)
- **Built later?** Phones that were offline send their doors when they reconnect, so a file built
  later can be a few doors higher — and a published report keeps its numbers until you press
  **Refresh numbers**.
- **Doors changed while the file was being built** — a door recorded again, unknocked or changed —
  show up in the next file.

Someone who asked not to be contacted doesn't change the count: their knock stays in the file with
the name blank. See [Which file do I send my client?](which-file-to-send-a-client) and [Exporting
your data](exports).
