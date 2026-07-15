# Working in this repo

**The invariant: after any feature change, cascade.**

```
code  →  docs (Part 1 plain-English + Part 2 technical)  →  Help Center content
```

A change isn't "done" when the code works. Every user-facing feature change also updates:

1. **Docs** in [`docs/`](docs/) — the two-layer feature doc (**Part 1 — For everyone**, plain
   language; **Part 2 — Technical reference**). See [`docs/README.md`](docs/README.md) for the house
   style and the full keep-current routine.
2. **Help Center content** in [`server/src/content/help/`](server/src/content/help/) — the curated,
   plain-English **guides**, **page guides**, **FAQ**, and **getting-started** articles that end
   users read in-app. **Part 1 is the source for this copy; Part 2 (Technical) is never exposed to
   users.** New recurring question? Triage it via
   [`server/src/content/help/faq/_INBOX.md`](server/src/content/help/faq/_INBOX.md).

## The second invariant: privacy & terms

Some changes don't just need docs — they change what we promise people **legally**. Our **Privacy
Policy**, **Terms of Service**, and the signed **Data Processing Addendum** ([`docs/DPA.md`](docs/DPA.md))
make specific claims about what we collect, how long we keep it, who can see it, and who we share it with.
**Code that drifts from those claims is a false legal statement, not just a bug** — the exact drift the
2026 privacy remediation exists to prevent recurring.

**A change is privacy-affecting — STOP and flag it — if it touches any of:**

- **What we collect** — a new field holding personal data (name, DOB, phone, address, precise location, a
  free-text note about a person), or a new source of it.
- **Retention or deletion** — how long anything is kept; what account/org deletion removes or leaves; a
  TTL, purge, cascade, or backup.
- **Who can access customer data** — staff access, grants, roles, tenant isolation, a route that returns
  PII, an audit log.
- **Sharing / subprocessors** — a new or replaced third-party service or external API that receives
  customer data (hosting, database, maps, geocoding, email, SMS, analytics, error tracking, storage).
  **This one is special — it is a contractual event, not just a disclosure. See the callout below.**
- **What we expose** — reports, exports (CSV/PDF), public/share links — anything that puts customer data
  in front of someone new.

**When triggered:**

1. **Say so out loud** in the change: "this affects what our Privacy Policy / ToS / DPA claims about X."
2. **Reconcile with [`docs/PRIVACY_VERIFICATION.md`](docs/PRIVACY_VERIFICATION.md)** — the code-verified
   record of what we *actually* do — and update it so it stays true.
3. **Flag whether the published Privacy Policy, ToS, or DPA text needs to change.** The static legal pages
   and [`docs/DPA.md`](docs/DPA.md) are edited deliberately by the owner, never as a side effect of code.
4. If you're unsure whether a change is privacy-affecting, treat it as if it is.

> ### 🛑 Adding or replacing a subprocessor is a CONTRACTUAL NOTICE event — not just a disclosure edit
> A new third party that processes personal information (a new host, database, geocoder, email/SMS
> provider, analytics, error tracker, storage bucket — anything customer data flows to) triggers the
> signed DPA's subprocessor clause ([`docs/DPA.md`](docs/DPA.md) §6): we must **give customers notice
> BEFORE the change takes effect**, and they may object. So before wiring one up:
> 1. Update the subprocessor list in **`docs/DPA.md` §6** *and* the **Privacy Policy's service-providers
>    paragraph**.
> 2. **The owner sends customer notice** (per DPA §6) before it goes live — this is a gate, not a
>    follow-up.
>
> **Never route customer data to a new third party ahead of that notice.**

**Never ship a change that makes a published policy sentence false.** The policy is a promise; the code is
whether we keep it.

## Breaking server change? Bump the client-version gate.

**If you change the server in a way an already-released mobile app can't handle** (removing or changing
the shape of an endpoint/field the shipped app depends on), you MUST raise the client-version gate, or
old phones hit cryptic 4xx errors instead of a clean "Update required" wall:

1. Bump **`CLIENT_API_VERSION`** in [`mobile/lib/config.js`](mobile/lib/config.js) (the number the new
   app bundle declares it speaks).
2. Set **`MIN_CLIENT_API_VERSION`** in
   [`server/src/config/clientVersion.js`](server/src/config/clientVersion.js) to that same new number
   (the server then walls anything older — `app/index.jsx` redirects to `/update-required`).

Only bump on a genuine breaking change — a *backward-compatible* addition needs neither. Ship the new
client (OTA or build) **before/with** raising the server floor, so the people you wall have an update to
get. Two things this is NOT: it is unrelated to the build-currency nag / `MOBILE_UPDATE_MODE` (that asks
"is your *binary* the newest?"; this asks "can your *code* talk to my API?"), and the **web** console
needs no gate — it reloads fresh on every deploy.

## Help Center content, at a glance

Each article is a markdown file under `server/src/content/help/` (subfolder = `kind`) with a small
frontmatter header:

| Field | Values / meaning |
|---|---|
| `slug` | stable id used in URLs and internal `[label](slug)` links |
| `title` | article heading |
| `audience` | `all` \| `canvasser` \| `admin` \| `lead` \| `super` |
| `kind` | `getting-started` \| `guide` \| `page` \| `faq` |
| `order` | numeric sort within its section |
| `sourceDoc` | the `docs/` file this copy is derived from |
| `summary` | one-line blurb for listings |
| `tags` | comma-separated keywords |

**Audience → role visibility** (a role sees its own tier and everything below): a **lead** sees
`lead` + `canvasser` + `all`; an **admin** adds `admin`; a **super** adds `super`.

The library is served by [`server/src/routes/help.js`](server/src/routes/help.js) (mounted at
`/api/help`, loader [`server/src/services/help/loadHelp.js`](server/src/services/help/loadHelp.js))
and rendered on **web** ([`client/src/pages/HelpPage.jsx`](client/src/pages/HelpPage.jsx)) and
**mobile** (`mobile/app/(app)/help/`). Content ships with the server — a server deploy updates both
clients; no OTA/app release is needed to fix help copy.

## House rules

- **Plain JavaScript only** — no TypeScript.
- **Light theme + red brand accent.** Use the existing semantic design tokens
  (`bg-card`/`text-fg`/…); never hard-coded grays or dark sections.
- Match each file's neighbors in style, naming, and comment density.
