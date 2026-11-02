# AAPC landing page — build brief, rulings and status

The plan for the doorline.app landing page ahead of the **AAPC Election Post-Mortem (Nov 17, 2026)**:
live by **Nov 14** for testing. Written 2026-11-01 from a browser review of the site, a claim-by-claim
check of the page against the code, and the owner's answers; two owner addenda followed the same day.
The brief and both addenda are kept below **verbatim**, with superseded lines marked, so later phases
build from the same text. What shipped is documented where it lives: [MARKETING_SITE.md](MARKETING_SITE.md)
(the site, demo requests, prerendering, the banner, visit counts) and [CLIENT_PORTAL.md](CLIENT_PORTAL.md)
(the shared-report map).

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Brief §3–6, and the §7.11 words removed from the current page | **Committed 2026-11-01 (`27e8711`)** — see *Phase 1, as built* |
| 2 | §7–9 (new page structure, /aapc), the offline-queue fix in §10 | **Website half BUILT 2026-11-01, uncommitted** — see *Phase 2 (website), as built*; the queue fix is [PROPOSAL_OFFLINE_QUEUE.md](PROPOSAL_OFFLINE_QUEUE.md) (two review rounds done; not built) |
| 3 (after AAPC) | The rest of §10: the iOS fake-GPS check, isolation tests before any trust page, later polish | Not started |

## Owner rulings during the build (2026-11-01)

These override the brief where they differ.

- **House-level maps stay — and show addresses and answers.** *"they should be able to see addresses and
  answers. lets say the candidate himself or the campaign manager asks for a report and says 'i wanna see
  what homes we've been to' i can send them a report link which will show them a map with all homes and
  they can filter by survey answer(s) etc."* So: the area map is the default (new reports, and existing
  reports by migration); the house-level map is an opt-in per report behind a warning, recorded with who
  turned it on, and when on it works as the old pins map did — addresses, answers, answer filters. This
  supersedes §3's "A shared view never returns a household's survey answers or street address" and its
  "coverage status only".
- **Demo requests are kept 24 months**, then delete themselves (a TTL), or sooner on request.
- **The demo form promises** "Omar will reply within one business day to set up a 20-minute
  walkthrough" (§5's bracketed values).
- **Privacy policy / terms wording**: approved for reports, report links and demo requests — with the
  house-level sentence revised after the ruling above (see Phase 1).
- **No target dates.** *"stop with the dates. we are deploying as soon as we finish which with your power,
  is in hours, not days."* The brief's Nov 12 and Nov 14 deadlines no longer apply; the plan states gates,
  not dates. What the page itself says on a given day stays (the banner's after-event text from Nov 18,
  gone from Nov 25). When the banner starts is question Q1 of the Phase 2 plan: the brief's *"Live from the
  /aapc launch"* was written for a launch around Nov 14.
- **Phase 2 decisions: every recommendation accepted**, except that the production phone update for the
  queue fix may go out before Election Day. A placeholder stands in for the photo; the name is **Omar
  Zumaya**.

## Phase 1, as built

- **§4 design fixes** — all eleven, plus the §7.1 eyebrow, subhead (addendum 2 §3) and price line, which
  were settled copy. Nothing animates in; phones get a full-size phone screenshot and never download the
  console map; the desktop map is cropped to the map; justified text gone; the header folds below 1024;
  `html.marketing` paints the page background white; phone body text ≥14px; icons match; images sized,
  hero eager, the rest lazy. Small red labels on tinted bands use `brand-700` (contrast).
- **§7.11 words** removed, and the FAQ takes §7.9's answers (adjusted for the house-map ruling). The
  "Words to avoid" table lives in MARKETING_SITE.md.
- **§3 shared reports** — area by default, house-level opt-in with a warning and a server-side
  confirmation, existing reports moved by `npm run migrate:client-report-areas` (CLIENT_PORTAL.md).
- **§5 demo form** — the new fields including addendum 2's "How did you hear about us?", saved before
  it's emailed, `?src=` and page recorded, no autofocus on touch, neutral focus ring, personal thank-you.
  Super-admin **Website** page (`/super-admin/website`) lists requests and visits.
- **§6 speed and crawlability** — the homepage is prerendered to real HTML and hydrates in place
  (`/app`, `/privacy`, `/terms` were already static); JSON-LD `Offer` with a per-campaign, per-month
  unit; hashed assets cached a year; first-party daily visit count (addendum 2 §5); `/app` says "See how
  it works". `/aapc` gets prerendered when it exists (Phase 2 — MARKETING_SITE.md lists the four steps).
- **Addendum 2 §2 banner** — built into the prerendered page with its date switch in
  `client/src/marketing/aapc.js`, and **off** (`pageLive: false`) until `/aapc` ships, so it can never
  link to a missing page. Phase 2 turns it on in the same change that adds `/aapc`.
- **Not done in Phase 1:** §7.2 numbers strip (unblocked by addendum 2 but part of the restructure),
  §9 verification items (a)–(f).

Deploy steps (owner, Heroku dashboard): deploy, then in **More → Run console**:
`npm run migrate:build-indexes -- --apply` (the demo-request expiry and the visit-count index),
`npm run migrate:client-report-areas` (dry run — read the list), then
`npm run migrate:client-report-areas -- --apply`.

## Phase 2 (website), as built — 2026-11-01

Built to the plan below (v2 with the owner's answers), in this tree, uncommitted. Where it differs:

- **The homepage**: Hero, Numbers, Problem, Proof (`#proof`, light stone-100), Client reports, Setup,
  Features, Founder & trust, FAQ, final CTA. 10,926 px at 390 wide (the brief's baseline was ~11,900;
  12,725 before tightening phone spacing, hiding Setup's phone shot on phones — the hero shows the same
  one — and showing Proof's map alone on phones). 8,341 px at 1440. Old ids kept as aliases.
- **Proof's screenshots** are new: the Audit page and the map with canvasser locations, from the demo
  campaign with every address blurred. The demo data had only weak-GPS flags, so the demo seed now
  stages one run of six doors recorded from a parked car (far, rapid, one-spot, one fake-GPS knock) —
  internal demo org only; production's copy changes at the next Rebuild demo day.
- **Sample report**: wired (`siteFacts.js` `SAMPLE_REPORT`), but empty until the owner's four steps in
  C-f give it a URL and password; until then the hero reads *See how it works* and the other spots show
  nothing. The lockout exemption and the password-field fix are in.
- **Numbers**: the brief's Nov 1 figures, pending the owner's `migrate:platform-stats` output.
- **Timing report**: `npm run report:setup-times` (imports only).
- **/aapc**: as planned; the banner starts Nov 1. The form's booking variant adds the optional mobile
  number. Every date case checked in a browser (Nov 17 23:00, Nov 18, Nov 25, Dec 10 Eastern).
- Docs: MARKETING_SITE.md, CLIENT_PORTAL.md, OPERATIONS.md, PRIVACY_VERIFICATION.md items 51(g) and 53,
  the Website page's Help Center guide.

## Phase 2 plan (v2, 2026-11-01) — rewritten after review round 1

Four parts. A–C are the website: one server deploy, nothing for phones. D, the offline-queue fix, has its
own plan, [PROPOSAL_OFFLINE_QUEUE.md](PROPOSAL_OFFLINE_QUEUE.md): a server deploy plus a phone update.
Line references are to HEAD `27e8711`.

### A. The homepage, rebuilt to §7

| # | Section | Background | What's in it | Waiting on |
|---|---|---|---|---|
| — | AAPC banner | red | Built in Phase 1. Switches on with /aapc, the day it ships (Q1); after-event text from Nov 18; gone from Nov 25, by itself | — |
| — | Header | white | Proof · Reports · Setup · FAQ, Sign in, Request a demo | — |
| 1 | Hero | white | As live now, plus **Request a demo** / **Open a sample report** (password beside it) and *Web console for the office · iOS & Android app for the field*. The demo buttons work before the page's JavaScript arrives (B) | the sample link (C-f) |
| 2 | Numbers | stone-50 | Four totals from one constant, captioned with the date they were read (C-d); Fox Bryant on a client line (addendum 1); quote 1 | the numbers check (C-d), a quote |
| 3 | Problem | white | *A door program shouldn't live in five tools*: today's three cards, the new honor-system card (question Q4), the closing line as *"Doorline puts it all in one place, and checks every door recorded in the app against its house."* | Q4 |
| 4 | Proof `#proof` | decision 1 | Eyebrow, H2, body, the six bullets, two new screenshots (Audit page with flags; map with canvasser locations), quote 2 | decision 1, a quote |
| 5 | Client reports `#reports` | brand-50 | *Send a report, not a spreadsheet*, body (the PDF is confirmed), the house-map line as built, **Open a sample report** with its password, the portal screenshot, quote 3 | the sample link, a quote |
| 6 | Setup `#setup` | white | H2 as *"From voter file to knocking, often the same day"* until decision 5's report backs *usually*; the two columns, the turf and phone shots, quote 4, *How canvassers get the app →* | the geocoding check (C-c), Q2, a quote |
| 7 | Features | stone-100 | *Built for firms running many campaigns*, nine cards | — |
| 8 | Founder & trust | white | Your note (addendum 1 §2) signed *Omar Zumaya, Founder, Doorline*, the four trust lines, Privacy policy | a monogram (OZ) stands in for the photo, never a stock face; the title is a placeholder too |
| 9 | FAQ `#faq` | stone-50 | Phase 1's nine answers (FAQ 1 per Q3, FAQ 2 per Q2) | Q2, Q3 |
| 10 | Final CTA | brand-50 | *See Doorline run your next canvass*, body (per Q3), both buttons, the sample report's password beside its button | Q3 |

**Goes away:** How it works (the brief cuts it), today's four-claim strip (its lines live on in Proof and
Setup), and today's product tour (split into Proof and Setup). That takes the survey phone screenshot with
it, which shows a real Des Moines address beside a made-up voter answering "Strongly support" (the §7.6
check). Quote slots without a supplied quote don't render. The length is measured after the build against
the brief's ~11,900 px at 390 wide; the bar is *clearly shorter*. **The old section ids stay as anchor
aliases** (`#turf`, `#field`, `#oversight`, `#how`): `privacy.html`, `terms.html`, `app.html`,
`delete-account.html` and `404.html` link to them, and the legal pages are owner-edited. On the homepage
the header links are plain `#proof`; a `/#proof` would reload `/?src=…` and lose the tag.

**New screenshots** come from the demo campaign on a local copy, captured the way the existing ones were
(`client/shots-raw/` → `npm run shots:optimize`). If the demo data has no flagged doors to show, the demo
seed gains a few; that touches only the internal demo org, and production's copy changes only when
someone presses Rebuild demo day. **The Audit page lists each flag with its address**
(`FlaggedEntryList.jsx:17-19, 77`), and the demo's addresses are real Des Moines homes, so that shot is
cropped or blurred to keep any readable address from sitting beside a made-up flag; both new shots get
the §7.6 check.

**Copy the code requires** (beyond the brief's text): see *Claim check* below.

### B. /aapc, and the banner switched on (addendum 2 §4)

Top to bottom: eyebrow, H1, subhead, the ad's three bullets word for word, the ad's mockup card built in
HTML with its example numbers (tagged *Example*, decision 2, with a *+ 12 more books* row so its 41% adds
up), the monogram with the before/after line, **Book 15 minutes with Omar** / **Request a demo** (both
open the form with **When?**), the numbers strip, three short blocks (Proof, Client reports, Many
campaigns, in the claim-checked words), the sample report link with its password, the price line.

- **Prerendered** like the homepage, with its own head and `noindex`. `prerender.js` swaps exact strings,
  and three head tags span several lines, so `client/index.html`'s block from `<title>` to the JSON-LD is
  wrapped in comment markers (Vite keeps comments) and replaced whole per page, values escaped. /aapc gets
  a self-canonical and `noindex`; a half swap that left the homepage's canonical beside `noindex` could
  get the homepage dropped from search. The build fails unless /aapc has exactly one self-canonical plus
  `noindex` and `/`'s head is unchanged. /aapc stays out of `sitemap.xml` and isn't disallowed in
  `robots.txt` (a crawler has to read the `noindex`). The rest is the four places in MARKETING_SITE.md,
  plus `pageLive: true`.
- **What the page says switches by itself, with one more attribute.** The banner keeps `data-aapc` (its
  window, Q1). The same inline script also stamps `data-aapc-event`: `before` until Nov 18 (Eastern),
  `after` from then, with no start or end. /aapc's photo line and the When? select read that one, so the
  page never shows both lines (after Nov 25 or with JavaScript off, `data-aapc` reads `off`). CSS shows the
  before-line by default; the variant is never chosen during render (that would break hydration).
  `aapc.test.js` runs past Nov 25.
- **Source:** the dialog sends `pageSource() || options.source || defaultSource`, with
  `<DemoRequestProvider defaultSource="aapc">` on /aapc, so a `?src=home-banner` always wins and the
  header's button (which passes its click event, not options) still sends `aapc`. Every demo button is
  tested.
- **Buttons work before the JavaScript arrives.** Until the page hydrates (about 94 KB gzipped plus the
  page chunk, seconds on venue Wi-Fi) a `<button>` does nothing. Every demo control renders as
  `<a href="mailto:hello@doorline.app?subject=…">`, whose click handler opens the dialog once the page is
  live: same markup on server and client, so hydration is safe. `contact.js`'s comment changes to say the
  mailto is the before-JavaScript fallback, never the primary path.
- **The booking dialog fits a 15-minute meeting.** When the dialog asks When?, its intro reads *"Book 15
  minutes with Omar, at the event or after. He'll email or text you to set a time."* instead of the
  20-minute walkthrough and next-business-day promise, and it offers an optional **Mobile number (for a
  text)** (Q5).
- **After Nov 25** the banner disappears by itself; /aapc stays up with the after-event line (decision 3).
- On /aapc the header's section links point at `/#proof` etc.; on the homepage they stay `#proof`.

### C. The §9 checks — answered

- **a. PDF — exists.** **Download PDF** on the shared report and in the builder
  (`PublicReportDetailPage.jsx:118`, `ClientReportBuilderPage.jsx:1159`, renderer `lib/reportPdf.js`); the
  map is left out on purpose. Reports copy: *"Send it as a password-protected link that expires on its own
  and can be revoked, or as a PDF."*
- **b. Unknock** drops an entry from campaign totals, Door Outcomes, future exports and the Billing page's
  door count (`services/billing/statement.js:75-78`). A published client report keeps it until **Refresh
  numbers**; issued statements stay frozen, with a drift warning. Proof copy: *"…an unknocked entry drops
  out of every live count, and out of a client report when you refresh it."* The Billing page already shows
  each campaign's billable doors per month (decision 4).
- **c. Geocoding** — nothing in the app shows the setting. **You check:** Heroku dashboard → the app →
  **Settings** → **Reveal Config Vars** → `GEOCODE_ENABLED` must read exactly `true`. Anything else (unset,
  `1`, `TRUE`) is off, and then imports reject rows without coordinates, which makes Setup's *"the rest
  wait for you to place by hand"* wrong.
- **d. Platform totals and the legal text.** The Terms already allow it: Doorline "may create, retain, and
  use aggregate usage statistics … (such as total organizations served, campaigns run, or doors knocked)"
  (`terms.html:91`); the privacy policy and DPA speak only of retaining aggregates, and nothing forbids
  publishing. Optional clarifying edit (yours, ideally with a lawyer): *"create, retain, use, and publish …
  (such as total organizations served, campaigns run, doors knocked, surveys taken, or voter records
  processed)"*. Not a blocker. **The numbers themselves need one check before they go live:** the Control
  Room's overview cards count demo and internal campaigns, and its lifetime panel, which skips internal
  orgs, still includes counts banked from deleted campaigns, test ones among them. Run
  `npm run migrate:platform-stats` in **More → Run console** (without `--apply` it only reads; verified
  from the repo root) and paste the output. The constant takes the dry run's freshly computed live
  numbers (*"Would set the LIVE bucket to…"*), rounded down, and the caption names the day it was run. If
  any comes out under the printed ad's figure (95,000+ knocks, 23,000+ surveys), I flag it before it
  publishes rather than show a smaller number than the ad. Test organizations not marked internal are
  counted too, so tell me if any exist. Same command whenever you refresh the numbers.
- **e. "Usually the same day"** has never been measured. Import jobs keep start, finish and row counts;
  turf cuts leave timing in the queue for 7 days. Decision 5.
- **f. Sample report.** The demo campaign already publishes an **area-map** report with a demo link, and
  area reports refuse door taps (the per-door call answers 409; no addresses anywhere). The page links to
  `/r/<token>`, never to a report URL (the report id changes on every Rebuild demo day). The setup, once
  (`SEED_DEMO_SHARE_PASSWORD` never replaces a password a link already has, `seedDemoOrg.js:716-736`):
  1. In **Share**, set the demo link's password to a lowercase phrase of 12+ characters you're happy to
     print.
  2. In **Settings → Config Vars**, set `SEED_DEMO_SHARE_PASSWORD` to the same phrase and
     `SEED_DEMO_SHARE_TOKEN` to the link's current token (so a `--rebuild` recreates the same URL and
     password).
  3. **Extend** the link to the end of its one-year life.
  4. **Never press Renew, New address or rotate on it** — each gives it a new URL. If it ever expires,
     **Rebuild demo day** brings it back at the same URL.
  Acceptance: open the printed URL on a phone and unlock it with the printed password. **Lockouts:** a
  published password turns two safety limits into ways to lock everyone out, even with the right
  password: 10 wrong tries per Wi-Fi address per 15 minutes (a whole venue shares one) and 50 a day from
  anywhere (`share.js:161-169`, `shareLinks.js:24`). The demo link (internal org, pinned token) is exempt
  from the daily limit and gets a higher per-address one; the password field turns off auto-capitalize,
  auto-correct and spell-check for every viewer (`PublicReportLayout.jsx:33-40`; iOS capitalizes the first
  letter today). If it ever locks: **Unlock now** in Share, never rotate. **Renewal date:** the link's
  **Expires** date in Share. The demo's view counts record no IP or device.

### Decisions

**Decided by the owner, 2026-11-01: all as recommended.**

| # | Question | Recommended |
|---|---|---|
| 1 | The brief makes Proof a dark band (stone-900); you've said black isn't Doorline's color. | **Light**: stone-100 with the red eyebrow, the brief's order otherwise |
| 2 | Tag the /aapc mockup card *Example*? Its numbers are made up. And keep the ad's word **Live** on it, though the app badges a running pass *Active*? | **Yes, and keep "Live"**: the page should read as the ad's page, and the app's numbers do refresh live |
| 3 | Keep /aapc up after Nov 25, with the after-event line? | **Yes** (noindex) |
| 4 | Feature the billable-door count for firms that bill clients per door? Proposed Proof bullet: *"A door count you can invoice from: once per door per pass each month, with unknocked entries removed."* (The Billing page counts by month, so a pass that spans a month end counts a door in both.) | **Yes** — the brief asked for it if it exists, and it does |
| 5 | Back "usually the same day" with real numbers: a small read-only console report of import times by size, customer orgs only, no names (turf-cut timings last only 7 days, so imports only), run once it ships. The page says *"often the same day"* until it backs *usually*. If no import near 100,000 rows exists yet, keep *often*, or approve one timed test import into an internal org (a write). | **Build the report** |
| 6 | Quotes: none yet. | **Ship without**; slots appear when you send them |
| 7 | The printed ad says *"Numbers by pass, book and canvasser"*, and the homepage and /aapc repeat it. Pass and canvasser results exist; a book shows its progress (17/70, *In progress*), as the ad's own card does. Keep the words as printed, or add a **By book** table to campaign Home (doors, connection rate and surveys per book), so the line holds in full? | **Keep the words** for AAPC (the ad's card shows exactly what a book shows); the By book table makes a good first job after AAPC |

### Questions from review round 1 — answered by the owner, 2026-11-01

| # | Question | Answer |
|---|---|---|
| Q1 | **When does the banner start?** "From the /aapc launch" now means about three weeks, across Election Day. | **Today** — `AAPC.start` becomes the day /aapc ships |
| Q2 | **"Need a voter file? We'll help you get one."** (FAQ 2 since Phase 1, and Setup) | **Advice: connecting them with a vendor.** Setup: *"Need a voter file? We'll connect you with a vendor."* FAQ 2: *"Don't have one? We'll connect you with a vendor."* Doorline never obtains or handles the file. |
| Q3 | **"We set up your first campaign with you on the demo call"** (FAQ 1 and the final CTA) — a prospect's voter file before any agreement | **Reworded:** FAQ 1 *"…We walk you through it on a demo campaign, and set up yours the day you sign up."* (its opening also becomes *"Often the same day."*, decision 5); final CTA *"…on a live demo campaign, and set up yours the day you sign up."* |
| Q4 | Keep the **honor-system** card? | **Keep** |
| Q5 | **At AAPC, how does someone who books 15 minutes find you?** | **No table: email or text.** The booking dialog reads *"Book 15 minutes with Omar, at the event or after. He'll email or text you to set a time."* and, whenever it asks When?, offers an optional **Mobile number (for a text)**. Stored, emailed and listed with the request like its other fields; a new field of personal information, flagged under Privacy (the policy's *"anything else you choose to tell us in the form"* already covers it). |

### What I need from you

1. A photo (square, at least 800 px) to replace the monogram, and the line under *Omar Zumaya* if not
   *Founder, Doorline* (it can't present Fox Bryant as who built or owns Doorline).
2. Optional: up to four quotes, each with a name, a title and their written OK.
3. Fox Bryant on the client line: the name as text (recommended) or a logo file.
4. Optional: a scheduling link (adds *Pick a time now* after the form) and an AAPC attendee offer.
5. The platform-stats output (C-d), the `GEOCODE_ENABLED` value (C-c), and the two demo-link config vars
   (C-f, with the steps I'll give you).

### Order and gates

- **Website (A–C):** built and checked locally (phone and desktop widths, JavaScript off, Lighthouse, the
  date cases) → you review screenshots → you commit → deploy as soon as it's checked. Nothing for phones.
- **Offline queue (D):** its own plan — server first, the staging phone update, then production once the
  staging check passes and the privacy-policy edit is live.
- **One at a time:** the website first, handed over for its commit, then the queue fix. Your single
  `git add -A` ships whatever is in the tree, so two half-built halves must never sit in it together.

### Acceptance

Brief §11 and addendum 2 §6, each run and reported, plus: `/aapc` serves prerendered HTML with `noindex`;
a request from /aapc arrives with `source=aapc`, and from the banner with `home-banner`; with the date
set to Nov 10, /aapc offers "At AAPC, Nov 17"; on Nov 18 it doesn't, and the photo line has switched.

### Privacy (CLAUDE.md invariant)

- **Numbers strip** — platform-wide totals derived from customer data; the Terms allow aggregate usage
  statistics (C-d). Flagged, not blocked.
- **Sample report** — the internal demo org, area map, no addresses or names; the password is published;
  views are counted without IP or device.
- **/aapc visits** — the same first-party daily count; PRIVACY_VERIFICATION item 51(d) gains `/aapc`, and
  the Website page and its Help Center guide (`page-website.md:33-35`) show visits per page. A move from
  /aapc to the homepage (`Sec-Fetch-Site: same-origin`) counts as internal, not *direct* — direct is the
  bucket that measures QR scans.
- **The sample link's exemptions** — the demo link skips the daily wrong-password limit and gets a higher
  per-address one; its pinned token keeps one sample URL alive past the policy's "up to one year" (our
  internal demo org only). Both recorded in PRIVACY_VERIFICATION.
- **Decision 5's timing report** reads every customer org's import jobs: a new PRIVACY_VERIFICATION item
  (item 50's console-output rule: totals only), a root `package.json` proxy, an OPERATIONS row.
- **Q2 and Q3** settled as privacy questions: Doorline only connects a prospect with a vendor, and loads
  no voter file before sign-up.
- **New field: an optional mobile number** on demo requests that ask When? (Q5). Kept 24 months like the
  rest of a request; PRIVACY_VERIFICATION item 51 gains it. The policy's demo-request sentence (*"…and
  anything else you choose to tell us in the form"*) already covers it, so no policy edit.
- **Founder photo and name** are yours; client names and quotes need written permission.
- Nothing new is collected; the demo form changes only in when it offers "At AAPC" and its 15-minute
  wording.
- **The offline-queue fix is privacy-affecting** — see its §H.

### Claim check (every new line, against the code)

Twenty-two claims checked. Thirteen hold as the brief wrote them, including GPS on every door, flags
recomputed each time the Audit page loads, the import taking .xlsx, cutting by size, precinct, district or
a drawn area, re-cuts keeping history, fully-voted households dropping off, canvassers seeing only their
own books, renaming survey options safely, lit drops, per-campaign time zones, and audited, time-limited
staff access. The rest need these words:

| Brief's line | Why | Ships as |
|---|---|---|
| "an unknocked entry drops out of every count [and the billable total]" | A published report keeps its numbers until refreshed; changing an outcome or unknocking is on Door Outcomes, org admins only | "…an unknocked entry drops out of every live count, and out of a client report when you refresh it." |
| "Send it as a [PDF or a] password-protected link…" | The PDF exists (no map) | "Send it as a password-protected link that expires on its own and can be revoked, or as a PDF." |
| "shows exactly what will change before anything is written" | The preview gives counts and examples, and "updated" counts every matched voter | "shows what will change before anything is written" |
| "Every campaign is walled off with its own team, turf and reports" | People records, do-not-contact, do-not-knock addresses and the survey library are shared across the organization | "Each campaign gets its own team, books and reports. Run all of them from one account." |
| "Give a lead full control of their campaign and nothing else" | Leads can't change dates or billing rules, unknock, set do-not-contact, edit voters or run the full backup | "Hand a lead one campaign to run day to day, and nothing else." |
| "fully-voted households drop off every book" | Each campaign takes its own voted list | "…drop off every book in that campaign." |
| "Export Center: Take your data with you any time." / "Export everything, any time." | Exports work even while paused, but do-not-contact voters, audit flags, survey designs, books and history aren't in any file | "Export your voters, results, survey answers and notes any time, even while your account is paused." / "Export your voters, results and notes any time, even while paused." |
| "Location is recorded only when a door is recorded, never between doors." | A lead's pin move can store their position as the new pin | "Location is recorded only when you save something at a door, never between doors." (FAQ 5 takes the same words) |
| "Numbers by pass, book and canvasser" (the printed ad) | Pass and canvasser results exist; a book shows progress only (17/70 and its status) | Decision 7 |
| /aapc card: "Live" | The app badges a running pass **Active**; its green **Live** dot is the auto-refresh switch. *Done*, *Progress* and *Connection rate* are the app's own words | Decision 2 |
| "Doorline puts it all in one place, and makes every door prove itself." | iOS fake GPS isn't detected, and paper results typed in at a desk carry the desk's GPS | "…and checks every door recorded in the app against its house." |
| "From voter file to knocking, usually the same day" | Never measured (decision 5) | "…often the same day" until the report backs *usually* |
| The mockup card's 41% | Its three books add up to 59/156 = 38% | A *+ 12 more books* row |

**Found along the way (not in Phase 2 unless you say so):**
- The phone's admin menu calls the live map **"Doors & canvasser pings"** (`mobile/components/CampaignHome.jsx:1107`) —
  the word the site bans, and it reads like tracking. Fixed in the offline-queue phone update (*Doors &
  canvasser locations*).
- A **confirmed** fake-GPS knock stays in a client report's numbers with no warning; the publish warning
  counts only unreviewed ones.
- Paper results typed in at a desk carry the desk's GPS, so they show up as far-from-house flags.
- The Audit page shows **no** flags (not a partial list) when a range holds over 250,000 entries; ranges
  over 62 days are refused; the list stops at 500.
- A pin move sends the phone's position even when the pin is dragged; the server ignores it (a note for
  the privacy record).

### What changed after review round 1 (2026-11-01)

Four reviewers ran: one on this website half, three on the queue fix (their changes are in
PROPOSAL_OFFLINE_QUEUE.md §K), one of whom also checked this half's privacy and release.

| Found | Change |
|---|---|
| **Blocker:** the sample link's password plan couldn't work: the config var never replaces a link's existing password, and Renew gives a new URL | The four-step setup in C-f, with an acceptance check |
| A published password makes the wrong-password limits lock everyone out, a whole venue at once; iOS capitalizes the first letter | The demo link is exempt; auto-capitalize off; a runbook |
| A tagged visit (`?src=home-banner`) lost to the button's own source, and the header's button sent none on /aapc | One source order, a page default, every button tested |
| After Nov 25, or with JavaScript off, /aapc would show both photo lines | `data-aapc-event` |
| /aapc visits were added into the homepage's total, and hops from /aapc counted as *direct* (the QR bucket) | Per-page columns; same-origin moves count as internal |
| Demo buttons do nothing until the JavaScript arrives, seconds on venue Wi-Fi | They render as mail links the dialog takes over |
| "Book 15 minutes" opened a dialog promising a 20-minute walkthrough and a next-day reply | 15-minute wording; Q5 |
| The head swap could leave the homepage's canonical beside `noindex` | Whole-block swap between markers; build checks |
| Removing old sections would break links from five static pages, and `/#proof` reloads a tagged homepage | Old ids kept as aliases; `#proof` on the homepage |
| Billing counts by month | Decision 4's bullet says *each month* |
| Live-only numbers could come out under the printed ad's | Flagged before publishing; the caption names the read date |
| Copy that claims more than the code (closing line, *usually*, the card's 41%), the CTA's missing password, /aapc's blocks | Claim check rows; fixed in A and B |
| Privacy: voter-file help and day-one setup handle a prospect's voter data; the Audit shot shows real addresses; the sample URL outlives "one year"; the timing report reads every customer's imports | Q2, Q3, the shot cropped, records in PRIVACY_VERIFICATION |
| The banner running three weeks through Election Day | Q1 |

---

## The brief (verbatim, Nov 1, 2026)

> DOORLINE LANDING PAGE: BUILD BRIEF (Nov 1, 2026)
> Deadline: AAPC event, Nov 17. Live by Nov 14 for testing.
> Sources: browser review of doorline.app, your code-verified claim check, and Omar's answers.

### 1. Settled decisions
- Buyer: canvassing firms first (one campaign or many), then consultants, campaigns, committees and advocacy groups.
- Market: Republican and conservative. Keep the red brand. Name i360, L2 and Data Trust as file sources.
- Sales: demo-led. No self sign-up.
- Why Doorline wins: accurate numbers traceable to a door, fraud flags, a live map, and an app that just works (invite email, set password, knocking).
- Price line: "Local races from $300 per campaign, per month." No ranges.
- ~~Keep Doorline publicly separate from Fox Bryant: no Fox Bryant name anywhere unless Omar says so.~~ *(Replaced by addendum 1 §1.)*
- No client uses house-level maps in shared reports, so the default can change freely.
- RETIRE_ALL_REPORTS_LINKS is true in production, so "links expire" holds.

### 2. Phases
- Phase 1, this week (no new input needed): sections 3–6, and remove the 7.11 words from the current page.
- Phase 2, by Nov 12 (needs Omar's inputs): sections 7–9 and the offline-queue fix in 10.
- Phase 3, after AAPC: the rest of section 10.

### 3. Privacy fix for shared client reports (do first)
Problem: new reports default to an exact-pin map. In the shared view, tapping a door returns that household's street address, status and every survey answer (/api/share/:token/reports/:id/map/doors). The page claims voter identity is stripped.
Fix:
- Default new and existing reports to the area map.
- ~~A shared view never returns a household's survey answers or street address. A house-level map, if kept, shows coverage status only.~~ *(Superseded by the owner's house-map ruling above: an opted-in house map shows addresses and answers.)*
- The house-level map is opt-in per report, with a warning.
- Update privacy.html (~line 101, "at the address level") to match.
- Test the share endpoints with a valid token: no address or answer fields come back. *(Now: for area reports.)*

### 4. Design fixes to the current page
1. The hero must be fully visible on first paint, with no opacity animation above the fold. Today it fades in on load at 390 and 1280–1920.
2. Below the fold, remove opacity-0 from the reveal wrapper ("translate-y-4 opacity-0 transition-all duration-700 … data-[visible=true]"), or drop the reveals. Content must never be blank after a nav jump.
3. Left-align the 4 justified paragraphs and their bullets.
4. The eyebrow must fit on one line at 1024/1280/1440/1920. Its column is ~433px; the new copy is 34 characters.
5. Collapse the header links into the menu button below 1024px. They wrap onto two lines at 768.
6. Phones (<640px): lead with the phone screenshot (~260px wide) right under the CTAs. The console shot renders at 16% scale and the overlapping phone at 82px, so both read as texture.
7. Desktop hero: crop the console shot to the map, the "Survey recorded – synced" toast and the phone overlay. It renders at 27% scale and the sidebar is noise.
8. Marketing routes: set the html/body background to white. Body is rgb(11,15,25), which shows as a dark band on Mac and iPhone overscroll. Scope the change so the console keeps its own background.
9. Phone body text ≥14px (12 blocks are under 13px). Use 12px only for eyebrows and captions.
10. Icons must match their labels (today: scissors on "Canvasser insights", a map pin on "Voter profiles").
11. Images: set width/height; hero eager with fetchpriority=high; everything else lazy.

### 5. Demo form
- Intro: "Tell us about your team. Omar will reply within [one business day] to set up a [20-minute] walkthrough."
- Fields:
  - Name*
  - Work email* (placeholder you@yourfirm.com)
  - Organization* (placeholder "Firm, campaign, or committee")
  - You are (optional): Canvassing firm / Consulting firm / Campaign / Party or committee / Advocacy group / Other
  - Team size (optional): Just me / 2–10 canvassers / 11–50 / 51–200 / 200+ (fixes the "Just me canvassers" typo)
  - Anything else? (optional)
- No autofocus on touch devices. On desktop, use a neutral focus ring; red reads as an error.
- Success message: "Thanks, {first name}. Omar will email you within [one business day]." Add "Pick a time now" if Omar supplies a scheduling link.
- Store every request in the database as well as emailing it; today a failed email loses the lead. Save the source (?src=…, or "aapc" on /aapc) and the page it came from.
- Keep the honeypot, the 2-second minimum and the rate limit.

### 6. Speed and crawlability
- Prerender /, /app, /aapc, /privacy and /terms to static HTML at build; the console stays a single-page app. Today the body is an empty #root until ~300 KB of JavaScript plus the landing chunk load, so a QR scan on conference Wi-Fi can land on a white screen.
- Give each route its own title, description and Open Graph tags (/aapc can be noindex).
- Add offers (price 300, USD) to the SoftwareApplication JSON-LD.
- Optional: first-party visit counts for / and /aapc, by day and source. Server-side only: no cookies, no stored IPs, no third-party scripts. *(Turned on by addendum 2 §5.)*
- /app: replace "Take the tour or request a demo" (no tour exists) with "See how it works or request a demo from the homepage."

### 7. New page structure and copy
Target: noticeably shorter (now ~11,900px at 390px wide, about 14 phone screens). Cut "How it works"; the pipeline is told three times.
Nav: Proof · Reports · Setup · FAQ, plus Sign in and Request a demo.
Section backgrounds, top to bottom: white, stone-50, white, dark (stone-900), brand-50, white, stone-100, white, stone-50, brand-50.
Copy marked [confirm] depends on section 9.

#### 7.1 Hero (white)
- Eyebrow: FOR CANVASSING FIRMS AND CAMPAIGNS
- H1: Cut the turf. Walk the doors. Know exactly what happened. (keep, with the last sentence in red)
- Subhead: ~~Every door GPS-stamped. Knocks that don't add up, flagged. Every result live on one map. Run one campaign or twenty, and hand clients numbers they can trust.~~ *(Replaced by addendum 2 §3.)*
- Buttons: [Request a demo] [Open a sample report]. Until 9f is done, use [See how it works] → #proof. Sign in stays in the header and footer only.
- Price line: Local races from $300 per campaign, per month. Every canvasser and feature included.
- Small line: Web console for the office · iOS & Android app for the field
- ~~Temporary bar above the header through Nov 18: "Meet Doorline at AAPC on Nov 17 → Book 15 minutes", linking to /aapc.~~ *(Replaced by addendum 2 §2.)*

#### 7.2 Numbers strip (stone-50)
- Numbers: ~~27 campaigns · 120,000+ doors knocked · 28,000+ surveys · 739,000+ voter records~~ *(Replaced by addendum 2 §3: 120,000+ door knocks logged · 28,000+ surveys taken · 27 campaigns · 739,000+ voter records.)*
- Caption: "Doorline platform totals as of Nov 1, 2026." Keep the numbers and date in one constant; Omar will send updated numbers after Election Day.
- [QUOTE 1: field director or consultant. 1–2 sentences, name, title]
- [CLIENT NAMES: only with written permission. None until Omar approves.] *(Addendum 1 §1: Fox Bryant may be listed.)*
- ~~Blocked until 9d is done.~~ *(Addendum 2 §3: no longer waits on 9d.)*

#### 7.3 Problem (white)
- H2: A door program shouldn't live in five tools
- Cards:
  - The universe is a spreadsheet (keep the current text)
  - The field day is a group chat (keep the current text)
  - NEW, "The door count runs on the honor system": Doors get marked from the car. Surveys get filled in to hit a goal. By the time anyone checks, the money's spent.
  - The recap is a Friday-night deck (keep the current text)
- Closing line: Doorline puts it all in one place, and makes every door prove itself.

#### 7.4 Proof (dark band, id="proof")
- Eyebrow: § PROOF
- H2: Catch fake knocks before anyone pays for them
- Body: Every door recorded in the app carries a GPS stamp and its distance to the house. Doorline flags the knocks that don't add up and puts them on your Audit page within seconds of syncing. Review them, fix them, or unknock them; an unknocked entry drops out of every count [confirm: and the billable total].
- Bullets:
  - Flags doors recorded far from the house, seconds after the last door, or several houses from one spot
  - Catches fake-GPS apps on Android
  - Warns you before you publish a client report with fake-GPS flags still open
  - Hour-by-hour knocks per canvasser, with overlapping knocks counted once
  - Shows where each result was recorded from, with a line to its house
  - *(Addendum 2 §3 adds: Numbers by pass, book and canvasser.)*
- New screenshots: the Audit page with flags; the map with "Show canvasser locations" on. The timeline shot is optional.
- [QUOTE 2: consultant or field director]
- When auto-pause ships, add: "Canvassers with impossible entries are paused until a lead reviews them."

#### 7.5 Client reports (brand-50, id="reports")
- Eyebrow: § CLIENT REPORTS
- H2: Send a report, not a spreadsheet
- Body: Publish a report and the numbers freeze: doors knocked, contact rate, survey results and a coverage map. They change only when you refresh, and the report says when. Send it as a [confirm: PDF or a] password-protected link that expires on its own and can be revoked.
- Line (ships with section 3): ~~No canvasser or voter names. Survey results by area, never by household.~~ *(After the house-map ruling: no canvasser or voter names; results by area, or every home with its address and answers when the house-level map is turned on for that report.)*
- Link: Open a sample report →, with the password shown beside it
- [QUOTE 3: project manager or campaign manager]

#### 7.6 Setup (white, id="setup")
- H2: From voter file to knocking, usually the same day
- Column A, "Bring any voter file": Upload the CSV or Excel file from i360, L2, Data Trust, the state or your client. Doorline recognizes their columns, shows exactly what will change before anything is written, and maps every address it can match; the rest wait for you to place by hand. Cut balanced books to the size you want, by precinct or district, or draw them by hand. Re-cut between passes without losing knock history.
  - Line: Need a voter file? We'll help you get one.
- Column B, "A field app your canvassers can't break": Canvassers get an invite email, set a password and sign in, with no separate app account. They open their book and knock: pins change color as they go, scripts and surveys follow your logic, and fully-voted households drop off once you upload the voted list. No signal? Doors and surveys save on the phone and send as soon as there's signal again.
  - [QUOTE 4: canvasser]
  - Link: How canvassers get the app → /app
- Screenshots: turf cut and phone book (existing). The demo data uses real Des Moines addresses, so check the survey phone shot doesn't show a readable real address next to a made-up answer.

#### 7.7 Feature grid (stone-100)
- H2: Built for firms running many campaigns
- Cards:
  - Many campaigns, one login: Every campaign is walled off with its own team, turf and reports. Run all of them from one account.
  - Roles and team leads: Give a lead full control of their campaign and nothing else. Canvassers only see their own books.
  - Passes and re-knocks: Each pass keeps its own status, so re-knocking not-homes never muddies your counts.
  - Early-vote tracking: Upload the voted list and fully-voted households drop off every book.
  - Surveys and scripts: Branching questions, read-aloud scripts and tags. Rename an option without breaking past counts.
  - Voter profiles: Household, contact history, answers and notes in one place, plus an org-wide do-not-contact list.
  - Lit drops and walk packets: Run lit-drop programs in the same app, or print packets when you need paper.
  - Per-campaign time zones: Run races in different states, each on its own clock.
  - Export Center: Take your data with you any time.

#### 7.8 Founder and trust (white)
- Omar's photo and a first-person note (Omar will edit): ~~"I'm Omar. I run paid door programs, and I built Doorline because the tools we used could show where a canvasser was, but not whether the door was really knocked. …"~~ *(Replaced by addendum 1 §2.)*
- Trust list:
  - Export everything, any time.
  - Your data is never sold, and no other customer can see it.
  - Staff access is audited and time-limited.
  - Location is recorded only when a door is recorded, never between doors.
- Link: Privacy policy

#### 7.9 FAQ (stone-50)
1. How fast can we be knocking doors? Usually the same day. Send your voter file in any vendor's format; once it's imported and cut, your crews install the app and walk. We set up your first campaign with you on the demo call.
2. What do we need to get started? A voter file with addresses and state voter IDs, as CSV or Excel, from i360, L2, Data Trust, the state or your client. Don't have one? We'll help you get one.
3. What happens when a canvasser loses signal? They keep knocking. Doors and surveys save on the phone and send as soon as there's signal again. Anything recorded offline is marked so you can audit it.
4. How do you catch canvassers who don't actually knock? Every door is GPS-stamped with its distance to the house. Doorline flags doors recorded far from the house, seconds after the last door, or several from one spot, plus fake-GPS apps on Android. Flags land on your Audit page within seconds of syncing, and Doorline warns you before you publish a client report with fake-GPS flags still open.
5. Do you track canvassers all day? No. Location is recorded only when a canvasser records a door. That's what gets verified; nothing is tracked between doors.
6. What's in a shared report? ~~Only what you publish: doors, contact rate, survey results and a coverage map. No canvasser or voter names, and survey results are shown by area, never by household. Links are password-protected, expire on their own and can be revoked.~~ *(As built after the house-map ruling: results by area unless the house-level map is turned on for that report, which shows every knocked home with its address and answers.)*
7. Can different teams work the same campaign? Yes. Split it into walk lists, each with its own crew, passes and survey. Every door belongs to one list, so teams don't double-knock each other.
8. How do canvassers get set up? Add them in the console. They get an email, set a password, install the app and sign in; there's no separate app account. The link is good for 72 hours, and you can resend it or set a temporary password.
9. What does it cost? A flat monthly rate per campaign, sized to the race. Local races start at $300 per campaign, per month, with every canvasser, feature and door included. No per-seat fees, per-door charges or add-ons. Setup is free, and billing starts the month of your first knock. Request a demo and we'll quote your race.

#### 7.10 Final CTA (brand-50)
- H2: See Doorline run your next canvass
- Body: Bring a race you're working. We'll walk through the console and the field app on a live demo campaign, and set up your first campaign on the call.
- Buttons: [Request a demo] [Open a sample report]

#### 7.11 Words to avoid (each overstates the code)
- "never lose data"
- "the moment it happens"
- "syncs automatically", "in the background"
- "pings", "ping trails"
- "voter identity stripped"
- "side-by-side comparisons"
- "optimized walk order"
- "dedicated fake-GPS alert" (say Android)
- "coverage" as a percentage of the universe (no such figure exists)
- "Nothing bad"

### 8. /aapc page *(hero, buttons and QR note replaced by addendum 2 §4)*
- URL: https://doorline.app/aapc. Demo requests from it carry source=aapc.
- ~~Hero: "Meet Doorline at AAPC, Nov 17", plus [event name, city, booth/table].~~
- ~~Subhead: "Canvassing software that makes every door prove itself, for firms running one campaign or twenty."~~
- ~~Omar's photo with: "I'll be there in person. Grab 15 minutes, or book a demo for after the event."~~
- ~~Buttons: [Book 15 minutes at AAPC] [Request a demo]. Both use the same form, with a "When?" select: At AAPC, Nov 17 / After the event.~~
- Then: the numbers strip; three short blocks (Proof, Client reports, Many campaigns); the sample report link; the price line.
- [AAPC attendee offer: only if Omar decides on one]
- ~~QR code: Omar will confirm what the printed QR encodes. …~~ *(Addendum 2 §1: it encodes https://doorline.app with no tag.)*

### 9. Verify before the copy ships
a. Is there a PDF export of client reports? Most clients get reports as PDFs by email. If there isn't one, consider a "Download PDF" (print stylesheet), since that's how reports actually travel.
b. What does unknock remove an entry from: totals, the client report, the "billed once" counts? If firms get a billable knock count per campaign, feature it.
c. Confirm GEOCODE_ENABLED=true in production.
d. Do the terms and privacy policy allow publishing aggregated, anonymized platform totals? If not, draft a clause for Omar to approve (ideally with a lawyer) before the numbers strip goes live.
e. Benchmark a 100k-row import and a turf cut on the production queues, to back "usually the same day".
f. Sample report: use the demo org, area map, door taps disabled, link expiry 365 days. Tell Omar the renewal date.

### 10. Product work
- Offline queue (Phase 2, data integrity):
  - Never drop a queued item silently; show dropped items to admins with the reason.
  - Stamp each item with who recorded it. Never upload it under another user; hold it until that canvasser signs in.
- ~~Trial lock (optional, Phase 2): email Omar 2 days before any org's trial makes it read-only.~~ *(Dropped by addendum 1 §3.)*
- iOS fake-GPS (Phase 3): check whether CLLocation's sourceInformation (iOS 15+) can be read through expo-location or a small native module.
- Isolation tests (Phase 3): cover every org and campaign scoping rule before a trust page promises it.
- Auto-pause for impossible entries: a separate project.
- Later polish: a self-hosted headline typeface, a full data and security page, a case study.

### 11. Acceptance checks
- curl https://doorline.app/ returns HTML containing "Know exactly what happened".
- The hero is fully visible on first paint, and nothing is blank after a nav jump.
- The eyebrow is on one line from 1024 to 1920; the nav doesn't wrap from 768 to 1023.
- No justified text. Body text on phones ≥14px.
- On phones, a readable phone screenshot sits right below the CTAs.
- The page is clearly shorter than today's ~11,900px at 390px.
- Lighthouse mobile (Slow 4G): LCP under 2.5s; accessibility 95+.
- Demo requests are stored, emailed and tagged with a source; /aapc requests show source=aapc.
- Shared report endpoints return no street addresses or household answers. *(Now: for area reports — the default.)*
- No dark overscroll band on iPhone or Mac.
- Every claim on the page matches sections 7 and 9.

## Addendum 1 (Omar, Nov 1) — verbatim

1. Fox Bryant can be listed as a client: in the client names row (7.2) and on /aapc. Present it as a client only, not as who built or owns Doorline. This replaces the Fox Bryant line in section 1. Other client names still need written permission.
2. Fox Bryant still publicly endorses i360, so nothing on the site should knock other platforms. Replace the founder note in 7.8 with:
   "I'm Omar. I run paid door programs, and I built Doorline because a door count shouldn't run on trust. Doorline checks every knock against the house it's for, and it's simple enough that canvassers are knocking minutes after the invite email." — Omar [last name], [title]
3. Section 10: drop the trial-lock email. Omar activates accounts by hand.

## Addendum 2 (Omar, Nov 1) — verbatim

1. **The printed AAPC ad (can't change).** The half-page ad in the AAPC Election Post-Mortem program (Nov 17, 2026) is already printed. Its QR code goes to https://doorline.app with no tracking tag, so the homepage is where every scan lands. Printed text, word for word:
   - Headline: Every door. Every pass. Every number.
   - Subhead: Simple for your canvassers. Total visibility for you.
   - Bullets: GPS-stamped knocks, live on web and phone / Numbers by pass, book and canvasser / Client reports shared by private link
   - Numbers: 95,000+ door knocks logged / 23,000+ surveys taken
   - Call to action: Request a demo at doorline.app
   - Price: Starts at $300 per campaign, per month — everything included.
   - QR: https://doorline.app, caption "Scan to visit"
   - Mockup (example numbers): "Beaverdale · Pass 2" card with a green-dot "Live" label; Book 7 17/17 Done, Book 14 42/70 In progress, Book 8 0/69 Not started; 41% Progress, 24% Connection rate.
2. **Homepage AAPC banner** (replaces the temporary bar in 7.1).
   - A slim bar at the very top of the homepage, above the header. Not a popup or overlay: it pushes the page down and never covers "Request a demo".
   - On a 390×844 phone, the banner and the hero's "Request a demo" button are both visible without scrolling.
   - Text through Nov 17: At AAPC on Nov 17? Book 15 minutes with Omar →
   - Text from Nov 18: Saw us at AAPC? Book 15 minutes with Omar →
   - Link: https://doorline.app/aapc?src=home-banner
   - Live from the /aapc launch (by Nov 14) through at least Nov 24. Keep the start, switch and end dates in one config.
   - The homepage will be prerendered, so put the banner in the static HTML; people scanning on conference Wi-Fi then see it before the JavaScript loads. Static HTML won't change by itself, so swap the text and hide the bar by date in the browser, or redeploy on Nov 18 and Nov 25.
   - Brand: red #DC2626, stone neutrals.
3. **Stay consistent with the ad through Nov 24.**
   - Keep a visible "Request a demo" button in the homepage hero and header.
   - Pricing: "Local races from $300 per campaign, per month. Every canvasser and feature included." Never publish add-ons or anything else that contradicts "everything included".
   - Platform totals say "door knocks", not "doors knocked". New 7.2 numbers strip: 120,000+ door knocks logged · 28,000+ surveys taken · 27 campaigns · 739,000+ voter records. The ad has already published totals, so the strip no longer waits on 9d, but still finish 9d this week.
   - The homepage hero subhead (7.1) becomes: Simple for your canvassers. Total visibility for you: every door GPS-stamped, suspicious knocks flagged, and every result live on one map.
   - Keep the H1: Cut the turf. Walk the doors. Know exactly what happened.
   - Add "Numbers by pass, book and canvasser" to the Proof bullets in 7.4, so all three ad bullets appear on the homepage.
4. **/aapc page** (replaces the hero, buttons and QR note in section 8).
   - Eyebrow: AAPC ELECTION POST-MORTEM · NOV 17
   - H1: Every door. Every pass. Every number.
   - Subhead: Simple for your canvassers. Total visibility for you.
   - Below that: the ad's three bullets, word for word, and a version of the ad's mockup card with the same example numbers, so the page reads as the ad's page.
   - Omar's photo with: "I'll be at the Post-Mortem in person. Grab 15 minutes, or book a demo for after the event." From Nov 18: "Missed me at AAPC? Book 15 minutes and I'll walk you through it."
   - Buttons: [Book 15 minutes with Omar] [Request a demo]. Both open the same form. The "When?" select offers "At AAPC, Nov 17" only through Nov 17.
   - Then: the numbers strip, the three short blocks, the sample report link and the price line.
   - Requests keep their src: home-banner, or aapc when there's none.
5. **Measuring the ad** (QR scans carry no tag).
   - Add an optional "How did you hear about us?" select to the demo form: AAPC event / Referral / Search / Other. It's the only way to tie demo requests from people who scanned the QR code to the ad.
   - Turn on the optional first-party daily visit count for /, so the Nov 17 spike shows up. Server-side only: no cookies, no stored IPs.
6. **Extra acceptance checks.**
   - curl https://doorline.app/ returns HTML that includes the banner text.
   - With the date set to Nov 18, the banner and /aapc show the after-event text, and the "At AAPC, Nov 17" option is gone. With the date set to Nov 25, the banner is gone.
   - On a 390×844 phone, the banner and the hero's "Request a demo" are both visible without scrolling.
   - A demo request started from the banner arrives with src=home-banner.
   - No page says "doors knocked" for platform totals.
