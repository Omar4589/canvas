---
slug: xls-file-wont-upload
title: My voter file is a .xls — can I upload it?
audience: lead
kind: faq
order: 23
sourceDoc: IMPORTS.md
summary: Two very different kinds of file arrive named .xls. Most upload and import normally; a genuine Excel 97–2003 workbook needs a twenty-second Save As first.
tags: import, xls, xlsx, excel, file format, upload, convert, spreadsheet
---

Usually yes — and when the answer is no, the upload now tells you exactly why instead of showing you a screen full of nonsense columns.

Two completely different kinds of file arrive with a `.xls` name, and Doorline decides which one you have by reading what's **inside** the file, never by its name.

**1. A text file named `.xls` — most state and vendor exports.** Plenty of voter files are really tab-separated (or comma-separated) *text* that someone saved with a `.xls` extension; Florida's state export is one of them. These **upload and import normally**. The separator is worked out for you, even when some fields contain commas of their own. There is nothing to convert.

**2. A genuine Excel 97–2003 workbook.** This is a much older format that shares nothing with today's `.xlsx` but the first three letters. It can't be read, so the upload is **refused with the fix spelled out**:

> Open the file in Excel → **File → Save As** → choose **Excel Workbook (.xlsx)** → upload the new `.xlsx`.

That takes about twenty seconds and doesn't change your data. (It's also worth knowing this format stops at 65,536 rows, so a big voter file was never one of these to begin with.)

**If you're not sure which kind you have, just upload it.** If it imports, it was the first kind.

## Save as .xlsx, or as CSV?

Either one imports. Prefer **`.xlsx`**: the import can see each cell's real type, so it can warn you when an ID or ZIP looks like it lost a leading zero, or when a birth date came through as an Excel serial number. A CSV arrives as plain text with no type information, so those warnings can't fire. If you do choose CSV, pick **CSV UTF-8** so accented names survive.

Two things are worth a glance after **any** conversion — they're the classic ways a spreadsheet quietly damages a voter file:

- **Leading zeros.** ZIPs like `00214` and codes like `0069` must still show their zeros. If Excel has turned them into `214` and `69`, format those columns as **Text** before saving.
- **Dates.** A birth date showing as `31234` is an Excel serial number. The import copes with those, but it's easier to fix at the source.

The same rules apply to the other places you upload a file of Voter IDs — **walk list from a CSV**, **early voting**, and **do-not-contact** lists.
