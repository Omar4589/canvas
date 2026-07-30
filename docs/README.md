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
| [GETTING_STARTED.md](GETTING_STARTED.md) | **Start here:** the click-by-click first-run walkthrough — create campaign → import voters → survey → walk list (auto Pass 1) → cut & accept books → assign → activate — with the two gotchas (books before activation; assigning can come after). |
| [CAMPAIGNS.md](CAMPAIGNS.md) | The setup flow at a glance and the on-screen Setup-progress guide, plus managing a campaign (edit rules, type-lock, archive vs. delete) and extending a live one with a new walk list. Full walkthrough in GETTING_STARTED.md. |
| [METRICS.md](METRICS.md) | Every number on the dashboards — knocks, surveys, coverage, connection rate — and the duplicate-knock ("overlap") warning. The source of truth for counting. |
| [DATE_FILTERS.md](DATE_FILTERS.md) | The date-range control on the dashboards (and map): presets, what each page defaults to, the custom picker, the boundary math, and why the map narrows its pins. |
| [TIMEZONES.md](TIMEZONES.md) | What "a day" is and which clock every date/time is shown in: every campaign owns its timezone (the org's for org-wide rollups), the anchor-tz date window, day bucketing, and timestamp display labels. |
| [EFFORTS.md](EFFORTS.md) | Parallel canvassing within a campaign: walk lists (areas/teams) that own disjoint doors, a survey, and a crew, each with its own passes. Door ownership + Intake, per-walk-list survey/reporting, concurrency. |
| [WALKLISTS.md](WALKLISTS.md) | Saved, frozen door sets you carve walk lists from — built from the filter builder or an uploaded Voter-ID CSV — and how a saved search seeds/claims a walk list's doors. |
| [PASSES.md](PASSES.md) | A walk list's passes — the billable sweeps: auto Pass 1, per-walk-list numbering, the draft → active → archived lifecycle, and where they're managed (inside the walk list, not a top-level page). |
| [PASSES_AND_TURF.md](PASSES_AND_TURF.md) | Cutting a pass's doors into books (walkable turf), turf-cutting/recutting, editing books after the cut (move/merge/split) + how those edits reach canvassers, and the mechanics that apply per pass. |
| [SURVEYS.md](SURVEYS.md) | Building, running, and reporting surveys — per-effort overrides, the guardrails on editing a survey that's already collecting answers, and **auditing answers** (the Survey Explorer: who chose an option, who recorded it and when, the per-canvasser breakdown, CSV export). |
| [CLIENT_PORTAL.md](CLIENT_PORTAL.md) | Client reports & shareable links: building & publishing frozen weekly report snapshots (KPIs with this-week deltas, support/survey/contact breakdowns, authored observations, a coverage map), and the public per-campaign **share link** (`/r/<token>`, optional password, rotate/revoke) that opens a no-login report hub. |
| [IMPORTS.md](IMPORTS.md) | Voter uploads: how rows match, what goes live, and how new addresses reach the field through Intake. |
| [VOTERS.md](VOTERS.md) | The voter directory and profile: where voters live (org vs campaign), what's editable, and mobile lookup. |
| [EARLY_VOTING.md](EARLY_VOTING.md) | Early/already-voted marking and how "voted" doors drop off the canvasser's list and show as their own coverage bucket. |
| [CANVASSER_APP.md](CANVASSER_APP.md) | The mobile field app's shell: the sign-in → org → campaign → effort → book → houses flow, the slide-out menu (drawer), the lean per-screen headers, the merged map context card, and where the effort picker's data comes from. |
| [ADMIN_APP.md](ADMIN_APP.md) | The mobile admin app: the bottom-tab nav (Overview · Insights · Map · Books · More), the "More" hub, and the Books screen for assigning turf/books to canvassers (by book / by canvasser, bulk). Super admins share these screens in-org. |
| [MAPS.md](MAPS.md) | Every map (mobile field app + web admin): reading the pins, where coordinates come from, how a knock becomes a "ping," rendering, and the live-refresh intervals. |
| [AUDIT.md](AUDIT.md) | The GPS **canvassing-quality audit**: flags for doors marked far from the house, in rapid succession, all from one spot, or with weak GPS — live-detected from the ping trail, reviewed on a dedicated Audit page or as a map overlay, with a persisted decision (open/reviewed/dismissed/confirmed) per entry. |
| [NOTES.md](NOTES.md) | The **Notes hub**: every door, survey, and admin/profile note for a campaign in one read-only, searchable feed (web + mobile), with type/author/walk-list/date filters and tap-through to the voter profile or the map focused on the door. |
| [USERS.md](USERS.md) | Accounts vs memberships, the roles, adding/linking people, coordinators (crews), passwords/lockouts, **deleting your account**, and what's shared vs isolated across orgs. |
| [EMAIL.md](EMAIL.md) | Every email Doorline sends — triggers, recipients (billing-only notices), link lifetimes — plus the mailer's dormant/live switch, reset-token mechanics, and the delivery-gated deletion warnings. |
| [ROLES.md](ROLES.md) | The org roles (admin / team lead / canvasser) and the **team lead** (a campaign-scoped admin): the grant store, the per-surface authorization contract, and web/mobile scoping. |
| [PERSONS.md](PERSONS.md) | The cross-org **Person** layer: how the same real person is deduped across orgs, plus ownership, merge/split, locks, and edit proposals. |
| [PLATFORM.md](PLATFORM.md) | The **super-admin** platform console: the Control Room (cross-org totals + lifetime platform totals + idle-orgs queue + live activity feed), Organizations, All Users + promote, and the People layer. |
| [BILLING.md](BILLING.md) | Charging orgs for Doorline: the $300/campaign/month model, trials, the account state machine (read-only suspension, offline grace), the super-admin Billing panel + monthly statement, and the entitlement gate. |
| [MARKETING_SITE.md](MARKETING_SITE.md) | The public site at `doorline.app`: who the landing page is written for (the buyer, not the canvasser), the demo-request form that replaced the `mailto:` CTA, the `/app` install page, and the React-route vs. static-document split — including the four places a static page must be wired or it 404s in production only. |
| [THEMING.md](THEMING.md) | Cross-cutting (not a feature): light/dark mode and the web design tokens — how the theme flips, the full token reference, and the rule that every control must use the semantic tokens (`bg-card`/`text-fg`/…) so nothing renders white in dark mode. |
| [PERFORMANCE.md](PERFORMANCE.md) | Cross-cutting (not a feature): resource hygiene — focus-gated polling and GPS on covered mobile screens, the single-flight offline queue, AbortSignal/debounce on searches, map lifecycle rules, and the state-reset patterns. |
| [OPERATIONS.md](OPERATIONS.md) | Not a feature doc: the **runbook**. Jobs Heroku Scheduler runs for you (the deleted-identity purge), the one-off commands you type into Heroku's Run console (lock the store reviewers' demo login, build indexes), and why `autoIndex` is off in production. |
| [PROPOSAL_PARALLEL_EFFORTS.md](PROPOSAL_PARALLEL_EFFORTS.md) | Historical design proposal for the Efforts model — superseded by [EFFORTS.md](EFFORTS.md); kept for the rationale. |

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
4. **Cascade to the Help Center** — whenever you touch a doc's **Part 1 (For everyone)**, update the
   matching content in [`server/src/content/help/`](../server/src/content/help/): the curated,
   plain-English articles + FAQ that end users read in the web console and the mobile app. Part 1 is
   the *source* for that help copy; **Part 2 (Technical) is never exposed to users**. If the change
   surfaces a new recurring question, drop it in
   [`faq/_INBOX.md`](../server/src/content/help/faq/_INBOX.md) to triage into a real FAQ entry.

Over time this index becomes the map of the whole app. Docs can drift from the code after big
changes — when in doubt, trust the code and fix the doc.
