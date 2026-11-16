# The public marketing site

Everything a signed-out visitor sees at `doorline.app`: the landing page, the `/aapc` page for the
AAPC Election Post-Mortem, the demo-request form that is the product's only conversion action, and
the `/app` install page for canvassers who arrive without an invite.

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

That split decides the whole layout. There is one call to action, and one way to see the product
without a call:

- **Request a demo** — the primary button, in the header, the hero, and the closing band.
- **Open a sample report** — a real published report from our demo campaign, with its password
  printed beside the link (*The sample report* below). Until that link is set up, the hero's second
  button reads **See how it works** and jumps to the Proof section.

**Sign in** sits in the header and the footer only, for people who already have an account.

The starting-price line under those buttons is **copy, not a third CTA** — it carries no link and
opens nothing. Its job is to answer the question that otherwise closes the tab, so the demo
requests that do arrive come from people who already know the number. It ends with the site's
risk-reversal (since Nov 16): *"Setup is free, and billing starts with your first knock. New to Doorline?
Ask about a free trial."* The same two sentences close the **Get started** band's paragraph, sit under
`/aapc`'s buttons and in its closing band, and close the FAQ's *What does it cost?* answer (before its
*Request a demo*) — always together, never reworded, so no page can promise more than another. The first
is exactly the billing rule: a campaign's setup months bill nothing, and it bills from its first field
visit (monthly from that day, for a campaign first out since Nov 5, 2026 — [BILLING.md](BILLING.md)). The
second says *ask about* because trials are real but decided client by client: the owner gives a
first-time customer 7 days free, and one who keeps going after them, having knocked, pays; he sets up and
bills every client himself. Words that would promise more are in the table below.

There is deliberately **no "Download the app" button on the homepage**. Installing Doorline without
an invitation gets you a sign-in screen you cannot get past, so a download button aimed at the
homepage's audience would send a buyer somewhere useless. The store badges live in the footer,
where they say "this is a real, published app" rather than "install this now."

## What's on the homepage

Top to bottom (the AAPC brief's §7, Nov 2026): the AAPC banner (while it runs), the header, the hero,
the **numbers** (three platform totals in red — door knocks, surveys, campaigns — each ending in a plus,
"and counting", centered in a short band with the date they were counted under them, the same on /aapc;
no client names since the owner's addendum 3, no voter-record count since Nov 2, never an organizations
count), **the problem** (four ways a door program goes
wrong), **Proof** (how Doorline checks every door, with screenshots of the Audit page and the map),
**Client reports**, **Setup** (from the voter file to the first knock), the feature cards, the founder's
note with the **Your data** list, the FAQ, and the closing band. The founder's note is Omar's own words,
set as a quote in the site's usual type — semibold, inside quotation marks (a serif without them was tried
on Nov 2 and dropped the next day) — signed *Omar Zumaya, Founder, Doorline*. The **Your data** list beside
it is in smaller type than the quote (it was set to the quote's size on Nov 15 and put back the next day:
it looked off). A monogram stands in for his photo until he sends one, and a
scan of his signature will sit above his name when he sends that. The FAQ shows each question on one line;
a tap opens its answer and closes the one that was open (since Nov 15; it used to print every answer, a long
scroll). The section links in the header are Proof · Reports · Setup · FAQ.

**Every public page has the same header** (since Nov 15): the privacy, terms and delete-account pages, the
`/app` page and the not-found page now show the homepage's header too — the same four links, **Sign in**,
**Request a demo**, and the same menu button on a phone. On those pages **Request a demo** goes to the
homepage and opens the form there. Before, they had an older header of their own.

## Requesting a demo

Every **Request a demo** button opens a short form in a dialog on the page. It promises *"Omar will
reply within one business day to set up a 20-minute walkthrough"* and asks for a name, work email
and organization, then — all optional — what kind of team they are (canvassing firm, consulting
firm, campaign, party or committee, advocacy group), team size, **how they heard about us** (AAPC
event, referral, search, other — the printed AAPC ad's QR code carries no tag, so this question is
the only way to tie a scan to a lead), and anything else.

On `/aapc` the page speaks in Omar's own voice. Through Nov 17 its two main buttons read **Find me at
AAPC** — Omar will be at the Post-Mortem with no table, and so will most people who land on the page (the
owner, Nov 15) — and from Nov 18 they read **Book 15 minutes with me**. Either opens the booking form.
Through Nov 17 it is titled *"Let's meet at AAPC"* and reads *"I'll be at the Post-Mortem on Nov 17. Leave
your details and I'll email or text you to find a time to meet there, or after the event."*; from Nov 18 it
reads *"Book 15 minutes with me and I'll email or text you to set a time."* It asks **when** (*"At AAPC,
Nov 17"* is offered through Nov 17 itself) and offers an optional **mobile number**, so Omar can text or
email to set the time; its button says **Send**. Its **Request a demo** opens the demo form, also in the
first person: *"Tell me about your team and I'll reply within one business day to set up a 20-minute
walkthrough."* The thank-you follows the same voice. On the homepage the form, the banner (*"…Book 15
minutes with Omar"*) and the thank-you stay in the third person.

The form floats in the middle of the screen with the page dimmed behind it (since Nov 15; it used to fill
the window from top to bottom). On a computer it is two columns wide, so the whole form fits a laptop
screen; on a phone or a short window it scrolls, and its top is never cut off. Beside the button it says
*"Omar will get back to you within one business day. Prefer email? hello@doorline.app"* — on `/aapc`,
*"I'll get back to you within one business day. Prefer email? omar@doorline.app"* (Omar's own address
on his own page since Nov 16; hello@ is for general questions). There is **no phone number anywhere on the site, on
purpose**: scrapers (the owner, Nov 15).

The buttons work even before the page has finished loading: until then a tap opens an email to
`hello@doorline.app` (`omar@doorline.app` on `/aapc`); once the page is ready, the same tap opens the
form.

Submitting it **saves the request** and emails the Doorline team. Saving comes first, so a failed
email can no longer lose a lead; the request waits on the super-admin **Website** page either way,
marked if its email failed. Each request also records the page it was sent from and that link's tag
(say `src=home-banner`; a request from `/aapc` with no tag records `aapc`). It is kept for **up to
24 months**, then deletes itself — or sooner, from
the Website page, when the person asks. The person sees *"Thanks, Dana. Omar will email you within
one business day."*, and replying to the notice email reaches them directly.

On a phone the form doesn't jump straight into the name field (that threw the keyboard up over the
form); on a computer it does.

The form used to be a `mailto:` link that opened your mail app. That did nothing at all for anyone
reading the site in a browser with no mail app configured, which is most people — so the only way
to buy Doorline silently failed for a large share of visitors.

An address is still shown for anyone who would rather write their own email: `hello@doorline.app`
inside the homepage's dialog and in every page's footer **Contact** link, and `omar@doorline.app` under
`/aapc`'s buttons and inside its dialog. Requests sent through the form are still emailed to hello@ (the
Website page's inbox), whichever page they come from.

## The page loads as real HTML

The homepage and `/aapc` are built into finished web pages ahead of time, so the headline, the buttons and every
section appear the moment the page arrives — before any of the app's JavaScript has downloaded. That
matters most for someone scanning the AAPC ad's QR code on conference Wi-Fi, who used to look at a
blank white screen until about 300 KB of script arrived. The page then quietly "wakes up" (the demo
button starts working) once the script is in.

## The AAPC banner

From the day `/aapc` launched (Nov 1, 2026 — the owner's call) through Nov 24, a slim red bar sits
at the very top of the homepage, above the header. It is part of the page — it pushes everything down and never covers
anything — and links to `/aapc?src=home-banner`. Through Nov 17 it reads *"At AAPC on Nov 17? Book 15
minutes with Omar →"*; from Nov 18, *"Saw us at AAPC? Book 15 minutes with Omar →"*; from Nov 25 it is
gone. The switch happens in the visitor's browser at midnight Eastern, so no deploy is needed on those
days.

## The `/aapc` page

`doorline.app/aapc` is the printed AAPC ad's own page: the ad's headline (*Every door. Every pass.
Every number.*), its subhead and its three bullets word for word, a copy of its "Beaverdale · Pass 2"
card (tagged *Example* — the numbers are made up), Omar's line (*"I'll be at the Post-Mortem on Nov 17.
Leave your name and I'll find you there, or we'll set a time after the event."*, switching on Nov 18 to
*"Missed me at AAPC?…"*), **Find me at AAPC** (from Nov 18, **Book 15 minutes with me**) and **Request a
demo**, with *"Prefer email? omar@doorline.app"* under them (his own address, since Nov 16), the numbers (the homepage's band, larger
on a computer to catch the eye), three short blocks (Proof, Client reports, Many
campaigns) and the price. It stays up after the event with the after-event line. Search engines are asked not to list it
(it's an event page), and a link shared from it previews as Doorline's.

## The sample report

**Open a sample report** opens a real published report from Doorline's own demo campaign (made-up
canvassing on real Des Moines streets): the area map — no addresses — with door counts, contact rate
and survey results. Every report link has a password, so the page prints this one's beside the link.
Because the password is public, the two wrong-password limits that protect a client's link would only
lock visitors out of this one, so this one link — and only while it belongs to our internal demo
organization — doesn't have them.

Keeping its address from ever changing takes four steps, once (the owner, in the console and the
Heroku dashboard):

1. In **Share**, set the demo link's password to a lowercase phrase of 12+ characters you're happy to
   print.
2. In **Settings → Config Vars**, set `SEED_DEMO_SHARE_PASSWORD` to the same phrase and
   `SEED_DEMO_SHARE_TOKEN` to the link's current token.
3. **Extend** the link to the end of its one-year life.
4. **Never press Renew, New address or rotate on it** — each gives it a new URL. If it ever expires,
   **Rebuild demo day** brings it back at the same URL.

Then the link and password go into `client/src/marketing/siteFacts.js` (`SAMPLE_REPORT`), and every
"Open a sample report" appears. If it ever reports *locked*: **Unlock now** in Share — never rotate.

## Traffic: the Website page

The super-admin **Website** page opens on **Traffic**, so the first thing you see is today:

- **Visits today**, next to how many there were by this time of day yesterday and on the same day last
  week. Visits are counted by the hour, so the hour you're in is shared out evenly by the minute; a day
  from before visits were counted by the hour shows its whole-day total instead.
- **Demo requests today**, and how many are still open.
- **On phones**: the share of today's visits on a phone (tablets and computers next to it).
- **Top way in**: the way most of today's visitors got here.

Below that, pick **7, 30 or 90 days**:

- **Visits per day**, a bar chart. Click a day to see it hour by hour. Dots under the bars mark the days
  a demo request came in, and a line marks the AAPC event (Nov 17). **Show as a table** lists every
  number.
- **By the hour**: today, or the day you clicked, with how its visitors got here and on what.
- **How they got here**, in five groups: **QR code & direct** (QR scans, typed or saved addresses, links
  in emails and texts — the printed ad's QR code has no tag, so its scans land here), **Search & AI**
  (Google, Bing, DuckDuckGo, ChatGPT and the like), **Social media**, **Other websites**, and **Tagged
  links** (links shared with a `?src=` tag). Then the top sites and tags by name.
- **Where they landed**: the homepage or the AAPC page. Moving from one of our pages to another (the
  homepage's AAPC banner, say) isn't a new visit; those moves are listed on their own, and so is the
  canvasser app page, `/app`, whose visitors are mostly canvassers a customer sent there.
- **Phones and computers** for the period.
- **What it turned into**: the period's demo requests, about how many visits each one took, how people
  said they heard about us, the page they sent it from, and whether they came through the homepage's AAPC
  banner or a tagged link.

With **Live** on, the tab refreshes itself every minute. The second tab, **Demo requests**, is the
inbox; it shows how many are open.

**How it's counted.** On our own server, as each page is sent: no cookies, no tracking script, no stored
IP addresses or browser details; search-engine crawlers and link previews are left out. A reload counts
again, so these are visits, not people. The hour and the kind of device are kept as separate totals, never
tied to where a visit came from. Counting them began the day this shipped, and so did counting the canvasser
app page, so earlier days show a dash for those in the table. An iPad usually counts as a computer, because
its browser describes itself as a Mac. A link in an email or a text counts as QR code & direct, even when
an Android mail or messaging app names itself; the banner's AAPC-page address, copied and sent on, counts
as a visit like any other link.

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
  (**"Local races from $300 per campaign, per month. Every canvasser and feature included."**, then the
  risk-reversal sentence, which names no price), the
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
  site, and nothing sets a cookie. The one measurement is our own counts of page loads (*Traffic* above),
  kept on our server with no personal information in them.

## What the page claims — and the words we avoid

Every sentence on the landing page was checked against the code on 2026-11-01. These phrasings each
overstate what Doorline does, so they stay off the site:

| Avoid | Because | Say instead |
|---|---|---|
| "never lose data" | a queued item the server later rejects (canvasser removed, door deleted) isn't saved: since November 2026 it's listed for the canvasser and on the Audit page, but the door is knocked again | "Doors and surveys save on the phone and send as soon as there's signal again" |
| "the moment it happens" | flags are worked out when the Audit page loads, which refreshes every 20 seconds | "within seconds of syncing" |
| "syncs automatically", "in the background" | the queue sends on reconnect, app open, the next tap or sign-in — never in the background, and only while the person who recorded it is signed in | "send as soon as there's signal again" |
| "pings", "ping trails" | the app never tracks a canvasser between doors (a privacy-policy promise) | "where each result was recorded from, with a line to its house" |
| "voter identity stripped" | shared reports leave out names, but a house-level map — an opt-in per report — shows every knocked home's address and answers | name exactly what's left out, and only in the FAQ's *What's in a shared report?*: "No canvasser or voter names" (the owner's addendum 3 took it out of the Client reports band and /aapc) |
| "side-by-side comparisons" | there is one sortable table of every canvasser | "one table that ranks every canvasser" |
| "optimized walk order" | the order is a straight-line route, not a street route | "every book comes with a walk order" |
| "dedicated fake-GPS alert" | it's one flag among the Audit page's flags, not a separate alert | "Catches fake-GPS apps" — no platform named (the owner's decision, addendum 3: Android reports them today, and the iPhone check, iOS 15 and later, comes with the next app build) |
| a vendor list ("i360, L2, Data Trust…") | naming vendors invites "do you work with mine?"; the import reads any vendor's columns | "any major vendor" |
| "coverage" as a share of the universe | reports carry no such percentage | doors knocked, contact rate |
| "Nothing bad" | glib, and not quite true (see the first row) | "They keep knocking" |

Rows added by the Phase 2 claim check (Nov 2026 — every new line checked against the code):

| Avoid | Because | Say instead |
|---|---|---|
| "walled off" (campaigns) | people records, do-not-contact, do-not-knock addresses and the survey library are shared across an organization | "Each campaign gets its own team, books and reports" |
| "full control" (leads) | a lead can't change dates or billing rules, unknock, set do-not-contact, edit voters or run the full backup | "Hand a lead one campaign to run day to day, and nothing else" |
| "usually the same day" | never measured — `npm run report:setup-times` measures it | "often the same day" |
| "makes every door prove itself" | iOS doesn't report fake GPS, and results typed in at a desk carry the desk's location | "checks every door recorded in the app against its house" |
| "export everything" | do-not-contact voters, audit flags, survey designs, books and history aren't in any file | "Export your voters, results, survey answers and notes any time, even while paused" |
| "drops out of every count" (unknock) | a published client report keeps its numbers until refreshed | "drops out of every live count, and out of a client report when you refresh it" |
| "We'll help you get a voter file" | Doorline never obtains or handles a voter file for anyone | "We'll connect you with a vendor" |
| "We set up your first campaign on the demo call" | that would load a prospect's voter file before any agreement | "set up yours the day you sign up" |
| "free trial", "try it before you commit", "risk-free" | trials are real but decided client by client (the owner, Nov 16: a first-time customer can have 7 days free, and one who keeps going after them, having knocked, pays; he sets up and bills every client himself), so a blanket promise would be false for some. The billing meter can't tell: it counts a trial's knocks like any other (statement.js reads the subscription only for its rate), and the owner decides what to invoice. And setup needs a signed-up account | "New to Doorline? Ask about a free trial." after "Setup is free, and billing starts with your first knock." |
| "cancel anytime", "no contract", "no minimum" | how a customer ends service is set by their ordering agreement (terms.html §8, §13), which the code can't see; archiving stops a campaign's next renewal, but the month it's in has billed | nothing, until the owner confirms the terms |
| "billing starts the month of your first knock" | written for calendar months; a campaign first out since Nov 5, 2026 bills from the day of its first visit | "billing starts with your first knock" |

Platform totals say **"door knocks"**, never "doors knocked" — the printed AAPC ad's wording.

---

# Part 2 — Technical reference

## Three kinds of public page

| | React route | Prerendered React page | Static document |
|---|---|---|---|
| Pages | `/login`, `/forgot-password`, `/reset-password/:token`, `/r/:token` (and the console) | `/` (landing) and `/aapc` | `/privacy`, `/terms`, `/delete-account`, `/app` |
| Lives in | [`client/src/pages/`](../client/src/pages/) | `client/src/pages/`, rendered at build time into `dist/.prerendered/` | [`client/public/*.html`](../client/public/) |
| Served by | the SPA fallback in [`app.js`](../server/src/app.js) — the EMPTY shell | `PRERENDERED_PAGES` in `app.js`, **before** `express.static` | explicit `res.sendFile` routes, **before** the fallback |
| Registered in | [`server/src/webRoutes.js`](../server/src/webRoutes.js) → `WEB_SEGMENTS` | `WEB_SEGMENTS` too (it is still a React route) + the four places in *Prerendered pages* below | `STATIC_PAGES` in `app.js` |
| Head tags | inherited from `client/index.html` | `client/index.html`'s page-head block (the homepage's own); a page with a `head` in `entry-prerender.jsx` gets that block replaced whole (`/aapc`) | its own |
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

**Copy the header and footer from an existing static page.** The header is a static port of
`MarketingNav`: the four section links (`/#proof`, `/#reports`, `/#setup`, `/#faq`), Sign in, and
Request a demo as `/#demo`, which the homepage turns into an open form (`OpenDemoFromLink` in
`DemoRequest.jsx`, rendered first inside `LandingPage`'s provider; it drops the hash with
`history.replaceState`, so a reload doesn't reopen the form). Below 1024 px the links move into a native
`<details class="menu">` disclosure, so the menu needs no script. The five static pages (privacy, terms,
delete-account, app, 404) carry the identical block — markup and its CSS, from `.site-header{` through the
`.menu` media query; the header's button row is `.nav-actions` because `404.html` has an `.actions` of its
own. Add a new page to `STATIC_PAGES` in the brand-chrome test of
[`server/test/staticPages.int.test.js`](../server/test/staticPages.int.test.js), which requires the header's
markup and styles to match on every page. These pages draw in the system font stack; so does the React site
in practice (below).

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
  `#root` (marked `data-prerendered="<name>"`), `modulepreload` links for the page's own chunks, the
  AAPC inline date script, and — for a page with a `head` of its own — that head in place of
  `client/index.html`'s **page-head block** (everything between the `page-head:start` and
  `page-head:end` comments: title through JSON-LD). The block is swapped whole: three of its tags span
  several lines, and a half swap that left the homepage's canonical beside a `noindex` could get the
  homepage dropped from search. The build fails unless a page with a head has exactly one canonical
  (its own) and `noindex` exactly as configured, and a page without one keeps the shell's block
  untouched. Any surprise fails the build: a
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

**Adding a prerendered page (how `/aapc` shipped):** (1) the page component, its route in `App.jsx`
(`pages.<name> || lazy(...)`), and its segment in `WEB_SEGMENTS`; (2) an entry in
`entry-prerender.jsx`'s `PAGES` — `path`, `file`, `module`, `Component`, and a `head` (title,
description, canonical `url`, optional `robots`, OG title and description) unless it should carry the
homepage's; (3) a loader in `main.jsx`'s `PRERENDERED` map, so it loads its module before hydrating;
(4) a row in `PRERENDERED_PAGES` (it's then visit-counted too, a landing page on the Website page's
Traffic tab — give it a name in `pageLabel`, `client/src/lib/siteTraffic.js`, or it shows its path). Its
`useEffect` adds the `marketing` class and `stampAapc()` for a client-side arrival, as both pages do.

**Check a build:** `npm run build` ends with `prerendered / → dist/.prerendered/index.html` and
`prerendered /aapc → dist/.prerendered/aapc.html`; then with
`NODE_ENV=production npm start`, `curl -s localhost:$PORT/ | grep 'Know exactly what happened'` finds
the headline, `curl -s localhost:$PORT/login` is still the empty shell, and
`curl -sI localhost:$PORT/.prerendered/index.html` is a 404. `server/test/staticPages.int.test.js`
pins the serving rules.

## The AAPC banner and dates

`client/src/marketing/aapc.js` is the one config for every date-driven piece: `start` (Nov 1 — the
day `/aapc` shipped), `switchOn` (Nov 18), `end` (Nov 25), the event's time zone (Eastern), the
banner link, and `pageLive` (on). The prerendered pages can't know the date, so the build inlines
`aapcPhaseScript()` into `<head>`; before first paint it stamps two attributes, and `index.css` shows
the matching text:

- `<html data-aapc="before|after|off">` — **the banner's window**: off before `start` and from `end`.
- `<html data-aapc-event="before|after">` — **the event itself, no window**: `before` until `switchOn`,
  `after` from then, for good. `/aapc`'s founder line and its two main buttons' labels (`BookLabel`:
  *Find me at AAPC* / *Book 15 minutes with me*) use `.aapc-ev-before` / `.aapc-ev-after` (the before
  text shown by default); the booking form's words (`WORDS[voice].book[aapcEventPhase()]` in
  `DemoRequest.jsx`) and its *"At AAPC, Nov 17"* option follow the same switch, so `/aapc` never shows both
  texts and the option is offered from launch through Nov 17. The two classes set `display: revert`, so put
  them on an element with no display utility of its own.

`aapcPhase()` and `aapcEventPhase()` are the same rules for code that runs later; `stampAapc()` sets
both attributes on a client-side arrival. `aapc.test.js` pins the script to both functions hour by
hour, past Nov 25.

## Marketing components

[`client/src/marketing/`](../client/src/marketing/). `LandingPage.jsx` composes them in order and
pins `theme-light` so the public site stays light even when the app's dark theme is saved.

Conventions worth keeping: sections are `mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8` with
`py-16 sm:py-24` (tighter on a phone, where the page runs ~10,900 px at 390 wide); content data lives
in a module-level `const` array that gets `.map`ped; each page's `<h1>` belongs to its hero alone;
every focusable element carries `focus-visible:ring-2 focus-visible:ring-brand-600`.

The homepage (Phase 2, Nov 2026): `Hero`, `NumbersStrip`, `ProblemStrip`, `ProofSection` (`#proof`),
`PortalSpotlight` (`#reports`), `SetupSection` (`#setup`), `FeatureGrid`, `FounderNote`, `Faq`
(`#faq`), `CtaBand`. `/aapc` is `pages/AapcPage.jsx` with `AapcMockupCard`. The old product tour,
four-claim strip and How it works are gone, but **their ids stay as aliases** (`#turf`, `#field`,
`#how` on Setup; `#oversight` on Proof): `privacy.html`, `terms.html`, `app.html`,
`delete-account.html` and `404.html` link to them, and the legal pages are owner-edited.

Two components changed shape on Nov 15 and 16 (the owner's reviews):

- **`Faq`** renders each entry as a native `<details name="faq">`, so it folds with no script and works
  before hydration. The shared `name` keeps one answer open at a time where the browser supports it;
  an older browser lets several open, which is harmless. The plus turns into an × with `group-open:`.
- **`NumbersStrip`** is one layout on both pages, with no props (the Nov 15 `centered` prop was /aapc's
  alone; the owner asked for the homepage to match on Nov 16): centered, `py-8 sm:py-10` (it was
  `py-12 sm:py-14` with `mt-8` above the date), numbers `text-[22px]` on a phone and `sm:text-5xl` above,
  labels `sm:text-base`, the date centered under them. The component appends the plus, so `siteFacts.js`
  keeps the bare counts. 22 px is the phone size because the plus made `126,978+` 106 px wide at 24 px in a
  101 px column on a 360 px Android; at 22 px it is 97 px and fits from about 350 px up.
- **`FounderNote`** is as it was before Nov 15: the **Your data** list at `text-[15px]` with 18 px checks
  (set to the quote's size on Nov 15, reverted Nov 16).

**The typeface.** `tailwind.config.js` asks for `InterVariable`, but `@fontsource-variable/inter`
registers the family as `Inter Variable`, and `index.css` sets `body` to the system stack anyway, so
every page — the site and the console — draws in the device's own font (San Francisco on Apple devices),
and the Inter files are never downloaded. Checked in Chrome on Nov 15 (`CSS.getPlatformFontsForNode`).
That's the look everything has been approved in, and it is what keeps the static pages' lettering
matching. Switching to Inter would change every page at once, so it is the owner's call, not a fix to
slip into another change.

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

Single sources of truth, and CTAs must read from them rather than hard-coding:

- [`useAuthCta.js`](../client/src/marketing/useAuthCta.js) — `{ loading, authed, to, label }`, so
  nav and footer can never disagree about who is signed in.
- [`DemoRequest.jsx`](../client/src/marketing/DemoRequest.jsx) — `useDemoRequest().open()`, reached
  only through [`DemoButton.jsx`](../client/src/marketing/DemoButton.jsx). A DemoButton is a
  `mailto:` link in the markup, so a tap does something before the page hydrates (seconds on venue
  Wi-Fi); once live, its click opens the dialog. The link's address comes from the provider's context
  (`email`: `WORDS[voice].email` — `CONTACT_EMAIL` for `third`, `FOUNDER_EMAIL` for `first`, both in
  [`contact.js`](../client/src/marketing/contact.js)), the same address the dialog prints. The footer's
  Contact link always uses `CONTACT_EMAIL`. The provider wraps each page; `/aapc` passes
  `defaultSource="aapc"`, `askWhen` and `voice="first"`, so every control there books a meeting. The source a request
  sends is `pageSource() || options.source || defaultSource` — a tagged URL always wins. The dialog is a
  `fixed inset-0 overflow-y-auto` overlay around a `flex min-h-full items-center` wrapper that centers the
  panel (`max-w-xl`, a two-column form from `sm`): a panel taller than the window scrolls the overlay from
  its top, where centering the panel alone would cut its top off. `replyNote` sits beside the button with
  the `mailto:` address. There is no phone number on purpose (the owner, Nov 15: scrapers).
- [`siteFacts.js`](../client/src/marketing/siteFacts.js) — the three platform totals and the sample
  report's link and password (*The facts the pages state* below).
- [`SampleReport.jsx`](../client/src/marketing/SampleReport.jsx) — every "Open a sample report",
  always with its password; the hero's falls back to "See how it works" until the link exists.

The nav's section links (`SECTIONS` in `MarketingNav.jsx`) take a `base`: `''` on the homepage (a
plain `#proof` — a `/#proof` would reload a tagged `/?src=…` and lose the tag) and `'/'` on `/aapc`.

### The facts the pages state

- **Platform totals** (`PLATFORM_TOTALS`): refresh from `npm run migrate:platform-stats` in the Heroku
  Run console — without `--apply` it only reads — using its *"Would set the LIVE bucket to"* line
  (customer organizations only, and only what they have today). Not the Control Room's **Platform
  totals**: those leave the demo out too, but add the banked contribution of deleted orgs and campaigns —
  on Nov 16 that was 5 deleted campaigns that never knocked a door, so the panel read 27 campaigns where
  the live line read 22. Publish the exact count or round it down — never up — and date the caption;
  the strip shows exact counts with a plus (since Nov 16; the component adds it). Never publish the
  organizations count (the owner, Nov 16). The printed ad says 95,000+ door knocks and 23,000+ surveys,
  so never publish lower.
- **Client names**: none on the site since the owner's addendum 3 (the numbers strip's client line is
  gone). Any that come back need the client's written OK.
- **The sample report** (`SAMPLE_REPORT`): `/r/<token>` and its password, set after the four steps in
  Part 1. `routes/public/share.js` `isPublicSample` exempts exactly that token, and only while its link
  belongs to an internal organization, from the per-link wrong-password budget, and raises its
  per-address cap from 10 to 100 per 15 minutes. The share password field turns off auto-capitalize,
  auto-correct and spell-check for every viewer (`PublicReportLayout.jsx`).
- **"Often the same day"**: `npm run report:setup-times` (read-only; `services/site/setupTimes.js`)
  prints how long voter-file imports took in production, by size, customer organizations only. When it
  backs *usually*, the Setup heading and FAQ 1 may say so.

### Screenshots

Raw captures live in `client/shots-raw/` (gitignored); `npm run shots:optimize -- <file>` turns one
into its committed webp (`scripts/optimizeShots.js`, with an optional crop). The Proof pair (`audit`,
`locations`) is captured from the demo campaign on a local copy (`npm run seed:demo -- --apply` into a
scratch database), at 1440×900 @2x, **with every address blurred before the screenshot**: the demo's
doors are real Des Moines homes, and a readable address must never sit beside a made-up flag or answer.
The demo seed stages one run of six doors recorded from a parked car (`demoActivity.js`
`stageSuspiciousKnocks`: far, rapid, one-spot and one fake-GPS knock), so the Audit page has the real
thing to show.

## The demo-request endpoint

`POST /api/demo-request` — [`server/src/routes/public/demoRequest.js`](../server/src/routes/public/demoRequest.js),
mounted in `routes/index.js` above the auth gate.

| | |
|---|---|
| Body | `name`, `email`, `organization` (required); `role`, `teamSize`, `heardAbout`, `when` (optional — each one of its labels in `services/site/demoOptions.js`), `phone` (optional — 7–15 digits with the usual separators; a malformed one is a **400**, never a silent drop, because the person asked to be texted), `message` (optional); `source` (a `?src=` tag) and `page` (a path) — dropped, never rejected, when malformed; `company` (honeypot), `elapsedMs` (timing) |
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
`GET /api/super-admin/website/traffic?days=30` (1–366; the page asks for 7, 30 or 90) — *Visit counts*
below.

Mail goes out as kind `demoRequest` ([`templates.js`](../server/src/services/mail/templates.js)),
the only template addressed to Doorline rather than to a customer. It overrides the shared layout's
footer, and it passes the prospect's address as `sendMail`'s `replyTo` so Reply answers them.

**The subject is `Demo request — {organization}` and carries nothing else.** Subjects are copied
verbatim into `EmailLog`, which is metadata-only and readable on the super-admin Emails page, so
the prospect's name and address stay in the body, which is never logged.

Recipient is `DEMO_REQUEST_TO` (default `hello@doorline.app`) — override it on staging so test
submissions don't reach the real inbox.

Tests: [`server/test/demoRequest.test.js`](../server/test/demoRequest.test.js), 10 cases, no DB, runs
on plain `npm test`. It mounts the router on a bare Express app rather than calling `createApp()`,
which eagerly opens ioredis handles for bull-board. Saving, the failed-email path, bot rows never
saved, and the Website routes' access rules are in `server/test/demoRequestStore.int.test.js`.

## Visit counts

`services/site/siteVisits.js` `countVisit` runs as `app.js` serves a prerendered page (`PRERENDERED_PAGES`)
or `/app` (the `STATIC_PAGES` handler, `APP_PAGE`). A visit is a `GET` that wants HTML from something that
isn't a bot (a broad user-agent filter; no user agent at all counts as a script) and isn't a
prefetch/prerender. It writes two kinds of row, fire-and-forget (a failed write costs one count, never the
page; the returned promise settles when both have, for tests):

- **`SiteVisitDay {day, path, source, count}`**, for every visit. `day` is the owner's calendar day
  (Central). `source` is the page's valid `?src=` tag (never the reserved words `direct` or `internal`;
  a tag in `OWN_PAGE_TAGS` only when `Sec-Fetch-Site` is `same-origin` or absent, so the banner's /aapc
  address shared elsewhere is filed by where it really came from), else `internal` when the browser says the request came from one of our own pages (`Sec-Fetch-Site:
  same-origin` — our pages send no Referer, so a hop from `/aapc` to the homepage would otherwise read as
  `direct`, the QR-scan bucket), else the referring site's host without `www.` (only the host — never the
  URL), else `direct`. Its unique `{day, path, source}` index needs `migrate:build-indexes`; until then
  racing first visits can split a key across rows, which the reader sums.
- **`SiteVisitHour {day, hour, device, count}`**, for an ARRIVAL on a marketing page only — never a move,
  never `/app`. `hour` is the owner's (0–23; the hour a fall-back repeats holds both); `device` is
  `deviceOf(req)`: `Sec-CH-UA-Mobile: ?1` → phone, else the user agent (iPad / tablet / Android without
  "Mobile" → tablet; Mobi / iPhone / Android → phone; else computer — a new iPad's Safari says Mac). These
  rows carry no page and no source on purpose (privacy record item 55). Its unique index is synced at boot
  (`server.js` → `syncSiteVisitIndexes`), so no build-indexes step.

No IP, cookie or user agent is stored. **Arrivals vs moves:** `channelOf(source)` returns `null` for a move
— `internal`, or a tag in `OWN_PAGE_TAGS` (`home-banner`, the homepage banner's link to `/aapc`, pinned to
`client/src/marketing/aapc.js` by `siteVisits.test.js`; add any new tag our own pages put on a link to
each other) — else the channel: `direct` (also webmail sites and the Android mail and messaging apps that
name themselves as the referrer, `DIRECT_HOSTS`), `search` (a search engine's own address on any country
domain, plus AI assistants), `social` (networks, their shorteners and apps; subdomains match), `tagged` (no
dot: a `?src=` tag) or `other`.

**The read**, `GET /api/super-admin/website/traffic?days=N` (`routes/superAdmin/website.js`, super-admin
only; a bad `days` is a 400): `days[]` oldest first with zeros — `visits` (arrivals on the marketing
pages), `channels`, `moves`, `appPage`, `devices`, `hours[24]`, `demoRequests` (by `visitDay` of
`createdAt`); `today {day, hour, yesterday, lastWeek}`, each comparison day with `visits` and `byNow`
(its whole hours before this one plus this hour's share by the minute — the owner's zone is a whole number
of hours from UTC — or `null` unless the day came after `hoursSince`, the first day with hour rows, which
began mid-day), read from at least 8 days whatever the range; and for
the range, `sources` (non-direct arrivals with their channel, top 25), `pages`, `movesTo`, and
`demoRequests {total, heardAbout, pages, tags}` (an untagged `/aapc` request's `aapc` is its page, not a
tag; the tab names `home-banner` as the homepage's AAPC banner, `tagLabel`). Ranked biggest first, ties
alphabetical with "didn't say" (`null`) last. The open count comes from `GET /demo-requests` (`open`). The
table shows a dash, not a zero, for devices and the app page on days before `hoursSince`: both began with
the same release.

**The tab**, `client/src/components/website/TrafficTab.jsx` (`TrafficView` renders one read; the tab owns
the range and the picked day), polls every 60 s under `lib/livePoll.js`'s contract with the open-count
query beside it (`SuperAdminWebsitePage.jsx`, whose tab lives in `?tab=requests`). Charts are plain markup
in theme tokens: `VisitColumns.jsx` (columns with a tooltip on hover and focus, one Tab stop and arrow
keys, the selected day full brand and the rest `/75`, a dots strip for request days, the AAPC line from
`AAPC.day`) and `ShareRows.jsx`. Words and sums: `client/src/lib/siteTraffic.js`.

Tests: `server/test/siteVisits.test.js` (the rules: visit, source, channel, own-page and reserved tags,
device, hour), `server/test/siteTraffic.int.test.js` (real page serves through `app.js` against a
fixture dist write the rows; the read's numbers; super-admins only), client `lib/siteTraffic.test.js` and
`lib/websiteTrafficRender.smoke.test.js`.

## Privacy

The form is the only place in the product that collects personal data from someone who is **not a
user, not a voter, and not a customer**. What keeps that bounded, all load-bearing:

- **Stored, and the policy says so.** Since Nov 2026 each request is saved (`DemoRequest`) as well as
  emailed. The Privacy Policy's *Demo requests* paragraph names what is collected, why (reply and
  arrange a demo) and for how long (up to 24 months — the TTL). Only super-admins can see them, and a
  person's deletion request is a Delete on the Website page. The visit counter stores no personal
  information at all. A booking (`/aapc`) may add a **mobile number** — optional, kept with the rest
  of the request; the policy's *"anything else you choose to tell us in the form"* covers it.
- **The sample report is ours, not a customer's.** It's the internal demo organization's report, on the
  area map (no addresses), and its password is public by design; its view count records no IP or
  device. Its one exemption from the wrong-password limits applies only while it belongs to an
  internal organization.
- **No new subprocessor.** Mail goes through Resend, already listed in [`DPA.md`](DPA.md) §6.
  A hosted captcha (Turnstile, hCaptcha, reCAPTCHA) would be a new subprocessor — under the signed
  DPA that is a **customer-notice event**, not a code decision. That is why bot defence is a
  honeypot and a clock.

See the watchlist entry in [`PRIVACY_VERIFICATION.md`](PRIVACY_VERIFICATION.md).

## SEO checklist when touching public pages

- `client/index.html` owns the head for **every** React route, and the prerendered homepage is built
  from it — treat any change there as a change to the homepage's identity. A prerendered page of its
  own (like `/aapc`) gets its head from its `PAGES` entry, swapped in by `scripts/prerender.js`.
- `/aapc` is `noindex` with a self-canonical: an event page, not a search landing page. It stays out
  of `sitemap.xml` and must never be disallowed in `robots.txt` (a crawler has to read the noindex).
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
