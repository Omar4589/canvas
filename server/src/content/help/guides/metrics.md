---
slug: metrics
title: Understanding the numbers
audience: lead
kind: guide
order: 22
sourceDoc: METRICS.md
summary: What a knock, coverage, and connection rate actually mean on your dashboard.
tags: metrics, knocks, coverage, rate, billing
---

A few definitions make every dashboard number click into place.

## Knocks

A **knock** is one distinct door within one pass. If two canvassers hit the same door in the same pass, it counts **once**. Knock the same door again in a *new* pass and that's a new knock. So running another pass **adds knocks** — each door counts once per round.

## Coverage (houses knocked)

**Coverage** — "houses knocked" and the coverage bar — is based on each door's *current* status across the whole campaign. It is **not** pass-aware: one house has one status no matter how many passes hit it. So a second pass adds knocks but **doesn't** change coverage. See [Coverage vs. knocks](coverage-vs-knocks).

## Rates

- **Connection rate** — the share of knocks that reached a survey (surveyed knocks ÷ knocks).
- **Contact rate** — the share where someone actually came to the door (including [refusals](restricted-vs-refused)).

## Surveys

Surveys are counted per voter, and a voter can be surveyed once per pass. "Surveyed voters" counts distinct people reached — a different lens than door-based knocks, and nothing sums the two together.

> Tip: Dashboard totals add up across *all* passes. Only the per-pass progress view is scoped to one pass.
