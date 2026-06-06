# Docs

Reference documentation for how this app actually works — written to be read, not just skimmed by
machines. The goal is for these docs to eventually cover the **whole app**, so anyone (including new
users, once we turn the plain-English parts into tutorials) can understand a feature without reading
the code.

## How the docs are structured

Every feature doc follows the same two-layer shape:

- **Part 1 — For everyone** — plain language: what the thing is and how to use it. This is the
  layer we'll spin user tutorials off of.
- **Part 2 — Technical reference** — for developers (and Claude): models, endpoints, aggregations,
  invariants, and the frontend files that render it.

Keep that split, cross-link related docs with a "Related:" line, link to source as
`[path](../server/src/...)`, and skip emoji/diagrams to match the existing style.

## The docs

| Doc | What it covers |
|---|---|
| [METRICS.md](METRICS.md) | Every number on the dashboards — knocks, surveys, coverage, connection rate — and the duplicate-knock ("overlap") warning. The source of truth for counting. |
| [DATE_FILTERS.md](DATE_FILTERS.md) | The date-range control on the dashboards (and map): presets, what each page defaults to, the custom picker, the boundary math, and why the map narrows its pins. |
| [TIMEZONES.md](TIMEZONES.md) | What "a day" is and which clock every date/time is shown in: every campaign owns its timezone (the org's for org-wide rollups), the anchor-tz date window, day bucketing, and timestamp display labels. |
| [EFFORTS.md](EFFORTS.md) | Parallel canvassing within a campaign: efforts (areas/teams) that own disjoint doors, a survey, and a crew, each with its own rounds. Door ownership + Intake, per-effort survey/reporting, concurrency. |
| [WALKLISTS.md](WALKLISTS.md) | Saved, frozen door sets you carve efforts from — built from the filter builder or an uploaded Voter-ID CSV — and how a list seeds/claims an effort's doors. |
| [PASSES_AND_TURF.md](PASSES_AND_TURF.md) | Rounds (a "pass" within an effort), books (walkable turf), turf-cutting & recutting, and the mechanics that apply per round. |
| [SURVEYS.md](SURVEYS.md) | Building, running, and reporting surveys — per-effort overrides, and the guardrails on editing a survey that's already collecting answers. |
| [IMPORTS.md](IMPORTS.md) | Voter uploads: how rows match, what goes live, and how new addresses reach the field through Intake. |
| [VOTERS.md](VOTERS.md) | The voter directory and profile: where voters live (org vs campaign), what's editable, and mobile lookup. |
| [EARLY_VOTING.md](EARLY_VOTING.md) | Early/already-voted marking and how "voted" doors drop off the canvasser's list and show as their own coverage bucket. |
| [MAPS.md](MAPS.md) | Every map (mobile field app + web admin): reading the pins, where coordinates come from, how a knock becomes a "ping," rendering, and the live-refresh intervals. |
| [THEMING.md](THEMING.md) | Cross-cutting (not a feature): light/dark mode and the web design tokens — how the theme flips, the full token reference, and the rule that every control must use the semantic tokens (`bg-card`/`text-fg`/…) so nothing renders white in dark mode. |

### Related references (repo root)

| File | What it covers |
|---|---|
| [TURF_RUNBOOK.md](../TURF_RUNBOOK.md) | Operational, step-by-step runbook for cutting and recutting turf (the "how to do it" companion to PASSES_AND_TURF.md). |
| [PROJECT_BRIEF.md](../PROJECT_BRIEF.md) | High-level project overview. |

## How we keep these current

When we investigate how something works, the routine is:

1. **Check here first** — is there already a doc (or a section) for it?
2. If yes, **update it**; if no, **create one** in `docs/` using the Part 1 / Part 2 house style
   above.
3. Cross-link it from related docs and add a row to the table above.

Over time this index becomes the map of the whole app. Docs can drift from the code after big
changes — when in doubt, trust the code and fix the doc.
