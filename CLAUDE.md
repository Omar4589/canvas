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
