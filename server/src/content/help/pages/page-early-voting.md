---
slug: page-early-voting
title: The Early Voting page
audience: lead
kind: page
order: 113
sourceDoc: EARLY_VOTING.md
summary: Upload a CSV or Excel list of voters who already voted so their doors drop off canvassers' books.
tags: early voting, voted, page, csv, excel, xlsx, count only rows where
---

The **Early Voting** page is where you upload a list of voters who have already cast a ballot, as a CSV or an Excel workbook (`.xlsx`), matched by Voter ID with or without leading zeros. Their doors then drop off canvassers' books so nobody wastes a knock on someone who's already voted. The preview names the column it matched on and lets you change it; you can preview the match before importing and undo it if needed. An election office's returns file can go in as it comes: **Count only rows where** lets you count only some of its rows, accepted ballots say. From an Excel file only the first tab is read, and a workbook with rows hidden in Excel is refused. Files can be up to 50 MB; only the Voter ID column is used, so a bigger file goes in as a copy with just that column. If you edit a file after picking it, pick it again before applying.

For the full walkthrough, see [Dropping voters who already voted](early-voting).
