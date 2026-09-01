---
slug: voter-notes-export-empty
title: Why is my voter notes export empty?
audience: lead
kind: faq
order: 47
sourceDoc: EXPORTS.md
summary: Voter profile notes only contains notes typed on a voter's profile — the notes canvassers leave at the door are in the Notes export instead.
tags: export, csv, notes, door notes, survey notes, empty, download
---

Because there are three different kinds of note, and that export only carries one of them.

**Voter profile notes** contains the notes someone types on a **voter's profile** in the console. If nobody on your team has written one, the file comes back with only its column headings — which is exactly what you'd see if your notes are all coming from the field.

The notes your canvassers leave are a different thing entirely:

- the **optional note** typed when marking a door (Not home, Refused, Lit dropped, …), which is a record about that **door**;
- the **note left when submitting a survey**, which is attached to the person surveyed.

To get those, use the **Notes** export. It puts all three kinds in one file, one row per note, with who wrote it and the door or voter it belongs to. You can narrow it to just the ones you want — by source, by door outcome ("only the not-home notes"), by date, walk list, round, author, or by searching the note text.

The quickest way: open the campaign's **Notes** page, set the filters until you're looking at the notes you want, and choose **Export these**. It queues the file with those same filters. The page shows at most 500 notes per source, but the export isn't capped — it contains every matching note.

One thing to expect in the file: a door note names nobody. Marking a house "not home" is a record about the address, and no individual was selected, so the voter columns are blank. If you need the people registered at that address beside the note, tick **Include the voters registered at each door** when you queue the export.
