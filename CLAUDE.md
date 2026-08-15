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

## Touched a server route? Run `npm run audit:mobile-api` before you deploy.

**"I only changed admin routes, not mobile routes" is the trap this catches.** The mobile app has a
whole admin section — books, turf, timeline, audit, users, flags, reports — and it calls **56
`/admin/*` endpoints**, more than double what it calls under `/mobile/*`. Editing one of those is a
mobile-facing change even though nothing under `server/src/routes/mobile/` moved.

```
npm run audit:mobile-api            # flags which of your uncommitted server changes mobile depends on
npm run audit:mobile-api -- main    # ...against a git ref
npm run audit:mobile-api -- --list  # the whole mobile-facing surface, with the files that call each
```

It resolves each route file to its real mount prefix from `routes/index.js`, so it works even when a
router's own paths are all params. It flags files, not diffs — it **cannot** see a response-shape
change, so read the flagged diffs yourself. **Adding** a field, endpoint, or optional param is always
safe. **Removing** a field, renaming a route, or making a param required is not — that is the case
below.

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

## After EVERY mobile build + submit: update the build-currency vars.

**A new native build is not "done" when it's submitted — you MUST re-point the build-currency vars at it,
or it silently breaks.** Until you do, the vars still name the *previous* build as current, so the brand-new
build nags **itself** ("update available") while the superseded build reads "ok" — exactly backwards. This
is the build-currency nag (Gate B); it is env-driven, so no deploy is needed.

Every time you `eas build` + `eas submit` a new mobile build:

1. Grab the new build's **runtime version** per platform (expo.dev build page, or `eas build:list`).
2. In the **Heroku dashboard → Config Vars**, set **`MOBILE_CURRENT_RUNTIME_ANDROID`** and
   **`MOBILE_CURRENT_RUNTIME_IOS`** to the new hashes (comma-separate to keep older builds "current" too).
3. **Wait until the store actually serves the new build** (Play Internal live / TestFlight processed) before
   flipping, so an old-build user who taps **Update** gets something installable.

Verify by hitting `GET /api/build-status?platform=…&runtimeVersion=…`: the new build must read `ok`, an
older one `outdated`. Anyone reading this after the user says they built/submitted: remind them of this
step. **List the `staging` and `production` runtime versions BOTH** — they are identical when cut from the
same commit, but if they ever diverge, omitting one nags that whole lane toward a store page offering it
nothing. (Related knobs: `MOBILE_UPDATE_MODE` soft|hard, `MOBILE_UPDATE_NOTE`, and `MOBILE_STORE_URL_ANDROID`
— which stays SET while the legacy `com.canvassapp.mobile` fleet exists, and `MOBILE_STORE_URL_IOS` which
stays UNSET now that the App Store listing is public. See [`mobile/README.md`](mobile/README.md).)

## Two release lanes: `staging` first, then `production`.

**Both stores went public 2026-07-28 and `main` is now the working branch** — deploy server/web from
`main`, and ship mobile from `main`. Mobile has two lanes, separated by the **channel** baked into each
binary, never by the store or the Play track:

- **`staging`** → TestFlight + Play internal track. Publish with `npm run ota:staging`, normally from a
  feature branch.
- **`production`** → App Store + Play production track. Publish with `npm run ota:production` from `main`
  after the change is confirmed in staging.

Both profiles come from one tree, so they share a fingerprint; a JS-only feature branch can therefore feed
`staging` and, once merged, feed `production` with no rebuild. Touching a hashed input (`app.json`,
`eas.json`, a native dep, an icon) diverges the fingerprint and `ota:check` will refuse — that refusal is
the signal to cut a fresh set of four builds, never something to override.

**Two frozen refs exist and must never be moved:** `sharedVoters` (tag `legacy-android-lifeline`) is the
only tree that can still OTA the retired `com.canvassapp.mobile` app, and `play-org-launch` is the tree the
first `com.doorline.app` builds came from. Background in [`mobile/README.md`](mobile/README.md) →
**History: the Play relaunch**.

## Ops is run from the Heroku DASHBOARD, never the CLI.

**The owner does not use the `heroku` CLI. Ever.** Everything operational happens in the Heroku
dashboard — config vars, dyno scaling, and one-off scripts via **More → Run console**. Never hand over
a `heroku run …` / `heroku ps` / `heroku config:set …` command as the instruction; give the thing that
gets typed into the dashboard, and say where in the dashboard it goes.

**The consequence that actually bites:** the dashboard's Run console starts at the **app root**, not in
`server/`. A script registered only in `server/package.json` is *unreachable* from it. So any script
meant to be run in production MUST be proxied in the **root `package.json`**, following the existing
convention — trailing `--` so flags drill through to the inner script:

```jsonc
// root package.json
"audit:stale-overwrites": "npm --prefix server run audit:stale-overwrites --",
// server/package.json
"audit:stale-overwrites": "node src/migrations/auditStaleOverwrites.js",
```

Then the console command is just `npm run audit:stale-overwrites` (add `-- --apply` for a script that
takes flags — the `--` in the proxy is what lets that through).

Before handing over any operational command, **run it from the repo root yourself** — not from
`server/` — or you will hand over something that fails the moment it is pasted in.

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
- **Use `grep -a` on the three NUL-bearing files.** Composite map keys are built as
  `` `${a}\0${b}` `` — a deliberate separator no id can contain, so two-part keys can't collide.
  Plain macOS `grep` treats those files as binary and **skips them silently**, so an audit
  concludes the code isn't there. Verified list (2026-08-15; `fbtime/sync.js` left the list that
  day — the shift-cache rewrite keys on single shift ids, no composite keys left):

  | File | NULs |
  |---|---|
  | `server/src/services/person/resolvePerson.js` | 6 |
  | `server/src/services/dnc/recomputeDoNotKnock.js` | 3 |
  | `server/src/services/person/mergePersons.js` | 2 |

  It has already misled two audits — the Person layer once, and fbtime `sync.js` (then a list
  member) again on 2026-08-14, where a grep for a model it imported and wrote returned nothing.
  Two follow-on traps: `git diff` renders these files as **`Binary files … differ`**, so a diff
  review shows you nothing — use `git diff --text`. And a NUL prints as a blank in terminal
  output, so `` `${id}\0${day}` `` reads as `` `${id} ${day}` `` when you cat it. Re-scan with the
  `python3` walk in the session log rather than `grep -c $'\0'` — bash cannot put a NUL in a
  string, so that command silently tests for the empty string and always "passes".
- **Light theme + red brand accent.** Use the existing semantic design tokens
  (`bg-card`/`text-fg`/…); never hard-coded grays or dark sections.
- Match each file's neighbors in style, naming, and comment density.
