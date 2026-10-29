# Client report links — one link per report, passwords you can see again, Archive

**Status:** **Built 2026-10-28; code reviews 1 and 2 done (0 blockers, 0 majors) and every finding fixed;
uncommitted.** What was built, and every place it
differs from this plan, is §K (at the end); the doc of record is [CLIENT_PORTAL.md](CLIENT_PORTAL.md), the
release steps are in [OPERATIONS.md](OPERATIONS.md), and the privacy record is
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 44. Plan, revision 4 (2026-10-28), after the three
review rounds the owner asked for (§L). **Approved by the owner 2026-10-28: "Build it, then 2 code
reviews."** Optional pieces (Part 1, "If you want it smaller"):
kept 2, 4, 5, 7, 8, 9, 10; **cut 3 (the "My client already has this password" tick box) and 6 (the reminder
line in Share)**; 1 is decided after the check. The crash fix in "Found in passing" ships first, on its own
(owner, same day). The owner's answers of 2026-10-27 are recorded in Part 1. Builds on
the shipped work in [PROPOSAL_CLIENT_REPORTS_UPGRADE.md](PROPOSAL_CLIENT_REPORTS_UPGRADE.md) and
[PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md](PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md); how the tab works today is in
[CLIENT_PORTAL.md](CLIENT_PORTAL.md). Web and server only — the phone app calls none of these routes. Old
All your reports links are turned off by a Heroku setting on a day the owner picks, not by the deploy (§I).

---

## Part 1 — For everyone

### What the owner asked for (2026-10-27)

1. Reports already made can't be archived or deleted. *(Delete exists, but it's hidden behind the ⋮ at the
   right of each report.)*
2. Does an **All your reports** link show the new report and the older ones? *(Yes. It opens every
   published report of the campaign, on every tab — whole campaign, teams, walk lists — and a new report
   appears on it the moment it's published.)* The owner would rather have **one link per report**: make a
   report, share its link; next week, make the next one and share its link. In the owner's words: "if
   someone really needed an update, they'd use the dashboard and All Time date filter."
3. Share always makes up the password — you can't set your own.
4. A lost password can't be found again, and making a second link for the same report gives a second
   password and leaves you choosing between two links.

### The owner's answers (2026-10-27)

- **Old "All your reports" links: turn them off.**
- **A lost password: show it again.** Anyone who manages the campaign (admins and its team leads) can see
  and copy it later. Doorline keeps it encrypted.
- **A new report's link starts with the same password as your last link**, so your client keeps one
  password for the season. You can still pick another.
- **Archive tidies your list only.** Your client's link keeps working.

### Found in passing — urgent, and outside this plan

**One request can crash Doorline's web server today.** A password containing one malformed character (a
"lone surrogate" — no keyboard types one, but a crafted request can send it) makes the password library run
out of memory, and the whole server process exits. It's reachable without signing in: the sign-in page with
any real account's email, and a client link's password page with a real link address. Production runs one
web server, so one request is an outage until Heroku restarts it, and repeated requests keep it down. It's in
today's code, not caused by this plan (round 3 reproduced it against the real app; a one-line check of the
installed library confirmed it). **Recommended: a separate small fix, now** — refuse such a password before it
reaches the library in sign-in, password changes and the link password page (`User.verifyPassword` /
`User.hashPassword` in `server/src/models/User.js:96-102`, and the share unlock), with tests; a server deploy
only — the phone just gets "Invalid credentials" for a password it can't send anyway. This plan carries the
same guard on the link routes it touches.

**Built 2026-10-28 and handed over as a ship-alone patch** (`password-crash-fix.patch`, ahead of the rest
of this plan; deploy pending): `server/src/utils/passwordText.js` `isWellFormedText`, checked before every
bcrypt call on those paths. `User.verifyPassword` treats such a password as wrong (sign-in);
`User.hashPassword` refuses it with `400 PASSWORD_INVALID`, "That password has a character that can't be
used. Try another." (password change, reset, a member's temporary password); the public link unlock answers
it as a wrong password before any slot is reserved; and the link routes refuse a typed one with `400
SHARE_PASSWORD_INVALID`. Pinned by `server/test/passwordText.test.js` and `passwordText.int.test.js`, which
sends it to each of those routes (a missing guard ends the test process, which fails the run). Its lines are
also in this build's working tree. Recorded in PRIVACY_VERIFICATION item 44(l).

### What changes

**1. Every report has its own link — and only one.** **Share** on a published report:

- **No link yet:** you pick the password (below) and how long the link lasts (90 days unless you pick 30,
  180 or 365), then **Create link**. There's no label to type and no "which reports" choice.
- **From then on**, Share on that report always shows that same link: its address, its password, when it
  expires and when it was last opened, and the message to paste into your email or text. There's no second
  link to make, so you never choose between two. *(A report that already got two links before this change
  keeps both; Share lists the extra one under the main one, with Delete.)*
- Your client's link goes straight to that one report. It never shows another report, and next week's
  report never appears on it.
- A **Latest progress** report is no different: its link shows the totals through its last day. For newer
  totals, **Next report** on it makes a new Latest progress report, with its own link to send (same
  password).
- Share stays on a report you've taken down, so you can still manage its link; its message can't be copied
  until the report is back up.
- New links have no label; older links keep theirs.

**2. Passwords.** When you make a link, its password is one of:

- **Same as your last link** — picked for you when this report's tab has a link whose password Doorline
  kept: "Same as your last link (Paid team · Oct 12 – Oct 18)". When only *another* tab has one, it's
  offered — "Same as the Whole campaign · Oct 12 – Oct 18 link" — but not picked, since that tab may go to
  someone else.
- **Make one up for me** — 12 characters, without look-alike letters. Right after **Create link** it's shown
  in plain text with **Copy password** — "Its password: k7Hq9mXrW2pZ".
- **Type my own** — 12 or more characters. Under the box: "Everyone who manages this campaign can see this
  password later. Don't use one you use anywhere else."

The message you copy ends by what you just did: a password made up or typed → "I'll send you its password
separately"; Same as … → "use the password I sent you".

Afterwards the password is in Share, hidden as dots: **Show**, then **Copy password**. **Change password**
sets a new one (made up for you, or typed). When other links of the campaign use the same password, it
offers to change them too — "Also change it on the 3 other links that use this password (Whole campaign,
Paid team)", ticked — so a leaked season password is replaced in one step, whether it was copied with
**Same as …** or typed again by hand. (Links made before this change aren't included — change those one by
one. Old links to all your reports aren't included either.) Changing a password signs out anyone using the old one. When someone who manages the
campaign leaves, change the password the same way — they still know it.

**Doorline staff can't see or type link passwords.** Working in your organization under a support grant,
staff can make a link with a made-up password or Same as …, or change a password the same way — but they
never see one and can't type one in.

When a password can't be shown — a link made before this change (Doorline only ever kept a scrambled check
of its password), or Doorline's key isn't available — Share says: "This link's password can't be shown. To
have one you can see, change it — then send your client the new password."

**3. Old "All your reports" links stop working — on a day you pick.** This release doesn't turn them off;
a Heroku setting does. Until you flip it, they keep working as today — no new ones can be made; you can change
their password, give them a new address, or delete them. The day you flip it (**Settings → Reveal Config Vars → `RETIRE_ALL_REPORTS_LINKS` = on**),
every link that opened all of a campaign's reports stops working — **in every organization, not just
yours** — including the links in every message already sent. Someone who opens one sees "This link no
longer works. Ask the person who sent it for the link to the latest report." Devices signed in to it are
signed out at once. (A link that was already turned off keeps saying "This link isn't available.")
Unsetting the setting brings them back at once, with no deploy.

On your page, those links sit in a small card above your reports, **Old links to all your reports**:

- before the switch: "Each report now has its own link: press Share on a report to send it. Doorline will turn
  these old links off." Each row says what it does now — "Candidate · still opens every report · last opened
  Oct 26", "A link made Jul 3 · expired Oct 30", "Board · turned off" — with **Change password** and **New
  address** on one that still works, and **Delete** on each. Delete on a working one asks first: "Your client
  loses every report on it now, not on the day Doorline turns these off. Send them each report's own link
  first. This can't be undone." (on any other: "Nobody can open it. This removes it from your list.");
- after it, titled "…— turned off": "These opened every report of this campaign and no longer work. Each
  report now has its own link: press Share on a report to send it." Each row with **Delete** ("It no longer
  works. This removes it from your list.").

None can be turned back on, renewed or extended.

A read-only check, `npm run report:all-reports-links`, lists each organization that has such links — how
many still work, how many are already off or expired, when one was last opened — with organization names
only, so you know whose clients need a new link, and which customers to tell first. It runs after the
deploy and before the switch.

**4. Archive, and a Delete you can find.** Each report row shows its actions as buttons: **Open**,
**Share**, **Next report** (on the newest) on the left; **Archive**, **Take down** (or **Put back up**) and
**Delete** on the right — nothing hidden behind the ⋮. On a phone they sit on two lines.

- **Archive** moves a report into a folded **Archived (N)** list at the bottom of its tab: "Archived — it's
  under Archived (4) at the bottom. Undo". Nothing changes for your client. **Unarchive** brings it back.
  Drafts can be archived too.
- The **newest** report of a tab (and its newest Latest progress report) isn't offered Archive — that's
  where Next report lives — and it's never folded away: if it ends up archived (say, a newer one was
  deleted), it stays in the list, marked Archived, with Unarchive.
- An archived report still counts for its dates: no false "not covered" gap line, and New report still
  knows those dates are taken: "You already published a Whole campaign report for Oct 19 – Oct 25 — it's
  archived." with **Open it** and **Unarchive**. Next report onto an archived report opens it, and the
  report says it's archived, with Unarchive.
- **Delete** works as today: the report is gone for good, and its link with it.

**5. Each report row says how its link is doing**, in two short lines under the numbers:

- the link: "Link: active · expires Jan 25" · "No link of its own yet — Share makes one." · "Link expired
  Jan 25 — Share to renew it." · "Link locked after 50 wrong passwords — Share to unlock it." · "Link
  turned off — Share to turn it on." · on a taken-down report with a link, "Its link shows “taken down”
  until you put it back up." (nothing on a draft);
- the opens: "About 5 visits · your organization: 2 visits" — every visit the report ever had, through any
  link, old ones included.

The **Client links** side panel goes away: each report's link lives with its report.

**6. Publishing says what happens next.** The Publish confirm's subtitle: "Oct 19 – Oct 25 — after you
publish, Share makes its link for your client." — or, while an old link to all your reports still works, "Oct
19 – Oct 25 — your old link to all your reports shows it as soon as you publish; Share makes its own link."
(with "Your client sees exactly the preview." as today).
Afterwards: "Published — Share makes its link for your client." with **Share**. New report's note under
**Make a second one**: "Each one gets its own link once it's published." (or, beside a taken-down one: "The
taken-down one stays hidden until you put it back up. The new one gets its own link once it's published.").

### Other gaps found while planning — fixed by this plan

- Links were managed in two places (Share, and the side panel) with different options — only the side
  panel let you type a password. Now there's one place: Share.
- An All your reports link quietly showed every tab — team and walk-list reports too — to whoever had it.
- Delete and Take down were hidden behind the ⋮.
- "Published. Your client can see it now." was only true through an All your reports link.
- Weekly reports pile up with no way to tidy the list.
- A leaked password would have had to be changed link by link.
- History named a link by its label ("A client link" without one); it now names the report.
- Take down and Delete confirms named links by label; they now talk about "its link".
- The demo's client link opens all reports. It becomes the demo report's own link — same address, same
  password; after the first rebuild, nobody is signed out by **Rebuild demo day**.
- The builder's preview of the "earlier totals were updated" line used the old wording; it now matches what
  the client reads.

### Other gaps found — not in this plan (the owner's call)

- **Someone else who should see one report — a donor, a board member — gets the same link and password as
  your client:** a report can't have a second link. To cut one person off you'd change that link's password,
  and your client would then need the new one for that report too.
- **Your client signs in once per link — so once a week.** "Keep me signed in" belongs to one link. The
  password box on the client's page doesn't offer to save the password (it's set that way for shared
  computers); we could let browsers save it.
- **A client can't page back to earlier weeks** from a link — the owner's choice.
- **A client who follows several tabs gets one link per tab each week**, and types the password once for each.
- **Archive and Delete work one report at a time** (no select-several).
- **A campaign manager's Show isn't written to History:** everyone who can Show a password can already open
  the report and change the password. Logging each Show is a small addition if wanted.

### If you want it smaller — the optional pieces

Everything else in this plan is either what you asked for, or keeps something from breaking or a published
promise true. These can go without either:

1. **The date gap** — flip the switch the day you deploy. Only if the check lists no organization but yours
   with a link that still works; otherwise other customers' clients lose their links with no warning. If item 4
   below says it's a material change, the email still goes out (the same day is fine).
2. **"Also change it on the other links."** Without it, a leaked season password or a departing manager means
   changing each link by hand.
3. ~~**The "My client already has this password" tick box**~~ — **cut by the owner 2026-10-28.**
4. **Archive's Undo** — Unarchive under Archived does the same.
5. **The two new Help articles** (a lost password; where the Client links panel went) **and the staff line in
   the staff-access article** — the guide covers them.
6. ~~**The reminder line in Share** about your old link's password~~ — **cut by the owner 2026-10-28.**
7. **The link line on each report row** — Share says the same.
8. **The How it works rewrite** — today's steps stay true.
9. **History's new words** (turned off, new address) — History must still name each link by its report.
10. **"— it's archived" in New report's message** — Open it lands on the report, which says it's archived.

Not optional, though they look it: the line for reports that got two links before this change (without it
that second link is on no screen and can't be revoked, which the policy promises), the old-links card, the
homepage wording, the area-view warning's new words, and the opens line's new words.

### What this changes in our promises — decisions

1. **Who is affected, and telling them** (after the deploy, before the switch). The read-only check (§3)
   lists every organization with an All your reports link. Proposed email to each listed organization's
   admins:

   > Each Doorline client report now has its own link: press Share on a report to make it. On [Month D],
   > the older links that open all of a campaign's reports stop working; anyone who opens one then sees
   > "This link no longer works. Ask the person who sent it for the link to the latest report." Before then,
   > on each tab your client follows, open the newest published report, press Share and make its link. To
   > keep the password your client already has, choose Type my own and type it (it needs 12 or more
   > characters; a shorter one can't be kept, so make up a new one and send it). Then send your client the
   > new link. Each new link on that tab starts with the same
   > password, so your client keeps one password. An old link that expires before then can't be renewed.
   > Also new:
   > your campaign's admins and team leads can see a link's password again in Share (Doorline staff
   > can't), so don't use a password you use anywhere else. Links to a single report keep working. Our
   > Terms of Service and Privacy Policy say the same from [Month D].

   **The date:** a date before **Nov 3** means your customers re-send links in the last days before the
   election; Nov 4 or later avoids that.
2. **Privacy Policy** (`client/public/privacy.html:101`), on the date: "Links created before that date
   remain accessible until the customer revokes them, and we provide customers a tool to revoke them." →
   **"Links created before that date no longer work."**
3. **Terms §6** (`client/public/terms.html:118`), on the date: "Links created before password protection
   was introduced remain accessible until revoked, and the Customer can revoke them at any time." →
   **"Since [Month D, 2026], links that opened all of a campaign's reports — including every link created
   before password protection was introduced — no longer work."** (Doorline, not the customer, turns these
   off — this sentence says so.)
4. **Is it a "material change"?** The Terms (§15) and the Privacy Policy ("Changes to this policy") both
   promise that material changes are communicated — the Terms to "customer organizations and active users",
   the Privacy Policy to "affected customers and users". If yes, the email in item 1 is that notice and can't
   be skipped; decide whether it goes to the organizations the check lists or to every customer. Any customer
   with a **signed agreement**: check it — it controls over the Terms.
5. **"Last updated"** on both pages (July 17 and July 15, 2026) is already behind later edits (four to the
   Privacy Policy, one to the Terms); bump both to the date.
6. **Passwords that can be shown — the DPA (§4: no material decrease in overall protection).** Decide
   **before the deploy** — passwords become viewable at the deploy, not on the date.
   - *Weaker:* before, nobody — Doorline included — could recover a link's password; now someone holding
     both the database and Doorline's server settings could. Every admin and lead of the campaign can see
     the password, and still knows it after leaving the campaign — and a client given a team-lead account
     can see every link password on that campaign, other recipients' included. By default one password
     covers a campaign's links all season. A typed password is stored in a form that can be shown.
   - *Unchanged or stronger:* checking a password is unchanged; each link still has its own unguessable
     address; a copy of the database alone reveals no password (the key is kept at a different company);
     the database already holds the reports the password protects; All your reports links go away;
     **Doorline staff can't see or type passwords**.
   - My read: not a material decrease, given that staff can't see them. Owner to confirm; recorded in the
     privacy record. No policy sentence says a password can't be shown, so the Privacy Policy needs no
     change for this.

**The homepage** (`client/index.html:28`, `:41`, `:55`) says reports are shared "from one link"; it becomes
"…frozen reports you share by password-protected link." — shipped with the deploy, no decision needed.

No new company receives any data, and nothing new is collected about voters or canvassers.

### What the owner does to ship it

**Before the deploy:** decide item 6. Heroku dashboard → **Settings → Reveal Config Vars**: check
`CREDENTIAL_SEAL_KEY` is there. If it's missing: **More → Run console** →
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, copy the 44-character line it
prints, and add it as `CREDENTIAL_SEAL_KEY` (if it was missing, this also turns on FbTime Connect for every
organization — Part 2 §I). Never replace one that's there — without it, Show and Same as … don't work.

**The deploy** (server + web from `main`, with `RETIRE_ALL_REPORTS_LINKS` unset):

1. Deploy. No phone update, no client-version change.
2. Super-admin home → **Rebuild demo day** (the demo's client link becomes a link to the demo report — same
   address and password; demo viewers sign in once more).
3. Check passwords work, in the demo's Whole campaign tab: **New report** → Latest progress → Create draft →
   Publish → **Share** → Make one up for me → Create link; **Show** gives the password just shown. Then New
   report → the first choice → Create draft → Publish → Share: **Same as your last link** is picked → Create
   link → Show gives the same password. (Rebuild demo day afterwards tidies them away.)
4. **More → Run console:** `npm run report:all-reports-links`.
5. Decide items 1–5. Send the email (if any), naming the date. Tell me the date, the email as sent and how
   many organizations got it (or that you sent none), your answer to item 4, and which sentences you chose —
   the privacy record notes them.
6. On each tab your own clients follow, press **Share** on the newest published report and send its link (to
   keep the password your client already has: Type my own and type it, which needs 12 or more characters —
   a shorter one can't be kept, so make up a new one and send it; on that client's other tabs, Same as
   that link).

**On the date** (or, with no gap, the same day — after step 6):

1. The legal edits (items 2, 3, 5) — you make them, or tell me to apply them — committed and deployed.
2. **Settings → Reveal Config Vars → `RETIRE_ALL_REPORTS_LINKS` = `on`** (the dynos restart; no deploy).
3. Check: an old All your reports link (from an email) says "This link no longer works"; the demo's link
   opens the demo report; doorline.app/privacy and doorline.app/terms show the new sentences and the new
   "Last updated" date.

**If something's wrong:** delete `RETIRE_ALL_REPORTS_LINKS` (the ✕ beside it in Config Vars) — old links
open again at once; anyone the switch signed out types the password again — and put the legal sentences back
in the next deploy.

---

## Part 2 — Technical reference

### A. What the code does today (verified 2026-10-27/28, rounds 1–2)

1. **All-reports links.** `ReportShareLink.reportId` null or missing = every published, not-taken-down
   report of the campaign (`models/ReportShareLink.js:99-106`). `routes/public/share.js:117` `reportScope`
   has no tab filter, so the hub (`:199`) lists every tab's reports. All 10 public routes run `loadShare`
   first (`share.js:128, :158, :199, :260, :291, :301, :312, :321, :331, :345`); the client's PDF is built in
   the browser from those routes. `loadShare` finds only `isActive: true` links (`:56`) — a turned-off link
   answers 404 `SHARE_NOT_FOUND` before any other check. An old link's missing `reportId` reads null on a
   hydrated document.
2. **Share** (`ShareDialog.jsx`): `KINDS` (`:40`) defaults to All your reports, "(the usual choice)";
   `create` (`:101`) never sends a password, so the server generates one (`clientReportShares.js:202`); **Make
   a link** (`:199-211`) is always offered, and the radio list (`:162`) then asks which link.
3. **Set my own** exists only in the side panel's **+ New link** (`ClientLinksPanel.jsx:544`); **Change
   password** only on the panel's rows (`:255`).
4. **Passwords** are bcrypt-hashed only (`clientReportShares.js:209`); a generated one is returned once
   (`:229-233`). `PRIVACY_VERIFICATION.md:3480` and `:4863` (D11) say so.
5. **Delete / Take down / Put back up** are the row's `RowMenu` items (`ReportRow.jsx:84`, a bare ⋮ at
   `:153`). `DELETE /admin/client-reports/:id` takes the report's one-report links with it. `ClientReport.status`
   carries an **unused `'archived'` value** (`ClientReport.js:137`) — every public reader filters
   `status: 'published'`, so Archive must never use it.
6. **Next report** is a button only on the newest row of each kind (`ReportRow.jsx:142`,
   `ClientReportsPage.jsx:309`); the builder has none. Next onto an existing report just opens it
   (`ClientReportsPage.jsx:330-339`; `clientReports.js:1507-1508`, `:1572-1575`).
7. **Duplicates**: New report's prompt is `duplicateText` (`newReportChoices.js:160-166`) — "You already
   published a Whole campaign report for Oct 19 – Oct 25. To bring its numbers up to date, open it and press
   Refresh numbers." The note under **Make a second one** is `NewReportDialog.jsx:686-688`.
8. **The server's link check** (`clientReportChecks.js:180` `linkState`, called `:394`) counts
   `reportId: { $in: [null, report._id] }`; read by `PublishDialog.jsx:49` and the builder's `hasUsableLink`
   (`ClientReportBuilderPage.jsx:1026`). A draft can never have a link (`clientReportShares.js:200`).
9. **Earlier totals**: a one-report link reads `earlierTotalsLine(r, { oneReport: true })` (`share.js:266`);
   the builder's preview builds the hub's wording (`clientReports.js:1426`).
10. **History**: a link row is named by `toValue.label`, else "A client link" (`client/src/lib/campaignHistory.js:276`);
    `withoutSecrets` drops every key matching `/token|password|hash/i` (`clientReportHistory.js:85-88`).
    `eraseHistory` touches only edit rows (`:251`), restore refuses others (`:150`), and the phone's feed
    excludes these rows (`routes/admin/campaigns.js:466`).
11. **Demo**: `seedDemoOrg.js:678` `ensureShareLink` keeps one all-reports link, "Client demo link"
    (`SEED_DEMO_SHARE_TOKEN` pins its address, `SEED_DEMO_SHARE_PASSWORD` its password — ignored once the
    link has one, `:718`), and runs on every seed (`:1310`). The reset deletes every one-report link
    (`:785`), `--rebuild` deletes links too (`:927`); a report is published only when the demo has no
    activity yet (`:1212`, `:1245-1291`). Share tokens are keyed to the link's `_id` (`services/auth/tokens.js:127,
    :141`). The super-admin button is **Rebuild demo day** (`SuperAdminHomePage.jsx:354`; its confirm says the
    link "always points to the campaign's latest report", `:398`).
12. **Sealed secrets**: `utils/sealedSecret.js` — AES-256-GCM, one master key `CREDENTIAL_SEAL_KEY`, no
    associated data, `String(plaintext)`; `sealSecret` throws without a key or with a malformed one,
    `sealedSecretConfigured()` returns false for both; used today for FbTime API keys (one seal, nine
    single-argument opens; `routes/admin/integrations.js:333`), whose Connect is gated only on the key
    (`:299`). No doc records whether the key is set in production. The error handler returns `err.message`
    in production (`middleware/error.js:8`).
13. **Guard indexes**: `clientReportIndexes.js` hard-codes `ClientReport.collection` (`:47`, `:55`, `:68`);
    built at boot (`server.js:17`, `worker.js:91`) and nightly (`scheduler.js:229`).
    `migrate:build-indexes -- --apply --sync` drops indexes a schema doesn't declare (`buildIndexes.js:13, :68`).
14. **Client page errors**: any 410 is kind `expired`, with the server's message as the notice's title
    (`lib/shareErrors.js:29`, `PublicReportLayout.jsx:120-135`), and ends the session
    (`lib/shareSession.js:50`, `:68`). The password box has `autoComplete="off"` (`PublicReportLayout.jsx:38`).
15. **Staff**: Doorline staff in a customer organization pass `orgContext` only with a support grant, which
    sets `req.supportGrant` (`middleware/orgContext.js:112-126`; never for members, `:82-86`, or in an
    internal organization, `:96-100`); the shares router runs its own `orgContext` (`clientReportShares.js:51`).
    They pass `canManageCampaign`, see each link's `token` in the rows (`shareLinks.js:102`), and their
    `/admin` reads are AccessLogged (`routes/index.js:101`). The public `/share` routes check no grant and
    write no AccessLog — round 1 ran it: after the grant ended, `/share/<token>/unlock` and `/reports` still
    answered 200.
16. **Release settings**: `FBTIME_DOOR_COUNTS` is the precedent (`docs/OPERATIONS.md:570-611`) — read at call
    time (`services/fbtime/doorCounts.js:46`, `on` / `true` / `1`), unset = off, set in **Settings ▸ Reveal
    Config Vars**; saving restarts the dynos, no deploy.
17. **Phone**: `npm run audit:mobile-api -- --list` — 115 endpoints, none under `/share` or
    `/admin/client-reports`; the campaign history route it calls already filters client-report rows.
18. **Promises**: `client/public/privacy.html:101` and `:112` (staff need a time-limited grant); `terms.html:91`
    (staff access is time-limited and reason-logged), `:118` (§6), `:148` (§15 material changes), `:82`
    (signed agreements control); "Last updated" `privacy.html:81` (July 17), `terms.html:78` (July 15);
    `docs/DPA.md:41` (§4); `client/index.html:28, :41, :55` ("from one link").

### B. Data model

**ReportShareLink** — new declared fields, no migration:

- `passwordSealed: { type: String, default: null, select: false }` — the password, sealed. Every password
  write does **bcrypt, then seal with the hash as associated data, then one atomic write of both** (create,
  change, the change-everywhere fan-out, the demo seed). The associated data is `report-link:<passwordHash>`
  (`sealSecret` / `openSecret` gain an optional `aad`; an empty one equals none, so FbTime's sealed keys and
  its single-argument callers are unchanged, and the `v1:` format stays). A stale copy (the hash changed by
  code that didn't know this field) or a value sealed for anything else can't be opened as this link's
  password — round 2 ran each case. When sealing isn't possible (no key, or a malformed one — a malformed key
  must never fail a link) it's written **null**. Never in `shareRow`, a public response, History or a log.
  - **Reads that need `+passwordSealed`:** `rowsOf`'s own campaign query (it works out every row's flags
    from that read — documents handed to it are lean reads without the field), `GET /:id/password`,
    `passwordFrom`'s source, the change-everywhere pre-image and candidates, the demo seed's link read. An
    inclusive projection drops it — use `'passwordHash +passwordSealed'`; `aggregate` and `collection.*`
    ignore `select: false`; `create().toObject()` / `toJSON()` include it, so a created document is never
    spread into a response.
  - **Every open sits in a try/catch** that returns a reason, never the error — the error handler returns
    `err.message` in production.
  - Passwords must be well-formed text — `.refine((s) => s.isWellFormed())` in the zod schemas, so it runs
    before any bcrypt call (400 `PASSWORD_INVALID`). A lone surrogate doesn't just seal wrong: it makes
    bcryptjs 2.4.3 run out of memory and **the whole process exits** — round 3 reproduced it, and so did a
    one-line check of the installed bcryptjs (exit 134). The public unlock gets the same guard (C3).
  - The sealed copy's size follows the password's length, so a database copy alone reveals each password's
    length (never the password). Round 2 judged padding it to a fixed size low value; recorded in item 44.
- `oneLinkGuard: { type: Boolean }` — declared, **no default**. Round 1 confirmed on a throwaway mongod:
  undeclared, Mongoose drops it on create and the guard holds nothing. `true` on every link made after this
  change. Index `REPORT_ONE_LINK_GUARD` = `report_one_link_guard`: `{ reportId: 1 }`, unique,
  `partialFilterExpression: { oneLinkGuard: true }`, exported from the model and **declared on the schema**
  (`reportShareLinkSchema.index(...)`, as `ClientReport.js:342-354`) so `build-indexes --sync` never drops
  it. It builds over existing unflagged duplicates (verified).

**Admin share rows** (`shareRow` + `rowsOf`, which always reads the campaign's links itself, so a one-row
response — every PATCH, extend, renew, rotate, unlock and POST — is complete too):

- `allReports` — `reportId` null or missing (C1);
- `passwordCopyable` — the sealed copy opens with today's key and its hash (an AES open per link; round 2
  measured 100 opens at about 1 ms), **whoever is asking** — what Same as … needs;
- `passwordViewable` — copyable **and the request isn't staff under a support grant**; when false,
  `passwordHiddenReason`: `'staff'` (checked first) or `'unavailable'` (no sealed copy, or it doesn't open);
- `samePasswordCount` and `samePasswordTabs` — the campaign's other non-all-reports links with the same
  password: their sealed copies open to the same text (compared in memory, never returned), or, for a link
  without one, an identical `passwordHash`; with the tabs they're on, as the rows name them;
- `report` gains `seriesId` (for Same as …'s tab).

`GET /shares` also returns `allReportsRetired` (the switch, C1). The hash and the password never leave the
server, except the password through Show.

**ClientReport** — `archivedAt: { type: Date, default: null }`, `archivedBy: { type: ObjectId, ref:
'User', default: null }`. Operator-side only; Archive never touches `status`.

Old documents need nothing: missing `archivedAt` = not archived, missing `passwordSealed` = not viewable,
missing `oneLinkGuard` = unguarded.

### C. Server

**C1. All-reports links — new ones refused at the deploy, old ones turned off by a switch.**

- **The switch:** `allReportsRetired()` reads `RETIRE_ALL_REPORTS_LINKS` at call time — `on` / `true` / `1`,
  like `doorCountsAvailable`. Unset is how the deploy ships; unsetting it again brings the links back.
- `routes/public/share.js` `loadShare`: after the token lookup, `if (!share.reportId && allReportsRetired())`
  → **410 `SHARE_RETIRED`**, error "This link no longer works. Ask the person who sent it for the link to the
  latest report." Before the expiry and billing checks, so a retired link always says why. Every public route
  runs `loadShare` first, so signed-in devices are refused at once too. **The client needs no change:** a 410
  is already a session-ending notice titled with the server's words (§A.14). A link already turned off
  answers 404 first, as today.
- **From the deploy, switch or not:** `POST /admin/client-reports/shares` requires `reportId` (400
  `REPORT_REQUIRED`). On an all-reports link, `DELETE /:id` works as today (`loadShareInOrg` keeps it inside
  the organization), and **while the switch is off** so do a password change (`PATCH` with only `password` or
  `generatePassword`) and `POST /:id/rotate` — the Privacy Policy promises "a link's password can be changed,
  or the link rotated", and these links still work until the switch. Such a change writes `passwordSealed:
  null` (an all-reports link's password is never shown or copied), refuses `alsoChanged`, and under a support
  grant is refused outright (its new password could be seen by nobody). Everything else — unlock, extend,
  renew, enable, Show, and anything but DELETE once the switch is on — answers 409 `ALL_REPORTS_LINK` ("Links
  that open all your reports can only be deleted now."; before the switch: "…can only get a new password or a
  new address, or be deleted."). No "delete all" route.
- **The link check at publish time goes:** a draft can never have a link, so `linkState` and `checks.links`
  (server), and `reportLinksLine` / `reportLinkReason` / `expiringSoon` / `hasUsableLink` (client) are
  removed, not re-scoped (D5).
- **Unreachable once the switch is on** (removed later, §J): the hub's multi-report branch; the open-link
  branches in `share.js` (`:93-96`, `:165-169`); PATCH's first-password-on-an-open-link (`:303-305`,
  `:322`); Extend's "set an expiry" (`:351-356`); the seed's open-link upgrade (`seedDemoOrg.js:718-724`).
  Every legacy open link is an all-reports link. `POST /shares/revoke-legacy` still answers, but nothing calls
  it and it only turns links off — it goes with them.
- Nothing is written to any link, at the deploy or at the switch.
- `docs/OPERATIONS.md` gets a table for `RETIRE_ALL_REPORTS_LINKS` like `FBTIME_DOOR_COUNTS`'s.

**C2. One link per report.**

- `POST /shares`, in order: validate; load the report; **look first** — any link (guarded or not, any state)
  with this `reportId` → **409 `REPORT_HAS_LINK`** with the report's **primary** link (newest usable, else
  newest) — before the not-shown refusal and before any hashing; then the existing `REPORT_NOT_SHOWN`; then
  create with `oneLinkGuard: true`. An E11000 on the guard (`isOneLinkGuardError`; round 2 confirmed it can't
  be confused with a token E11000) answers the same 409 with the winner — or 404 `REPORT_NOT_FOUND` when the
  winner went with its report a moment ago, otherwise one retry (as `clientReports.js:785-786`). The "report
  deleted while the link was being made" cleanup stays. The report lookup is scoped to the organization and
  campaign first, so the 409 can't reveal another organization's link.
- `clientReportIndexes.js`: each guard gets a `model` (`(guard.model ?? ClientReport).collection` in
  `buildGuard` and `unguardDuplicates`, the model's name in the logs). Export `ensureOneLinkGuard` and
  `isOneLinkGuardError`; call it from `syncClientReportIndexes` (boot, web and worker) and `scheduler.js`
  (nightly, after `:230`). Healing makes the later of two guarded links an ordinary second link. Boot-built
  like the report guards — a deliberate exception to the build-indexes rule: partial, tiny, never drops.
- **Reports that already have two or more links** (one-report links have existed since Oct 25): every one
  keeps working. Share shows the primary, then a plain line per extra — "Also opens this report: Board ·
  made Oct 25 · Delete" ("a link made Oct 25" without a label). The read-only check (C6) counts these reports.

**C3. Passwords.**

- `POST /shares` takes `password` (typed, 12+) **or** `passwordFrom: <linkId>` (Same as …) or neither
  (generated) — never both (400).
- **`passwordFrom`:** the source is looked up with `{ _id, organizationId: activeOrgId, campaignId }` — the
  organization filter is what keeps it inside one organization (`canManageCampaign` alone doesn't); missing →
  404 `SOURCE_NOT_FOUND`. It mustn't be an all-reports link, and its sealed copy must open and
  `bcrypt.compare` against its hash — else 409 `PASSWORD_NOT_VIEWABLE`. The new link gets `passwordHash`,
  `passwordSealed` and `passwordMeetsRule` copied verbatim (no bcrypt run; the same sealed copy opens under
  the same hash). Staff may use it — they never learn the password. *(A link made at the very instant someone
  changes that password everywhere can keep the old one; Show tells you, and the next change everywhere finds
  it by its password. Round 2 judged a re-check loop low value.)*
- **`GET /shares/:id/password`** → `{ password }` for admins and the campaign's leads (`loadShareInOrg`),
  `Cache-Control: no-store`. **`if (req.supportGrant)` → 403 `STAFF_CANNOT_VIEW_PASSWORD`**, "Doorline staff
  can't view link passwords." Otherwise it opens the sealed copy and checks it with `bcrypt.compare` against
  the hash (about 70 ms) — a mismatch, a missing copy or a failed open answers 409 `PASSWORD_NOT_VIEWABLE`,
  never a 500. The value is never logged.
- **Staff under a support grant can't type a password:** a typed `password` on POST or PATCH from a request
  with `req.supportGrant` → 403 `STAFF_CANNOT_SET_PASSWORD`. They can generate one — and a generated password
  is **never returned to them** (`generatedPassword` / `password` left out of the response) — or use
  `passwordFrom`. So under a grant staff never learn a link's password, and can't keep opening a report
  through `/share` after the grant ends. Without a seal key a password staff generate could be seen by
  nobody, so under a grant Make one up needs the key: 403 `PASSWORDS_NOT_KEPT`, "Doorline can't keep link
  passwords right now — use Same as …".
- **The public unlock** (`share.js:170-179`) treats a password that isn't well-formed text as a wrong
  password, before `reserveUnlockSlot` and before bcrypt — one such request would otherwise take the web
  dyno down (today's code has this hole; see "Found in passing" in Part 1).
- **`PATCH /shares/:id`** gains `generatePassword: true` (the server makes one) — refused beside `password`
  (400) — and **`alsoChanged: true`** ("change it on the links that use it"):
  1. the link's own write uses `returnDocument: 'before'` with `+passwordSealed`; its pre-image gives
     `preHash` and, when its sealed copy opens, `prePassword`;
  2. candidates: the campaign's other links that aren't all-reports links (`{ organizationId, campaignId,
     _id: { $ne }, reportId: { $ne: null } }`, `+passwordSealed`) whose `passwordHash` equals `preHash` or
     whose sealed copy opens to `prePassword`;
  3. for each, one `findOneAndUpdate({ _id, organizationId, passwordHash: <its own hash as read> }, [{ $set:
     { new hash, new sealed copy, passwordMeetsRule: true, credentialVersion: plusOne } }], { returnDocument:
     'before' })` — a result means it changed (it gets its own History row), none means someone changed it
     meanwhile (skipped). One bcrypt run and one seal serve every link;
  4. the response carries `changed` and `skipped`; Share shows skipped ones (D1). Round 1 and 2 ran the CAS
     on a throwaway mongod: nothing lost; two overlapping changes everywhere can split the links between the
     two new passwords, which `skipped` reports.
- Every response that carries a password is `no-store`.

**C4. Archive.**

- `POST /admin/client-reports/:id/archive` and `/:id/unarchive` (`loadReportInOrg`: admins and the
  campaign's leads). Each is a CAS — archive only when `archivedAt` is null, unarchive only when it isn't — so
  a repeat changes nothing and writes no second History row. Drafts can be archived. Publish, Take down and
  Put back up leave `archivedAt` as it is. History: `clientReport.archived`, `clientReport.unarchived`.
- **Display-only by construction** — round 1 checked every server reader: the public routes, the PDF, Next,
  the period math, the duplicate guards and earlier totals never read `archivedAt`.
- `adminListRow` (`:236`) adds `archivedAt`. The duplicate answers carry it: `REPORT_EXISTS` (`:671-691`, its
  read at `:739` adds `archivedAt: 1`), and the whole-report answers (`:783`, `:1509`, `:1575`, `:1655`,
  `:1670`) already do. `existingOf` (`:667`) prefers a report that isn't archived, after its open-first rule.

**C5. Demo seed** — the demo keeps one link and points it at the demo's report:

1. **The demo link** is the demo campaign's link with token `SEED_DEMO_SHARE_TOKEN` when that's set, else
   the newest active one labelled "Client demo link", else the newest so labelled (new links made in the app
   have no label; the demo organization's slug is unique, so no customer's link can match). A demo link given
   a New address in the app no longer matches the token, but its label still finds it.
2. The reset (`:785`) deletes the campaign's links **except** the demo link. **`--rebuild` keeps today's
   behavior:** it deletes the whole campaign through the shared deletion cascade (`deleteCampaign.js:182,
   :210-213`) — never special-cased — and the seed then makes a new demo link on the new campaign (item 4);
   its viewers sign in again. Rebuild demo day runs the reset, not `--rebuild` (`routes/superAdmin/platform.js:209-221`).
3. The report it opens: the one just published, else the one it already opens if that's shown, else the
   newest shown report. After publishing, `updateOne({ _id: demo._id }, { $set: { reportId, oneLinkGuard:
   true } })` — **the one place a link's report ever changes** (demo organization only). Same `_id`, token,
   password, sessions and counts; no token collision. If that report already has another link (made during
   a pitch), the demo link stays where it is and the log says so. No shown report at all → the summary and
   the `client portal:` line say so. **Once, on the first run after the deploy**, a demo link that is still an
   all-reports link is replaced instead of re-pointed: deleted, and a new one-report link created with the
   same token, password hash and sealed copy — so no link that opened all reports survives, the seed's own
   rule (the policy's sentences about links admit no exceptions, `:699-701`). Same address and password;
   demo viewers sign in once more. From then on it's re-pointed in place.
4. No demo link yet → one is made: `reportId`, `oneLinkGuard: true`, token `SEED_DEMO_SHARE_TOKEN` or a new
   one, label "Client demo link", password from `SEED_DEMO_SHARE_PASSWORD` or generated (sealed when the key
   is set).
5. **Password:** the link keeps its own. The env password is used only when the link has none; when it
   matches the kept hash (`bcrypt.compare`), it's sealed, so the demo password can be shown.
6. The extend / renew refresh stays as today.
7. The `SHARE_PASSWORD_UNSET` refusal applies only when there's no demo link with a password, no
   `SEED_DEMO_SHARE_PASSWORD` and no seal key — checked after the floors (`:892-909`) and before the first
   write (`:919`), so a refused rebuild never wipes anything.

`SuperAdminHomePage.jsx:398` becomes "it opens the demo's report". `demoRebuild.int.test.js:311-321` asserts
today's behavior and is rewritten.

**C6. `npm run report:all-reports-links`** — read-only, cross-organization, run after the deploy and before
the switch: `server/src/migrations/reportAllReportsLinks.js` (`"report:all-reports-links": "node
src/migrations/reportAllReportsLinks.js"` in `server/package.json`), proxied in the root `package.json` as
`"report:all-reports-links": "npm --prefix server run report:all-reports-links --"`. It connects with
`connectDb(uri, { autoIndex: false, autoCreate: false })` (as `reportTabWeeks.js:44`; `autoIndex` alone still
creates collections). For every organization with a non-deleted link whose `reportId` is null or missing:
the organization's **name**; how many such links **still work** (active, unexpired, billing not blocking —
`shareLinksBlocked`, one read per organization), how many are **off because of billing**, **turned off**, or
**expired**; how many campaigns; the newest "last opened". Then how many reports in that organization have
more than one link, and totals. **Organization names and counts only** — no campaign, label, token or
person, following `reportTabWeeks.js:20-21`. No `--apply`. Run from the repo root before hand-over; a row in
`docs/OPERATIONS.md`.

**C7. History.**

- `writeLinkHistory(link, field, { …, report })` stamps `clientReportId`, `seriesId` and `periodLabel`; when
  no report is passed it looks it up. `shareLinks.js:220`'s read adds `reportId: 1`; the report-delete
  cascade (`clientReports.js:1708`) and POST's cleanup (`clientReportShares.js:224-226`) pass the report;
  POST reads the report with its dates.
- `campaignHistory.js`: a link row with a period label is named by its report (`reportRowName()` + "report")
  — "Oct 12 – Oct 18, 2026 · Paid team report · Link created"; `REPORT_ROW` gains Archived and Unarchived;
  one vocabulary — "Link turned off — everyone was signed out" / "Link turned on" (the old disabled /
  enabled rows), "Link given a new address — everyone was signed out" (rotate); a deleted all-reports link
  reads "An old link to all your reports" — its delete row carries `toValue.allReports: true`, since older
  rows carry nothing to tell the two kinds apart.
- No History key may contain `token`, `password` or `hash` (`withoutSecrets` drops them): the change-
  everywhere row carries `toValue.alsoChanged: n` ("Also changed on 3 other links that used the same
  password"), each other link's row `toValue.changedTogether: true`.
- No side effects (round 1): erase, restore and the phone's feed are untouched.

**C8. The preview's earlier-totals line** (`clientReports.js:1426`) reads `earlierTotalsLine(report, {
oneReport: true })`, as every client now does; the hub's wording joins §J.

### D. Web

**D1. Share is the report's link manager** (`ShareDialog.jsx`; the pieces it needs — `PasswordInput`, the
Extend and Renew panels, the confirms, `linkBadges`, `failureLine` — move out of `ClientLinksPanel.jsx`, which
is deleted).

```
Share “Oct 19 – Oct 25 · Whole campaign”                       (no link yet)
  Make this report's link
  Password  (•) Same as your last link (Whole campaign · Oct 12 – Oct 18)
            ( ) Make one up for me
            ( ) Type my own  [____________]   12 or more characters
                Everyone who manages this campaign can see this password later.
                Don't use one you use anywhere else.
  Expires   [90 days — until Jan 25 ▾]
  [Create link]

Share “Oct 19 – Oct 25 · Whole campaign”                       (has its link)
  Link      doorline.app/r/7kQ…                                       [Copy link]
  Password  ••••••••••••                                              [Show]
            [Change password]
  ● Active · Expires Jan 25 · Last opened Oct 26           [Extend]  [New address]
  Message (no password in it)
  [ The report for Oct 19 – Oct 25 is up: … — use the password I sent you. ]
                                                         [Done] [Copy message]
```

- **No link — the password choice:** Same as … from the newest link with `passwordCopyable` on this report's
  tab (`report.seriesId`, else the old series key) — picked by default. None on the tab → the campaign's
  newest is offered but not picked ("Same as the Whole campaign · Oct 12 – Oct 18 link"), Make one up picked.
  None at all → Make one up. Type my own checks 12+ as you type and carries the warning. No label field. **Staff under a grant** don't see Type my own: "Doorline staff
  can't type a link password — make one up or use Same as …".
- **Right after Create link** (Make one up or Type my own) **or Change password:** the new password in plain
  text with Copy password — "Its password: k7Hq9mXrW2pZ" — so it's never unseen, even with no seal key.
  Not after Same as … (the client has it). To staff: "Doorline staff can't view link passwords — the
  campaign's admins and leads can see it in Share."
- **Has its link:** **Show** fetches the password into component state (never a react-query cache entry,
  dropped on close) — "Showing…", or "Couldn't show the password." with Try again — and then **Copy
  password** appears beside it (a plain click-time copy, so Safari's rule against copying after an awaited
  request never applies).
- **Subtitle** (`ShareDialog.jsx:132`): "Paste the message into your own email or text. It never includes the
  password."
- **Can't be shown:** `unavailable` → "This link's password can't be shown. To have one you can see, change it
  — then send your client the new password."; `staff` → "Doorline staff can't view link passwords." Both
  with Change password.
- **Change password:** Make one up / Type my own (not for staff); "Also change it on the N other links that
  use this password (Whole campaign, Paid team)" — ticked, shown when `samePasswordCount` > 0; "Changing it
  signs out anyone using the old one — send your client the new password." When fewer changed than were
  offered (`changed` against the count the Also change it line offered — two overlapping changes can skip links without either
  seeing a `skipped`): "Changed on 1 of the 3 other links — the rest were changed by someone else a moment ago;
  check their passwords." While the campaign has working all-reports links: "Your old link to all your
  reports keeps its own password — if that leaked too, change it or delete it under Old links to all your
  reports."
- **Status:** the badges, wrong-password line and lock advice in one vocabulary — "Turned off — Nobody can
  open it until you turn it on.", "…Give it a new address." — **Extend** (or **Renew** when expired),
  **Unlock now** when locked, **New address** (today's Rotate) and **Delete link**, each with its confirm:
  "Give this link a new address?" (on a turned-off link: "It stays turned off — nobody can open the new
  address until you turn it on."), "Delete this link?". No Turn off — Take down does that job for one report;
  a link that's already turned off (from before) shows Turn on and Delete.
- **Message** (`copyMessageFor`) endings, by what Share just did: a password made up or typed → "— I'll send
  you its password separately" ("…the new password separately" after a change); Same as …, or a link opened
  again later → "— use the password I sent you". The URL is the short
  `/r/<token>` (a one-report link's page opens its report).
- **Errors at Create:** Same as … can't be copied any more (409 `PASSWORD_NOT_VIEWABLE` / 404
  `SOURCE_NOT_FOUND`) → "Your last link's password can't be copied any more — choose Make one up for me or
  Type my own."; someone made it first (409 `REPORT_HAS_LINK`) → "Someone made this report's link a moment ago
  — here it is. Its password is the one they chose."
- **Taken down:** with a link — "This report is taken down — its link shows “taken down” until you put it
  back up."; without — "This report is taken down. Put it back up, then make its link." Copy message is off.
- **Extras** (C2): "Also opens this report: Board · made Oct 25 · Delete".

**D2. Report rows** (`ReportRow.jsx`): left (bordered, as today): Open, Share (published — shown or taken
down), Next report (newest of its kind). Right, one `ml-auto flex flex-wrap gap-1` group of ghost buttons
that wraps as a unit: Archive / Unarchive (no Archive on the newest of its kind; Unarchive on every archived
report), Take down / Put back up, Delete (danger text, last). Drafts: Open, Next report if newest, Archive,
Delete. The `RowMenu` goes. Round 1 measured the two groups at ≈209 px and ≈248 px — each fits a 280 px phone
row. Then the two lines (Part 1 §5): `linkStatusLine` (new, `linkState.js`) and the opens line (`opensLine`
summed over every link). Confirms:

- Take down (row and builder): "Its link shows “taken down” until you put it back up." (no line without one).
- Delete, shown, with a link: "Your client can open the Oct 19 – Oct 25 report right now. Deleting it also
  deletes its link — anyone who opens it then reads “This link isn't available.” To hide it but keep it, use
  Take down instead. This can't be undone."
- Delete, shown, no link: "The Oct 19 – Oct 25 report has no link of its own, so this deletes only the
  report. This can't be undone." — or, while an old link to all your reports still works: "The Oct 19 – Oct 25
  report has no link of its own, but your old link to all your reports shows it — deleting it takes it off
  that too. This can't be undone."
- Delete, taken down, with a link: "Your client already can't see the Oct 19 – Oct 25 report — it was taken
  down. Deleting it also deletes its link, for good. This can't be undone."
- Delete, taken down, no link, and drafts: as today (`ClientReportsPage.jsx:588-593`).

**D3. Page** (`ClientReportsPage.jsx`): a tab lists its non-archived reports, then **Archived (N)**, folded;
the newest of each kind is never folded (archived, it stays in the list marked Archived). Gap lines are still
worked out over **all** the tab's reports (`gapsAbove` unchanged) and drawn with the row they sit above. Tab
counts are non-archived. A tab whose reports are all archived: "Every report here is archived — open Archived
below, or press New report." Archive's feedback: "Archived — it's under Archived (4) at the bottom. Undo"
(errors in the page banner). `ClientLinksPanel` removed; **`RetiredLinksCard`** sits **above the reports card
at every width**, only when the campaign has all-reports links, worded by `allReportsRetired`, each row with
its state and — before the switch, on a working link — Change password and New address; Delete's confirm by
state (Part 1 §3).
`BrandingCard` unchanged in the side column.

**D4. Builder** (`ClientReportBuilderPage.jsx`): Share wherever the row has it (`:1283`, `:1484`); the opens
line as the row's (`:987`); one banner, "Published — Share makes its link for your client." with Share
(`hasUsableLink` and the "Your client can see it now." banner go, `:1022-1026`, `:1335-1347`); an archived
report: "Archived — it's out of your list. Nothing changes for your client." with Unarchive — which is also
where Next report lands when it opens an archived report.

**D5. Publish:** the confirm's subtitle (`PublishDialog.jsx:64`) "Oct 19 – Oct 25 — after you publish, Share
makes its link for your client." (while an old link to all your reports still works: "Oct 19 – Oct 25 — your
old link to all your reports shows it as soon as you publish; Share makes its own link."); its link line (`:111-113`) goes; "Your client sees exactly the preview."
(`:110`) stays. Before you publish (`BeforePublish.jsx:159-162`) loses its link line, so "Nothing needs a
look." can still appear.

**D6. Words elsewhere:**

- How it works step 3 (`howItWorksCopy.js`; rendered title — body, `HowItWorks.jsx:70`): "Share makes the
  report's link and a message to paste into your email or text. Next week's link keeps this week's password,
  so you send a password only the first time, or after you change it. Or open the report and press Download
  PDF." `PHONE_STEPS` (`:29`): "Share its link; send the password the first time."
- The area-view warning (`BeforePublish.jsx:145`): "“Support Smith?”: other reports your client can open
  could narrow down the answers its areas keep hidden — …".
- New report: `duplicateText` adds "— it's archived." (with Open it and Unarchive); the note under Make a
  second one (`NewReportDialog.jsx:686-688`) per Part 1 §6.
- The client's report page note (`PublicReportDetailPage.jsx:128`) "This link opens this report only." stays
  — it's true before and after the switch.
- The homepage meta (`client/index.html:28, :41, :55`).
- `linkState.js`: `linksFor` drops all-reports links; `linkStatusLine`; `opensLine` summed, "About N visits";
  the badge, advice and confirm words above. `copyMessage.js`: endings above; `linkMessageFor` and the Link
  ready dialog go.

**D7. Duplicates:** New report's prompt (D6) and Next report's landing (D4).

**D8. Client pages:** no code change (§C1). Tests pin it.

### E. Tests

**Server (int, throwaway mongod):**

- **One link per report:** a second POST → 409 with the primary; 20 concurrent POSTs → exactly one link;
  the raw document carries `oneLinkGuard: true`; `ensureOneLinkGuard` heals a planted duplicate; a legacy
  unguarded link blocks a new one; look-first beats `REPORT_NOT_SHOWN`.
- **All-reports links:** with the switch unset — they still open; POST without `reportId` → 400; a password
  change and a rotate work (sealed copy null, `alsoChanged` refused, refused under a grant); unlock, extend,
  renew, enable and Show → 409 `ALL_REPORTS_LINK`. With it on — `GET /share/:token`, `/unlock`, a signed-in
  `/reports/:id`, `/map`, `/logo` → 410 `SHARE_RETIRED`; every admin action but DELETE → 409; a turned-off one
  → 404 as before; unset again → they open. `reportSecurity.int.test.js:210-222` and `teamLead.int.test.js:779` (401 → 410) change accordingly.
- **Passwords:** generated, typed and copied links all Show; a change Shows the new one; no key → create
  works, `passwordViewable` false, Show → 409, and a change without the key nulls the sealed copy; a replaced
  key → 409, never 500; a stale copy (hash changed behind it) → 409; a value sealed without the link's
  associated data → 409; a password with a lone surrogate → 400 on POST and PATCH, and a wrong-password
  answer on the public unlock, with the process still up; another campaign's lead → 403; another
  organization → 404; `passwordFrom` from another campaign or organization → 404; a copied link unlocks with
  the source's password; `alsoChanged` changes exactly the links with the same password (copied *and* typed
  again), bumps each version, skips one changed meanwhile and says so, one History row each; no password,
  hash or sealed copy in list rows, History, an error body or any public response.
- **Staff** (under a support grant): Show → 403; rows `passwordViewable: false`, reason `staff`,
  `passwordCopyable` as for anyone; typed `password` on POST and PATCH → 403 `STAFF_CANNOT_SET_PASSWORD`;
  generated passwords not in the response; without a seal key, Make one up → 403 `PASSWORDS_NOT_KEPT`;
  `passwordFrom` works. In an internal organization (no grant), Show works.
- **Archive:** CAS both ways, one History row each, list rows and duplicate answers carry it, `existingOf`
  prefers the unarchived report, a one-report link still opens an archived report, publish / take down / put
  back up keep it, `status` untouched.
- **Demo:** after a reset (Rebuild demo day), the same link (same `_id`, token and password) opens the new
  report, and a viewer's share token still works; after `--rebuild`, a new demo link on the new campaign;
  the tie-break picks the newest active "Client demo link"; the first run after the deploy replaces an
  all-reports demo link with a new one-report link at the same address and password; a plain apply leaves the link as it is; a link made in the
  app for the demo report → the demo link stays put; no shown report → no change, a summary that says so; a
  matching env password gets sealed; the refusal comes before any write.
- **History:** link rows carry the report's id, series and period label; `alsoChanged` survives
  `withoutSecrets`; the new vocabulary.
- **The check:** read-only — `autoCreate: false`, no write of any kind (including a collection or index
  build); counts by state, billing bucket included; organization names only.
- **The preview** uses the one-report earlier-totals wording.
- **Legal text** (`staticPages.int.test.js`): the new Privacy and Terms sentences match; the old ones don't
  (in the date's commit).
- **Existing suites** (round 1's count — about 60 cases in 14 files): `shareLinks` (~17 of 20),
  `reportSecurity` (~9–13 of 21), `clientReportBuild` (~8), `clientReportSingleLinks` (~6 of 7),
  `clientReportMapPayload` (5 of 6), `clientReportBranding` (3), `demoRebuild` (2–3, plus `:311-321`),
  `clientReportEdits` (2), `clientReportMigration` (2), `leadWalkthrough` (~2), `clientReportOpens` (1–2),
  `clientReportChecks` (1–2; the links check goes), `sessionLifetime` (1), `teamLead` (1). Suites that read
  several reports through one shared link need one link per report.

**Client:** `linkState` (all-reports links excluded, `linkStatusLine` cases, "About N visits"),
`copyMessage` endings, Share states (no link with a same-tab source, another tab's source, none; just made;
has link; Show then Copy; can't show — `unavailable`, `staff`; staff without Type my own; taken down with and
without a link; extras; locked; expired; fewer changed than offered; the two Create errors; the Type my own
warning; the subtitle), row buttons by state, the Archived
fold and the newest-never-folded rule, gap lines with an archived middle report, the card's two wordings, its
row states and window actions, the Delete and Publish wording while an old link still works, History rows
(`campaignHistory`: report-named link rows, Archived, alsoChanged, the vocabulary). `shareSession.test.js`: a
410 `SHARE_RETIRED` on meta, unlock and a signed-in read each end the session;
`publicReportRender.smoke.test.js`: the notice shows the server's words.

### F. Docs and Help Center

Grep the whole repo case-insensitively at build for "all your reports", "client links", "hub", "client's
page", "sees both", "shown once", "new link", "make a link", "link ready", "opened via", "revoke",
"disable", "rotate", "earlier totals"; the list below is rounds 1–2's.

- **`docs/CLIENT_PORTAL.md` Part 1:** intro (`:3-13`); What your client sees — a link opens all your reports,
  the hub, "· Reports" (`:39-66`); the two earlier-totals forms (`:116-122`); Older/Newer (`:125-129`); Area
  view (`:176-179`); When something has changed (`:185-197`, a retired row); Building, "Your client sees both"
  (`:301-302`); Publishing; Take down and Delete naming links, the links panel and the row menu
  (`:581-595`); Latest progress on the client's list (`:641-643`, `:655-657`); Client links (`:727-795`,
  becomes "Sharing a report"); History; Who can do what (`:828-833`, the revoke-legacy exception goes).
  **Part 2:** §A (`:858` add `sealedSecret.js`, `:862` the check), §B models, §F lifecycle (archive), §G
  (`:1643`), §I (`:1788`), §J (`:1818-1826`, the hub — unreachable once the switch is on), §K share links, §M
  history, §O endpoints, §P error codes, §Q frontend (`:2298` "sees both"), §R deploy (the switch), §S tests.
- **Other docs:** `docs/PLATFORM.md:147-150` (the demo's link); `docs/OPERATIONS.md` (`:1249` the check; the
  `RETIRE_ALL_REPORTS_LINKS` table; `CREDENTIAL_SEAL_KEY` — "now also link passwords; never replace or
  remove"); `docs/ROLES.md:405-412` (leads and admins can view link passwords; staff can't);
  `docs/FBTIME_INTEGRATION.md:456-458` and the header of `server/src/utils/sealedSecret.js` (`:3-12`,
  `:19-22` — no longer "exactly one kind of value", and an absent key no longer means only "the integration
  is dormant").
- **Help:** `guides/client-reports.md` (`:8-9, :14, :16, :24, :30-37, :47, :56, :129, :136, :146-147, :176,
  :180-193, :187-191, :197, :205`); `pages/page-client-reports.md` (`:8-9, :18, :20, :24, :28, :32`);
  `faq/share-just-one-report.md` (keep the slug; rewritten as "Why does each report have its own link?",
  frontmatter `:8-9`, and the donor/board-member limit); `faq/client-link-asks-for-password-again.md` (`:8,
  :17, :20, :24, :26, :27, :32`, plus a "This link no longer works" entry under "If the page says something
  else"); `faq/exact-doors-or-areas.md:30`; `faq/how-do-team-reports-work.md:12`;
  `faq/doorline-staff-access.md` ("Client report link passwords are never shown to Doorline staff, even during
  a support session."). **New FAQs:** "I lost a client link's password" (with the Type my own warning and
  "when a manager leaves, change it") and "Where did the Client links panel go?". `faq/_INBOX.md` (`:65` "shown
  once"; a dated triage note). Unchanged: `getting-started/lead-getting-started.md`,
  `faq/which-file-to-send-a-client.md`.
- **Help ships with the deploy, so every sentence about old links must read true before and after the
  switch** — describe the turn-off conditionally, never "until Nov 4" or "have been turned off" in general.
  The new entry in `faq/client-link-asks-for-password-again.md`: "**“This link no longer works. Ask the person
  who sent it for the link to the latest report.”** — it's an old link to all your reports, which Doorline has
  turned off. Press **Share** on your newest report and send its link." "Where did the Client links panel go?":
  "Your old links to all your reports are listed above your reports under **Old links to all your reports**,
  where you can change their password or delete them. Doorline is turning them off for everyone; once it
  does, the card says so and they no longer work. Each report now has its own link — press **Share** on it."
- **`client/src/pages/SuperAdminHomePage.jsx:398`** (C5).
- This proposal: §K As built after the build.

### G. Privacy record

New **PRIVACY_VERIFICATION item 44** (v7, 2026-10-28), written with the build and completed on the date
(numbered 44, not 43 as planned: the walk-list archive build, the same day, took 43):

- the read-only check: a staff-facing, cross-organization output — organization names and counts only;
- all-reports links: no new ones from the deploy; turned off in every organization by
  `RETIRE_ALL_REPORTS_LINKS` on [date]; what a client sees; the email the owner sent (or chose not to) and the
  Terms / Privacy sentences chosen;
- one link per report;
- passwords sealed and shown to the campaign's admins and leads — where; who (a client given a lead account
  included); not logged in History; the key kept apart from the database; associated data binding each copy
  to its hash; a database copy alone reveals no password (its length, yes; copied links share a hash, which
  shows they share a password); **staff under a support grant can neither view nor type one** (the two 403s,
  their tests); the owner's DPA §4 decision;
- outside this plan, noted: a grant holder can still create a non-staff admin account (`vendorGuards.js:32-43`
  refuses only staff targets — logged and visible in Users), and a staff account a customer adds as a member
  acts as a member;
- archive is operator-side only; no new collection, no new recipient, no new subprocessor.

**Watchlist additions:** "Links created before that date no longer work" — owned by `loadShare`'s
`SHARE_RETIRED` rule under the switch, and its test; "under a support grant, staff can't view or set link
passwords" — owned by the two 403s and their tests; "a link's password can be changed, or the link rotated" —
owned by Change password and New address in Share and, until the switch, on the old-links card; "may revoke a
link at any time" — owned by Delete link in Share, the extra-links line's Delete and the card's Delete;
re-verify `:98-100` (privacy.html:112, "stated absolutely") against the new route. Item 44 also records the
demo organization's link: replaced once by the first rebuild after the deploy — a new link at the same
address and password, Doorline's internal organization with synthetic data.

**Annotations** (v7, item 44; v1 and v2 are never deleted) where the record says otherwise:

- *Becomes false (on the date):* `:74-75` (item 10, legacy links remain live); `:1153-1157` (watchlist: "a
  link to all reports serves exactly what it did"); `:1270-1275` (gap 5 — closed); `:3586-3587`,
  `:3602-3604`, `:3606-3607` (38(m): null = all reports; the demo never adopts a one-report link; each link
  keeps its own password; all-reports links render as before); `:4865`, `:4867` (D11 legacy and revocation
  rows); `:4872-4876` (the "may remain accessible" guidance and the legacy expiry line).
- *Becomes false (at the deploy):* `:907-908` (FbTime: "the first encrypted-at-rest secret… only the display
  prefix is ever readable"); `:3480` (38(e), "never stored"); `:4863` (D11, "returned once").
- *Becomes stale:* `:3207` (item 34, "the panel offers…"); `:3434-3438` (38(a)); `:3455`, `:3463` (opens
  lines); `:3471` (38(d)); `:3481-3486` (38(f): sessions also end on retirement or a change everywhere);
  `:3487-3500` (38(g): archived rows; link rows carry the report's id and period; `alsoChanged`);
  `:3627-3632` (38, the demo link's life); `:3654-3660` (38 v7 stamp, Make a link); `:4157` (v2 gap 7) and
  `:5551` (v1 item 10), closed on the date; `:5236` (G15 Atlas — it now also holds sealed passwords).

### H. Edge cases

- **Key absent or malformed:** links still work; a password made up or typed is shown once, right after;
  afterwards "can't be shown"; Same as … isn't offered.
- **Key replaced:** every sealed copy stops opening → "can't be shown". Verification is unaffected. (It would
  break FbTime too — never replace it.)
- **A sealed copy left stale** (the hash changed by code that didn't know the field): it no longer opens, so
  it's never shown as current.
- **Two people make the same report's link at once:** the guard leaves one; the other sees it.
- **A link made at the instant its source's password is changed everywhere** can keep the old one (C3).
- **Two changes everywhere at once:** the links can end split between the two new passwords; Share says how
  many were skipped.
- **A manager leaves the campaign:** they still know the season password — change it, with Also change it.
- **Staff under a grant:** can make links (made-up or Same as …) and change passwords the same way — never
  view or type one.
- **The switch on, then off again:** old links open again at once; nothing was written to them. A device that
  visited while it was on dropped its session and signs in again.
- **A password with a lone surrogate:** refused before bcrypt on every path this plan touches — it would
  crash the process.

### I. Rollout

**Before the deploy:** the owner decides Part 1's item 6, and checks `CREDENTIAL_SEAL_KEY` (Settings → Reveal
Config Vars). A good value is 44 characters ending in "=". If it's missing: Run console
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (verified from the repo root),
copy the output, add it as `CREDENTIAL_SEAL_KEY`; adding a config var restarts the dynos. **If it was
missing, adding it also turns on FbTime Connect** for every organization's admins (`integrations.js:299` is
its only gate) — FbTime is already in the Privacy Policy and DPA, so it's an unannounced feature, not a legal
problem; owner's call. Never replace an existing value (FbTime keys and every link password would stop
opening).

**The deploy** — server + web from `main`, `RETIRE_ALL_REPORTS_LINKS` unset. The guard index builds at boot.
No console step required; no OTA; no client-version gate (`audit:mobile-api` on the build diff, again). Then
Rebuild demo day; then the check (`npm run report:all-reports-links`, Run console); then the owner's decisions
and email; then the owner shares the newest reports with their own clients.

**On the date** — the legal edits deployed, then `RETIRE_ALL_REPORTS_LINKS = on`; verify (Part 1). Item 44
completed with the date, the email and the sentences chosen.

**Rollback:** unset `RETIRE_ALL_REPORTS_LINKS` — old links open again at once, no deploy — and put the legal
sentences back in the next deploy. Reverting the code itself is never needed for the links; for anything
else, revert on `main` and redeploy (the owner's routine).

### J. Later — once the switch has been on a while (after Election Day)

The switch becomes permanent in code, and the unreachable code in C1 goes with its tests: the hub's
multi-report branch and its earlier-totals wording, the open-link branches, first-password-on-an-open-link,
set-an-expiry, the seed's open-link upgrade, `revoke-legacy`.

### K. As built

**Built 2026-10-28, uncommitted; code reviews pending.** Four build agents built this plan (with the build
brief's contracts K1–K12 at the seams), then the docs, Help Center and privacy record followed. Everything
in Part 2 was built as written unless listed below: one link per report and its guard (§C2), passwords
sealed and shown again, Same as … and change everywhere (§B, §C3), the staff refusals (§C3), the switch
and its 410 (§C1), Archive (§C4), the demo link (§C5), the read-only check (§C6), History (§C7), the
preview's earlier-totals line (§C8), Share and the old-links card (§D1, §D3), the row's buttons and lines
(§D2), and the builder, Publish and New report wording (§D4–§D7). The owner's picks held: the "My client
already has this password" tick box and Share's reminder line were not built; the other optional pieces
were. The crash fix in "Found in passing" was built first and handed over on its own.

**Files.** Server: `models/ReportShareLink.js`, `models/ClientReport.js`, `utils/sealedSecret.js`,
`services/reports/shareLinks.js`, `clientReportIndexes.js`, `clientReportHistory.js`,
`clientReportChecks.js`, `services/retention/scheduler.js`, `services/platform/seedDemoOrg.js`,
`routes/admin/clientReportShares.js`, `routes/admin/clientReports.js`, `routes/public/share.js`, the new
`migrations/reportAllReportsLinks.js`, and its script in `server/package.json` with the root proxy. Web:
`ShareDialog.jsx` (rewritten), new `RetiredLinksCard.jsx` and `linkParts.jsx`, `ClientLinksPanel.jsx`
deleted, `linkState.js`, `copyMessage.js`, `hooks.js`, `ReportRow.jsx`, `ClientReportsPage.jsx`,
`ClientReportBuilderPage.jsx`, `PublishDialog.jsx`, `BeforePublish.jsx`, `NewReportDialog.jsx`,
`newReportChoices.js`, `howItWorksCopy.js`, `lib/campaignHistory.js` (its client-report rows only),
`client/index.html` and `SuperAdminHomePage.jsx`. Tests: [CLIENT_PORTAL.md](CLIENT_PORTAL.md) §S.

**Where the build differs from the plan, or settles what it left open.**

Server, links:

1. The typed-password guard is an explicit check answering `400 SHARE_PASSWORD_INVALID` (§B said a zod
   `.refine` answering `PASSWORD_INVALID`), and the password checks run before `REPORT_REQUIRED`. On
   PATCH, `password` beside `generatePassword` is `400 PASSWORD_AND_SOURCE`.
2. Under a support grant, any password change on a link to all reports is `403
   STAFF_CANNOT_SET_PASSWORD`, made up as well as typed ("…nobody could see the new one.").
3. A made-up password under a grant with no seal key is `403 PASSWORDS_NOT_KEPT`, on create ("Doorline
   can't keep link passwords right now, so nobody could see one made up here. The campaign's admins and
   leads can make this link.") and on PATCH ("…so nobody could see a new one. The campaign's admins and
   leads can change it."). The plan's "use Same as …" was dropped: Same as … needs the same key.
4. Show's `409 PASSWORD_NOT_VIEWABLE` carries a `reason` (`not_kept`, `no_key`, `unreadable`,
   `mismatch`); Same as …'s 409 carries none. Both of Same as …'s refusals answer "Your last link's
   password can't be copied any more — choose Make one up for me or Type my own."
5. A create that loses the guard race twice answers `409 SHARE_CHANGED`.
6. History writes `toValue.alsoChanged` only when n > 0; a link row written after its report is gone,
   without the report handed over, takes `clientReportId` from the link and has no tab or period.
7. PATCH answers `changed` and `skipped` only when `alsoChanged` was sent and a password changed.
8. Extend's "set an expiry" was unreachable before the switch too: a link that never expires is a link to
   all reports, and Extend refuses those.
9. `teamLead.int.test.js`'s wrong-password test (:779) keeps its point on a one-report link; the switch's
   410 is tested in `clientReportLinksRetired.int.test.js`, and `reportSecurity.int.test.js` checks unset
   → 200, on → 410, unset → 200.
10. `report_one_link_guard` is in the integration-test preload's `ENFORCED` list
    (`server/scripts/testIndexPreload.mjs`) — added by the walk-list session, whose file it is, at this
    session's request, with a `liveIndex.int.test.js` test that compares it to `REPORT_ONE_LINK_GUARD`
    (rename or change the guard and that test fails until the preload follows).

Server, reports, the demo and the check:

11. `REPORT_EXISTS` says "— it's archived" for a draft and a taken-down report too ("You already have a
    draft … — it's archived.", "…, taken down — it's archived.").
12. The check also lists organizations whose only issue is reports with more than one link, puts those
    with working links first, marks "(Doorline internal)" and "(being deleted)", adds a line for links
    whose organization no longer exists, and prints an organization's newest "last opened" as a UTC date.
13. The seed: with no shown report the demo link isn't touched, not even its expiry; a demo link that's
    turned off stays off (the `client portal:` line says so); the one-time replacement keeps the old
    link's on/off state and its "Client demo link" label; a failed replacement puts the old link back
    exactly; a demo link that stays put gets the usual expiry refresh; "that report already has another
    link" also covers a run with no demo link, or one still to all reports.
14. The seed refuses a `SEED_DEMO_SHARE_PASSWORD` that isn't well-formed text (`409
    SHARE_PASSWORD_INVALID`) before any write.
15. The seed's summary `share` is `{ token, url, expiresAt, reportId, isActive, note }` (`url` null with no
    demo link).
16. The seed's password writes are separate pinned writes, so a first password plus a renewal bumps
    `credentialVersion` twice.

Web, Share and the old-links card:

17. After New address, the card shows "Its new address: … Copy link".
18. "No link of its own yet — Share makes one." is warning-toned, and muted while a working old link to
    all your reports still shows the report: the only thing the switch changes in the row's link line.
19. A taken-down report whose link is turned off or expired shows that link's line, not the taken-down
    one.
20. The opens line keeps "Doorline staff: N visits" and "N views before per-link counts" when above zero.
21. Same as … from a link whose report has no `seriesId` is offered, never picked (the rows carry only
    `seriesId`, not the old series key).
22. Share's confirms sit in place, not in a dialog over it; the card's use `ConfirmDialog`.
23. Change password, for staff under a grant, offers only Make one up for me, with no staff line.
24. The card keeps **Add a password** for an old link with no password.
25. Also removed: `linkOpens`, `linkName`, `linksLine`, `noUsableLinkReason`, `deleteLinksText`,
    `disableConfirmText`, `opensSummary`, `reportUrl`, and the "No password" and "Never expires" badges;
    `singleLinksOf` stays as an alias of `linksFor`; `opensLine(report)` takes the report alone.

Web, the page, the rows and the builder:

26. Delete on a shown report whose link is expired or turned off drops "Your client can open … right
    now."; a report with two links of its own reads "its links — anyone who opens one".
27. Delete before the links list has loaded: "The {period} report and any link of its own are deleted for
    good. This can't be undone."
28. "Every report here is archived…" shows only when something is folded.
29. History's `changedTogether` row reads "Changed along with other links that used the same password".
30. The homepage's JSON-LD (`client/index.html:55`) reads "…frozen reports shared by password-protected
    link."; the two meta lines read "…you share by…".
31. The row's Delete is drawn in danger text in a small Button's shape: a ghost Button can't carry danger
    text in the built CSS.
32. Take down's line reuses `takeDownLinksText(linksFor(…))`, so it says "Its link" even for a report
    with two.
33. The builder's archived banner says "it's out of your list", slightly off for an archived newest
    report, which stays in the list.

Found while documenting:

34. The privacy record's item is **44**, not 43: the walk-list archive record, written the same day,
    took 43. This plan's references to it were renumbered.
35. `PASSWORDS_NOT_KEPT`'s create sentence (this plan's §C3) told staff to "use Same as …", which can't be
    offered then: without a usable key no sealed copy opens. Fixed after review: it now points to the
    campaign's admins and leads (deviation 3 above).
36. `loadShare`'s comment in `routes/public/share.js` named "the migration" (the v1 audit's phantom) as
    what ends legacy links; it now names the switch. In `models/ReportShareLink.js`, the header's "until the
    migration fills them" means `migrate:client-report-visibility`, which does fill those fields; its
    comments on `passwordHash`, `expiresAt` and `isLegacyOpen`, which say a migration finds open links,
    describe a migration that doesn't exist and were left as they are ([PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md),
    remaining gap 5).
37. Rebuild demo day's message now ends with the seed's note on the demo's client link when it couldn't
    move it ("Client link: no report is shown, so the demo link was left as it is."); the console's
    `client portal:` line still says it too.
38. `npm run report:all-reports-links` was run from the repo root against a throwaway database (output
    in [CLIENT_PORTAL.md](CLIENT_PORTAL.md) §R and [OPERATIONS.md](OPERATIONS.md)); `--apply` is refused
    (exit 2).
39. **Code review round 1 (client) fixes:** Share builds the message only from a link the client can open
    (turned off, expired or locked → Copy message off, with "Turn it on before you send it." / "Renew it
    before you send it." / "Unlock it before you send it."); each action in Share and on the card shows only
    its own error; a refused Same as … is never replaced by another tab's link silently; refusals meaning
    the link changed elsewhere re-read the list (incl. `ALL_REPORTS_LINK`); Type my own's box is named and
    described for screen readers (`PasswordInput` passes `aria-labelledby` / `aria-describedby`); focus goes
    to Copy link after a Create with no password on screen, to Undo after Archive, and to the row after
    Unarchive; "Changed on 0 of the 1 other link" reads "It wasn't changed on the other link — …".
40. **Added after code review round 2:** §E's two client tests for the switch, which the build had left
    out. `shareSession.test.js`: a 410 `SHARE_RETIRED` on meta, on unlock and on a signed-in read each ends
    the session (the remembered token dropped, the notice in the server's words).
    `publicReportRender.smoke.test.js`: the notice shows those words as its title, with nothing under it,
    on its own and through the session to the layout.
41. **Code review round 2 (client) fixes:** no press in Share or on the old-links card leaves the keyboard
    on `<body>` (`useFocusAfter`: Turn on / Unlock now → Copy link, Renew / Extend → Extend, deletes → the
    next control, the card's last → the reports heading); Copy link's focus after Create no longer relies on
    a mount-time `autoFocus` that lost a race with the list's answer; Create's `REPORT_NOT_SHOWN` /
    `REPORT_NOT_FOUND` re-read the report as well as the links (`onReportChanged`), and a deleted report's
    Share says "This report was deleted — there's nothing to share." New flow tests mount the real page,
    Share, the card and the overlay on a minimal DOM (`clientReportShareFlow.smoke.test.js`).

**Docs and Help Center.** CLIENT_PORTAL.md (Part 1 rebuilt around one link per report — *Sharing a
report*, *Old links to all your reports*, *Your reports list, and Archive* — and Part 2 §A, §B, §F, §G,
§I, §J, §K, §M, §O, §P, §Q, §R, §S); OPERATIONS.md (the release section with the switch's table, the
switch and the seal key in Part 2, the check's row); ROLES.md; PLATFORM.md; FBTIME_INTEGRATION.md;
README.md; PRIVACY_VERIFICATION.md (item 44, its watchlist bullet, and the annotations §G lists). Help:
`guides/client-reports.md`, `pages/page-client-reports.md`, `faq/share-just-one-report.md` (same slug,
retitled "Why does each report have its own link?", with the donor and board-member limit),
`faq/client-link-asks-for-password-again.md` (the "This link no longer works" entry),
`faq/exact-doors-or-areas.md`, `faq/how-do-team-reports-work.md`, `faq/doorline-staff-access.md` (the
staff line), the new `faq/lost-client-link-password.md` and `faq/where-did-client-links-go.md`, and
`faq/_INBOX.md`. Every Help sentence about old links reads true before and after the switch.

### L. Review log

**Round 1 (2026-10-27/28)** — three reviewers: A (server and security, on a throwaway mongod), B (the
owner's routine through the real screens, plus simplicity), C (privacy, legal, release, consistency).

- **A — 0 blockers, 3 majors, 11 minors.** Confirmed: every public route runs `loadShare`; the guard index
  builds over old duplicates and holds 1 of 20 concurrent creates; `oneLinkGuard` must be declared; the
  `passwordFrom` boundary; History stamping has no side effects. Majors: "also change it" can't be one
  `updateMany` (now per-link CAS); a delete-all route without an organization check (cut); the demo seed.
  Minors: History key names, naming link rows, stale or replaced-key Show, sealing hardening, guard helper
  details, POST order and races, single-row responses, archive details, unreachable code, the real test list,
  the check counting dead links.
- **B — 1 blocker, 8 majors, 15 minors, 10 simplifications.** Blocker: the plan's client change for retired
  links would have left the client on "Loading…" or a blank page — the existing 410 handling already says the
  right thing, so no client change. Majors: archiving the newest report hid Next report; Same as … could
  borrow another tab's recipient's password; a Latest progress link isn't live; a donor or board member loses
  their own link; confirms and History read "Unlabelled link" / "A client link" / "Client Report.archived";
  the check printed customers' link labels; no Help answer for the deploy-day message. Simplifications taken:
  no Turn off; no delete-all; counts not id lists; no fold for extra links; the publish-time link check
  removed; one opens line. Not taken: dropping the expiry picker (the policy's "chosen by an administrator").
- **C — 2 blockers, 5 majors, 12 minors.** Blockers: the "before deploying" check couldn't run (the Run
  console runs the live code); Doorline staff under a grant could Show a customer's link password and keep
  opening the report after the grant ended — breaking the Privacy Policy's staff sentence (reproduced on
  today's code; now refused). Majors: the Terms sentence and the other-customer decisions; the DPA §4
  premise; a Type my own warning; ~20 privacy-record passages; more doc and Help passages. Minors: other
  docs, "Last updated", the key step's FbTime side effect, the demo between deploy and rebuild, the check's
  scope and names, legal-text tests, can't-show wording, "also change it" scope, Same as …'s tab, the
  homepage, rolling back legal text, small inconsistencies.

**Round 2 (2026-10-28)** — two reviewers: V (coverage of the server, security and release fixes, plus
experiments on revision 2's new mechanisms) and W (coverage of the UX, copy, docs and legal fixes, plus a
rehearsal of every owner and client step).

- **V — 0 blockers, 1 major, 11 minors.** Held under experiment: associated data (every case, FbTime
  unchanged), POST order, archive, the check's cost. Major: the demo seed couldn't tell its own link from a
  pitch link, could collide on its token, and signed viewers out on every rebuild — now one demo link,
  re-pointed in place (C5). Minors: the "fixed-length" envelope wasn't (cut instead); the can't-show reason
  for links made without a key; the full `select: false` list and the try/catch rule (an escaped parse error
  would have echoed a password); the copy re-check ran once (cut — low value); overlapping changes everywhere
  (now reported as skipped); staff couldn't use Same as … (`passwordCopyable`); staff could still type a
  password and keep using it after the grant (now refused); the check's `autoCreate` and billing bucket;
  release sequencing against the owner's one-commit routine; a verify step that couldn't pass; tabs in the
  message and the change-everywhere line.
- **W — 0 blockers, 3 majors, 12 minors.** Majors: a "Release 1 on the date" could never wait outside
  `main` under the owner's routine — now one deploy with a switch (the `FBTIME_DOOR_COUNTS` pattern), and the
  check runs between; the customer email asked for what today's Share can't do (rewritten, sent after the
  deploy); "also change it" missed passwords typed again by hand (now matched by the password itself).
  Minors: the card's date (none now); the Terms sentence for links already off; ship-step gaps (item 6 before
  the deploy, Election Day, the verify order); staff and Same as …; the preview's earlier-totals wording; the
  deploy-day message and second tab; one vocabulary; the duplicate prompts quoted wrongly; an archived newest
  report as a dead end; unnamed row and Share states; How it works and the Publish confirm; the staff-access
  FAQ and leads who are clients. Simplifications taken: the switch instead of two releases; one can't-show
  sentence; endings from what Share just did (no `copiedFromEarlier`); Copy password after Show; the homepage
  off the decision list.

**Round 3 (2026-10-28, final)** — two reviewers: X (server and security of revision 3, plus coverage of round
2's server findings) and Y (the owner's final read).

- **X — 1 blocker (in today's code, not this plan's), 1 major, 6 minors.** Blocker: a password with a lone
  surrogate makes bcryptjs 2.4.3 run out of memory and the process exit — reproduced against the real app
  through the unauthenticated link unlock and sign-in; one request takes down the single web dyno. Now
  guarded on every link route this plan touches (zod `isWellFormed` before bcrypt; the unlock treats it as a
  wrong password), and flagged in Part 1 as a separate urgent fix for sign-in. Major: `--rebuild` deletes the
  whole demo campaign through the shared cascade, so it can't keep the demo link — it keeps today's behavior;
  Rebuild demo day (the reset) keeps the link. Minors: a split that `skipped` can't see (now compared with the
  offered count); a leaked season password on a working all-reports link (a line in Change password); staff
  generating with no key (refused); the demo link's tie-break; History for deleted all-reports links
  (`toValue.allReports`); `revoke-legacy` still answers. Verified: the switch in both states (a share token
  from the window is refused at `loadShare`); grouping by password and the per-link CAS; no remaining way for
  staff under a grant to learn a password; the full `select: false` list; the guard error, `existingOf`, the
  check script and the preview change.
- **Y — 1 blocker, 2 majors, 16 minors.** Blocker: in the window before the switch, old links still worked
  but could only be deleted — making the Privacy Policy's "a link's password can be changed, or the link
  rotated" false for live links; now, until the switch, they can get a new password or a new address. Majors:
  the extra-links line was listed as optional but is the only way to revoke a report's second link (now
  required); skipping the email is only safe when no other customer is affected, and the Privacy Policy and
  Terms both promise notice of material changes (now spelled out in item 4 and optional item 1). Minors:
  the password check moved to deploy day; the reminder line, step 6 and the email now say Type my own plus the
  tick box; the card's rows say each link's state, and Delete asks first on a working one; the can't-show,
  archive and taken-down sentences no longer claim a link works; Share's subtitle; the Delete and Publish
  wording while an old link works; the client page note kept as is; Help text true in both states; the demo
  link replaced once so no all-reports link survives; ship-step wording; the "Last updated" count; one more
  not-in-plan gap; the corrected optional list.
