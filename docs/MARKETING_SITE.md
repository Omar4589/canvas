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

There is deliberately **no "Download the app" button on the homepage**. Installing Doorline without
an invitation gets you a sign-in screen you cannot get past, so a download button aimed at the
homepage's audience would send a buyer somewhere useless. The store badges live in the footer,
where they say "this is a real, published app" rather than "install this now."

## Requesting a demo

Every **Request a demo** button opens a short form in a dialog on the page — name, work email,
organization, and optionally team size and a message. Submitting it emails the Doorline team; you
get a confirmation in the dialog, and replying to that email reaches the person who submitted it.

The form used to be a `mailto:` link that opened your mail app. That did nothing at all for anyone
reading the site in a browser with no mail app configured, which is most people — so the only way
to buy Doorline silently failed for a large share of visitors.

`hello@doorline.app` is still shown inside the dialog and in the footer for anyone who would
rather write their own email.

## The `/app` page

`doorline.app/app` is a small page for **canvassers**: the two store badges, and the thing the
store listings can't tell them — that they need an account from their campaign first, that they
sign in with the same email and password they set on the web, and that they must not create a new
account. Most canvassers arrive by invitation email instead, but some search the store or type the
domain, and this is where those people land.

It is linked from the field-app section of the homepage, from the line under the hero buttons, and
from the footer.

## What the site does not do

- **No self-signup.** There is no "create account" anywhere, on the site or in the app.
- **No pricing page.** Pricing is a conversation with an account manager (see [BILLING.md](BILLING.md)).
- **No tracking or analytics.** No third-party scripts of any kind run on the marketing site.

---

# Part 2 — Technical reference

## Two kinds of public page

| | React route | Static document |
|---|---|---|
| Pages | `/` (landing), `/login`, `/forgot-password`, `/reset-password/:token`, `/r/:token` | `/privacy`, `/terms`, `/delete-account`, `/app` |
| Lives in | [`client/src/pages/`](../client/src/pages/) | [`client/public/*.html`](../client/public/) |
| Served by | the SPA fallback in [`app.js`](../server/src/app.js) | explicit `res.sendFile` routes, **before** the fallback |
| Registered in | [`server/src/webRoutes.js`](../server/src/webRoutes.js) → `WEB_SEGMENTS` | `STATIC_PAGES` in `app.js` |
| Head tags | inherited from `client/index.html` | its own |
| Linked with | `<Link to>` | `<a href>` — must be a full page load |

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

## Marketing components

[`client/src/marketing/`](../client/src/marketing/). `LandingPage.jsx` composes them in order and
pins `theme-light` so the public site stays light even when the app's dark theme is saved.

Conventions worth keeping: sections are `mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8` with
`py-20 sm:py-24`; content data lives in a module-level `const` array that gets `.map`ped; `<h1>`
belongs to `Hero` alone; `Reveal` (from `useReveal.jsx`) wraps anything that should animate in;
every focusable element carries `focus-visible:ring-2 focus-visible:ring-brand-600`.

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
| Body | `name`, `email`, `organization` (required); `teamSize`, `message` (optional); `company` (honeypot), `elapsedMs` (timing) |
| Validation | Zod, reusing `nameSchema` / `emailSchema` from [`utils/validators.js`](../server/src/utils/validators.js); bounded free text for org (120) and message (2000) |
| Rate limit | 20/hour per IP, counting **every** request. Not tighter: only a valid submission sends mail, and a low cap would lock out a person who mistypes their own email |
| Bot defence | honeypot field + a 2-second floor on time-to-submit. **No captcha** — see below |
| Success | `{ ok: true }` |
| Failure | `502` with a `send-failed` code, so the dialog can offer the direct address instead of a false success |

**Two contracts that are easy to break:**

- **The bot checks return exactly what success returns.** A filled honeypot or a too-fast submit
  gets the same `200 {ok:true}`, so a bot can't tell which of its submissions landed.
- **The send is awaited.** This differs from `POST /auth/forgot-password`, which answers *before*
  doing its work to close an account-existence oracle. There's no oracle here, and a failed send
  means a lost lead — so this mirrors `resendInvite.js`: the send *is* the request.

Mail goes out as kind `demoRequest` ([`templates.js`](../server/src/services/mail/templates.js)),
the only template addressed to Doorline rather than to a customer. It overrides the shared layout's
footer, and it passes the prospect's address as `sendMail`'s `replyTo` so Reply answers them.

**The subject is `Demo request — {organization}` and carries nothing else.** Subjects are copied
verbatim into `EmailLog`, which is metadata-only and readable on the super-admin Emails page, so
the prospect's name and address stay in the body, which is never logged.

Recipient is `DEMO_REQUEST_TO` (default `hello@doorline.app`) — override it on staging so test
submissions don't reach the real inbox.

Tests: [`server/test/demoRequest.test.js`](../server/test/demoRequest.test.js), 6 cases, no DB, runs
on plain `npm test`. It mounts the router on a bare Express app rather than calling `createApp()`,
which eagerly opens ioredis handles for bull-board.

## Privacy

The form is the only place in the product that collects personal data from someone who is **not a
user, not a voter, and not a customer**. Two limits keep that bounded, and both are load-bearing:

- **Nothing is stored.** There is no `Lead`/`DemoRequest` model. The submission becomes an email;
  the only persistent trace is the metadata-only `EmailLog` row, whose `to` is our own address.
- **No new subprocessor.** Mail goes through Resend, already listed in [`DPA.md`](DPA.md) §6.
  A hosted captcha (Turnstile, hCaptcha, reCAPTCHA) would be a new subprocessor — under the signed
  DPA that is a **customer-notice event**, not a code decision. That is why bot defence is a
  honeypot and a clock.

See the watchlist entry in [`PRIVACY_VERIFICATION.md`](PRIVACY_VERIFICATION.md).

## SEO checklist when touching public pages

- `client/index.html` owns the head for **every** React route — treat any change there as a change
  to the homepage's identity.
- New public URL → add it to `client/public/sitemap.xml`.
- `client/public/robots.txt` allows everything except `/api` and `/r/` (share links must stay
  unindexed).
- Verify a static page against a **real build**, since the static/SPA logic only runs under
  `isProd`:

```
npm run build && NODE_ENV=production npm start
curl -sI localhost:$PORT/app          # 200
curl -s  localhost:$PORT/app | grep canonical   # .../app — NOT the bare domain
curl -sI localhost:$PORT/app.html     # 301 → /app
curl -sI localhost:$PORT/nonsense     # still 404
```
