# The public marketing site

Everything a signed-out visitor sees at `doorline.app`: the landing page, the demo-request form
that is the product's only conversion action, and the `/app` install page for canvassers who
arrive without an invite.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) (how a canvasser actually gets the app),
[EMAIL.md](EMAIL.md) (the demo-request notice), [USERS.md](USERS.md) (there is no self-signup —
accounts are created for you), [THEMING.md](THEMING.md) (the `theme-light` pin).

- **Part 1 — For everyone** is plain language: what's on the site, what the buttons do, and who
  each page is written for.
- **Part 2 — Technical reference** is for developers (and Claude): the routing split, the
  four-place wiring for a static page, the demo endpoint's contract, and the SEO checklist.

---

# Part 1 — For everyone

## Who the site is for

Doorline is sold to organizations, not to individuals. The landing page is written for the person
who **buys**: a campaign manager, a consultant, an advocacy director. The person who **uses** the
mobile app — a canvasser — cannot create an account at all, and normally never visits the website;
they get an invitation email instead.

That split decides the whole layout. There are two calls to action, and only two:

- **Request a demo** — the primary button, in the header, the hero, and the closing band.
- **Sign in** — for people who already have an account.

The starting-price line under those buttons is **copy, not a third CTA** — it carries no link and
opens nothing. Its job is to answer the question that otherwise closes the tab, so the demo
requests that do arrive come from people who already know the number.

There is deliberately **no "Download the app" button on the homepage**. Installing Doorline without
an invitation gets you a sign-in screen you cannot get past, so a download button aimed at the
homepage's audience would send a buyer somewhere useless. The store badges live in the footer,
where they say "this is a real, published app" rather than "install this now."

## Requesting a demo

Every **Request a demo** button opens a short form in a dialog on the page. It promises *"Omar will
reply within one business day to set up a 20-minute walkthrough"* and asks for a name, work email
and organization, then — all optional — what kind of team they are (canvassing firm, consulting
firm, campaign, party or committee, advocacy group), team size, **how they heard about us** (AAPC
event, referral, search, other — the printed AAPC ad's QR code carries no tag, so this question is
the only way to tie a scan to a lead), and anything else. On `/aapc` it also asks **when** they'd
like to meet; "At AAPC, Nov 17" is offered only through the event day.

Submitting it **saves the request** and emails the Doorline team. Saving comes first, so a failed
email can no longer lose a lead; the request waits on the super-admin **Website** page either way,
marked if its email failed. Each request also records the page it was sent from and that link's tag
(say `src=home-banner`). It is kept for **up to 24 months**, then deletes itself — or sooner, from
the Website page, when the person asks. The person sees *"Thanks, Dana. Omar will email you within
one business day."*, and replying to the notice email reaches them directly.

On a phone the form doesn't jump straight into the name field (that threw the keyboard up over the
form); on a computer it does.

The form used to be a `mailto:` link that opened your mail app. That did nothing at all for anyone
reading the site in a browser with no mail app configured, which is most people — so the only way
to buy Doorline silently failed for a large share of visitors.

`hello@doorline.app` is still shown inside the dialog and in the footer for anyone who would
rather write their own email.

## The page loads as real HTML

The homepage is built into a finished web page ahead of time, so the headline, the buttons and every
section appear the moment the page arrives — before any of the app's JavaScript has downloaded. That
matters most for someone scanning the AAPC ad's QR code on conference Wi-Fi, who used to look at a
blank white screen until about 300 KB of script arrived. The page then quietly "wakes up" (the demo
button starts working) once the script is in.

## The AAPC banner

From the day `/aapc` launches (Nov 14) through Nov 24, a slim red bar sits at the very top of the
homepage, above the header. It is part of the page — it pushes everything down and never covers
anything — and links to `/aapc?src=home-banner`. Through Nov 17 it reads *"At AAPC on Nov 17? Book 15
minutes with Omar →"*; from Nov 18, *"Saw us at AAPC? Book 15 minutes with Omar →"*; from Nov 25 it is
gone. The switch happens in the visitor's browser at midnight Eastern, so no deploy is needed on those
days. The bar stays switched off until `/aapc` itself ships, so it can never point at a missing page.

## Visit counts

The super-admin **Website** page shows how many times the homepage was loaded each day, split by
where visitors came from: a link's own tag, the website that sent them (like google.com), or
"direct" — which is what a scan of the untagged QR code looks like. The counting happens on our own
server: no cookies, no tracking script, no stored IP addresses; search-engine crawlers and link
previews are left out.

## The `/app` page

`doorline.app/app` is a small page for **canvassers**: the two store badges, and the thing the store
listings can't tell them — that they need an account from their campaign first, that they sign in
with the same email and password they set on the web, and that they must not create a new account.
An **Asked to sign in again?** section says that the password prompt is routine, that **Later**
keeps a canvasser knocking when the signal is weak, to always sign back in as yourself, and what to
do about a lost phone ([USERS.md](USERS.md) → *Sessions*). Most canvassers arrive by invitation
email instead, but some search the store or type the domain, and this is where those people land.

It is linked from the field-app section of the homepage, from the line under the hero buttons, and
from the footer.

## What the site does not do

- **No self-signup.** There is no "create account" anywhere, on the site or in the app.
- **No pricing page, but the starting price is published** *(ruling revised Aug 2026 — it used to
  be "no price anywhere")*. Three places say it and no more: the line under the hero buttons
  (**"Local races from $300 per campaign, per month. Every canvasser and feature included."**), the
  **"What does it cost?"** FAQ entry, and the `offers` node in `client/index.html`'s JSON-LD (an
  `Offer` at 300 USD with a per-campaign, per-month unit). Nothing else is public: the tier card
  (District, Federal) is an account-manager document, and every negotiated org/campaign rate stays
  private. **"Everything included" is a printed promise:** the half-page ad in the AAPC Election
  Post-Mortem program (Nov 17, 2026) says *"Starts at $300 per campaign, per month — everything
  included."* — so nothing priced separately may ever appear on the site. The reasoning is that the
  two directions cost different things. A local race is the volume buyer and shops on budget, so a site with no number reads "enterprise, can't afford
  it" and loses that lead before it ever becomes one; a published *ceiling*, meanwhile, only anchors
  the big races down — which is why the top of the card stays off the site. It says **per campaign**
  because that is the billing unit, and a firm running three races pays three times. See
  [BILLING.md](BILLING.md).
- **No third-party tracking or analytics.** No third-party scripts of any kind run on the marketing
  site, and nothing sets a cookie. The one measurement is our own daily count of homepage loads
  (*Visit counts* above), kept on our server with no personal information in it.

## What the page claims — and the words we avoid

Every sentence on the landing page was checked against the code on 2026-11-01. These phrasings each
overstate what Doorline does, so they stay off the site:

| Avoid | Because | Say instead |
|---|---|---|
| "never lose data" | a queued item the server later rejects (canvasser removed, door deleted) is dropped | "Doors and surveys save on the phone and send as soon as there's signal again" |
| "the moment it happens" | flags are worked out when the Audit page loads, which refreshes every 20 seconds | "within seconds of syncing" |
| "syncs automatically", "in the background" | the queue sends on reconnect, app open, the next tap or sign-in — never in the background | "send as soon as there's signal again" |
| "pings", "ping trails" | the app never tracks a canvasser between doors (a privacy-policy promise) | "where each result was recorded from, with a line to its house" |
| "voter identity stripped" | shared reports leave out names, but a house-level map — an opt-in per report — shows every knocked home's address and answers | name exactly what's left out: "No canvasser or voter names" |
| "side-by-side comparisons" | there is one sortable table of every canvasser | "one table that ranks every canvasser" |
| "optimized walk order" | the order is a straight-line route, not a street route | "every book comes with a walk order" |
| "dedicated fake-GPS alert" | fake-GPS detection works on Android only | "fake-GPS apps on Android" |
| "coverage" as a share of the universe | reports carry no such percentage | doors knocked, contact rate |
| "Nothing bad" | glib, and not quite true (see the first row) | "They keep knocking" |

Platform totals say **"door knocks"**, never "doors knocked" — the printed AAPC ad's wording.

---

# Part 2 — Technical reference

## Three kinds of public page

| | React route | Prerendered React page | Static document |
|---|---|---|---|
| Pages | `/login`, `/forgot-password`, `/reset-password/:token`, `/r/:token` (and the console) | `/` (landing) — `/aapc` joins it | `/privacy`, `/terms`, `/delete-account`, `/app` |
| Lives in | [`client/src/pages/`](../client/src/pages/) | `client/src/pages/`, rendered at build time into `dist/.prerendered/` | [`client/public/*.html`](../client/public/) |
| Served by | the SPA fallback in [`app.js`](../server/src/app.js) — the EMPTY shell | `PRERENDERED_PAGES` in `app.js`, **before** `express.static` | explicit `res.sendFile` routes, **before** the fallback |
| Registered in | [`server/src/webRoutes.js`](../server/src/webRoutes.js) → `WEB_SEGMENTS` | `WEB_SEGMENTS` too (it is still a React route) + the four places in *Prerendered pages* below | `STATIC_PAGES` in `app.js` |
| Head tags | inherited from `client/index.html` | `client/index.html`'s (the homepage's own); another page writes its own in `scripts/prerender.js` | its own |
| Linked with | `<Link to>` | `<a href>` from outside the app, so the visitor gets the HTML; a `<Link>` from inside the app is fine | `<a href>` — must be a full page load |

**The rule for choosing:** if the page has to be correct for a crawler or a link preview, it must
be static. `client/index.html` hard-codes `<link rel="canonical" href="https://doorline.app/">`
along with homepage-specific OG tags, and every React route inherits them — so an SPA-served page
declares itself a duplicate of the homepage and previews as the homepage. `app.js` records this as
the reason the legal pages were moved out of React in the first place.

### Adding a React route

Add it to `App.jsx` **and** add its first segment to `WEB_SEGMENTS`. Missing the second step
returns a 404 from the SPA fallback — silently, and **only in production**.
[`server/test/webRoutes.test.js`](../server/test/webRoutes.test.js) parses `App.jsx` and fails on
divergence in either direction; it runs under plain `npm test`.

### Adding a static page — four places

1. `client/public/<name>.html` — a complete document with its own `<title>`, description,
   `rel=canonical`, and OG tags. Zero JavaScript.
2. `STATIC_PAGES` in [`server/src/app.js`](../server/src/app.js) — maps the clean URL to the file.
3. The `.html` → clean-URL **301 array** in the same file, so the twin URL isn't separately
   crawlable.
4. `STATIC_PAGE_SEGMENTS` in `server/test/webRoutes.test.js`, which asserts no React route ever
   collides with a static one.

Then add a `<url>` block to [`client/public/sitemap.xml`](../client/public/sitemap.xml).

Assets a static page references must live in `client/public/` too — Vite hashes anything under
`client/src/assets/`. The store badges are therefore committed twice on purpose:
`client/public/badge-*.{svg,png}` for `/app`, and `client/src/assets/marketing/badge-*` for the
React footer. They are vendor artwork and never change.

## Prerendered pages

The homepage reaches the browser as finished HTML, then hydrates in place. The pieces:

- **Build** — `client/package.json`'s `build` runs three steps: `vite build` (the app, plus
  `dist/.vite/manifest.json`), `vite build --ssr src/entry-prerender.jsx --outDir .ssr` (gitignored),
  and `node scripts/prerender.js`, which renders each page in `entry-prerender.jsx`'s `PAGES` and
  writes `dist/.prerendered/<file>`: the shell with `class="marketing"` on `<html>`, the markup inside
  `#root` (marked `data-prerendered="<name>"`), `modulepreload` links for the page's own chunks, and —
  while `/aapc` is live — the AAPC banner's inline date script. Any surprise fails the build: a
  failed Heroku build leaves the running release alone, while a page that silently fell back to the
  empty shell would go unnoticed.
- **One tree** — `client/src/AppTree.jsx` is the provider stack for both the browser (`main.jsx`, with
  `BrowserRouter`) and the build (`entry-prerender.jsx`, with `StaticRouter`), so the HTML and the tree
  that hydrates it can't drift. `App` takes `pages` — already-loaded components for prerendered routes.
- **Serving** — `PRERENDERED_PAGES` in `server/src/app.js` serves each file at its clean URL (maxAge 0)
  and bumps that day's visit count. `express.static` runs with `index: false` and `dotfiles: 'ignore'`,
  so neither `/.prerendered/…` nor `/.vite/manifest.json` is reachable (the static default only skips a
  dot-NAMED file and would serve the folder's contents as duplicates). `dist/index.html` stays the
  empty shell for every console route. A missing file (a dist built before this) falls back to the shell.
- **Caching** — hashed files under `/assets` are sent with `max-age=1y, immutable`; every HTML document
  keeps `max-age=0`, so a deploy shows on the next request.

**Hydration rules — break one and React throws the server HTML away and re-renders (a visible
flash):**

1. `main.jsx` loads the page's module **before** `hydrateRoot`. Hydrating while the lazy route's chunk
   was in flight let AuthProvider's first state change discard the HTML (React #421) and show
   "Loading…".
2. The first render must not depend on anything the build can't know. Auth renders signed out on
   both sides (AuthProvider starts in `loading`); `localStorage` reads return null at build time
   (`api/client.js`); a date-dependent text renders **every** variant and lets an attribute pick one
   (the AAPC banner: `<html data-aapc>`).
3. Nothing starts invisible — no `opacity-0` entrance animations; the HTML is the first paint.
4. The SSR render and the client bundle come from the same build (the one `build` script).

**Adding a prerendered page (how `/aapc` ships):** (1) the page component, its route in `App.jsx`,
and its segment in `WEB_SEGMENTS`; (2) an entry in `entry-prerender.jsx`'s `PAGES`, with its own
title, description, canonical and OG tags written by `scripts/prerender.js`; (3) a `data-prerendered`
branch in `main.jsx` that loads its module before hydrating; (4) a row in `PRERENDERED_PAGES`. For
`/aapc`, also set `AAPC.pageLive` (`client/src/marketing/aapc.js`) so the banner appears.

**Check a build:** `npm run build` ends with `prerendered / → dist/.prerendered/index.html`; then with
`NODE_ENV=production npm start`, `curl -s localhost:$PORT/ | grep 'Know exactly what happened'` finds
the headline, `curl -s localhost:$PORT/login` is still the empty shell, and
`curl -sI localhost:$PORT/.prerendered/index.html` is a 404. `server/test/staticPages.int.test.js`
pins the serving rules.

## The AAPC banner and dates

`client/src/marketing/aapc.js` is the one config for every date-driven piece: `start` (Nov 14),
`switchOn` (Nov 18), `end` (Nov 25), the event's time zone (Eastern), the banner link, and `pageLive`
(off until `/aapc` ships). The prerendered page can't know the date, so the build inlines
`aapcPhaseScript()` into `<head>`; it stamps `<html data-aapc="before|after|off">` before first paint,
and `index.css` shows the matching text or hides the bar. `aapcPhase()` is the same rule for code that
runs later (the demo form's "When?"); `aapc.test.js` pins the two together hour by hour.

## Marketing components

[`client/src/marketing/`](../client/src/marketing/). `LandingPage.jsx` composes them in order and
pins `theme-light` so the public site stays light even when the app's dark theme is saved.

Conventions worth keeping: sections are `mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8` with
`py-20 sm:py-24`; content data lives in a module-level `const` array that gets `.map`ped; `<h1>`
belongs to `Hero` alone; every focusable element carries `focus-visible:ring-2 focus-visible:ring-brand-600`.

Three rules from the Nov 2026 fixes:

- **Nothing animates in.** The scroll-reveal wrapper (`useReveal.jsx`) is gone: it started every
  section at `opacity-0`, which left the hero fading in on first paint and sections blank after a
  nav jump — and would blank the whole page when served as static HTML before JavaScript runs.
- **`html.marketing` paints `<html>` and `<body>` white** (`index.css`, added by `LandingPage` while
  mounted). The no-flash theme script puts `dark` on `<html>` for a dark-mode device; `.theme-light`
  only re-pins the page's own subtree, so without this the console's dark surface showed as a band
  on Mac and iPhone overscroll. Don't "fix" it by skipping `dark` on marketing routes: `useTheme`
  reads and saves that class, so a hop into the console would save a dark-mode user as light.
- **Phones get their own hero image.** Below `sm` the console composition is replaced by one
  full-size phone screenshot (`PhoneHero`); from `sm` up the hero shows the map cropped to the map
  itself (`client/scripts/optimizeShots.js`'s `extract`, from the 2880-wide raw capture), served
  through a `<picture>` whose source only matches from 640px — a phone never downloads it.
  `npm run shots:optimize -- map.png` regenerates just that one file.

Two single sources of truth, and CTAs must read from them rather than hard-coding:

- [`useAuthCta.js`](../client/src/marketing/useAuthCta.js) — `{ loading, authed, to, label }`, so
  nav, hero, band, and footer can never disagree about who is signed in.
- [`DemoRequest.jsx`](../client/src/marketing/DemoRequest.jsx) — `useDemoRequest().open()`. The
  provider wraps the whole page in `LandingPage.jsx` because the three buttons that call it sit at
  three different scroll depths.

The nav's section links (`SECTIONS` in `MarketingNav.jsx`) are in-page `#` anchors that only
resolve on `/`; the static pages link back to them as `/#turf`.

## The demo-request endpoint

`POST /api/demo-request` — [`server/src/routes/public/demoRequest.js`](../server/src/routes/public/demoRequest.js),
mounted in `routes/index.js` above the auth gate.

| | |
|---|---|
| Body | `name`, `email`, `organization` (required); `role`, `teamSize`, `heardAbout`, `when` (optional — each one of its labels in `services/site/demoOptions.js`), `message` (optional); `source` (a `?src=` tag) and `page` (a path) — dropped, never rejected, when malformed; `company` (honeypot), `elapsedMs` (timing) |
| Storage | saved as a `DemoRequest` **before** the email is sent; `expiresAt` = +730 days with a TTL index (needs `npm run migrate:build-indexes -- --apply` after the deploy — until then nothing expires). The model has `bufferCommands` off, so with no database the save fails at once and the email still goes |
| Validation | Zod, reusing `nameSchema` / `emailSchema` from [`utils/validators.js`](../server/src/utils/validators.js); bounded free text for org (120) and message (2000) |
| Rate limit | 20/hour per IP, counting **every** request. Not tighter: only a valid submission sends mail, and a low cap would lock out a person who mistypes their own email |
| Bot defence | honeypot field + a 2-second floor on time-to-submit. **No captcha** — see below |
| Success | `{ ok: true }` — when the request was saved, or emailed, or both |
| Failure | `502` with a `send-failed` code only when **both** the save and the send failed, so the dialog can offer the direct address instead of a false success |

**Two contracts that are easy to break:**

- **The bot checks return exactly what success returns.** A filled honeypot or a too-fast submit
  gets the same `200 {ok:true}`, so a bot can't tell which of its submissions landed.
- **The send is awaited.** This differs from `POST /auth/forgot-password`, which answers *before*
  doing its work to close an account-existence oracle. There's no oracle here, and when the save also
  failed, the send's outcome decides what the prospect is told — so this mirrors `resendInvite.js`.

The selects' allowed values live twice — the dialog's `client/src/marketing/demoOptions.js` and the
server's `services/site/demoOptions.js` (production server code never imports from `client/`) —
pinned identical by `server/test/demoOptionsMirror.test.js`.

Super-admins work the saved requests on **`/super-admin/website`** (`routes/superAdmin/website.js`):
`GET /api/super-admin/website/demo-requests?status=open|handled|all`, `PATCH …/:id {handled}` (records
who handled it), `DELETE …/:id` (permanent — for a person's deletion request), and
`GET /api/super-admin/website/visits?days=60`.

Mail goes out as kind `demoRequest` ([`templates.js`](../server/src/services/mail/templates.js)),
the only template addressed to Doorline rather than to a customer. It overrides the shared layout's
footer, and it passes the prospect's address as `sendMail`'s `replyTo` so Reply answers them.

**The subject is `Demo request — {organization}` and carries nothing else.** Subjects are copied
verbatim into `EmailLog`, which is metadata-only and readable on the super-admin Emails page, so
the prospect's name and address stay in the body, which is never logged.

Recipient is `DEMO_REQUEST_TO` (default `hello@doorline.app`) — override it on staging so test
submissions don't reach the real inbox.

Tests: [`server/test/demoRequest.test.js`](../server/test/demoRequest.test.js), 9 cases, no DB, runs
on plain `npm test`. It mounts the router on a bare Express app rather than calling `createApp()`,
which eagerly opens ioredis handles for bull-board. Saving, the failed-email path, bot rows never
saved, and the Website routes' access rules are in `server/test/demoRequestStore.int.test.js`.

## Visit counts

`services/site/siteVisits.js` bumps `SiteVisitDay {day, path, source, count}` as `app.js` serves a
prerendered page. A visit is a `GET` that wants HTML from something that isn't a bot (a broad
user-agent filter, no user agent at all counts as a script) and isn't a prefetch/prerender. `day` is
the owner's calendar day (Central). `source` is the page's valid `?src=` tag, else the referring
site's host without `www.` (only the host — never the URL), else `direct`. Fire-and-forget: a failed
write costs one count, never the page. No IP, cookie or user agent is stored. The unique
`{day, path, source}` index needs `migrate:build-indexes`; until then racing first visits can split a
key across rows, which the reader sums. Tests: `server/test/siteVisits.test.js` (the rules) and
`demoRequestStore.int.test.js` (the per-day read).

## Privacy

The form is the only place in the product that collects personal data from someone who is **not a
user, not a voter, and not a customer**. What keeps that bounded, all load-bearing:

- **Stored, and the policy says so.** Since Nov 2026 each request is saved (`DemoRequest`) as well as
  emailed. The Privacy Policy's *Demo requests* paragraph names what is collected, why (reply and
  arrange a demo) and for how long (up to 24 months — the TTL). Only super-admins can see them, and a
  person's deletion request is a Delete on the Website page. The visit counter stores no personal
  information at all.
- **No new subprocessor.** Mail goes through Resend, already listed in [`DPA.md`](DPA.md) §6.
  A hosted captcha (Turnstile, hCaptcha, reCAPTCHA) would be a new subprocessor — under the signed
  DPA that is a **customer-notice event**, not a code decision. That is why bot defence is a
  honeypot and a clock.

See the watchlist entry in [`PRIVACY_VERIFICATION.md`](PRIVACY_VERIFICATION.md).

## SEO checklist when touching public pages

- `client/index.html` owns the head for **every** React route, and the prerendered homepage is built
  from it — treat any change there as a change to the homepage's identity. A prerendered page of its
  own (like `/aapc`) gets its head from `scripts/prerender.js`.
- Its JSON-LD carries an **`offers` node — an `Offer` with `price: "300"` USD and a
  `UnitPriceSpecification` reading "per campaign, per month"** — so search results can show the
  starting price without implying a flat 300. It must track the published number: it is one of the three places that move
  together when `DEFAULT_RATE_CENTS` changes (the other two are `Hero.jsx` and `Faq.jsx`).
- New public URL → add it to `client/public/sitemap.xml`.
- `client/public/robots.txt` allows everything except `/api`. Share links (`/r/…`) must stay
  unindexed, but **not** through robots.txt: a crawler that robots.txt keeps out never fetches the
  page, so it never sees a noindex, and can still list a forwarded link's bare URL. Every `/r/` page is
  served with `X-Robots-Tag: noindex, nofollow` instead (the SPA fallback in
  [server/src/app.js](../server/src/app.js); [CLIENT_PORTAL.md](CLIENT_PORTAL.md) §K). Don't add
  `Disallow: /r/` back.
- Verify a static page against a **real build**, since the static/SPA logic only runs under
  `isProd`:

```
npm run build && NODE_ENV=production npm start
curl -sI localhost:$PORT/app          # 200
curl -s  localhost:$PORT/app | grep canonical   # .../app — NOT the bare domain
curl -sI localhost:$PORT/app.html     # 301 → /app
curl -sI localhost:$PORT/nonsense     # still 404
```
