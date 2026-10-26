# Client Reports — simpler to start, links to one report, your organization's week

**Status:** **Built 2026-10-25; code reviews 1 and 2 done and fixed (§K, §L); ready to commit.** Plan
revision 3 (2026-10-25), after review rounds 1 (two reviewers: the code, and newcomers + the Monday routine) and 2
(one reviewer re-running everything; §I); approved by the owner 2026-10-25 ("build it, then 2 code reviews"). Where
the build differs from or adds to the plan is §J, *As built*, and what the two code reviews changed is §K and §L
(all at the end); what was built is documented in [CLIENT_PORTAL.md](CLIENT_PORTAL.md). Builds
on the shipped upgrade ([PROPOSAL_CLIENT_REPORTS_UPGRADE.md](PROPOSAL_CLIENT_REPORTS_UPGRADE.md)).

---

## Part 1 — For everyone

After the upgrade the Client Reports page does a lot more, and a first-time visitor can't tell where to start.
This plan makes the main path obvious without taking anything away, and adds what the owner asked for: links
to a single report, and report dates that follow your organization's week.

**1. The page says what it's for, and shows how it works.** One line under the title:

> Make reports for your client here. Each one shows the campaign's running totals and what was added in the
> dates you pick. Share it with a link and its password, or download a PDF. *How it works*

The first time someone opens the page, a short guide sits at the top of the reports list (where "No reports
yet" is today, on an empty page):

1. **Make a report** — press **New report** and pick the dates, usually **Last week**. After that, **Next
   report** on your newest report makes the following one in one click, with your settings and notes copied.
2. **Check it, then publish** — the preview is exactly what your client will see. Once it's published, its
   numbers stay as they are until you press **Refresh numbers**.
3. **Share it** — **Share** gives you a message with the link to paste into your email or text; send the
   link's password separately. Or open the report and press **Download PDF**.

**Got it** hides the guide for that person; **How it works** brings it back.

**2. Your organization's week.** Report dates follow your organization's week — **Monday to Sunday** unless an
admin changes it (the setting sits in the **New report** dialog: "Report weeks run Monday – Sunday for your
organization. Change"). **New report** offers, each with its dates shown:

- **Last week** — the most recent full week (on a Monday, the Monday-to-Sunday just ended);
- **This week, not over yet** — the whole current week; refresh its numbers once the week ends;
- **Pick dates** — any range, for anything else.

When the tab already has reports, the first choice is what comes next, and **Next report** makes the same:

- a report that ran **whole weeks** (7, 14, … days) is followed by the next run of the same length, on the
  same weekday — an existing Sunday-to-Saturday series carries on Sunday-to-Saturday;
- **whole months** (one, or a quarter) are followed by the same number of months;
- a report of **any other length** is followed by a catch-up from the next day to the end of last week (or to
  the end of this week, when your last report already reaches into it) — "Oct 14 – Oct 25 · 12 days — from the
  day after your last report to the end of last week, so your next report covers a full Monday – Sunday week."
  The report after that is a normal week. This is what fixes the "Oct 14 – Oct 26" reports, which came from each
  new report copying the length of the one before.

After a long gap the two differ on purpose: **New report** suggests the most recent full week (or month) and
names the days no report covers, while **Next report** fills the gap from the day after your last report.

If a tab's weeks run on a different weekday than the organization's (most tabs made so far started on whatever
day their first report was made), **New report** says so — "Your last Whole campaign report ran Wednesday –
Tuesday. Your organization's report weeks run Monday – Sunday." — and offers **Move this tab to Monday – Sunday
weeks** (a short catch-up report first, e.g. Oct 21 – Oct 25), or, for admins, **Use Wednesday – Tuesday weeks
for the whole organization**. A new campaign whose first doors were knocked this week starts with **This week,
not over yet** instead of an empty last week.

**3. A link to all your reports, or to just one.** Every published report gets a **Share** button. It gives
you the copy-ready message (never with a password in it) and the link it uses. If no link opens the report yet,
it offers to make one:

- **All your reports** *(the usual choice)* — one link and one password; next week's report shows up on it
  too;
- **Just this report** — for someone who should see only this one (a donor, a board member). It has its own
  password, and next week's report won't be on it.

A just-this-report link opens that report and nothing else: your client lands straight on it, with no list of
other reports and no Older/Newer arrows. The links list names each link by who it's for and what it opens
("Candidate — opens all your reports", "Board — opens only the Oct 19 – Oct 25 report"), with the one-report
links folded under their own heading. A password is shown once, right after the link is made — copy it then.
Take down and Delete say which one-report links stop working; deleting a report deletes its one-report links.

**4. No accidental doubles.** Making a report for dates a tab already has asks first: "You already have a
draft Whole campaign report for Oct 19 – Oct 25. [Open the draft] [Make a second one]". If two people press
Create at the same moment, both land on the same draft ("Ada made this report a moment ago — you're both in
it.").

**When two people work at the same time** (already true, verified in the upgrade's reviews, and unchanged):
the same report building twice builds once; two different reports build side by side and the rest wait their
turn with their place shown; two people editing one report have their changes merged and are asked only when
they changed the same thing; **Next report** pressed twice makes one draft. Item 4 closes the last gap.

**What isn't changing yet.** The page keeps its layout — links and branding on the right, every report option
in the editor. Moving some of it out of the first view is a separate decision the owner is still weighing
(Part 2 §G).

---

## Part 2 — Technical reference

### A. What the code does today (verified 2026-10-25, round 1)

- **Header copy:** `client/src/pages/ClientReportsPage.jsx:162`.
- **Default period:** `client/src/components/clientReports/reportDates.js:96-110` `defaultPeriod` — no earlier
  report: the seven days ending yesterday; else the day after the tab's last report for **that report's
  length**, capped at yesterday (`:108` — itself a source of odd lengths, e.g. a 5-day Oct 19–23), kept in the
  future only when the last report already reaches yesterday, with §O4's long-gap rule. **Next report:**
  `server/src/routes/admin/clientReports.js:1378-1389` `nextPeriodOf` — the same length from the next day; whole
  calendar months stay months. Neither knows a week, so one 13-day report propagates ("Oct 14 – Oct 26").
  Report dates can't be edited after creation (`updateSchema`, `:143-173`). A tab's client heading reads "Weekly
  reports" only while its reports are 7 days (`seriesHeading`, `client/src/lib/reportDerive.js:506`).
- **Every report already shows the campaign to date:** the big numbers, contact and survey breakdowns, voter
  groups and the map are running totals to the period's end; only the "+N" pills are the period
  (`reportDerive.js:359-403`). (Why a "whole campaign so far" date choice is not in this plan — §I.)
- **No duplicate guard:** `POST /admin/client-reports` (`clientReports.js:631-688`) inserts any period. `POST
  /:id/next` is idempotent for the draft count (CAS on `nextReportId`), but a double click's second request can
  get 409 `NOT_LATEST_REPORT` (16 of 60 in round 1).
- **Links are campaign-wide:** `ReportShareLink` (`server/src/models/ReportShareLink.js:33-100`) has no report
  field. Public report routes go through `reportScope(req)` (`server/src/routes/public/share.js:114`): the hub
  directly (`:194`), the report, map, doors, areas and opened through `loadReport`, which builds `{ _id:
  req.params.id, ...reportScope(req) }` (`:226`). Meta, unlock and the logo read no report. `seriesNav`
  (`clientReportRead.js:86-104`) gives Older/Newer. Share tokens, Keep me signed in, the credential version and
  open counts are already per link (`share.js:92-111`, `reportOpens.js:47-63`).
- **"Can a link open this report?" is answered in several places, each counting every link of the campaign:**
  server `linkState` (`clientReportChecks.js:153-170` → `checks.links`); `BeforePublish.jsx:149`
  (`noUsableLinkReason`); `PublishDialog.jsx:47` (`linksLine`); `ReportRow.jsx:72-73`;
  `ClientReportBuilderPage.jsx:1019-1021` and its "Published. Your client can see it now." banner (`:1318-1325`);
  the Delete confirm (`ClientReportsPage.jsx:465`); `CopyMessageDialog.jsx` (`usableLinks`, `linkState.js:27-28`,
  whose second parameter is `now`).
- **Report deletion paths:** `DELETE /:id` (`clientReports.js:1518`); End team deletes drafts (`:428`); Next's
  losing request deletes its own draft (`:1489`); campaign and org deletion delete every report and link
  (`deleteCampaign.js:182, 206`; `deleteOrganization.js:81, 233`); the demo reset deletes the campaign's reports
  and keeps its links (`seedDemoOrg.js:780`), and `ensureShareLink` (`:683-686`, `:713`) adopts any active link
  of the campaign.
- **History rows:** `CampaignChange` has no `via` field (strict mode drops it); a link route marks a special
  case with a flag inside `toValue` (`clientReportShares.js:201`, `legacySweep: true`).
- **Organization settings** sit on the page they affect (Users, Billing, the logo on Client Reports);
  `req.activeOrg` is the full Organization document on every admin route (`orgContext.js`).
- **Help routes:** `/help/:slug` (`App.jsx:259-260`) — the client-reports guide is `/help/client-reports`.

### B. The intro and the guide

- **Header** (`ClientReportsPage.jsx`): title unchanged; the one-line description from Part 1 §1 (one copy
  source — the guide's text lives in one module and the Help article quotes it), ending in a **How it works**
  text link. Buttons unchanged and in today's order (**New report** first).
- **Guide** (new `components/clientReports/HowItWorks.jsx`): a light card at the top of the reports card, above
  the tabs; on an empty page it replaces "No reports yet". Three numbered steps (Part 1 §1), **Got it**, and
  "More in the Help Center →" (`/help/client-reports`). Phones (< 640 px) get short lines and no Help line:
  "Make a report — usually Last week; then Next report each week." / "Check the preview, then publish." /
  "Share the link; send its password separately."
- **Dismissal** is a per-viewer convenience in the operator's own browser:
  `localStorage['doorline.clientReports.howItWorks.<userId>'] = '1'`, every read and write in try/catch (a
  private window simply shows the guide again); **How it works** re-opens it. Recorded in PRIVACY_VERIFICATION
  item 38 with the builder's other device storage (a UI flag, no personal data).

```
 Client Reports                                                          [New report]  [History]
 Make reports for your client here. Each one shows the campaign's running totals and what was added in
 the dates you pick. Share it with a link and its password, or download a PDF.  How it works
 ┌──────────────────────────────────────────────────────────┐  ┌───────── Client links ─────────┐
 │ How client reports work                                  │  │ …                              │
 │ ① Make a report — press New report and pick the dates,  │  │                                │
 │   usually Last week. After that, Next report on your     │  └────────────────────────────────┘
 │   newest report makes the following one in one click.   │
 │ ② Check it, then publish — the preview is exactly what  │
 │   your client will see. Once it's published, its numbers │
 │   stay as they are until you press Refresh numbers.      │
 │ ③ Share it — Share gives you a message with the link;   │
 │   send the link's password separately. Or Download PDF.  │
 │                        More in the Help Center →  [Got it]│
 │ ─────────────────────────────────────────────────────────│
 │  Whole campaign 4 │ Paid team 2                          │
 │  Oct 19 – Oct 25  ● Published  …                         │
```

### C. The organization's week and the next period

**Storage.** `Organization.reportWeekStartsOn: { type: Number, min: 0, max: 6, default: 1 }` (0 = Sunday …
6 = Saturday). Read as `org.reportWeekStartsOn ?? 1` everywhere (no migration). Additive; no index.

**API.** `GET /admin/client-reports/settings` → `{ weekStartsOn }` (admins and leads);
`PATCH /admin/client-reports/settings { weekStartsOn: 0..6 }` → admins only (403 `FORBIDDEN_ROLE` for a lead,
as branding). Declared **before** the router's `/:id` routes (else `/settings` is read as an id → 400), or
mounted ahead of the router as `/shares` is (`routes/index.js`). `GET /admin/client-reports/series` also
returns `weekStartsOn` (from `req.activeOrg`), so New report needs no extra request.

**UI.** In the **New report** dialog, under the date choices — admins: "Report weeks run Monday – Sunday for
your organization. **Change**" (a weekday select: "This sets the dates new reports suggest, for every campaign
in your organization. Reports you've already made keep their dates."); leads: "Report weeks run Monday – Sunday
for your organization (set by an admin)." It says *report* weeks on purpose: other pages' This/Last week date
presets stay Monday-based (`client/src/lib/datePresets.js:58`).

**Week math — ONE definition, two copies, one fixture table** (client
`client/src/components/clientReports/reportDates.js`; server new `server/src/services/reports/reportPeriods.js`;
pure functions on civil `YYYY-MM-DD` strings, weekday by `Date.UTC(y, m-1, d).getUTCDay()`; a JSON fixture table
run by a client test and a server test is the parity pin — the `bookStatusFilter.js` pattern):

- `weekStartOf(day, s)` = `day − ((dow(day) − s + 7) % 7)`; `weekEndOf(day, s)` = `weekStartOf(day, s) + 6`;
  `lastWeek(today, s)` = `[weekStartOf(today, s) − 7, weekStartOf(today, s) − 1]`;
  `thisWeek(today, s)` = `[weekStartOf(today, s), weekStartOf(today, s) + 6]`.
- **`nextPeriod(L, s, today)`** — the period after report L, for both New report's first choice and Next report.
  With `S = L.end + 1` and `len = days(L)`:
  1. L is N whole calendar months (starts on a month's first day, ends on a month's last day) → `S` … the end of
     the Nth month from `S` (one month → the next month, a quarter → the next quarter; checked first, so a
     February that is also four aligned weeks stays monthly — pinned in the fixtures). Kind `months`.
  2. `len % 7 === 0` (whole weeks, any weekday) → `S` … `S + len − 1`. Kind `weeks`.
  3. Otherwise:
     a. `S` is the first day of an organization week (`S === weekStartOf(S, s)`, i.e. L ended on a week end) →
        `S` … `S + 6`, handled as rule 2 with `len = 7` (kind `weeks`, including its long-gap rule). This keeps a
        catch-up from ever being a whole number of weeks (round 2: without it, a one-week-late catch-up came out
        14 days and rule 2 then repeated 14 days forever);
     b. else → `S` … `E`, where `E = weekStartOf(today, s) − 1` (the end of the last complete organization week);
        if `E < S`, then `E = weekEndOf(S, s)` (the end of this week). Kind `catch_up`, branch `last_week` or
        `this_week`. Always starts mid-week, so it is never whole weeks (round 2: 0 of 2,517,840 cases).
  Every rule starts at `S`, so Next's `NEXT_PERIOD_MISMATCH` contiguity check still holds (round 2: 8,283,492
  cases through the server's own `zonedDayRange`, six zones with DST, never fired).
- **New report's first choice — `suggestPeriod(L, s, today)`:**
  - No L → `lastWeek`, unless the campaign has no knock before this week's start (one indexed
    `CanvassActivity.exists({ campaignId, actionType: { $in: KNOCK_ACTIONS }, timestamp: { $lt: <this week's start
    in the campaign zone> } })`, returned by the series picker as `knockedBeforeThisWeek`) → `thisWeek` (a new
    campaign's first report is not an empty last week).
  - Otherwise `P = nextPeriod(…)`, then the long-gap rule, judged on the series' own cadence. A run is
    *complete* when its last day is before today. Kinds `weeks` and `months`: the series' own grid is L's runs
    continued — `L.start + k·len` for weeks, the next N-month blocks for months; if at least one more complete run
    lies on that grid after `P`, suggest the most recent complete run on it and name the skipped days ("No report
    covers Oct 26 – Nov 8"). Kind `catch_up`: if `P` is longer than 14 days, suggest `lastWeek` and name the
    skipped days.
  - A first choice that ends after today is kept (the period isn't over; the builder says so) — the old cap at
    yesterday is gone.
- **The choices**, a vertical radio list with dates, the first choice selected; labels by kind and branch:
  - `weeks`, 7 days, equal to `lastWeek`: "Last week · Oct 19 – Oct 25 — the week after your last report";
    7 days on another weekday: "Oct 25 – Oct 31 — the week after your last report"; N > 1 weeks: "Oct 26 – Nov 8 ·
    2 weeks — the two weeks after your last report"; `months`: "November — the month after your last report" /
    "October – December — the three months after your last report";
  - `catch_up`, branch `last_week`: "Oct 14 – Oct 25 · 12 days — from the day after your last report to the end
    of last week, so your next report covers a full Monday – Sunday week"; branch `this_week`: "Oct 14 – Oct 18 ·
    5 days — from the day after your last report to the end of this week, so your next report covers a full
    Monday – Sunday week";
  - a long-gap choice has no "after your last report" words: "Last week · Oct 26 – Nov 1", "November", "Nov 9 –
    Nov 22 · 2 weeks", with the "No report covers …" line under it;
  - then "Last week · …" (unless already first), "This week, not over yet · Oct 26 – Nov 1 — refresh it once the
    week ends" (unless it equals the first choice), and "Pick dates" (today's two date inputs).
- **Next report** — `nextPeriodOf` → `nextPeriod(L, req.activeOrg.reportWeekStartsOn ?? 1, today)`. The handler
  computes the campaign zone and "today" BEFORE the period (today they come after it, `clientReports.js:1425-1426`
  and `:1497`). A `catch_up` longer than 14 days is refused `409 NEXT_GAP_TOO_LONG { catchUp: {weekStart,
  weekEnd}, suggested: {weekStart, weekEnd} }` (`suggested` = `suggestPeriod`'s long-gap choice) and the row opens
  **New report** with `suggested` selected — one click never makes a 40-day report. When a later report in the
  series already covers exactly the next period, Next answers `200 { report, existing: true }` (a double click's
  second request today gets `NOT_LATEST_REPORT`); any other later report keeps the 409.
- **The week-mismatch nudge** — only when the tab's last report is kind `weeks` (rule 2; never a month that
  happens to be four weeks) and starts on another weekday than `s`: "Your last Whole campaign report ran
  Wednesday – Tuesday. Your organization's report weeks run Monday – Sunday." Choices: **Move this tab to Monday –
  Sunday weeks** — selects the rule-3b catch-up for this tab ("Oct 21 – Oct 25 · 5 days first"; admins and
  leads); and, for admins, **Use Wednesday – Tuesday weeks for the whole organization** (sets the org's week);
  leads see "Ask an admin to change the organization's week, or pick dates."

```
 New report
   Covers   (•) Whole campaign   ( ) A team  + New team   [ ] Only one walk list
   Dates    (•) Oct 14 – Oct 25 · 12 days — from the day after your last report to the end of last
                week, so your next report covers a full Monday – Sunday week
            ( ) Last week · Oct 19 – Oct 25
            ( ) This week, not over yet · Oct 26 – Nov 1 — refresh it once the week ends
            ( ) Pick dates
            Report weeks run Monday – Sunday for your organization. Change
   Title    [ Oct 14 – Oct 25                                    ] (optional)
                                                            [Cancel]  [Create draft]
```

### D. Links to one report

**Model.** `ReportShareLink.reportId: { type: ObjectId, ref: 'ClientReport', default: null }` — null (or
missing, on every link made before this) = every published report of the campaign. Set at creation, never
changed. No new index: link queries by `{campaignId, reportId}` ride the existing `{campaignId, isActive}` index
(a campaign has a handful of links).

**Admin API** (`routes/admin/clientReportShares.js`). `POST` accepts `reportId` (optional): the report must be in
the org and campaign and **shown** — published and not taken down (`409 REPORT_NOT_SHOWN`; a taken-down report
is still `status: 'published'`, and a link to it would only ever say "taken down"; the same test as Copy message's
`shown` today). `reportId` is a declared schema path, so `strictQuery` keeps it in every filter (an undeclared
one would be dropped and match every link — round 2 reproduced that). Every share row returns `reportId` and `report: { id, weekStart, weekEnd, scopeLabel } | null`
(`null` with a `reportId` = "a deleted report", only reachable mid-race).

**One filter for "links that can open this report"** — `linksFor(shares, reportId)` in `linkState.js`
(`reportId == null || reportId === this report`), applied BEFORE every existing helper (`usableLinks`'s signature
is unchanged), in every place §A lists: the report row, the builder and its post-publish banner, Before you
publish, the Publish confirm, the Delete confirm, Share. On the server, `linkState` in clientReportChecks.js
filters `reportId: { $in: [null, report._id] }` (which also matches links without the field). New wording where
no link opens the report: published — "No link opens this report — your links open other reports. Share makes
one."; draft — "No link opens this report yet. After you publish, Share makes one." The post-publish banner says
"Published — create a link so your client can open it." only when no link opens THIS report.

**Public routes** (`routes/public/share.js`):
- `loadReport`, before its query: `if (req.share.reportId && String(req.share.reportId) !== String(req.params.id))`
  → 404 `REPORT_NOT_FOUND`. (Putting `_id` inside `reportScope` would be overwritten by — or would overwrite —
  the URL's `_id` in `{ _id: req.params.id, ...reportScope(req) }`; round 1 confirmed both failure modes.)
- The hub: for a single link, query `{ ...reportScope(req), $and: [{ _id: req.share.reportId }] }` (no key can be
  overwritten), and answer `single: true` and `reportId`, plus `gone: true` when that report isn't shown (taken
  down, unpublished, deleted).
- The report route, for a single link: `nav: null`; the earlier-totals line without its "since <period>" clause,
  worded "Totals from before Oct 19 were updated by −120 doors after they were first reported." (the same
  counts; it names no other report).
- Taken down / gone on a single link: "This report was taken down or removed. Ask the person who sent it." — no
  "see all reports". Put back up → works again. Opens count under the link as today.
- Client pages: the list page `Navigate replace`s to the report when `single` and a row exists, and shows the
  gone message otherwise; the detail page hides "‹ All reports" and the taken-down card's "see all reports" when
  `single`; optional note under the heading: "This link opens this report only."

**Admin UI.**
- **Share** (replaces **Copy message**; on every shown report's row and in the builder): the message, the link
  it uses (a chooser: "Board — opens only this report", "Candidate — opens all your reports"), and **Make a link**
  with the two kinds (Part 1 §3) — always there (a donor's link next to an existing all-reports link), and the
  main action, with *All your reports* selected, when no link opens the report. A new
  link's password shows once, right there: "Password for Board: ••••• [Copy password] — shown once. Send it
  separately from the message." No **Copy password** for existing links (passwords are hashed and returned
  once). The message ends by link: all-reports → "— use the password I sent you."; made just now → "— I'll send
  you its password separately."; an existing one-report link → "— use the password I sent you for this report."
  The new-link message reads "Here's the link to this report: …" for a one-report link (today: "…to our
  reports").
- **New link** (links panel): "Opens: (•) All your reports ( ) One report only [report ▾] — next week's report
  won't be on it."
- **The links panel:** all-reports links on top; one-report links under a collapsed "Links to one report (N)";
  each labelled "Board — opens only the Oct 19 – Oct 25 report (Whole campaign)". The panel's line becomes "A
  link opens all your reports, or just one. Each has its own password — send it separately."
- **Take down / Delete confirms** name the report's one-report links: "Board, a link to just this report, shows
  'taken down' until you put it back up." / "Its link Board (just this report) stops working for good."

**Cascade.** `DELETE /:id` deletes the report's one-report links and writes a History row per link with
`toValue: { reportDeleted: true }` (the `legacySweep` precedent; `campaignHistory.js` renders it "deleted with
its report"). The demo reset deletes the campaign's one-report links, and both `ensureShareLink` queries add
`reportId: null`, so the demo link is never a one-report link. Campaign and org deletion already delete every
link. Drafts can't have links, so End team and Next's loser need nothing.

```
 Share "Oct 19 – Oct 25 · Whole campaign"
   Link   (•) Candidate — opens all your reports         doorline.app/r/7kQ…  [Copy link]
          ( ) Board — opens only this report
          [ Make a link ]
   Message (no password in it)
   ┌─────────────────────────────────────────────────────────────────────────────────────┐
   │ The report for Oct 19 – Oct 25 is up: 3,412 doors knocked so far (+412 in that       │
   │ period)… Open it here: https://doorline.app/r/7kQ…/reports/… — use the password I     │
   │ sent you.                                                                              │
   └─────────────────────────────────────────────────────────────────────────────────────┘
                                                                [Copy message]   [Done]
```

**Privacy.** Narrows what a link holder can reach; collects nothing new. PRIVACY_VERIFICATION item 38 gets a
sub-entry (what a one-report link reaches; its earlier-totals wording; the delete cascade), and 38(a)'s "other
reports on the same link" and the `areaNarrowing` comment (`clientReportChecks.js:229`) are scoped to all-reports
links. No Privacy Policy / ToS / DPA sentence changes (`privacy.html:101`, `terms.html:118` re-checked); no new
subprocessor.

### E. No accidental doubles

- **A tab** is its `seriesId` (every report made since the upgrade has one; `POST /` and Next resolve the series
  first).
- **The field:** `ClientReport.dupGuard: { type: Boolean }` — declared, with NO default (absent = outside the
  guard: every older report and every deliberate second one). Undeclared, Mongoose's strict mode would drop it on
  create and `strictQuery` would drop it from filters, and the guard would silently hold nothing (round 2
  reproduced the drop).
- **Look first:** `POST /admin/client-reports` looks for a report with the same `organizationId`, `campaignId`,
  `seriesId`, `weekStart` and `weekEnd` (the org and campaign keep it on the campaign index — `{seriesId, …}`
  alone was a collection scan) → `409 { code: 'REPORT_EXISTS', reportId, status, takenDown }` unless
  `allowDuplicate: true`.
  Dialog wording — draft: "You already have a draft Whole campaign report for Oct 19 – Oct 25. [Open the draft]
  [Make a second one]"; published: "You already published a Whole campaign report for Oct 19 – Oct 25. To bring
  its numbers up to date, open it and press Refresh numbers. [Open it] [Make a second one]"; taken down: "…for
  Oct 19 – Oct 25, taken down. [Open it] [Make a second one]"; under **Make a second one**: "Your client sees both
  once both are published."
- **The race** (two creates passing the look-up at once) is closed by the database, not by comparing ids (round
  1 showed id order isn't arrival order — two drafts survived): a **unique partial index** on ClientReport
  `{ seriesId: 1, weekStart: 1, weekEnd: 1 }`, `partialFilterExpression: { dupGuard: true }`, name
  `report_period_guard`. `dupGuard: true` is set on every create without `allowDuplicate` (and on Next's insert);
  reports made before this, and deliberate second ones, aren't in it. **Built at boot**, by an explicit
  `ClientReport.collection.createIndex(…)` in `clientReportIndexes.js` beside the client-report collections it
  already syncs — `createIndex` never drops anything (unlike `syncIndexes`), the index covers only new guarded
  reports (instant to build), and building it before any guarded create removes both the console step and the
  window round 2 found (a same-instant double landing between deploy and a manual `--apply` would make the build
  fail). `migrate:build-indexes` lists it as already built. A build failure is never fatal (the look-first check
  still holds), and the index **heals itself** (code review round 1, SRV-1, §K): a build that fails on a duplicate key
  takes every guarded report but the first made of its tab and dates out of the guard (they become ordinary second
  reports, still found by the look-first) and builds again; any other failure retries in the background after 5 s,
  30 s, 2 min and 10 min; and the nightly maintenance job re-checks it, so a build that ran out of retries is
  repaired within a day. A duplicate-key error on a create → the existing report is answered `200 { report,
  existing: true }` and the dialog says "Ada Lovelace made the Whole campaign report for Oct 19 – Oct 25 a moment
  ago — you're both in it." (as built, §J and §K). The insert (and its key check) happens
  before `enqueueBuild` and `writeReportHistory`, so a loser leaves no job and no "created" row. Dates are
  immutable after creation, so the key never changes; deleting a report frees it.
- **Next report** never answers `REPORT_EXISTS` (§C: an exact later report → `existing: true`).

### F. Tests

- **Week math:** one fixture table, run by a client and a server test: the presets on each weekday; `nextPeriod`
  for 7-, 14- and 28-day runs on every weekday, whole months and quarters (February as 4 aligned weeks → March),
  irregular lengths on every weekday of `today`, rule 3a (an irregular report ending on a week end → one week),
  the 14-day catch-up limit, the long-gap choices on each cadence's own grid with "complete = ends before today",
  every label branch; every `weekStartsOn`; DST weeks; month and year boundaries; the round-1 scenarios (Mon Oct
  26: Oct 12–18 → Oct 19–25; Oct 1–13 → Oct 14–25; Sun–Sat series → Oct 25–31 + the nudge; a monthly reporter on
  Nov 10 → October; a 2-week reporter → the next two weeks) and round 2's (Oct 14–25 then one missed Monday →
  Oct 26 – Nov 1, never 14 days; a 2-week series Oct 12–25 on Mon Nov 30 → Nov 9–22; Wed–Tue tab → "Move this tab"
  catch-up Oct 21–25; a new campaign's first report → This week).
- **Next:** contiguity; `NEXT_GAP_TOO_LONG`; a double click → one draft, both 200.
- **Settings:** admin PATCH 200; lead PATCH 403, GET 200; another org 404; out of range 400; `/settings` not read
  as an id.
- **One-report links:** with a one-report token, every public route given another report's id → 404 (report,
  map, doors, areas, opened); the hub → one row, `single: true`; taken down → `gone: true`; `nav` null; the
  earlier-totals wording; draft refused at create; DELETE cascade + History rows; demo reset removes them and
  never adopts one; `linksFor` in every place §A lists (server `checks.links` included); existing links
  byte-identical.
- **Duplicates:** 409 + `allowDuplicate`; ten concurrent creates of one period → exactly one report, the others
  `existing: true`, no orphan job or History row; the index name and partial filter pinned.
- **Client:** the guide (dismiss, reopen, storage failures, phone copy), the date choices on each weekday and
  after each kind of last report, the nudge, the week setting for admins vs leads, Share (link choice, make a
  link, password once, message endings), the duplicate prompt, the single-link public pages, 1280 and 390 px.

### G. Later — moving things out of the first view (owner deciding; not in this build)

1. **Links and branding** move from the always-visible right column behind **Share** (per report, §D) and a
   **Settings** button (logo, report week, all-reports links).
2. **Teams and walk lists** in New report go under **More options**; whole campaign is the default.
3. **Advanced display options** in the editor — map questions, headline, voter groups, door goal, area view —
   collapse into **More display options**, closed unless one is in use.
4. **One main button per report** — Open (draft) or Share (published); History, Next, Take down and Delete in
   the ⋯ menu.

### H. Docs, Help, privacy, rollout

- **Docs:** CLIENT_PORTAL.md (Part 1 + Part 2: the guide, the week setting and choices, `nextPeriod` /
  `suggestPeriod`, `NEXT_GAP_TOO_LONG`, one-report links, `linksFor`, the duplicate guard); README row.
- **Help Center:** guides/client-reports.md and pages/page-client-reports.md (quoting the guide's one copy
  source; the date choices; Share; one-report links); a new FAQ "Can I share just one report?";
  faq/client-link-asks-for-password-again.md ("each link has its own password"); faq/exact-doors-or-areas.md:30
  ("Your client sees every report on the link" → only for a link to all your reports).
- **Privacy record:** item 38 — the one-report link sub-entry and the scoping notes (§D); the guide's
  localStorage flag with the other device storage. No policy, ToS or DPA change; no new subprocessor.
- **Rollout:** `npm run audit:mobile-api` (the phone calls no client-report or share endpoint — no client-version
  gate); deploy server + web. No migration (new fields read as their defaults) and no console index step (the
  guard index builds at boot, §E). Optional, read-only, before or after: `npm run report:tab-weeks` (Heroku
  dashboard → More → Run console; proxied in the root `package.json` with the trailing `--`) prints, per
  organization, how many tabs' latest report is whole weeks on a weekday other than the organization's — the tabs
  that will show the nudge.

### I. Review log

**Round 1 (2026-10-25)** — two reviewers, both read-only, both ran their claims (scripts in the session
scratchpad `plan2/`).

*Code* (no blockers): the id tie-break let two drafts survive (forced interleaving; two processes in one second;
1 in 500 even in one process) → the unique partial index (§E); `_id` inside `reportScope` is overwritten by — or
overwrites — the URL's id in `loadReport` → the explicit check (§D); the public pages assumed a hub of several
reports, and a taken-down one-report link fell into an empty hub → `single` / `gone` (§D); six places count every
link as able to open every report → `linksFor` everywhere (§D); the demo reset could orphan a one-report link and
adopt it as the demo link → cascade + `reportId: null` (§D); smaller: a `dupGuard` marker before enqueue and
History (§E), Next answers `existing` rather than `REPORT_EXISTS` (§C, §E), History has no `via` field (§D), the
Help route is `/help/client-reports`, `/settings` must precede `/:id` (§C), February is a month and four weeks
(§C), Copy password only right after creation (§D), the old cap at yesterday (§C). Its round-1 checks that held:
the week math against Next's contiguity check (235,200 cases), the first-knock query's index use, `req.activeOrg`
on the routes, per-link sessions and opens, no mobile endpoint, no policy sentence made false.

*Newcomers + the Monday routine:* the revision-1 next-period rule broke the Monday routine — an existing Sunday-to-
Saturday series got 1-day reports from Next, monthly and two-week reporters were pushed onto one week, and the
plan's own example held only mid-week → the whole-weeks/catch-up rule and series-cadence long gaps (§C);
"Whole campaign so far" was dropped (every report already shows running totals; a campaign-length report sorts
wrong, never shows as Latest, bends the hub's trend line, and gave "whole campaign" two meanings in one dialog);
the intro and guide promised things the app doesn't do ("totals for the dates you pick"; "refresh any time") →
rewritten (Part 1 §1); one-report links would have become the weekly default, a new password every Monday →
All your reports is the default, one-report for a donor or board member, passwords shown once, message endings by
link (§D); "This week so far" became the whole current week, "not over yet"; the choices became a dated radio
list with the suggestion first; the week setting moved into New report; the duplicate prompt names the report
and what Make a second one does; take-down and delete confirms name one-report links; one-report links fold
under their own heading.

**Round 2 (2026-10-25)** — one reviewer re-ran revision 2 (scripts in `plan2/r2/`). No blockers. HIGH: a catch-up
made one week late came out exactly 14 days, and rule 2 then repeated 14 days forever (132,769 sweep cases) → rule
3a (an irregular report ending on a week end is followed by one week), after which no catch-up is whole weeks
(0 of 2,517,840). MEDIUM: the first-choice labels didn't match every branch → labels by kind and branch, no
"after your last report" on long-gap choices, This week hidden when it equals the first choice; the long-gap
"most recent complete run" was ambiguous for 14+ day runs → the series' own grid, complete = ends before today;
`dupGuard` must be a declared field or the guard holds nothing → declared, no default; most existing tabs run on
the weekday their first report was made and would never reach the org's week → the nudge's **Move this tab**
catch-up and a read-only `report:tab-weeks` count. LOW: Part 1 now says New report and Next differ after a long
gap; the nudge only for whole-week tabs (not a February month); multi-month runs (quarters) continue as months;
Next computes the zone and "today" first, and `NEXT_GAP_TOO_LONG` names both periods; one-report links need a
shown report (not taken down); the look-first query carries org and campaign (index); the guard index builds at
boot instead of by a console step (no window); a new campaign's first report starts at This week; Share's **Make a
link** is always there. Sound, by running them: contiguity over 8,283,492 cases; every round-1 scenario; months
2026–2029; the guard index over 200 legacy duplicates and 120 rounds of 10–50 concurrent creates plus two processes
— exactly one report every time, errors carrying `report_period_guard`; one-report links open only their report
(both round-1 failure modes reproduced on the old shapes and closed); no other public route reaches another
report; the seven "can a link open it" places; no client-version gate; the privacy and Help claims.

### J. As built (2026-10-25)

Five build agents built the plan on 2026-10-25, uncommitted; two code reviews followed (§K, §L). What was built is documented
in [CLIENT_PORTAL.md](CLIENT_PORTAL.md) (Part 1, and Part 2 §B, §F, §I, §K, §Q, §R); the privacy record is
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 38(m), with stamps on 38(a), 38(l) and the policy re-check.
Where the build differs from or adds to the plan, read from the code:

- **The week setting's Change is an inline panel inside New report** (a weekday select, its sentence, Save and
  Cancel), not a dialog of its own; saving suggests the dates again.
- **Share's Make a link always generates the password**, shown once with Copy password; Set my own stays in the
  links panel's **+ New link**.
- **Last week stays offered when it equals the tab's last report**; picking it gets the duplicate prompt (§E).
- **New report's choices are a module of their own**, `client/src/components/clientReports/newReportChoices.js`
  (`dateChoices`, `choiceLabel`, `weekNudge`, `duplicateText`), pure and tested without React. The client copy of the
  week math drops `defaultPeriod` and keeps `gapBetween`; both copies also export `dayOfWeek` and `catchUpPeriod`
  (the nudge's Move this tab is `catchUpPeriod`, or last week naming the skipped days when it runs past 14 days).
  The fixture table has 499 cases, each with a note, generated from an independent brute-force reference.
- **The link helpers live in `linkState.js`**: `linksFor`, `singleLinksOf`, `linkOpens`, `linkName`,
  `deleteLinksText`, and (moved from `parts.jsx` in code review round 1) `reportLinkReason`, `reportLinksLine`,
  `takeDownLinksText` and one shared `andList`.
- **A double click's own report just opens.** When the duplicate guard's race answer (`existing: true`) is a draft
  the same person made (a second tab, a double click), New report opens it instead of saying "<name> made the
  <tab> report for <dates> a moment ago — you're both in it."
- **The race answer names the winner's creator**: `200 { report, build, existing: true, createdByName }` (first and
  last name). `REPORT_EXISTS` also carries `weekStart`, `weekEnd` and `scopeLabel` (the tab's current name), and
  its `error` is the dialog's sentence.
- **The settings route answers `403 ORG_CONTEXT` for an organization you aren't in** (the shared `orgContext`;
  a missing or deleting organization is `404`), where §F listed "another org 404".
- **Next decides from one read** of the series' later reports (the exact next period → `existing: true`, any other →
  `NOT_LATEST_REPORT`): a two-read version let a sibling click's draft land between the reads. Its guard race answers
  the winner, or inserts once more if the winner was deleted in between. `NEXT_GAP_TOO_LONG`'s sentence: "More than
  two weeks have passed since this report. Choose the next report's dates in New report."
- **The schema also declares the guard index** (`REPORT_PERIOD_GUARD` in `models/ClientReport.js`) beside the boot
  `createIndex`, so `migrate:build-indexes` lists it as built and its `--sync` never drops it.
- **A link to one report being made while its report is deleted** deletes itself (with a "deleted with its report"
  History row) and answers `404`; `REPORT_NOT_SHOWN`'s sentences: "This report isn't published yet. Publish it, then
  make its link." / "This report is taken down. Put it back up, then make its link."
- **New report opens with dates from a link**: the list page reads `?new=1&seriesId=&weekStart=&weekEnd=` (contract
  K10), opens New report on that tab with those dates picked and drops the params. Nothing in the app sends it yet
  (the builder has no Next button; the list row's Next opens the dialog directly).
- **Unchanged on purpose:** a row's "Opened via …" line still names any of the campaign's links (since round 1 it
  waits for the links list). The browser tab title on a one-report link reads "{Campaign} · Report" since round 1
  (it read "· Reports").
- **Noted during the build for the code reviews, and where they stand after round 1:** (1) `other_reports` winning
  over this report's own expired link — fixed (LINK-2, §K); (2) `demoRebuild.int.test.js` never pinned `REDIS_URL` —
  fixed (it pins a dead port); (3) the one-report tab title — fixed (above); (4) leftover gitignored
  `client/.smoke-cr-integration-*` folders — none left in the tree; (5) the link helpers in two files — fixed (above);
  (6) the three judgement calls above (the inline Change panel, Make a link's generated password, Last week offered
  when it equals the last report) — unchanged, the owner's to confirm.

### K. Code review round 1 (2026-10-25)

Three reviewers (links, the server, the dates) ran their findings against the real app, throwaway databases and real
browsers; two fix agents and the lead fixed every one, with tests. Severity in brackets.

- **LINK-1** [high] New link's **One report only** could make a link to ALL reports: the report pick was fixed when
  the dialog opened (empty while the reports list loaded), and an empty pick silently fell back to all-reports while
  the box showed a report. Fixed: the pick is worked out from the list as it is now (`chosen`), a one-report request
  always carries it, **Create link** waits while there is none, and the box reads "— loading your reports…" meanwhile.
- **LINK-2** [medium] Link reasons tested `other_reports` before this report's own links, so an expired, locked or
  disabled link to all the reports read "your links open other reports" instead of naming its fix. Fixed on both
  sides: the links that open this report decide the reason; `other_reports` only when none of any state does but the
  campaign has other links, `no_link` when it has none.
- **LINK-3** [low] Share pressed before the links list loaded offered to make an all-reports link the campaign already
  had. Fixed: Share gets `null` while the list loads and says "Loading links…" (no Make a link, Copy message off) or
  "Couldn't load the links."; "Opened via …" also waits for the list.
- **SRV-1** [low] The guard index never healed: a failed boot build left the guard off until a restart, and a
  same-instant double landing meanwhile failed every later build. Fixed: a duplicate-key build failure takes the later
  duplicates out of the guard (ordinary second reports) and builds again; other failures retry after 5 s, 30 s, 2 min
  and 10 min; the nightly maintenance job re-checks it (§E).
- **SRV notes** [low] The series picker's comment named the wrong index (it is the single-field `{ campaignId }`;
  measured, still cheap) — corrected; New report and `report:tab-weeks` now pick a tab's latest report alike (newest
  `weekEnd`, then `createdAt`, then `_id`); `report:tab-weeks` reads the organization's week through the schema cast,
  as the app does (a stored "3" is Wednesday in both).
- **WEEK-1** [high] New report suggested stale dates on a page left open across midnight or across an admin's week
  change (its today, week and first-knock facts came from the page's cached series list), so it disagreed with Next.
  Fixed: the dialog reads the series picker again each time it opens ("Loading the dates…", or "Couldn't load the
  dates." with Try again) and again when the campaign's day ends while it is open.
- **WEEK-2** [low] After the race note the dialog's dates jumped to the next period (the list gained the new draft).
  Fixed: the dates freeze when Create is pressed, and the note names them: "<name> made the <tab> report for <dates>
  a moment ago — you're both in it."
- **WEEK-3** [low] A first choice that hadn't started yet said only "isn't over yet", and POST / gave no warning. Fixed:
  "Starts Oct 26 — its numbers stay empty until then." under the choice, POST / answers `warnings:
  ['STARTS_AFTER_TODAY']` like Next, and the builder opens with "This period hasn't started yet."
- **WEEK-4** [low] Keyboard focus fell to the page body when Change, Save, Cancel or the nudge's organization-wide
  button unmounted. Fixed: focus moves to the weekday select, and back to Change.
- **Smaller (lead):** the team and walk-list picks in New report fall back to the first of the lists as they are now;
  admin list rows carry `createdAt` for the tie-break; the `?new=1` comments say nothing in the app sends that link
  yet.

### L. Code review round 2 (2026-10-25)

A verification pass re-ran every round-1 fix (all fixed: LINK-1 to LINK-3, WEEK-1 to WEEK-4, SRV-1 and the SRV
notes), and a fresh-eyes pass walked the app in real browsers, desktop and phone. Nothing blocker or high; privacy
item 38(m) checked clean. A client fix agent and the lead fixed every code finding; FRESH-2 was the docs'. Severity
in brackets.

- **VER-1** [low] New report wasn't frozen while Create was on its way, and **Make a second one** rebuilt the request
  from the form as it then stood: dates or Covers changed mid-flight, then "already exists", sent the new choice
  with `allowDuplicate` (outside the guard), and the race note named the form's tab. Fixed: the form is disabled
  while Create is on its way, the request built at the click is kept (`pressedBody`) and Make a second one sends it
  again with `allowDuplicate: true`, and the race note names the report's own tab (`report.scope.label`).
- **VER-2** [low] Dead ends: Share's "Couldn't load the links." had no Try again and reopening Share sent no request;
  the links panel's own error had no retry (older than this build); New link with a failed reports list read "—
  loading your reports…" forever. Fixed: Try again on all three; opening Share or New link after a failure reads the
  list again once; New link says "Couldn't load your reports.", and "— loading your reports…" only while it's read.
- **FRESH-1** [medium] The duplicate prompt opened out of view (under Title; on a tab with the week nudge, none of it
  on screen at 1280×800 or 390×844), Create draft just went pale, and focus fell to `<body>`. Fixed: the
  walk-list-name, team-ended, duplicate and race-note boxes and the generic error sit right under the dates, above
  Title; the first three are `role="alert"`, the race note `role="status"`; each is scrolled into view with its
  first control focused (the race note's Open it takes focus as it appears).
- **FRESH-2** [low, docs] The docs said a deleted report's one-report link reads "This report was taken down or
  removed…", but the link is deleted with its report and reads "This link isn't available. It may have been replaced
  or switched off — ask the person who sent it."; and they quoted the History row as "Link deleted · Board · Deleted
  with its report", where the drawer shows "Board · Link deleted" with "Deleted with its report" under it. Fixed in
  CLIENT_PORTAL.md (Part 1; Part 2 §F, §M), the Help Center's client-reports guide and its two link FAQs.
- **FRESH-3** [low] After Next's `NEXT_GAP_TOO_LONG`, New report opened without the server's sentence the docs
  promised. Fixed: the page hands it over (`initial.notice`) and New report shows it at the top of the dates.
- **FRESH-4** [low] Focus fell to `<body>` after Got it, Share's Make a link and Share's Create link. Fixed: Got it →
  the How it works link; Make a link → its first choice; Create link → the new password's Copy password.
- **FRESH-5** [low] The duplicate prompt for a taken-down report said "Your client sees both once both are
  published.", but a taken-down report stays hidden. Fixed: "Your client sees only the new one; the taken-down one
  stays hidden unless you put it back up." (drafts and shown reports keep the old line).
- **FRESH-6** [low] The links panel showed a one-report link as "Active · Opens only the Oct 14 – Oct 25 report" while
  that report was taken down. Fixed: every share row's `report` now carries `takenDown` (the lead, server side), and
  the row adds "Its report is taken down — the link shows “taken down” until you put it back up."
- **FRESH-7** [low] A second link made in the same Share replaced the first one's one-time password, with no way
  back. Fixed: every link made in that Share keeps its own password line and Copy password until Done, each ending
  "— shown once. Send it separately from the message. Lost it? Change password on the link."
- **FRESH-8** [low] A brand-new admin's draft said "No link yet — create one." (in red in the Publish confirm) where
  nothing could make one. Fixed: on a draft with no link at all, "No link yet — after you publish, Share makes one.";
  a published report keeps "No link yet — create one."

No privacy change: `report.takenDown` reaches only the admins and leads who read share rows, and it is the report's
own state, which the same people already see on the reports list.
