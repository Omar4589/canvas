---
slug: party-filter-first-walk-list
title: Can I make my first walk list only Democrats (or one precinct)?
audience: lead
kind: faq
order: 22
sourceDoc: WALKLISTS.md
summary: Yes — build a saved search right after your first import, then seed the walk list from it.
tags: saved search, party, precinct, target, walk list
---

Yes — and you don't need to have created any walk list yet.

1. **Import your voter file.** As long as it has a party column, every voter's party is stored.
2. **Build a saved search.** On the **Saved Searches** page, use the filter builder — set **Party = DEM** (or pick a precinct), preview, and save. Saved searches are campaign-wide and don't require a walk list to exist, so you can do this the moment the import finishes.
3. **Create the walk list** and pick that saved search under "Seed door-set." It now owns exactly those doors.

> Heads up: A saved search only includes doors the app can place on the map. Any address without map coordinates is left out — and the preview tells you how many were skipped.

More in [Saved searches](saved-searches).
