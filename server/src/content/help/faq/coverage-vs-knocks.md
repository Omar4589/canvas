---
slug: coverage-vs-knocks
title: Coverage vs. knocks — what's the difference?
audience: lead
kind: faq
order: 34
sourceDoc: METRICS.md
summary: A knock counts per door per pass; coverage is each door's current status campaign-wide.
tags: coverage, knocks, metrics, passes
---

They answer two different questions.

- **Knocks** count every distinct door **within a pass**. Run a second pass over the same doors and you get **more knocks** — this is the billable unit.
- **Coverage** ("houses knocked") is each door's **current status across the whole campaign**, regardless of how many passes hit it. One house has one status.

So running another pass (or recutting) **adds knocks** but leaves **coverage** unchanged — the door was already "reached." That's why a big Round 2 can show lots of new knocks while the coverage bar barely moves.

See [Understanding the numbers](metrics).
