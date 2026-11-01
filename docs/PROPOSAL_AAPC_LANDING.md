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
| 1 | Brief §3–6, and the §7.11 words removed from the current page | **Built 2026-11-01, uncommitted** — see *Phase 1, as built* |
| 2 (by Nov 12) | §7–9 (new page structure, /aapc), the offline-queue fix in §10 | Not started |
| 3 (after AAPC) | The rest of §10 | Not started |

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
