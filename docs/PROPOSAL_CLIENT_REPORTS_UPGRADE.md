# Client reports: audit, plan and design

**Status.** **Built 2026-10-24, uncommitted; code review rounds 1 and 2 done and fixed; owner
walkthrough next.** Audit 2026-10-23. Owner rulings 2026-10-23 and 2026-10-24 (§E). Plan and design
revised after four review rounds (2026-10-24, §N); **round 4's amendments in §O override any earlier
text they contradict.** Approved by the owner for building (2026-10-24), followed by two code-review
rounds. Where the build differs from the plan is listed in §P, *As built*; what code review rounds 1
and 2 found and how each finding was fixed are §Q and §R (all three at the end); what was built is
documented in [CLIENT_PORTAL.md](CLIENT_PORTAL.md), the deploy steps in [OPERATIONS.md](OPERATIONS.md).

Each audit finding says how it was checked: **verified** (run against the real app and a throwaway
database), **from code** (read, not run), or **not measured**.

Related: [CLIENT_PORTAL.md](CLIENT_PORTAL.md) (how the feature works today),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (D11, and gap 34 for the findings below),
[EFFORTS.md](EFFORTS.md) (walk lists), [ROLES.md](ROLES.md) (team leads), [SURVEYS.md](SURVEYS.md),
[METRICS.md](METRICS.md), [MAPS.md](MAPS.md), [OPERATIONS.md](OPERATIONS.md).

---

# Part 1 — For everyone

## What was checked

The **Client Reports** tab inside a campaign (the report list, the share-link panel and the report
builder), the public pages a client opens from a link, and the server code behind both. The page had
not been touched while a lot changed around it: scripted surveys, walk lists, Not a target voter,
answer edits, and team leads who can be the client.

## What was wrong

**Privacy switches that only worked on screen.** Turning the map off hid it, but the street addresses,
results and answers behind it were still handed out to anyone with the link and password who asked the
server directly. A survey question you hid still travelled with the report as a map filter, and its
internal code (which is made from the question's wording) still reached the client. Unticking every
question showed all of them. A follow-up question on the map ("Yard sign?", asked only after a Yes)
showed which homes gave the answer to a question you had hidden. *(all verified)*

**Weak spots in the links.** A password could be one character. Changing it didn't lock out people
already reading. Before the password, the link revealed the campaign, the organization and the link's
private label. "Last opened" lit up when someone merely reached the password screen. *(verified)*

**Frozen reports that could change.** Fixing a typo meant unpublishing, which took the report off the
client's page and recomputed its numbers when you republished. The server also let a published report
be published again with newer data. *(verified)*

**Rough edges for the client.** After a day with the tab open, the page claimed nothing had been
published. The map didn't fit a phone. Door details showed internal question codes. Every card said
"this week", even on a two-week report. *(from code)*

**Rough edges for you.** Preview showed the last saved version. Recompute, Publish and Unpublish
failed without a word. The default week could end tomorrow. Links always lasted 90 days, while the
Privacy Policy says an admin can choose up to a year. *(from code)*

**Big campaigns.** Publishing did everything inside one request on the web server, the machine that
answers every click from you, your team and your clients. On a campaign the size of Collier it can
slow the site or time out. *(not measured)*

## What you decided

- **Team leads keep full control** of client reports, as today.
- **One client per campaign**, so links stay per campaign. A campaign can have a **volunteer team and
  a paid team**, told apart by their coordinators, and the client may want a report for each. **One
  team name can cover several crews** (a paid team with two crew leads).
- **Recipients keep using a link and a password**, hardened. No accounts, no email addresses stored.
  Your client can tick **Keep me signed in on this device**.
- **Published reports get two kinds of fix:** edit the words in place while the numbers stay frozen,
  or **Refresh numbers**, which shows the before-and-after first.
- **A ready-to-send message** for any published report. You send it yourself.
- **Next report in one click**, starting the day after the last report ended.
- **Your organization's logo** on the client's page and PDF, with a small "Powered by Doorline".
- **Exact door pins stay the default**; any report can switch to an **area view**.
- **When both teams reached the same home or voter, it counts in both team reports**, and each team
  report says so.
- **Area view shows a question's survey answers by area only when every area has at least five answers**;
  otherwise that report shows door results only for that question (a larger area size usually fixes it).
- **When earlier weeks' totals change after you sent them, the client's next report says so** in one
  neutral line.
- **No Privacy Policy sentence** about recording when a report link is opened.
- **The homepage line** "the numbers never change under you" gets reworded.

## What changes for the person building reports

- **One row per survey question:** show its chart, use it as a map filter, or make it the headline. A
  question you don't show can't reach the map or the client. "None" really means none. A follow-up
  question can only go on the map if the question it depends on is on the map too; the builder says
  why ("Asked only after Yes to 'Back the recall?' — showing it shows who said Yes").
- **Numbers build in the background.** Creating a report, Next report and Recompute build the numbers
  on the worker with a progress bar, and you can leave the page. If someone is editing answers,
  unknocking, converting, relabelling or re-cutting the campaign, the build waits for them, and says so.
- **Publish is instant and freezes exactly what you previewed.** The builder shows "Numbers as of 9:14
  am". If those numbers are old, the period hasn't ended, or knocks arrived while they were being
  built, Publish says so and offers Recompute first. Publishing what you previewed also cancels a
  recompute still waiting in the queue.
- **"Before you publish"** gathers what's worth a look: open mock-GPS flags in this report's scope,
  surveys an admin entered or edited, a period that isn't over, no usable link for the client, notes
  copied from last week that you haven't reviewed, earlier reports whose totals have changed since you
  sent them, follow-up questions whose charts hint at a hidden question, and on team reports how many
  canvassers worked and how many door visits more than one team made. On an area report it also says
  when an area's hidden answers could still be worked out.
- **On a published report:**
  - **Edit** fixes the title, the notes and what is shown. The client sees "Edited Oct 21". Leads on the
    campaign can see the earlier text in History; an admin can Erase it there, everywhere it is kept.
  - **Switch to areas** builds the areas in the background; your client sees exact doors until they're
    ready. Going back to exact doors means refreshing the numbers.
  - **Refresh numbers** rebuilds from today's records, shows what moved, and changes nothing until you
    press **Apply**. It's also how you add to the map: turn it on, add a map question, change the area
    size, or switch areas back to exact doors. The client sees "Numbers refreshed Oct 28".
  - **Take down** hides it from the client but keeps it exactly as it was; **Put back up** shows it
    again, unchanged, with its original publish date. A taken-down report still only changes through
    Edit or Refresh.
- **Team reports.** A team name (for example "Paid team") covers one or more crews you pick, and never
  contains a canvasser's name. Each team tab has **Edit team**: rename it, change its crews, or end it.
  If a crew lead leaves, the next report asks what to do; by default her crew's past doors keep counting
  in the team while those canvassers have no crew. Moving one of them into another crew moves their past
  doors with them (your July ruling: the current coordinator owns all history), and the screen that moves
  them says which client-report team that changes. Published reports stay as they were sent. A walk
  list whose name happens to match a canvasser's name ("Marco Island") gets a warning you can confirm.
- **Client links.** Choose how long a link lasts, from 30 days to a year; extend it up to a year from
  when it was made. An expired link is renewed with a new address, which you send to your client.
  Passwords you set need 12 or more characters; a link whose older password turns out to be shorter is
  flagged the next time it's used. A password change, rotate or disable signs everyone out. No link
  accepts more than 50 wrong passwords in any 24 hours; reaching that locks it, without signing out
  devices already in, and the panel tells you to rotate it, since 50 wrong passwords is never your
  client. The panel shows the link's wrong-password count for the last day, the last week and in total.
- **Who opened what:** "Opened via the Candidate link: about 2 visits", counted roughly once per browser
  per report per day. Visits by people signed in to your organization, and by Doorline staff, are listed
  separately.
- **History:** publishes, refreshes, edits, take-downs, deletes and every link change appear in the
  Client Reports tab's History. They don't appear in the campaign's general History or on the phone.
- **Report branding** (admins): upload a logo once, as any image; your browser turns it into a clean
  PNG before it's sent.

## What changes for your client

- The password screen shows nothing about the campaign until the password is right, and offers **Keep
  me signed in on this device** (up to 30 days; some phones clear it sooner). A **Sign out on this
  device** link is always there.
- If something changes (a new password, a renewed or rotated link, a report taken down), the page says
  what happened and what to do, instead of claiming nothing was published.
- Your logo is at the top. Tabs separate the whole campaign, each team and each walk list. Each tab
  shows its latest report, a small chart of doors knocked in each report, and its reports newest first.
- Each report names its period ("+412 this week", or "+812 in these 14 days") and the dates it was
  published and last edited or refreshed, as dates, never times. If the numbers were taken before the
  period ended, it says "Numbers as of Oct 24". If earlier totals changed, it says so in one line.
  Arrows move to the older or newer report in the same tab. Team reports say that a home both teams
  visited counts in each team's report.
- The map works on a phone: full width, filters in a drawer, two fingers to pan, door details below
  the map, and real question wording instead of codes.
- **Area view** shows shaded areas with how many doors were reached and how they went. It never shows an
  address. A single-choice question shows its answers area by area only when every area has at least
  five answers to it; otherwise that report shows only the question's overall chart. Where every home
  that answered in an area gave the same answer, that tells you how each of them answered. How each door
  went shows for every area, even one with a single home, and other reports on the same link (other
  weeks, teams or walk lists, or an exact-doors report) can narrow things down.

## Big campaigns

Builds run on the background worker and work through the campaign a slice at a time, so a big report
never crowds out the imports and exports the worker runs at the same time. Each build uses a fixed
cut-off time, stops if the campaign or organization is being deleted, and waits outside the queue if
another change is running, so one campaign can't hold up everyone else's reports. The client's map
downloads a compact list of door positions and results, without addresses, and fetches a door's address
only when it is tapped, so even a 100,000-door report opens on a phone.

## What this does not change

How every number is counted ([METRICS.md](METRICS.md)), tags hidden until ticked, door-goal progress
only, and the phone app (nothing here changes what it shows). No new company receives any data. The
Privacy Policy, Terms and DPA need no edit for these changes; the homepage line and two marketing lines
are corrected (§J). Pin clustering is not used anywhere: area-view hexagons are fixed and look the same
at every zoom.

---

# Part 2 — Technical reference

## A. Method

Read end to end: [routes/admin/clientReports.js](../server/src/routes/admin/clientReports.js),
[routes/public/share.js](../server/src/routes/public/share.js),
[models/ClientReport.js](../server/src/models/ClientReport.js),
[models/ReportShareLink.js](../server/src/models/ReportShareLink.js),
[services/reports/computeReport.js](../server/src/services/reports/computeReport.js),
[services/reports/clientReportView.js](../server/src/services/reports/clientReportView.js),
[ClientReportsPage.jsx](../client/src/pages/ClientReportsPage.jsx),
[ClientReportBuilderPage.jsx](../client/src/pages/ClientReportBuilderPage.jsx),
[PublicReportLayout.jsx](../client/src/components/PublicReportLayout.jsx),
[PublicReportListPage.jsx](../client/src/pages/PublicReportListPage.jsx),
[PublicReportDetailPage.jsx](../client/src/pages/PublicReportDetailPage.jsx),
[ClientReportMap.jsx](../client/src/components/ClientReportMap.jsx),
[ClientReportView.jsx](../client/src/components/ClientReportView.jsx),
[reportDerive.js](../client/src/lib/reportDerive.js) and
[reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js).

**Verified** items come from scratch probes, kept out of the repo, that boot `createApp()` against a
throwaway `mongod` and drive the real admin and share endpoints. The review rounds ran their own probes
the same way (§N); round 2 also built a working prototype of §F2's build and matched it against today's
code, and round 3 ran the plan's literal filters on MongoDB 7.0.2 with the repo's Mongoose.

The phone app calls no client-report or share endpoint (`npm run audit:mobile-api -- --list`,
cross-checked by grep). It does call `GET /admin/campaigns/:campaignId/history`; client-report rows are
kept out of that route's default response by a filter in the query (§F9), so what the phone receives is
unchanged, including its 200-row cap. Nothing here needs an OTA or a client-version gate.

## B. Verified defects in today's code

| # | Defect | Where | Probe result |
|---|---|---|---|
| B1 | `showMap: false` only hides the map in the browser. Publish always runs `buildFrozenMapPoints`, and `GET /share/:token/reports/:id/map` never checks `visibility.showMap`. | `clientReports.js:697-704`; `share.js:166-173` | Map off → `/map` 200 with all 3 doors, e.g. `{"addressLine1":"1 Elm St", …, "status":"surveyed", "answers":[{"questionKey":"support","answer":"Yes"},{"questionKey":"bond","answer":"For"}]}` |
| B2 | Hidden questions ride the payload. `mapFilterSurvey` filters on `mapAnswerKeys` only, never `visibleQuestionKeys`, and treats an empty list as every question. `mapAnswerKeys` is seeded with every choice question at create (`clientReports.js:454`), and the builder hides that checklist while the map is off (`ClientReportBuilderPage.jsx:509`). | `clientReportView.js:114-127` | `bond` unticked from visible questions → the share response's `survey.questions` still carries `bond` with `Against 2 · For 1`, and the points carry `bond` answers. |
| B3 | `visibleQuestionKeys: []` means all (`shapeWindow`), so unticking everything shows everything. | `clientReportView.js:10-12`; `ClientReportBuilderPage.jsx:147` | Empty list → client breakdowns `['support','bond']`. |
| B4 | No password strength rule. `shareCreateSchema.password` is `min(1)`; `shareUpdateSchema.password` has no minimum. The unlock limiter counts per IP + token. | `clientReports.js:241, 251`; `share.js:106-114` | PATCH `password: "a"` → 200; unlock with `"a"` → 200. |
| B5 | A password change does not end existing unlocks: the share JWT is `{kind, shareId, campaignId}`, lives 24 h, and is never checked against the password. | `tokens.js:112-119`; `share.js:56-75` | The old JWT after the password change → 200. |
| B6 | Publish has no status guard, so a published report can be re-frozen with newer data. | `clientReports.js:672-717` | Backdated knock added, publish again → 200; `doorsKnocked` 3 → 4; `publishedAt` moved. |
| B7 | The pre-password meta call returns `label`, which no client screen renders. `loadShare` stamps `lastAccessedAt` on every call, meta and failed unlocks included. | `share.js:48, 84-99` | Meta with no password → `{"campaignName":"Fall","orgName":"Acme","label":"Internal — do not forward","requiresPassword":true}`; `lastAccessedAt` set. |
| B8 | Hidden question keys still reach link holders through `visibility.mapAnswerKeys` (raw) and `supportQuestionKey` (even when hidden). Keys are slugs of the question title (`SurveyBuilder.jsx:107-110`). | `clientReportView.js:68, 88-91` | Recall question hidden and made the headline → the response carries `"would_you_back_recall_of_mayor_smith"` twice. |
| B9 | A follow-up question on the map reveals the hidden question it depends on, door by door. Questions can be conditional (`visibleIf`, `SurveyTemplate.js`); the field submit drops answers to questions that weren't shown (`normalizeAnswers.js:105`); the map path never considers `visibleIf`. | `computeReport.js` (map answers); `normalizeAnswers.js:52, 105` | With "Back the recall?" hidden and "Yard sign?" (asked only after Yes) on the map, every door carrying a yard-sign answer answered Yes. (Round 3, privacy reviewer, with the real `normalizeAndFilterAnswers`.) |

## C. Defects from code (not run)

- **C1. Public error states.** `PublicReportListPage` has no error branch, so a 401 (the share JWT
  kept in `sessionStorage` past 24 h) renders "No reports have been published yet"
  (`PublicReportListPage.jsx:36`). The detail page renders "Report not found" and the map "Map is
  unavailable right now". `PublicReportLayout` collapses a 404 and the server's `410 SHARE_EXPIRED` into
  "This report link is not available" (`PublicReportLayout.jsx:80`). Today's link-level 404
  (`share.js:29`) and report-level 404 (`share.js:146`) carry no code to tell them apart.
- **C2. Legacy link with a password added.** `isLegacyOpen` is `!passwordHash || !expiresAt`
  (`clientReports.js:214`), and adding a password never sets `expiresAt`, so the row keeps its "open
  link" badge and `revoke-legacy` (`:324`) still disables it.
- **C3. Period wording.** "+N this week" is hard-coded (`ClientReportView.jsx:24`, `reportPdf.js:102`)
  along with about a dozen other weekly strings (§F10), but the create form accepts any range.
- **C4. Default week.** `defaultWeek()` uses `toISOString()` (`ClientReportsPage.jsx:14`), which is
  UTC: in the US evening the end date is tomorrow.
- **C5. Builder state.** Preview reads the saved report, not the draft on screen. There is no
  unsaved-changes guard. `recomputeM`, `publishM` and `unpublishM` have no `onError`
  (`ClientReportBuilderPage.jsx:101-122`).
- **C6. Client map.** The door panel prints `a.questionKey` (`ClientReportMap.jsx:359`). The layout is a
  fixed `w-64` filter column beside the map in a 70vh row (`:267`).
- **C7. Support subtitle.** `support.subtitle` is `` `${surveysTaken} total responses` ``
  (`reportDerive.js:166`), while the bars count that question's own answers.
- **C8. Editing after publish.** Unpublish sets `status: 'draft'` and nulls `publishedAt`
  (`clientReports.js:732-736`), and republish recomputes (B6's path).
- **C9. Link scope.** A link returns every published report of its campaign. Ruled fine (§E).
- **C10. Expiry choice.** The API accepts `expiresInDays`; the panel always posts `{ campaignId }`.
- **C11. What a lead can do.** Leads can do everything on this page. Ruled: keep.
- **C12. Smaller.** Deleting a published report gives a draft's warning. Link and report changes leave
  no history. Share responses carry no `Cache-Control: no-store`. The PDF's filename collides across
  scopes (`reportPdf.js:269`). The "+N" pill is about 3:1 contrast (`StatCard.jsx:42`). The marketing FAQ
  says a report "can be password-protected" (`marketing/Faq.jsx`), though passwords are mandatory.

## D. Scale (not measured)

**Production formation** (from the owner's Heroku dashboard, 2026-10-24): one `web` dyno, Standard-2X
(1 GB), running `node src/server.js` with no heap flag; one `worker` dyno, Performance-M (2.5 GB), with
`WORKER_MAX_OLD_SPACE=2000`, a 2,000 MB heap cap instead of the script's 384 MB default.

Today's publish runs on the **web** dyno, with Heroku's 30-second router limit, and loads every
in-scope household, every knock and every survey response into memory. The worker has room, but it is
one program running every queue at once (up to two imports, an export, turf, deletes, maintenance,
conversions and answer edits); if one job pushes the heap past its cap, every job on the dyno is
interrupted. §F2 keeps a build's memory small and flat. Verification includes a timing and memory run on
a **synthetic** campaign of Collier's size (§K): a copy of real customer data would take PII out of
production.

## E. Owner rulings

| Date | Question | Ruling | Consequence in this plan |
|---|---|---|---|
| 10-23 | What can a lead do? | **Full control, as today.** | No role change. Org-wide **branding** is admin-only (it changes every campaign's reports). Leads can choose link expiry; the policy's "chosen by an administrator" is read as covering them. |
| 10-23 | Different clients per walk list? | **No: one client per campaign.** Volunteer and paid teams may want separate reports. | Links stay per campaign. **Team reports** (§F4). |
| 10-23 | How do recipients get in? | **Link + password, hardened.** | §F6. |
| 10-23 | Fixing a published report | **Both:** edits that keep numbers frozen, and Refresh numbers with a before-and-after. | §F3; Take down can't get around it. |
| 10-23 | Telling the client about a new report | **Copy-ready message.** | §G6. |
| 10-23 | Starting next week's report | **One click from last week.** | §F10. No scheduler. |
| 10-23 | Branding | **Org logo + small Doorline mark.** | §F8. |
| 10-23 | Map precision | **Exact pins by default, area view per report.** | §F5. |
| 10-24 | A sentence about recording link opens? | **No.** | §I. |
| 10-24 | Home or voter both teams reached | **Counts in each team's report.** | §F4, with a note on the report. |
| 10-24 | Homepage "numbers never change under you" | **Reword.** | §J. |
| 10-24 | Survey answers in area view | **Only where 5+ homes answered**, with honest wording. Revised after round 4: **all or nothing per question**. | §O5: a single-choice question shows area answers only when every area has 5+ answers to it; no rule ever looks at the answers when deciding. |
| 10-24 | After round 4 | **Build it, then two code-review rounds.** | §M. |
| 10-24 | Client stays signed in | **Opt-in.** | §F6: up to 30 days. |
| 10-24 | One team name, several crews? | **Yes.** | §F4. |
| 10-24 | Tell the client when earlier totals changed? | **Yes, one neutral line.** | §F4, §H3. |
| 10-24 | A third review round? | **Yes, short.** | §N. |

## F. Server plan

### F0. Rules that apply everywhere

- **Old documents lack the new fields.** Every new field used in a query filter tolerates its absence:
  `{ field: null }` matches a missing field; comparisons such as `$lt` don't, so they are paired with `{
  field: null }` in an `$or` or written as `$in: [value, null]`. Every counter is updated with a pipeline
  that treats null as 0 (`{ $add: [{ $ifNull: ['$failedUnlocksTotal', 0] }, 1] }`), since `$inc` on an explicit
  null throws (verified). **JavaScript reads never trust a Mongoose default** for an old document (a
  missing `snapshotInputs` hydrates as empty lists and would read as "nothing on the map"); each field
  has one helper with an explicit fallback: `liveInputs(report)` (from `visibility` when
  `snapshotInputs` is missing), `numbersCutOff(report)` (`statsComputedAt ?? publishedAt`),
  `lifetimeStart(link)` (`lifetimeStartAt ?? createdAt`), `seriesKeyOf(report)` (`seriesId`, else
  `legacy:<campaign or effortId>`). The deploy comes before the migration, so all of this must work on
  unmigrated documents; tests insert raw legacy documents and drive every route.
- **Scope clauses run in Mongo**, never re-implemented in JavaScript (`teamMatch`, `withTeam`,
  `NOT_BULK`, `STATUS_ROW_MATCH`).
- **Every new model declares `organizationId`** (and `campaignId` where it has one); strictQuery strips
  undeclared filter keys, so a cascade delete would otherwise match everything.
- **Nothing on the wire tells time to the second.** The client gets civil dates (`YYYY-MM-DD` in the
  report's time zone), never instants, and the map's version is an opaque random key, not an ObjectId
  (whose first bytes are a timestamp).

### F1. Visibility, enforced on the server

- **One meaning of "empty": none.** `visibleQuestionKeys` and `mapAnswerKeys` mean "show none" when
  empty, for every report. Create, Next and the builder always write explicit keys.
- **Follow-ups need their parents.** Each build freezes `questionDeps` (question key → the keys its
  `visibleIf` rules depend on, transitively) from the template into `snapshotInputs`; for a report built
  before this change, the live template supplies them.
- **`visibleKeysFor(report)`** = `visibleQuestionKeys` ∩ the frozen breakdown keys.
  **`mapKeysFor(report)`** = keys in `mapAnswerKeys` ∩ `visibleKeysFor` **whose every dependency is also
  in the set**, or `[]` when the map is off. A follow-up whose parent isn't on the map never reaches it.
  When a key leaves `mapKeysFor`, it also leaves `mapAnswerKeys`.
- **Charts of follow-ups** stay the operator's choice; a follow-up chart whose parent is hidden is
  flagged in "Before you publish" ("Its total shows how many said Yes to 'Back the recall?'").
- **The client payload** (`shapeReportForClient`): `visibility` carries `{ showMap, mapMode, areaSize }`
  only; `supportQuestionKey` only when visible; each window drops `coverage`; `survey` lists `mapKeysFor`
  questions only; dates as civil dates (`publishedOn`, `editedOn`, `refreshedOn`, and `numbersThrough`
  only when the numbers stopped before the period ended); `scope: { kind, label, seriesKey }`;
  `earlierTotals` (§F4). No instants.
- **The map readers** (public and admin preview) read the live snapshot only: `{ clientReportId,
  snapshotId: report.snapshotId ?? null }`. They serve pins or cells according to the **live snapshot's**
  mode (`liveInputs(report).mapMode`, missing = pins), never the operator's on-screen setting. Order of
  checks: map on (else **404 `MAP_NOT_SHARED`**), then the requested snapshot key (else **409
  `MAP_UPDATED`**), then the mode. Answers outside `mapKeysFor` are stripped before anything else
  touches the rows (`shapeMapPoints`, `shapeAreaCells`), which also fixes already-published reports.
- **Migration `migrate:client-report-visibility`** (dry run unless `-- --apply`; proxied in the root
  `package.json`). Steps, in order; the dry run marks which discard information:
  1. **List legacy reports whose operator unticked every question.** By default they keep "none";
     `--keep-legacy-all` first writes their breakdowns' keys. Decide before step 4.
  2. **Series.** One `campaign` series per campaign and one `walk_list` series per (campaign, `effortId`)
     with reports; labels from the frozen `effortName`, with " (2)" added where two walk lists share a
     name; labels containing a canvasser's name are listed for the owner rather than refused. Every
     report gets `seriesId` and `scope`.
  3. **Backfill.** Reports: `editVersion: 0`; `statsComputedAt = publishedAt` on published reports
     (today's publish recomputes at that moment); `snapshotInputs` from the current settings, with
     `mapKeys = mapKeysFor(report)` and `questionDeps`. Legacy points: `seq` = their rank by `_id` within
     the report (positions identical before and after), and the report's `extent`. Links:
     `credentialVersion: 0`, the rolling failure budget's fields (`failedUnlockAt: []`,
     `failedUnlocksTotal: 0`, `failedByDay: []`, §O7), `lifetimeStartAt` (= `createdAt` on links that
     expire; unset on legacy open links until they gain an expiry).
  4. **Discards information:** every report's `mapAnswerKeys` becomes `mapKeysFor(report)`.
  5. **Irreversible:** points of every report whose map is off (drafts included) are deleted, and
     answers outside `mapKeysFor` are `$pull`ed from the rest.
  It also lists open drafts, which need a recompute before they can be published (§L).

### F2. Snapshots, built on the worker

A **snapshot** is one build's frozen output: the numbers on the report document and the map rows (pins
or cells) tagged with its `snapshotId`. A build never writes over a live snapshot; it writes a new one,
and one atomic update swaps it in.

**Fields on `ClientReport`:**

| Field | Meaning |
|---|---|
| `snapshotId`, `snapshotKey` | The live snapshot (`null` on reports built before this change, whose rows carry no `snapshotId`; `{ snapshotId: null }` matches the missing field, verified), and its opaque random key, the only one the client sees (legacy reports: `"legacy"`). |
| `snapshotInputs` | What the live snapshot was built with: `{ showMap, mapMode, areaSize, mapKeys, questionDeps, coordinatorIds }`. Removals update it in place (§F3); anything that adds to it needs a new build. |
| `statsComputedAt` | The live snapshot's cut-off time (stored; sent to the client only as `numbersThrough`, a date). |
| `stats`, `goalSnapshot`, `mapPointCount`, `areaCellCount`, `extent`, `earlierTotals`, `arrivedDuringBuild` | The live numbers and their notes. |
| `editVersion` | Incremented by every PATCH; Publish compares it. |
| `takenDownAt`, `takenDownBy` | Set by Take down. A published report with `takenDownAt` is hidden from the client. |
| `build` | `{ kind: 'recompute' \| 'refresh' \| 'remap', status: 'queued' \| 'waiting' \| 'running' \| 'ready' \| 'failed' \| 'idle', jobId, snapshotId, snapshotKey, inputs, fenceAt, startedAt, beatAt, waitingSince, rebuilds, firstCheck, progress, waitingFor, error: { code, message }, result, requestedBy, cancelledAt, cancelledBy }` |

**`build.inputs` is the build's target.** It freezes, at claim, every setting the build will produce:
`{ showMap, mapMode, areaSize, mapKeys, questionDeps, coordinatorIds }`. Removals made while the build is
live prune it (§F3). Commits and Apply write it; nothing intersects it with the report's other settings.

**Is a build live?** One helper, `buildIsLive(report)`, used by every gate. `queued` and `waiting` are
live while `queue.getJobState(jobId)` is `waiting`, `delayed` or `active` (it returns `unknown` for a
lost job instead of throwing) and the build is under two hours old; `running` is live while `beatAt` is
under 5 minutes old. Anything else is not live, and the next Publish, Take down or claim resets it to
idle in its own CAS.

**Claim** (web, one request). `findOneAndUpdate({ _id, organizationId, status: <draft for recompute,
published for refresh and remap>, …not live (pinning the `build.jobId` observed dead)… }, { $set: {
build: { kind, status: 'queued', jobId: <new ObjectId hex>, inputs, startedAt: now, beatAt: now, … } }
})`. No document back → **409 `REPORT_BUSY`** with the current build. A claim replaces a `ready` result.
The job is enqueued through `queueOp` with a timeout; if enqueueing fails, a CAS on `{ 'build.jobId',
'build.status': 'queued' }` marks it `failed` ("Couldn't start — try again"), the `parkUnqueued` pattern.

**Cancel** always replaces the whole object: `$set: { build: { status: 'idle', cancelledAt, cancelledBy }
}`, then deletes the pre-image's `build.snapshotId` rows. Every worker write matches on `build.jobId`
and `build.snapshotId`, which the replacement removes, so a cancelled build's heartbeat, commit and
failure writes all miss (verified; setting only `build.status` would not do this).

**Queue.** A new `QUEUE_NAMES.CLIENT_REPORT`, registered in [worker.js](../server/src/worker.js) at
**concurrency 2** (each build's memory is bounded by its batch size), `attempts: 1`, `maxStalledCount:
2`, and a `failed` listener whose CAS is `{ 'build.jobId', 'build.status': { $in: ['queued', 'waiting',
'running'] } }` (so a throw after a refresh reached `ready` doesn't lose the review). It sets `failed`
and clears `build.snapshotId`, leaving that attempt's rows to the sweep. The builder shows "Queued (2
ahead)" from the queue's waiting list.

**Each attempt** (worker):

1. **Own the attempt.** CAS `{ _id, 'build.jobId', 'build.status': { $in: ['queued', 'waiting',
   'running'] }, status: <the claim's status> }` → `$set { 'build.status': 'running', 'build.snapshotId':
   new ObjectId(), 'build.snapshotKey': <random>, beatAt }`. No match → exit. Every attempt, a delayed
   redelivery included, writes under its own snapshot.
2. **Wait outside the slot.** If `otherChangeRunning(campaignId)` reports something: delete this
   attempt's rows (if any), CAS `status: 'waiting'`, `waitingFor` (reworded for reports), `beatAt`, and
   `waitingSince` if unset; then `job.moveToDelayed(now + 30 s, token)` and throw `DelayedError`, which
   frees the worker slot and doesn't count as an attempt (verified in bullmq 5.77). Thirty minutes after
   `waitingSince` the build fails `BLOCKED`; an open one-person answer-edit session never ends by itself,
   so that message says "press Stop on Door Outcomes".
3. **Fence.** `fenceAt = now`. Every `CanvassActivity` and `SurveyResponse` read adds `createdAt: { $not:
   { $gt: fenceAt } }`; the `$not` form keeps rows with no `createdAt` (verified).
4. **Heartbeat.** A 30-second timer (`unref`) CASes `{ _id, 'build.jobId', 'build.snapshotId' }` →
   `beatAt`, `progress`. A miss sets an in-memory cancel flag; the batch loop checks it and stops. The
   timer is cleared before the commit.
5. **Deletion.** `deletionRequested({ campaignId, organizationId })` is checked before every batch; if
   true, the build stops with `UnrecoverableError`. `ClientReportMapPoint` and `ClientReportAreaCell`
   join `LATE_WRITE_MODELS`, and the commit runs inside `sweptAfter(tenant, …)`.
6. **Build** (below).
7. **Changed during the build?** The first time this check runs for a build it records, in
   `build.firstCheck`, the newest `updatedAt` (and ids) it sees on each source below; a later check
   counts only rows newer than that, so a change the build already waited out never counts twice. The
   sources:
   - `otherChangeRunning(campaignId)`: a change still in flight sends the build back to step 2 (rows
     deleted, delayed), not to a rebuild;
   - `AnswerEditRun`, `SurveyConversionRun`, `UnknockRun` and `ReclassifyRun` for the campaign with
     `updatedAt >= fenceAt − 60 s` (clock skew between dynos);
   - a `TurfSnapshot` with `clearedKnocks: true` and `createdAt` or `restoredAt >= fenceAt − 60 s`;
   - for team reports, a `CoordinatorChange` for the campaign with `createdAt >= fenceAt − 60 s`;
   - a row of either ledger for the campaign changed in place: `{ campaignId, createdAt: { $lte: fenceAt
     }, updatedAt: { $gt: fenceAt } }` (`.exists()`; Mongoose bumps `updatedAt` on `updateMany`,
     verified).
   A finished change rebuilds once (`build.rebuilds`, kept on the document so a redelivery remembers it)
   with a new snapshot and fence; a second one fails `CHANGED_DURING_BUILD`. What no check can see is a
   door the phone replaces during the build (it deletes the old row and creates a new one, which the
   fence excludes); the build records `arrivedDuringBuild` = rows with `createdAt > fenceAt` and
   `timestamp < rangeEndUtc`, and the builder says "3 knocks arrived while these numbers were being
   built — Recompute to include them".
8. **Invariants.** For each window, Σ `contactBreakdown` === `doorsKnocked`, and period doors ≤
   cumulative doors. They hold by construction (one fold); a failure means a bug, fails the build loudly
   and never commits.
9. **Commit** (one CAS on `{ _id, 'build.jobId', 'build.snapshotId', status }`, keeping the pre-image).
   Before it, rows outside `build.inputs.mapKeys` are `$pull`ed and, if `build.inputs.showMap` is false,
   no rows are kept.
   - `recompute` (drafts): swap in the numbers, `snapshotId`, `snapshotKey`, `snapshotInputs =
     build.inputs`, `statsComputedAt: fenceAt`; `build: { status: 'idle' }`. Then delete exactly `{
     clientReportId, snapshotId: <previous> ?? null }`. The draft's on-screen settings aren't touched; if
     they now differ from `snapshotInputs`, the preview says so.
   - `refresh`: `build.status: 'ready'`, `build.result` = the new numbers. The live snapshot is untouched
     until Apply (§F3).
   - `remap`: §F5.
   **A commit that misses** CASes `{ 'build.jobId', 'build.snapshotId' }` → `failed` with code
   `SUPERSEDED` and `build.snapshotId: null` (if the build is still its own), then deletes its rows only
   after re-reading that the report's live `snapshotId` isn't this one.

**The build.** One function, `buildReportSnapshot()`, replaces `computeBothWindows` and
`buildFrozenMapPoints`. Round 2's prototype of it reproduced today's numbers exactly (§N).

- **Walk the households that have knocks.** An aggregation cursor over `CanvassActivity` (`{
  organizationId, campaignId, timestamp: { $lt: rangeEndUtc } }` + fence, `$group` by `householdId`,
  `$sort` by `_id`, `allowDiskUse`) yields every household with activity before the end, including any
  whose household record is gone, in batches of `CLIENT_REPORT_BATCH` (default 2,000).
- **Per batch, a handful of indexed finds** (`{ householdId: { $in } }` is indexed on both ledgers):
  1. **Scope rows:** `CanvassActivity` with `KNOCK_ACTIONS`, the window and fence, and the scope
     clauses: walk list = the activity's `effortId`; team = `withTeam(…, { $or: [teamMatch(id) for each
     coordinator in build.inputs.coordinatorIds] })` + `NOT_BULK`.
  2. **Status rows** for the map, when they differ from (1): `STATUS_ROW_MATCH` rows of the batch's
     households, campaign-wide, for whole-campaign and walk-list reports (as today); for team reports,
     the team's own rows plus every `restricted` row on those doors.
  3. **Households:** `isActive: true`, with coordinates; for walk lists the household's current
     `effortId`; for teams, those with a team knock before the end.
  4. **Responses** for the map: the latest response carrying a map answer, sorted `{ submittedAt: 1,
     _id: -1 }` (today's tie-break, verified), scoped to the team on team reports, each answer passed
     through `publicPointAnswer`, kept only for `build.inputs.mapKeys`.
- **Door numbers come from one fold.** Scope rows are grouped in Node into (household, round) groups,
  keyed on `String(passId)` (so a missing and a null round stay apart, as `$group` keeps them). From the
  same groups, per window (cumulative, period, and cumulative to the previous report's cut-off for
  `earlierTotals`): `doorsKnocked`, the surveyed, lit, refused, not-target and contact flags, the contact
  breakdown via `resolveStatus`, and `homesKnocked`.
- **Map rows.** Pins are inserted per batch (`ordered: false`) with a running `seq`, the row's position
  in the client's compact payload (§F11). Area cells accumulate in memory and are written once at the end
  (§F5). `extent` is frozen from the pins, or from the cells' boundaries on an area report.
- **Survey numbers** (surveys taken, voters surveyed, breakdowns, tags, provenance) stay server-side
  aggregations with the fence and the scope. Voters surveyed is `$match: { voterId: { $ne: null } }` +
  `$group` + `$count`. Breakdown options get a stable order: count descending, then template order.
- **Parity with today, pinned.** Today's `computeWindowStats` and `buildFrozenMapPoints` stay in the
  test suite as oracles, compared option by option id. The fixture: a door moved between walk lists, a
  two-voter door whose later answer skips a map question, tied `submittedAt` values, two teams with a
  lead's own doors and a lead-only week, a desk `bulk` row, a door both teams knocked in one round, a
  re-stamp, an inactive knocked household, field and desk restrictions, not-target and no-soliciting
  doors; at the default batch and at `CLIENT_REPORT_BATCH=2`.

**Nightly sweep** (a maintenance job registered with
[scheduler.js](../server/src/services/retention/scheduler.js); the test pinning the scheduled-job list is
updated). It reads at `sweepStart`, and every delete it issues also requires `snapshotId <
ObjectId.createFromTime(Math.floor(sweepStart / 1000))` (or a null `snapshotId`), so a build that starts
after the read is never touched. It deletes: rows whose report no longer exists; rows of reports whose
map is off, sparing a live or `ready` build's snapshot; legacy rows (`snapshotId: null`) of reports that
now have a snapshot; and rows whose `snapshotId` is neither the live one nor a live or `ready` build's
and was minted more than 24 hours ago (`createFromTime` takes **seconds**).

### F3. Publishing, editing, taking down, refreshing

- **Publish is not a build.** It freezes the draft's live snapshot: `findOneAndUpdate({ _id, status:
  'draft', snapshotId: <previewed>, editVersion: <previewed> (`$in [0, null]` when 0) }, { $set: { status:
  'published', publishedAt, publishedBy, openMockFlagsAtPublish, build: { status: 'idle' } } })`. Setting
  `build` cancels any recompute still queued, waiting or running: what you previewed wins, and the
  cancelled build's writes all miss. Refused with **409 `RECOMPUTE_NEEDED`** when there is no snapshot, or
  when the on-screen settings add to `snapshotInputs` (a map question, map on, a different mode or area
  size, a different set of coordinators, compared sorted); **409 `SNAPSHOT_CHANGED`** when a recompute
  landed since the preview ("Your numbers were just rebuilt — look at the preview, then publish"); **409
  `SAVING`** when `editVersion` moved. The builder flushes pending auto-saves first. The confirm offers
  **Recompute first** when the numbers are more than an hour old, the period hasn't ended, or knocks
  arrived during the build; after a Recompute the owner reviews the new preview and presses Publish again.
- **Edits.** `PATCH /:id` writes only the fields it was sent, with a targeted `$set` and `$inc:
  { editVersion: 1 }`. A build never blocks a text or visibility PATCH. `isSupportQuestion` is no longer
  stored. On a published report (shown or taken down) it accepts the title, the observations, the
  headline, the visible questions and tags, the goal tick, and two removals, which are never refused:
  - **map off:** sets `showMap` and `snapshotInputs.showMap` false, deletes every map row of the report,
    and cancels any live build or `ready` result. It asks first: "This deletes the frozen map; turning it
    back on rebuilds every number."
  - **dropping map questions:** removes them from `mapAnswerKeys`, `snapshotInputs.mapKeys` and any
    build's `inputs.mapKeys`, and `$pull`s their answers (and any follow-up that depended on them) from
    the live and `ready` rows.
  **Switch to areas** claims a `remap` (§F5): the settings go into `build.inputs` and nothing on the
  report changes until it commits; while another build is live it answers **409 `REPORT_BUSY`** ("Wait
  for the refresh to finish, or discard it"). Anything that adds to the map (map on, a map question, area
  size, areas → pins) is **400 `NEEDS_REFRESH`**; the builder sends those through the Refresh dialog. An
  accepted edit on a published report stamps `contentEditedAt/By` and writes a History row (§F9).
- **Take down** sets `takenDownAt/By`, cancels any live build and discards a `ready` result (replacing
  `build`). The report stays `published` with its numbers and `publishedAt`; every public route filters
  `takenDownAt: null`. It can still only change through Edit or Refresh. **Put back up** clears
  `takenDownAt`, keeps `publishedAt`, writes a History row and is instant. There is no path from
  published back to draft.
- **Refresh numbers.** `POST /:id/refresh { map? }` claims a `refresh` build whose `inputs` are the
  report's live inputs plus the additions it carries (validated: choice questions only, ⊆ the visible set,
  dependencies included). A refresh rebuilds with the coordinators the report was built with
  (`snapshotInputs.coordinatorIds`) and skips the team check, so a report already sent never quietly
  starts covering another crew. On `ready`, the builder shows "New numbers ready to review (built Oct 22)
  · Rebuild". **Apply**: CAS `{ status: 'published', 'build.status': 'ready', 'build.snapshotId':
  <reviewed> }` → swap in the result, `snapshotId`, `snapshotKey`, `snapshotInputs = build.inputs`, and
  `visibility.{showMap, mapMode, areaSize, mapAnswerKeys}` from `build.inputs`; stamp
  `numbersRefreshedAt/By`; `build: { status: 'idle' }`; then delete the previous live rows. **Discard**:
  CAS `ready → idle`, and delete that result's rows from its own pre-image only when the CAS matched.
  Take down, Delete, map-off and any new claim also discard a `ready` result.
- **Delete** deletes the report, clears any `nextReportId` pointing at it, then deletes every map row with
  its `clientReportId`. A live build's heartbeat misses and it stops; the sweep catches anything left.

### F4. Team reports

- **Series.** A new collection, `ClientReportSeries { organizationId, campaignId, kind: 'campaign' |
  'walk_list' | 'team' | 'team_walk_list', label, labelKey, effortId?, teamSeriesId?, coordinatorIds:
  [ObjectId], pastCoordinatorIds: [ObjectId], endedAt, createdBy }`, records each run of reports. Every
  report carries `seriesId` and a frozen `scope.label`. The client groups reports by an opaque
  `seriesKey` and shows the series' current label.
- **Indexes** (all partial on `endedAt: null`; partial filters on `endedAt: null` and `kind` equality
  build on MongoDB 7.0, verified): unique `{ campaignId, labelKey }` (`labelKey` = the label lowercased
  and trimmed); unique `{ campaignId, kind }` for `kind: 'campaign'`; unique `{ campaignId, effortId }`
  for `kind: 'walk_list'`; unique `{ campaignId, coordinatorIds }` for `kind: 'team'` only (multikey, so
  a crew belongs to at most one active team; non-team series, whose empty arrays would collide, are
  outside the filter; verified); unique `{ campaignId, teamSeriesId, effortId }` for `kind:
  'team_walk_list'`. The route also de-duplicates `coordinatorIds`.
- **A team on one walk list** (`team_walk_list`) stores `teamSeriesId` and `effortId` and reads its
  crews and its name from the parent team, so renaming, changing crews or ending the team carries over;
  it reads "Volunteer team · North".
- **Labels.** Typed by the operator (1-60 characters). **400 `TEAM_LABEL_HAS_NAME`** when a team label,
  a walk-list series label or a combined label contains, as a whole word of three or more letters, the
  first or last name of a coordinator or crew member on the campaign.
- **The picker** lists the campaign's current crews (coordinators with `CampaignAssignment` rows): free
  crews selectable, crews in another active team shown with that team's name, former crews disabled with
  the reason. It explains that canvassers without a coordinator belong to no team report. Reusing an
  ended team's name offers to continue that team instead of starting a new one with the same name. No
  change to `routes/admin/reports.js`, which the phone calls.
- **Edit team** on each team tab (and `PATCH /admin/client-reports/series/:id`): rename, change crews
  (the same picker), end.
- **When a crew lead leaves.** Removing a coordinator clears her crew's `coordinatorId` but leaves every
  ledger row stamped with her (`releaseAssignedWork`), so her crew's past doors still belong to her
  stamp. Before a **recompute or Next** of a team report, each coordinator in `coordinatorIds` must still
  run a crew here. If one doesn't, the build fails `TEAM_CHANGED` and the builder shows a card, not
  Retry: "Dee no longer runs a crew on this campaign." with **Keep her past doors in Paid team**
  (default: her id moves to `pastCoordinatorIds`, still counted, exempt from the crew check and the crew
  index), **Remove them** (shows the effect, e.g. "−1,400 doors from earlier totals"), **Change crews**,
  and **End this team**. It points to the Team tab for her now crew-less canvassers. Refreshes and remaps
  of published reports don't run this check (§F3).
- **An org without team attribution** (`teamAttributionReadyAt` unset) gets **400
  `TEAM_ATTRIBUTION_NOT_READY`**, and the dialog disables "A team" with that reason.
- **Numbers: each team's own work.** The team clause covers `coordinatorIds` ∪ `pastCoordinatorIds`.
  Doors add `NOT_BULK`. A home or voter both teams reached counts for both. Parity, pinned by test: doors
  match `/team-breakdown` except in a window where only the lead knocked (that route folds a lead's own
  doors only when the crew also knocked); surveys, voters and tags match the crew-filtered
  `/campaign-rollup` and `/survey-results`. Homes knocked isn't compared.
- **The team map** shows doors the team knocked, each with the team's own latest result and answers.
- **What people are told.** Team reports and their PDF carry "A home both teams visited counts in each
  team's report." "Before you publish" shows the window's team sums against the whole campaign ("14 door
  visits by more than one team", doors no team covered), the number of canvassers who knocked for this
  team in the period (with a note when it's one: the report then shows one person's work), and earlier
  totals that changed, with the reason chosen by cause ("canvassers changed teams" or "the team's crews
  changed").
- **Earlier totals changed** (owner ruling 10-24). The comparison report is the same series' published,
  not-taken-down report with the latest `rangeEndUtc` on or before this report's `rangeStartUtc`. Each
  build recomputes that report's visible count cards (doors knocked, surveys taken and voters surveyed;
  doors knocked, lit dropped and homes knocked on lit-drop campaigns) up to `numbersCutOff(previous)` and
  compares them with what that report froze. The client's report carries one neutral line, "Earlier
  totals were updated by −120 doors since the Oct 13 – Oct 19 report", listing each card that moved; if
  that report is taken down later, the line drops the "since …" clause when shown.
- **No door goal** on team reports; `NO_GOAL_SNAPSHOT`'s message gains a team branch. **Mock-GPS counts**
  follow the report's scope (`countOpenMockFlags` gains the walk-list and team clauses).

### F5. Area view

- `visibility.mapMode: 'pins' | 'area'` (missing reads as pins) and `visibility.areaSize: 'small' |
  'large'` → H3 resolution 9 (about 1,100–1,400 ft across, 23–30 acres) or 8 (about 0.55–0.7 mi
  across). `h3-js` 4.4.0 is already a server dependency; `latLngToCell` and `cellToBoundary(h, true)`
  were verified.
- **Cells** accumulate in memory for the whole build and are inserted once into `ClientReportAreaCell {
  organizationId, campaignId, clientReportId, snapshotId, h3, doors, byStatus, answers }`, unique on `{
  snapshotId, h3 }`. `answers` is `{ <questionKey>: { n, options: { <label>: count } } }`, `n` being the
  homes in the cell that answered.
- **Which answers show.** Only **single-choice** map questions get area answers (a multiple-choice
  question stays a pins filter and a report-wide chart). Per question:
  1. a cell's answers show only when `n ≥ 5`;
  2. if any cell is hidden, the hidden cells together must have `n ≥ 5`, number at least two, and **not
     all agree** (no option's hidden total equals the hidden `n`); otherwise the next-smallest shown cell
     is hidden too, until all three hold;
  3. if they can't hold (fewer than five answers in the report, all answers in one area, or the cells run
     out), the question gets **no** area answers, and "Before you publish" says the report's own chart
     shows that area's answers and offers to hide the chart.
  Counts are never rounded. The rules apply when writing and again when reading.
- **Always shown:** `doors` and `byStatus` per cell, even a one-home cell.
- **"Before you publish"** also warns when another published report on the same link (another period,
  team or walk list of the campaign, or any exact-doors report) could narrow a question's hidden answers.
- **Switch to areas** on a published report is a `remap` build, claimed by the Edit (`build.inputs` holds
  the mode and size; the report doesn't change yet). It reads the live snapshot's points (the map must be
  on and in pins mode), bins them with the same rules, writes cells under a new snapshot, and its commit
  sets, in one update, `snapshotId`, `snapshotKey`, `snapshotInputs`, `visibility.mapMode` and
  `visibility.areaSize`, `areaCellCount`, `mapPointCount: 0` and `extent` from the cells; then it deletes
  the points. The numbers don't change and the client sees "Edited". Until it commits, the client keeps
  seeing exact doors; if it fails, nothing changed. The confirm says so, and that going back to exact
  doors means refreshing the numbers. A remap isn't subject to the team check. On a **draft**, the mode
  and size are ordinary settings that take effect at the next Recompute; Publish refuses a mismatch.
- **Wording** wherever the area view is described: "Area view never shows an address. An area's answers
  appear only when at least five homes there answered a single-choice question, and more small areas
  are hidden when needed so that the hidden areas, worked out together from the report's charts, never
  show a single home's answer. How each door went shows for every area, even one with a single home, and
  other reports on the same link can still narrow things down."
- **Not clustering.** Cells are fixed hexagons that look the same at every zoom.

### F6. Share links

- **Passwords.** An operator-set password must be at least 12 characters, on create and PATCH (400
  `SHARE_PASSWORD_TOO_SHORT`). `passwordMeetsRule` is set to true on every compliant or generated
  password; for an older link it is unknown until the next successful unlock, which checks the entered
  password's length (never storing it) and records true or false. The panel flags only `false`: "This
  link's password is shorter than 12 characters — change it."
- **`credentialVersion`** (missing reads as 0), incremented on a password change (including a first
  password on a legacy open link), rotate, renew and disable. The share JWT carries `cv`;
  `requireShareAccess` requires `(payload.cv ?? 0) === (share.credentialVersion ?? 0)`.
- **Failure budget.** *(Superseded by §O7's rolling list, which is what was built: the `failedUnlocks`
  counter and `failedWindowStart` window below never existed.)* Fifty wrong passwords within a 24-hour
  window lock the link for 24 hours.
  - A wrong-password attempt first **reserves** a slot: a pipeline `findOneAndUpdate` on `{ _id, $and: [{
    $or: [{ failedUnlocks: { $lt: 50 } }, { failedUnlocks: null }] }, { $or: [{ lockedUntil: null }, {
    lockedUntil: { $lte: now } }] }] }` that adds 1 with `$ifNull`, returning the post-image. Before it, a
    window older than 24 hours (or none) is reset: the counter to 0 and a new `failedWindowStart`; the
    reset never touches `lockedUntil`. No slot → **429 `SHARE_LOCKED`** with no bcrypt compare.
  - The password is compared against the post-image's `passwordHash`, and a token is signed with its
    `credentialVersion`.
  - A correct password refunds its slot only in the same window: `{ _id, failedWindowStart: <slot's>,
    failedUnlocks: { $gt: 0 } }`, minus 1.
  - The 50th failure sets `lockedUntil = now + 24 h` and `lastLockedUntil`, as a CAS on the slot's
    `failedWindowStart` (so an Unlock now or rotate that lands mid-compare isn't undone). A lock that
    starts within 24 hours of the previous one ending makes the panel say "Someone else may have this link
    — rotate it".
  - **A lock never ends sessions already open:** `requireShareAccess` never reads it, so remembered
    devices keep working. **Unlock now** sets the counter to 0 and clears the window and `lockedUntil`; a
    rotate does the same and bumps `cv`.
  - The panel shows the current window's count whenever it is above zero ("12 wrong passwords since Oct
    24, 9:12 am"), and History gets one row per window once it reaches 10, and one at a lock.
  - The per-IP limiter stays.
- **Nothing before the password.** `GET /share/:token` returns `{ requiresPassword }` only. The campaign
  name, org name and `hasLogo` ride `GET /share/:token/reports`. The link's label is never sent.
- **"Last opened"** is stamped when access is granted, including for legacy open links before their
  early return.
- **Error codes.** Every share 404 carries a code. Link-level: 404 **`SHARE_NOT_FOUND`**, 410
  `SHARE_EXPIRED`, 429 `SHARE_LOCKED`. Report-level: 404 **`REPORT_NOT_FOUND`** (taken down, deleted or
  never published), 404 `MAP_NOT_SHARED`, 409 `MAP_UPDATED`. `/logo` with no logo answers 204.
- **Keep me signed in.** `POST /share/:token/unlock { password, remember: true }` returns a 30-day
  share JWT (24 h otherwise). The page keeps it in `localStorage` and drops it only on a 401, a 410, or a
  404 with `SHARE_NOT_FOUND`. A password change, rotate, renew, disable or expiry still ends it. The
  client pages carry **Sign out on this device**.
- **Expiry within a one-year life.** `expiresAt` may never pass `lifetimeStart(link) + 365 days`. Create
  offers 30, 90, 180 or 365 days (default 90; `SHARE_LINK_DEFAULT_DAYS` must stay 90 while the policy
  says "90 days by default"). **Extend** sets `expiresAt = max(current, now + days)`, capped, and shows the
  resulting date; it never shortens a link. An **expired** link is **Renewed**: rotated (new URL, new
  lifetime, `expiresAt = now + the chosen days`, `cv` bump, password kept), so a URL forwarded long ago
  stays dead.
- **Legacy links.** Adding a password also sets `expiresAt`, `lifetimeStartAt` and `passwordMeetsRule`,
  so the link leaves `isLegacyOpen` and the revoke sweep. Badges: **No password** ("Add a password") and
  **Never expires** ("Set an expiry").
- **Headers.** `Cache-Control: no-store` on every `/share` response, the logo included. `X-Robots-Tag:
  noindex, nofollow` on `/r/` pages (set in app.js's SPA fallback, the only place that HTML is served)
  and on `/api/share`. robots.txt's `Disallow: /r/` is removed: a crawler blocked by robots.txt never sees
  a noindex, and can still list a forwarded link's bare URL. `/api` stays disallowed.

### F7. Opens

- **No new collection.** `ClientReport.views`: `{ byLink: Map<shareId, { opens, firstOpenedAt,
  lastOpenedAt }>, members: { admins, leads, others, staff: { opens, lastOpenedAt } } }`, declared as a
  Map of a subschema (a plain nested object would be stripped silently, verified), updated by one
  `updateOne` with `$inc`, `$min` and `$max` and `{ timestamps: false }`. The old `viewCount` and
  `lastViewedAt` stay, shown as "N views before per-link counts".
- **An open is a ping, not a fetch.** The page sends `POST /share/:token/reports/:id/opened` once per
  report per browser per day (a `localStorage` key with the date). The count is "visits counted by the
  page": a determined link holder could inflate it, so the panel says "about".
- **Members are counted separately.** When the page has a Doorline session it sends the token (a new
  `identifyIfSignedIn` option on `api()`, which keeps `sentToken` null so a stale token can't trigger
  sign-out handling). After responding, the server resolves it with a new helper,
  `resolveSessionUser(token)`, which runs `requireAuth`'s checks (ended sessions, password changed,
  account deleted or inactive, the 90-day cap) without responding or stamping last-seen. Then: a super
  admin → `members.staff`; an active member of the link's organization → `members.admins`,
  `members.leads` or `members.others` by role (a lead who is the client shows under leads, which the
  tooltip says); anyone else → the link. This never grants or refuses access.

### F8. Branding

- **`OrgBranding`** `{ organizationId (unique), logo: Buffer, width, height, bytes, updatedAt,
  updatedBy }`, its own collection, because `orgContext` loads the whole `Organization` on every request.
  Written with an upsert on `organizationId`.
- **Upload.** The browser draws the chosen image (PNG, JPEG or SVG, sized explicitly) onto a canvas no
  larger than 800 × 320 and exports a PNG, shrinking the canvas until it fits 256 KB; a canvas
  `SecurityError` (some browsers taint a canvas from an SVG with embedded HTML) shows a plain error.
- **Server check, then re-encode.** The server accepts PNG only and checks: the signature; exactly one
  `IHDR`, first; every chunk's CRC; width and height between 1 and 2,000 and at most 4 megapixels; bit
  depth 8; colour type 2 or 6; no interlace; the image data inflated with `zlib.inflateSync(…, {
  maxOutputLength: expected + 1 })` to exactly `height × (1 + width × bytesPerPixel)` bytes, every row's
  filter byte ≤ 4. It then **writes a fresh PNG** from the validated fields: `IHDR`, one `IDAT`
  (`zlib.deflateSync` of the checked scanlines) and `IEND`, plus `tRNS` only for colour type 2 with a
  6-byte body. The uploaded chunk bytes are never stored, so nothing else can ride along. multer memory
  storage with `limits: { fileSize, files: 1, fields: 0 }`; a `MulterError` maps to 413.
- `PUT` / `DELETE /admin/branding/logo` behind `requireOrgRole('admin')`; `GET` for admins and leads
  (leads see it read-only, or "No logo yet").
- **Public:** `GET /share/:token/logo` behind `requireShareAccess` (204 when there's none), fetched with
  `X-Share-Token` and shown as a blob URL, revoked on unmount.
- The PDF draws it with jsPDF's `addImage` inside a try/catch, so a bad logo never breaks a PDF, and adds
  a "Powered by Doorline" footer.
- Added to `ORG_SCOPED`.

### F9. History

- The existing campaign History model, `CampaignChange` (in both deletion cascades and in
  `LATE_WRITE_MODELS`), gains `source: 'client_report'` and two optional fields, `erasedAt` and
  `erasedBy`. Rows: `field: 'clientReport.created | published | edited | numbersRefreshed |
  refreshDiscarded | takenDown | putBackUp | deleted | remapped'`, `field: 'clientReportSeries.created |
  renamed | crewsChanged | ended'`, and `field: 'reportLink.created | passwordChanged | rotated | renewed
  | extended | disabled | enabled | wrongPasswords | locked | unlocked | deleted'`.
- **Kept out of the general feed.** `GET /admin/campaigns/:campaignId/history` adds `source: { $ne:
  'client_report' }` to its query by default, so the web campaign History and the phone app (which calls
  it unfiltered) see exactly what they see today, 200-row cap included (verified). The Client Reports
  tab's History drawer asks with `?include=client_reports`, a fixed value, and gets client-report rows
  only, under its own query key (the web drawer and the phone share `['admin', 'campaign-history', id]`).
  Web labels live in `client/src/lib/campaignHistory.js`.
- **What a row holds.** An edit stores only the earlier text, in `fromValue`; `toValue` stays null (the
  current text lives on the report), so each version is kept in exactly one row. Other rows name the
  report's period, never its title. A refresh keeps the before-and-after totals. Link rows never hold the
  URL token, a password or its hash.
- **Restore** is a server action by row id (`POST …/history/:rowId/restore`) that applies the row's
  earlier text as a normal edit, and refuses an erased row (409). **Erase** (admins) sets `fromValue:
  null`, `erasedAt`, `erasedBy`; "Erase all earlier text for this report" reaches every such row, beyond
  the drawer's page. The Erase confirm names any later report whose notes were copied from this text by
  Next. The drawer refetches on focus and after every action. The Edit confirm on a published report
  says "Team leads on this campaign can see the earlier text in History."
- Leads read this history on their campaigns, so it is customer-facing (§I).

### F10. Next report, dates and wording

- **`POST /:id/next`** creates the following period's draft in the same series. To make a double click
  return one draft, it inserts the draft first with a pre-generated `_id`, then CASes the source `{ _id,
  $or: [{ nextReportId: null }, { nextReportId: <a report that no longer exists> }] } → { nextReportId:
  <this _id> }`; if the CAS loses, it deletes its own draft and returns the winner. It is offered only on
  the latest report of each series. Dates: the same number of days, starting the day after the source's
  `weekEnd`, computed in the source's frozen `timeZone`, asserting the new range starts exactly at the
  source's `rangeEndUtc`; a source that is exactly one calendar month rolls by month. It warns when the
  new period would start after today. It copies the observations (marked "Copied from Oct 6 – Oct 12"
  until the operator ticks "I've reviewed these notes"; the publish confirm repeats it), the explicit
  visible keys, tags, goal tick, headline and map settings, and re-validates the series.
- **Create and Next insert the draft with a recompute already claimed** and enqueue it in the same
  request (201 with `build`). The builder opens on "Building the first numbers…". A draft with no
  snapshot (new, or from before this change) starts a recompute when opened; Publish stays disabled until
  one exists.
- **Dates on the server.** "Period not over" is `now < rangeEndUtc`, computed in `GET /:id`. The custom
  default starts the day after the series' last report (else yesterday minus six days) and ends at the
  earlier of start + that report's length − 1 and yesterday, in the campaign time zone.
- **Period wording.** `periodPhrase(weekStart, weekEnd)` counts civil days (`daysBetween` in
  [goalProgress.js](../server/src/services/reports/goalProgress.js), so a DST week is 7 days) and returns
  "this week", "that day" or "in these N days", plus the noun the other strings need. It is used on the
  report page and PDF; the hub and the copy-ready message, read later, use the dates. Every weekly
  string goes through it: the KPI pill and the "No new … this week" lines, the quiet-week banner, the
  Voters surveyed and goal help, the map's "No mapped doors for this week", the hub's heading, and the
  PDF's title, quiet-week line and filename.
- **When the numbers stop early.** If `statsComputedAt < rangeEndUtc`, the report, its hub row and the
  PDF say "Numbers through Oct 24 — the period was still running" (`numbersThrough`, a date).
- **No tiling claim.** Weekly "+N" figures don't add up to the running total for doors, homes or voters.
  The Doors knocked and Homes knocked help text gets the caveat Voters surveyed already has. The list
  marks gaps between consecutive reports of a series, about dates only, never days not yet reported.

### F11. The client map's payload

- **`GET …/map`** returns, for a pins report, a compact, address-free payload: `{ snapshotKey, lng, lat,
  status, answers: { <questionKey>: [optionIndex …] }, extent }`, columnar arrays whose positions are the
  rows' `seq` (legacy rows not yet backfilled are ordered by `_id`, which the backfill reproduces). No
  ids of any kind: about 26 bytes a door before gzip, so 100,000 doors is roughly 2.6 MB (0.7 MB
  gzipped), measured.
- **`GET …/map/doors?snapshotKey=…&rows=…`** (at most 200 positions) returns the street line, city,
  state and answer labels for those positions, read with `{ clientReportId, snapshotId: <live>, seq: {
  $in: rows } }` and stripped to `mapKeysFor`. A key that isn't the live one → **409 `MAP_UPDATED`**
  ("This report was just updated — reload"). Positions mean nothing outside this report's live snapshot,
  so nothing can be enumerated across reports; within a report, a link holder can page through every
  address, as `/map` allows today.
- Filters and counts run in the browser over the arrays, so "N of M doors" is exact. Pins are drawn with
  a zoom-aware circle radius, never merged. The admin preview uses the same shape.
- The map opens on `extent`. Below `md` it uses `cooperativeGestures` (mapbox-gl 3.23), the filters move
  to a drawer, and the door details sit below the map.

### F12. Models, indexes and cascades

| Model | Change | Indexes |
|---|---|---|
| `ClientReport` | `seriesId`, `scope`, `snapshotId`, `snapshotKey`, `snapshotInputs`, `statsComputedAt`, `editVersion`, `takenDownAt/By`, `build`, `extent`, `areaCellCount`, `earlierTotals`, `arrivedDuringBuild`, `contentEditedAt/By`, `numbersRefreshedAt/By`, `copiedFrom`, `copiedNotesReviewed`, `nextReportId`, `views`, `visibility.mapMode/areaSize` (`openMockFlagsAtPublish` already exists) | none new |
| `ClientReportSeries` | new | five partial-unique indexes (§F4) |
| `ClientReportMapPoint` | `snapshotId`, `seq` | `{ clientReportId, snapshotId, seq }` (not unique) — existing collection, so `migrate:build-indexes` |
| `ClientReportAreaCell` | new | unique `{ snapshotId, h3 }`, `{ clientReportId, snapshotId }` |
| `ReportShareLink` | `credentialVersion`, `passwordMeetsRule` (no default), `failedUnlockAt` (the rolling list of the last 24 hours' wrong passwords, §O7), `failedUnlocksTotal`, `failedByDay`, `lockedUntil`, `lastLockedAt`, `lifetimeStartAt` | none new |
| `OrgBranding` | new | unique `{ organizationId }` |
| `CampaignChange` | `source` enum gains `'client_report'`; `erasedAt`, `erasedBy` | none new |

- **Indexes on the three new collections** are built at boot by both the web and the worker
  (`syncIndexes`, awaited before the web listens; idempotent, and the collections start empty), because
  the web dyno writes them. The `ClientReportMapPoint` index goes through `migrate:build-indexes`.
  [buildIndexes.js](../server/src/migrations/buildIndexes.js) gets a per-model try/catch.
- **Cascades.** The campaign cascade gains `ClientReportAreaCell` and `ClientReportSeries`; `ORG_SCOPED`
  gains those and `OrgBranding` (never in the campaign cascade: it has no `campaignId`).
  `LATE_WRITE_MODELS` gains `ClientReportMapPoint` and `ClientReportAreaCell`.
- **The demo seed** ([seedDemoOrg.js](../server/src/services/platform/seedDemoOrg.js)) builds its report
  with the new builder, and its reset also deletes cells and series.

### F13. Endpoints

| Endpoint | New or changed |
|---|---|
| `POST /admin/client-reports` | Changed: series (new or existing), explicit keys, claims a recompute (201 with `build`) |
| `GET /admin/client-reports` · `GET /admin/client-reports/:id` | Changed: series, build state, taken-down state, views, flags |
| `PATCH /admin/client-reports/:id` | Changed: targeted `$set`, published edits and removals, `NEEDS_REFRESH`, switch to areas (claims a remap) |
| `DELETE /admin/client-reports/:id` | Changed: cells, `nextReportId`, build cancel |
| `POST /admin/client-reports/:id/recompute` · `/refresh` | Claim a build (202 with `build`) |
| `GET /admin/client-reports/:id/build` | New: state, progress, queue position |
| `POST /admin/client-reports/:id/refresh/apply` · `/refresh/discard` · `/build/cancel` | New |
| `POST /admin/client-reports/:id/publish` | Changed: freezes the previewed snapshot (no build) |
| `POST /admin/client-reports/:id/take-down` · `/put-back-up` | New (replace `/unpublish`) |
| `POST /admin/client-reports/:id/preview` | New: overlay preview through the public shapers |
| `GET /admin/client-reports/:id/preview/map` · `/preview/map/doors` · `/preview/areas` | Read the live snapshot |
| `POST /admin/client-reports/:id/next` | New, idempotent |
| `GET/POST/PATCH /admin/client-reports/series` | New: picker, create, rename, change crews, end, continue |
| `POST/PATCH /admin/client-reports/shares…` | Changed: password rule, expiry, extend, renew, unlock, `cv` |
| `GET /admin/campaigns/:campaignId/history` · `POST …/history/:rowId/restore` · `/erase` | Changed / new |
| `PUT/GET/DELETE /admin/branding/logo` | New |
| `GET /share/:token` | Changed: `{ requiresPassword }` only |
| `POST /share/:token/unlock` | Changed: `remember`, failure budget, `passwordMeetsRule` |
| `GET /share/:token/reports` | Changed: names, `hasLogo`; filters taken-down reports |
| `GET /share/:token/reports/:id` | Changed: shaped per §F1; `REPORT_NOT_FOUND`; no longer counts an open |
| `POST /share/:token/reports/:id/opened` | New |
| `GET /share/:token/reports/:id/map` · `/map/doors` · `/areas` · `GET /share/:token/logo` | Changed or new, live snapshot only |

## G. Design: the admin pages

Built from the existing pieces (`Card`, `Badge`, `Button`, `Modal`, `Segmented`, `NextStepBanner`) and
the semantic tokens. Small status text on a tint uses the `text-*-fg` tokens, as `Badge` does. Light
theme only.

### G1. The Client Reports tab

```
┌ Client Reports ───────────────────────────────────────────────────────────────────────┐
│ Reports your client opens from a link.          [ New report ] [ History ]            │
│                                                                                       │
│ ┌ Reports ─────────────────────────────────────────────┐ ┌ Client links ──────────────┐│
│ │ [ Whole campaign ] [ Volunteer team ] [ Paid team ]  │ │ Candidate          Active  ││
│ │                                    [ Edit team ]     │ │ doorline.app/r/e67T… [Copy]││
│ │ Oct 20 – Oct 26  Draft · Queued (1 ahead)            │ │ Expires Jan 21 · Extend    ││
│ │ Oct 13 – Oct 19  Published · Edited Oct 21           │ │ Last opened Oct 22         ││
│ │ 3,412 doors (+412) · 1,980 surveys (+260)            │ │ Password · Rotate · More ▾ ││
│ │ Opened via Candidate: about 2 visits                 │ │ [ + New link ]             ││
│ │ [Open] [Next report] [Copy message] [More ▾]         │ └────────────────────────────┘│
│ │ ── Oct 8 – Oct 12 not covered by any report ──       │ ┌ Report branding ───────────┐│
│ │ Sep 29 – Oct 5   Taken down Oct 22 · Put back up     │ │ [logo]  Change · Remove    ││
│ └──────────────────────────────────────────────────────┘ └────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- Reports newest first; a gap line sits only between two reports of the series.
- Build states on rows and in the builder: **Queued (n ahead)**, **Waiting** ("for the answer edit on
  this campaign to finish"), **Building n%**, **New numbers ready to review**, **Failed** (reason +
  Retry), **Stalled** (+ Retry), and **Team changed** (the §F4 card, never Retry). Queued and Waiting
  offer **Cancel**.
- **Next report** appears only on the latest report of each tab. **More ▾**: Take down or Put back up,
  Delete (on a shown report the warning names the links it shows on; on a taken-down one it says the
  client already can't see it).
- Below `lg`, the right column stacks under the reports.

### G2. New report and teams

```
┌ New report ──────────────────────────────────────────────────────┐
│ Covers       (•) Whole campaign                                  │
│              ( ) A team   [ Volunteer team ▾ ]  or  [+ New team] │
│                           Crews: Maria's crew                    │
│              [ ] Only one walk list  [Choose ▾]                   │
│ Period       [Oct 13] – [Oct 19]   7 days                        │
│              Starts the day after your last Volunteer team report│
│ Title        [                              ]  optional          │
│                                     [Cancel]  [Create draft]     │
└──────────────────────────────────────────────────────────────────┘
┌ New team / Edit team ────────────────────────────────────────────┐
│ Name your client sees  [ Paid team                ]              │
│ No canvasser names — the client sees this.                       │
│ Crews  [x] Sam's crew   [x] Dee's crew   [ ] Maria's crew        │
│                                    (in Volunteer team)           │
│        Former: Lee's crew — no longer coordinates here           │
│        Past doors kept: Pat (left Oct 2)                         │
│                       [ End this team ]  [Cancel]  [Save]        │
└──────────────────────────────────────────────────────────────────┘
┌ Paid team changed ───────────────────────────────────────────────┐
│ Dee no longer runs a crew on this campaign.                      │
│ (•) Keep her past doors in Paid team                             │
│ ( ) Remove them — earlier totals drop by 1,400 doors             │
│ [ Change crews ]  [ End this team ]       [ Continue ]           │
│ Her canvassers now have no coordinator: see the Team tab.        │
└──────────────────────────────────────────────────────────────────┘
```

"A team" is disabled with the reason when the org isn't ready for teams. A name that a canvasser's name
appears in is refused with "Team names can't include a canvasser's name".

### G3. The builder, on a draft

```
┌ ‹ All reports ─────────────────────────────────────────────────────────────────────────┐
│ Oct 20 – Oct 26  [Draft]  Team: Volunteer team                  Saved · just now       │
│ Numbers as of Oct 27, 9:14 am · Recompute                               [ Publish… ]   │
├───────────────────────────────────────────┬────────────────────────────────────────────┤
│ BEFORE YOU PUBLISH                        │ PREVIEW: exactly what your client sees      │
│ ! 3 unreviewed mock-GPS flags   [Review]  │ [logo] Fall 2026 · Fox Bryant              │
│ ! 3 knocks arrived during this build —    │ Oct 20 – Oct 26 · Team: Volunteer team     │
│   Recompute to include them               │ Doors knocked 3,412   +412 this week       │
│ ! "Yard sign?" chart: its total shows how │ Earlier totals were updated by −20 doors   │
│   many said Yes to a hidden question      │ since the Oct 13 – Oct 19 report.          │
│ i Earlier totals changed: the Oct 13 –    │ …                                          │
│   Oct 19 report sent 1,200 doors, now     │                                            │
│   1,180 (canvassers changed teams)        │                                            │
│ i 6 canvassers · 14 door visits by more   │                                            │
│   than one team                           │                                            │
│ i 12 of 980 surveys edited by an admin    │                                            │
│ [ ] I've reviewed the copied notes        │                                            │
│ OBSERVATIONS                [+ Section]   │                                            │
│ SURVEY QUESTIONS           Show: All·None │                                            │
│ Question                 Chart  Map  Headline                                          │
│ Support for Smith?        [x]   [x]   (•) │                                            │
│ Back the recall?          [ ]   [–]   ( ) │                                            │
│ Yard sign?                [x]   [–]   ( ) │                                            │
│   Asked only after Yes to "Back the       │                                            │
│   recall?" — map it with that question    │                                            │
│ MAP  [x] Show the map                     │                                            │
│      (•) Exact doors ( ) Areas [Small ▾]  │                                            │
│      Map preview is from 9:14 am, before  │                                            │
│      your map changes — Recompute         │                                            │
└───────────────────────────────────────────┴────────────────────────────────────────────┘
```

- **Auto-save** after 800 ms of quiet, through targeted PATCHes. The preview uses `POST /:id/preview`
  with the on-screen state, shaped by the server.
- **Leaving.** There is no data router (`<BrowserRouter>`, so `useBlocker` can't be used). The builder
  guards its own Back and tab links, flushes a pending save on unmount with `fetch(…, { keepalive: true
  })`, and sets `beforeunload` while a save is pending or failed. On a published report, an unapplied
  edit is kept in `localStorage` and offered back ("Restore your unsent edit").
- Every action reports errors in a banner under the header.

### G4. The builder, on a published report

```
│ Oct 13 – Oct 19  [Published · Edited Oct 21]   Opened via Candidate: about 2 · Consultant: about 1 │
│ [ Edit ]  [ Refresh numbers ]  [ Copy message ]  [ Take down ]                                      │
```

**Edit** unlocks the left column and previews the edit before **Update report** sends it. **Switch to
areas** confirms: "Your client keeps seeing exact doors until the areas are ready. Going back to exact
doors later means refreshing the numbers." Additions to the map read "Add this with Refresh numbers".
Removing the map asks first. Refresh is disabled while an edit is open.

```
┌ Refresh numbers? ────────────────────────────────────────────────┐
│ Also add to the map:  [ ] Turn the map on  [ ] Bond measure?     │
│                       [ ] Back to exact doors  [ ] Large areas   │
│ Rebuilt from records as of Oct 28, 3:10 pm, for Oct 13 – Oct 19. │
│                       Now        After                           │
│ Doors knocked         3,412      3,420   (+8)   +412 → +420      │
│ Surveys taken         1,980      1,983   (+3)                    │
│ Voters surveyed       1,702      1,704   (+2)                    │
│ Connection rate       58%        58%                             │
│ Contact breakdown, support split, voter groups, door goal  [▾]  │
│ Doors on the map      2,101      2,109                           │
│ Numbers move when knocks arrive late, answers are edited or      │
│ unknocked, or canvassers change teams, since these numbers were  │
│ taken.                                                           │
│ Your client sees the new numbers as soon as you apply them.      │
│                                        [ Discard ]  [ Apply ]    │
└──────────────────────────────────────────────────────────────────┘
```

### G5. Publish

```
┌ Publish this report? ────────────────────────────────────────────┐
│ ! This period ends Oct 26 and isn't over yet (Eastern time).     │
│ ! Numbers are from 9:14 am.               [ Recompute first ]    │
│ ! 3 unreviewed mock-GPS flags are in this report's numbers.      │
│ ! The notes were copied from Oct 13 – Oct 19.                    │
│ • Your client sees exactly the preview.                          │
│ • It shows on 2 links: Candidate, Consultant.                    │
│                                        [ Cancel ]  [ Publish ]   │
└──────────────────────────────────────────────────────────────────┘
```

**Recompute first** starts the build; when it's done the preview updates, and the owner reviews it and
presses Publish again. When no link is usable the last line names why and the fix: "No link yet —
create one", "Your only link expired — renew it", "Your only link is locked — unlock or rotate it",
"Your only link is disabled — enable it". If a recompute is queued, publishing the previewed numbers
cancels it.

### G6. The copy-ready message

Offered on every published report that isn't taken down, for usable links only (active, unexpired,
unlocked; a select when there are several); otherwise disabled with the same reason as G5. Built from
the shaped report and the campaign type:

> The Volunteer team report for Oct 13 – Oct 19 is up: 3,412 doors knocked so far (+412 in that period)
> and 1,980 surveys (+260). Open it here: https://doorline.app/r/…/reports/… — use the password I sent
> you.

It deep-links to the report, names the scope and the dates, and never contains the password.

### G7. Client links

```
┌ New client link ────────────────────────────────────┐   ┌ Link ready ─────────────────────────────────┐
│ Label     [ Candidate                ]              │   │ Send the link and the password separately.  │
│ Expires   [ 90 days ▾ ]  30 · 90 · 180 · 365         │   │ Link      doorline.app/r/e67T…  [Copy message]│
│ Password  (•) Generate a strong one                 │   │ Password  k7Hq9mXr2wPz          [Copy]       │
│           ( ) Set my own [            ] 12+ chars   │   │ Shown once. Lost it? Change password.        │
│                          [Cancel] [Create link]     │   │                                    [Done]    │
└─────────────────────────────────────────────────────┘   └──────────────────────────────────────────────┘
```

Row states: **Active**, **Disabled**, **Expires in 5 days** (also warned in the publish confirm),
**Expired** (**Renew**: "gives this link a new address — send your client the new link"), **Wrong
passwords** ("12 wrong passwords since Oct 24, 9:12 am"), **Locked** ("Locked until Oct 25, 9:12 am
after 50 wrong passwords. Devices already signed in still work · Unlock now"; locked again within a day
of the last lock adds "Someone else may have this link — Rotate"), **Short password** ("shorter than 12
characters — change it", only when known), and for legacy links **No password** and **Never expires**.
**Extend** shows the resulting date and offers only later ones, up to a year from when the link was made.
"Last opened" means the password was accepted.

### G8. Report branding

A card on the tab: the logo, **Upload** and **Remove** for admins (any image; converted and shrunk in the
browser), plain errors, and "Set by an admin" or "No logo yet" for leads.

## H. Design: the client's pages

### H1. Password gate and errors

```
┌──────────────────────────────────────────┐
│                 Doorline                 │
│   A report has been shared with you.     │
│   Enter the password you were given.     │
│   [ ••••••••••••••• ]                    │
│   [ ] Keep me signed in on this device   │
│   [ View report ]                        │
└──────────────────────────────────────────┘
```

One handler for every share call:
- **401** → the gate: "This link needs its password. If it no longer works, ask the person who sent it
  — it may have changed." The cached meta is refetched, so a legacy open link that gained a password
  shows the gate. A remembered token is dropped.
- **404 `SHARE_NOT_FOUND`** → "This link isn't available. It may have been replaced or switched off —
  ask the person who sent it." The remembered token is dropped.
- **410** → the server's message ("ask them to renew it"); the remembered token is dropped.
- **429** → "This link is locked after too many wrong passwords. Try again tomorrow, or ask the person
  who sent it."
- **404 `REPORT_NOT_FOUND`** → "This report was taken down or replaced — see all reports." The session
  is kept.
- **404 `MAP_NOT_SHARED`** → the map section is hidden; the session is kept.
- **409 `MAP_UPDATED`** → "This report was just updated — reload."
- Network or server errors → "Couldn't load — Try again".

### H2. The hub

```
┌ [org logo]  Fall 2026 · Fox Bryant                Sign out on this device ┐
│ [ Whole campaign ▾ ]                                                       │
│ LATEST  Oct 13 – Oct 19 · Whole campaign              Edited Oct 21        │
│ Doors knocked 3,412  +412 (Oct 13 – Oct 19)   Surveys taken 1,980  +260    │
│ Doors knocked in each report: 2,104 … 3,412  ▁ ▂ ▃ ▅ ▆ ▇                   │
│ Oct 13 – Oct 19    3,412 doors  +412    Edited Oct 21                  ›   │
│ Oct 6 – Oct 12     3,000 doors  +380                                   ›   │
│                                                   Powered by Doorline      │
└────────────────────────────────────────────────────────────────────────────┘
```

Scope tabs (a select on phones) appear when more than one series has reports; Whole campaign is the
default. LATEST, the trend and the list follow the selected series. The trend states what it plots, its
first and last values, and has an `aria-label`. With no reports to show, the hub says "No reports are
available on this link right now."

### H3. A report

Desktop is today's page plus the logo header, the scope label, "Published Oct 20", "Edited Oct 21" and
"Numbers refreshed Oct 28" (later first, as dates), the "Numbers through …" note, the "Earlier totals
were updated …" line, **Older** / **Newer** within the series, the team note on team reports, and the
period phrase. On a phone:

```
┌──────────────────────────────┐
│ [logo] Fall 2026    Sign out │
│ ‹ All reports  Older · Newer │
│ Oct 13 – Oct 19              │
│ Team: Volunteer team         │
│ Published Oct 20 · Edited    │
│ Oct 21              [ PDF ]  │
│ ┌ Doors ──┐ ┌ Surveys ┐      │
│ │ 3,412   │ │ 1,980   │      │
│ │ +412    │ │ +260    │      │
│ └─────────┘ └─────────┘      │
│ WHERE WE'VE BEEN [Filters 2] │
│ ┌──────────────────────────┐ │
│ │ map (two fingers to pan) │ │
│ └──────────────────────────┘ │
│ 412 Elm St · Surveyed        │
│ Support for Smith?   Yes     │
└──────────────────────────────┘
```

The support card's subtitle reads "N answers" (single choice) or "N selections" (multiple choice). The
"+N" pill and the hub's deltas use `text-success-fg` on the tint, which passes contrast.

### H4. Area view

Hexagons shaded by doors reached, with a legend that includes "answers hidden here", drawn in their own
style, never as 0%. Tapping one: "38 doors reached · Surveyed 21 · Didn't answer 12 · Declined to
participate 5", using the report's own labels, then the answer counts for each single-choice map question
shown there. An answer filter recolours areas by matching answers ÷ that question's answering homes in
the area. The map opens on the cells' extent.

### H5. PDF

The logo top left; the scope label, period phrase, and published, edited and refreshed dates in the
header; "Numbers through …" and "Earlier totals were updated …" when they apply; the team note;
"Powered by Doorline" in the footer; no map. The filename carries the campaign, scope and both dates.

## I. Privacy and legal

**These fixes make what our Privacy Policy says about published reports true again.** privacy.html line
101 says the map shows door statuses "and, where the customer chooses, responses to selected survey
questions, shown at the address level". Today a customer who turned the map off still has address-level
points served behind the link (B1); hidden question names still reach the client (B2, B3, B8); and a
follow-up on the map reveals a hidden question's answers door by door (B9). §F1 fixes all of them, for
published reports too. Gap 34 in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) records them (a)-(f)
and closes when this ships.

| Change | What it touches | Policy text |
|---|---|---|
| §F1 visibility enforced; follow-ups need their parents; live-snapshot readers; payload trimmed; cleanup migration | Less exposed, less kept | Makes line 101 true. No edit. |
| §F0, §F1 civil dates and an opaque map key on the wire | No exact times reach the client | No edit; "exclude … action timestamps" holds more strongly. |
| §F6 expiry picker, one-year life, renew = new URL | "after 90 days by default, or a period of up to one year chosen by an administrator" | Keeps the sentence true. Leads choose expiry too, under the ruling that "administrator" covers them. |
| §F6 `cv` (incl. disable), atomic lockout, nothing before the password | Less exposed | No edit. Terms §6 ("anyone with an unrevoked, unexpired link (and its password) can view the report") is untrue for new devices during a lock, up to 24 hours; it's a risk disclosure, so no edit is proposed. |
| §F6 keep signed in (opt-in, up to 30 days), sign out on this device | A longer-lived token on the client's own device, ended by any credential change | No edit. |
| §F6 `passwordMeetsRule` | Whether a password is 12+ characters, checked at unlock; the password is never stored | No edit. |
| §F4 team reports | Operator-typed names, checked against canvasser names; a one-person team report shows one person's work (the builder says so) | No edit: "exclude … canvasser identities" holds. |
| §F4 earlier-totals line | Tells the client earlier totals moved, without reasons | No edit. |
| §F5 area view | No addresses; single-choice answers only where 5+ homes answered, with extra areas hidden so the hidden group never shows one home's answer; statuses for every area; can be narrowed by other reports | No edit. Optional owner refinement: "shown at the address level" over-describes an area report. |
| §F7 per-link opens | Which link opened which report, about how often, first and last date; members and Doorline staff separately. No IP, no device. | **Owner ruled 10-24: no policy sentence.** The policy's "information collected automatically … the pages … you request, and the date and time" already covers it. |
| §F8 logo | New in-tenant collection, deleted with the org; re-encoded, so no metadata | No edit. |
| §F9 history | Staff names on report and link events; the earlier text of edits, kept in one row each until erased or the campaign is deleted; readable by leads, who may be the client | No edit; recorded as customer-facing, with Erase. |

**No new subprocessor.** H3, jsPDF and the browser canvas run locally, the logo is stored in our
MongoDB, area hexagons are drawn on the Mapbox tiles the map already loads, and Mapbox's Static Images
API is not used. The DPA §6 list is unchanged.

**Deliberately not included:** emailing clients and named recipients (ruled out), recording viewer IP
addresses or devices, pin clustering, rounding counts.

## J. Docs, Help Center and copy

- [CLIENT_PORTAL.md](CLIENT_PORTAL.md): Part 1 and Part 2 rewritten.
- [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): gap 34 closed; item 10 and D11's "Search-engine
  indexing" row (robots.txt is no longer the control); D11's map-point contents and its note that a
  per-door list was not built (`/map/doors` returns up to 200 positions per request, so a link holder can
  page through every address, as `/map` allows today); D11's "expiry cannot be extended", "metadata is
  never gated", "no rate limit or logging" and "password change ≠ revocation" rows; new entries for area
  cells, follow-up dependencies, per-link opens (with the owner's ruling), keep-signed-in,
  `passwordMeetsRule`, history retention and Erase.
- Help Center: [guides/client-reports.md](../server/src/content/help/guides/client-reports.md) (build,
  publish, edit, switch to areas, refresh, take down, teams, area view, links, branding),
  [pages/page-client-reports.md](../server/src/content/help/pages/page-client-reports.md),
  `faq/fix-one-survey-answer.md`, `guides/campaigns-manage.md`, `pages/page-door-outcomes.md` (a
  published report now changes through **Refresh numbers**), `guides/fix-pin-location.md` ("Republish it
  to pick up corrections"), `faq/team-door-counts.md` (team reports don't add up to the campaign),
  `faq/how-many-doors-a-day.md` (no goal on team reports), `faq/canvasser-left-the-team.md` (team reports
  keep a departed lead's past doors by default); new FAQ entries through `_INBOX.md`: "Why did my
  client's link ask for the password again?", "How do team reports work?", "Exact doors or areas?", "Why
  can't this follow-up question go on the map?".
- In the app: `components/outcomes/AnswerEditReviewModal.jsx` ("until you publish it again" → "until you
  refresh its numbers"); `client/src/lib/campaignHistory.js` (labels for the new rows); the comment in
  `PublicReportLayout.jsx` that calls robots.txt the control.
- Marketing: `marketing/CredibilityStrip.jsx` (owner ruling: "Client reports freeze when published.
  Numbers change only when you refresh them, and the report says when."); `marketing/PortalSpotlight.jsx`
  ("optional password · revocable", "just opens it"); `marketing/Faq.jsx` ("can be password-protected",
  untrue since July).
- Operations: [OPERATIONS.md](OPERATIONS.md) (the new queue and its concurrency, `CLIENT_REPORT_BATCH`,
  the nightly sweep in the scheduled-job table).
- Other docs: CAMPAIGNS.md, MAPS.md, DEPLOY_RUNBOOK.md, MARKETING_SITE.md (the robots line), PLATFORM.md
  (the demo "republishes").
- This file gets an "As built" section.

## K. Tests and verification

**Server integration** (extend [reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js),
plus a new `clientReportBuild.int.test.js`):

- **Legacy documents:** raw-inserted reports, points and links with none of the new fields (and a link
  with an explicit `failedUnlocks: null`), through every route: unlock, publish, Put back up, a removal
  PATCH, Extend, the views ping, the hub, Next, earlier totals, `/map` and `/map/doors`. The migration's
  order and both `--keep-legacy-all` paths; positions identical before and after the `seq` backfill.
- Every verified defect (B1-B9), flipped to assert the fix, B9 with a scripted (`visibleIf`) template.
- **Builder parity:** the oracle fixture in §F2, at the default batch and at `CLIENT_REPORT_BATCH=2`,
  options compared by id.
- **Fence and arrivals:** knocks inserted mid-build don't count and are reported; the breakdown still
  equals Doors knocked.
- **Liveness and attempts:** a stall redelivery writes under a new snapshot; a duplicate delivery exits;
  the `failed` listener never touches a `ready` build; an enqueue failure parks it; a lost queued job
  reads not live (`getJobState` → unknown); a waiting build frees its slot, remembers `waitingSince`
  across redeliveries and fails `BLOCKED` after 30 minutes; a dead build never blocks Publish, Apply or a
  claim; Cancel replaces `build` and every worker write then misses.
- **Commit misses:** `SUPERSEDED`, `build.snapshotId` cleared, rows deleted only when not live.
- **Deletion mid-build** with the real `deleteOrganization()` and `deleteCampaign()` leaves no rows.
- **Changes mid-build:** each source in step 7 triggers the one rebuild; a build that waited for a change
  doesn't count it again; a change still in flight sends it back to waiting; a second finished change
  fails it.
- **Sweep:** spares live, live-build and `ready` rows (including a ready "turn the map on" result) and
  any snapshot newer than its read; deletes orphans, map-off rows and superseded legacy rows; the cut is
  in seconds.
- **Publish:** freezes the previewed snapshot and cancels a queued recompute; `RECOMPUTE_NEEDED` for
  additions (map question, map on, mode, size, coordinators); `SNAPSHOT_CHANGED`; `SAVING`; no publish of
  a published report.
- **Take down:** hides from every share route, keeps numbers and `publishedAt`, cancels builds; Put back
  up restores it unchanged; no route returns it to draft.
- **Refresh:** each addition (map on, a map question, large areas, back to exact doors) → Apply → served;
  Discard deletes only after its CAS; Take down, Delete, map-off and a new claim invalidate a `ready`
  result; a refresh of a team report uses its frozen coordinators.
- **Switch to areas:** the client sees pins until the remap commits; a failed or cancelled remap changes
  nothing; a draft with a mode mismatch can't publish.
- **PATCH:** no lost update against a concurrent commit; removals during a build stick (and prune
  `build.inputs`); `$pull` of a dropped key and its follow-ups.
- **Series:** the five indexes under concurrency (two non-team series in one campaign; a team on a walk
  list; a crew in two teams refused); `TEAM_LABEL_HAS_NAME` on team, walk-list and combined labels;
  `TEAM_CHANGED` with keep, remove, change crews and end; continuing an ended team; several crews in one
  team; the readiness 400; `team_walk_list` following its parent.
- **Earlier totals:** the comparison report skips taken-down ones; visible cards only; the "since"
  clause drops when the earlier report is taken down later.
- **Team numbers:** parity with `/team-breakdown` (doors, outside lead-only windows) and the
  crew-filtered rollup; the team map's own answers; a restricted door; no goal; scoped mock-GPS counts.
- **Area:** no point rows; single-choice only; the 5-home rule with extra hidden areas until the hidden
  group isn't unanimous; the unattainable case gives no area answers and a warning; extent from cells;
  remap keeps the numbers and is exempt from the team check.
- **Map readers:** an unapplied refresh serves nothing; a remap's leftover points are never served;
  `/map/doors` with a foreign or stale key or out-of-range rows returns nothing; 409 before 404.
- **Links:** password length; `passwordMeetsRule` set at unlock; `cv` 0→1→2, a fresh unlock at 0, first
  password on a legacy link, disable ends tokens; 300 concurrent wrong guesses → 50 compares; the lock
  lasts 24 hours and then admits the right password; an Unlock now during the 50th compare isn't undone;
  the guarded refund; remembered tokens survive a lock; the lifetime cap; renew changes the URL; extend
  never shortens; meta returns only `requiresPassword`; every 404 has a code; `/logo` 204.
- **Opens:** staff, admins, leads and other members bucketed; an ended session counts under the link; no
  `updatedAt` bump.
- **History:** client-report rows absent from the default response (identical to today's, cap
  included), present only with `include=client_reports`; each text version in one row; Restore by id;
  Erase, including "all earlier text", and a stale Restore of an erased row refused; no secrets in link
  rows.
- **Branding:** PNG passes and is re-encoded; JPEG, SVG, oversize, a huge `IHDR`, an inflation bomb, a
  second zlib stream, a second `IHDR`, a bad filter byte, a misplaced `tRNS`, an `IDAT` after `IEND`, a
  bad CRC and a zero-width image all fail; `/logo` needs access; a bad logo doesn't break the PDF; the org
  cascade removes it.
- **Next:** double click, month roll, DST, a deleted draft, series re-validation.
- **Headers:** `X-Robots-Tag` on `/r/tok3n` (beside the existing test in `staticPages.int.test.js`) and
  on `/api/share`.

**Client:** `reportDerive` tests for `periodPhrase` (a DST week is 7 days), every routed string, the
support subtitle, the earlier-totals line and the copy message; render smoke tests for the per-question
rows (including a follow-up), the link badges, the team-changed card, the gate's states and the area
legend; an effects test (auto-save, the error handler, keep signed in, sign out) on the pattern of
`client/src/lib/doorOutcomesEffects.smoke.test.js`.

**Verification before hand-over:** re-run the review rounds' probes against the built tree; seed a
**synthetic** campaign the size of Collier and time a build while watching the worker's memory; walk
every screen above in the browser, at phone width too.

## L. Rollout

1. **Before deploying:** `npm run audit:mobile-api` (the history route changes; the phone's response is
   unchanged). Tell the owner that open drafts will need a recompute before they can be published, and
   that reports unpublished under today's code are drafts and come back through a recompute.
2. Server deploy from `main`; the web build and Help Center ride along. No OTA, no client-version gate.
   The web and worker build the new collections' indexes at boot.
3. Heroku dashboard → **More → Run console**: `npm run migrate:build-indexes` (dry run). It should include
   the new `ClientReportMapPoint` index; then `npm run migrate:build-indexes -- --apply`.
4. Same console: `npm run migrate:client-report-visibility` (dry run). Decide on the listed reports whose
   operator unticked every question, glance at the walk-list labels it flags, then `npm run
   migrate:client-report-visibility -- --apply` (add `--keep-legacy-all` to keep those charts).
5. Owner checks: map off on an existing published report → no map, `/map` 404; an existing link still
   unlocks; an existing report's map still shows door details; a team report beside the dashboard's team
   numbers; a password change signs out an open tab; Take down and Put back up; Refresh numbers with an
   addition.

## M. Review plan and recommendation

Four plan rounds ran on 2026-10-24 (§N). Rounds 3 and 4 each found one blocker, both an interaction
between the previous round's fix and an older rule, and majors that were narrower each round; none of
the previous round's fixes was missing. **The owner approved building after round 4, followed by two
code-review rounds** (§E). Code review can drive the real implementation and the tests in §K.

## N. Review log

**Round 1.** Five reviewers (concurrency and integrity, numbers, privacy and security, an owner
walkthrough, simplicity and feasibility). About 90 findings, 12 marked blocker; many found by two or
three reviewers independently; each blocker and major checked against the code before acceptance. What
changed because of them:

- **Deletion:** a build could write a deleted organization's addresses after the cascade (reproduced).
  Now: deletion checks, `sweptAfter`, orphan sweep.
- **Consistency:** chunked reads broke "the breakdown adds up to Doors knocked" (reproduced). Now: one
  fold, a fence, an invariant check.
- **Retries:** duplicate rows, a never-reclaimable lost job, unmarked failures, delete filters that
  could wipe legacy rows (reproduced). Now: per-attempt snapshots, heartbeats, failure marking, exact
  deletes.
- **Changes during a build:** re-cuts, relabels and re-stamps were missed. Now checked.
- **Refresh** could roll a newer publish back; map additions had no path. **Publish** froze numbers nobody
  previewed. Now one `build` object, a Refresh dialog that carries map changes, and a Publish that
  freezes the previewed snapshot.
- **Privacy:** two more hidden-key leaks (B8); Extend would have made the expiry sentence false; a
  non-atomic lockout; an overstated area promise; a `cv` precedence bug; logo bombs; a server-side map
  filter that would answer questions about hidden answers.
- **Numbers:** team overlap (owner chose "each team's own work"), weekly "+N" not tiling, the support
  subtitle's unit, `distinct` vs `$group` nulls, scope-blind mock-GPS counts.
- **Walkthrough:** team series on coordinator changes, scope-blind hub and message, "Updated" hiding a
  refresh, missing build states, client error handling, phone usability, misleading open counts, copy
  elsewhere that would become false.
- **Simplicity:** dropped a views collection, a history collection, the publish build, `/hub`,
  `questionsMode`, viewport paging and the "Start from" radio.

**Round 2.** Three reviewers on what round 1 changed. Of round 1's 90 fixes, 70 had landed cleanly, 19
partly and one was missing. A prototype of §F2's fold reproduced today's numbers exactly on a 26-door
fixture. Two blockers (every existing link would have stopped unlocking; Take down was a back door to
change a sent report) and about twenty majors: the state machine (stuck builds, slot-holding waits, an
empty published map), the team map showing the other team's answers, public map readers not limited to
the live snapshot, guessable door ids, a lockout that lasted a day, a lone small area recoverable from
one report, History reaching the phone garbled with no Erase, a malicious logo breaking every PDF, and
team series that dead-ended when crews moved.

**Round 3.** Three short reviews of what round 2 changed (mechanics, privacy and security, coverage with
a walkthrough). Of round 2's 51 fixes, 33 landed cleanly, 18 partly and none was missing. Findings, each
checked against the code or reproduced on MongoDB 7.0.2:

- **Blocker:** Apply and the refresh commit intersected the result with the report's current settings,
  so every map addition a Refresh carries was thrown away; "back to exact doors" blanked the client's
  map (reproduced in four cases). Now `build.inputs` is the build's target, and nothing intersects it.
- **Old documents:** legacy map points had no `seq`, so tapping a door on any existing report found
  nothing (reproduced); existing reports had no series; Mongoose defaults hid missing fields in
  JavaScript checks; an explicit null counter made every unlock fail with 500 (reproduced). Now: a
  migration step for series, `seq` and `extent`, explicit fallback helpers, and `$ifNull` counters.
- **Series:** the crew index refused a second non-team series in any campaign and every team-on-a-walk-
  list (reproduced); removing a departed crew lead dropped her crew's history; a refresh of a sent team
  report would have rebuilt it with today's crews. Now: indexes per kind, a parent link for team walk
  lists, past coordinators kept by default, frozen crews for refreshes, an Edit team screen.
- **State machine:** a build that waited for a change failed its own change check afterwards
  (reproduced); cancels only worked if the whole `build` object was replaced (reproduced); failed builds
  left rows behind; the `failed` listener could lose a ready review; switching to areas could leave the
  client a blank map.
- **Privacy:** a follow-up question revealed its hidden parent door by door, in today's code too (B9,
  verified); the area rule still revealed each hidden home whenever the hidden homes agreed (simulated,
  53% of reports on a 90/10 question), now closed by hiding until the hidden group isn't unanimous; the
  lockout could be stretched to about 100 guesses and an unlock mid-compare undone (reproduced); exact
  times leaked through `statsComputedAt` and the snapshot's ObjectId; Erase left copies of the text in
  other rows; five more malformed PNGs passed the logo check (verified), now closed by re-encoding.
- **Walkthrough and copy:** taken-down reports still offered in the message and the earlier-totals line,
  publish-while-queued with no way out, lock wording, a nag on every existing link's password, and more
  copy in the Help Center and operations docs.
- **Found in passing, outside this plan:** the dashboard's team views disagree about desk-entered
  (`bulk`) knocks, and the marketing FAQ still says reports "can be password-protected".

**Round 4.** Three short reviews of what round 3 changed (mechanics, privacy and security, coverage with
a walkthrough), probes on MongoDB 7.0.2 with the repo's Mongoose. Of round 3's 37 distinct fixes, 18
landed cleanly, 19 partly, none missing. One blocker (a map question removed on a draft, or a map turned
off before publishing, came back at the first Refresh, because draft removals never pruned the snapshot's
inputs) and about a dozen majors, most verified: the migration overwrote what the new code wrote between
deploy and migration; Cancel or Take down could delete a pre-upgrade report's live map; the series
indexes refused a second team on one walk list, two teams that both lost their leads, and repeated
walk-list names, and let a returning crew lead count in two teams; follow-up dependencies taken from
today's template were defeated by a survey edited mid-campaign; the area rule's own stopping point leaked
a lone home's answer (owner then chose all or nothing per question); a follow-up's area cells revealed its
parent's hidden ones; History rows had no declared report id, and Erase raced Restore. All are amended in
§O.

## O. Round 4 amendments (override earlier text)

### O1. Removals and the map's settings

- **One removal path** for drafts and published reports: turning the map off, dropping a map question,
  hiding a question's chart, and dropping a question a mapped follow-up depends on. At PATCH time it
  prunes `snapshotInputs`, any live or ready `build.inputs`, and the stored rows (`$pull` answers, or
  delete all rows when the map goes off), then writes `visibility`.
- **Readers serve the intersection** of the report's current settings and its snapshot: the map shows
  only when `visibility.showMap && liveInputs(report).showMap`, and map questions are `mapKeysFor(report)
  ∩ liveInputs(report).mapKeys`. Neither side alone can put something on the client's page.
- **A Refresh's base** is the report's current settings (`visibility`, pruned), plus the additions it
  carries. That set becomes `build.inputs`.
- **Commits and Apply are pipeline updates that read `$build.inputs` inside the write.** The commit
  re-reads the inputs after its last row insert, `$pull`s anything outside them, and pins them in its
  CAS (`'build.inputs.mapKeys': { $all: […], $size: n }`), retrying on a miss, so a removal that lands
  during a build is never undone. A removal PATCH also `$pull`s from a live build's rows.
- **Claiming over a `ready` result** is refused with **409 `REVIEW_PENDING`** ("New numbers are waiting
  for your review — apply or discard them first"), never a silent discard. `REPORT_BUSY` copy names the
  state (queued, waiting, running); Cancel is offered while running too. Publish while a recompute is
  queued or running says so: "A recompute is queued — wait for it, or publish these numbers and cancel
  it" ("running" when it is).

### O2. One discard helper

Cancel, Take down, map-off, Publish's replacement of `build`, the dead-build reset and Discard all call
one helper that deletes a build's rows **only** when the pre-image's `build.snapshotId` is an ObjectId
different from the pre-image's live `snapshotId`. Otherwise it deletes nothing and the sweep handles
leftovers. A legacy report's live rows (`snapshotId: null`) can therefore never be deleted by a cancel.

### O3. Old documents and the migration

- **Every migration write selects only what is missing**: reports `{ editVersion: null }`, `{ status:
  'published', statsComputedAt: null }`, `{ snapshotInputs: null }`, `{ extent: null }`; links `{
  credentialVersion: null }`, `{ lifetimeStartAt: null }`, the failure fields; rows and their `seq`,
  extent and step-5 cleanup only on `snapshotId: null` rows of reports whose live `snapshotId` is null.
  Running `--apply` twice over a collection holding post-deploy documents changes nothing (a §K test).
- **`ensureSeries(scope)`**, one idempotent find-or-create (`findOneAndUpdate` with upsert on the partial
  index's identity, e.g. `{ campaignId, kind: 'campaign', endedAt: null }`), is shared by Create, Next and
  migration step 2, and stamps that scope's legacy reports with `seriesId` and `scope` as it goes. So a
  report created the day after deploy never splits the client's tabs, and the migration never collides
  with series the route already made. The pre-migration fallback key is opaque (a hash, not a raw id).
- **Map rows of old reports** get `seq` (rank by `_id`) and the report's `extent` lazily, on the first
  `/map` or `/map/doors` read of that report (idempotent; the same order the migration uses), so door
  details work the day after deploy. Until then `extent` falls back to the pins' bounds.
- **`numbersCutOff(report)`** (`statsComputedAt ?? publishedAt`) is used everywhere a cut-off is compared,
  including §F10's "Numbers as of" check.

### O4. Series

- **One crew key per team.** `crewKeys = coordinatorIds ∪ pastCoordinatorIds`, stored, with the unique
  index `{ campaignId, crewKeys }` partial on `{ endedAt: null, kind: 'team', 'crewKeys.0': { $exists: true
  } }` (verified: a crew can't be in two teams, current or past; two teams that both lost their leads
  coexist). The picker shows "Past in Paid team" for such a crew.
- **The label index** is unique `{ campaignId, labelKey }` partial on `{ endedAt: null, kind: { $in:
  ['campaign', 'walk_list', 'team'] } }`; the campaign series gets a fixed `labelKey`. A team on one walk
  list stores no label of its own: its name is derived when read ("Volunteer team · North"), its
  uniqueness is `{ campaignId, teamSeriesId, effortId }`, and it reads as ended when its parent is
  (verified: two teams on one walk list, and one team on two walk lists, both work).
- **Repeated walk-list names** get " (2)", " (3)"… against the campaign's active `labelKey`s at runtime,
  retried on a duplicate-key error from that index. Duplicate-key errors map by index name to **409
  `TEAM_LABEL_TAKEN`** or **409 `CREW_IN_OTHER_TEAM`**, naming the other series.
- **Name check.** Team labels are refused when they contain a canvasser's name (`TEAM_LABEL_HAS_NAME`,
  "Report names can't include a canvasser's name"). A walk-list label that matches one gets a warning the
  operator can confirm ("This is a place, not a person"), because place names often are names; the
  New-report dialog then shows "Name your client sees", prefilled. Walk-list tabs get **Rename**. Next
  doesn't re-check names.
- **Ending and reusing a name.** A name that matches any series with published reports is refused with
  Continue (which re-validates crews the way Change crews does and opens the picker) or "choose a
  different name". After a long gap, Continue's default period is the current week. "End this team" from
  the team-changed card offers to delete that team's open draft.
- **When a crew lead leaves**, the card says what is true: "Her crew's past doors stay in Paid team while
  they have no crew. Moving one into another crew moves their past doors too", with live counts ("3 of 5
  have no crew; 2 joined Sam's crew"). The coordinator-change confirm (`CoordinatorConfirm`) names the
  client-report team whose numbers move. Publish's coordinator comparison uses `crewKeys`. If a past
  coordinator runs a crew again, the next recompute stops and offers "make her crew current in Paid team"
  or "remove her past doors".

### O5. Area view (owner ruling: all or nothing)

- A **single-choice** map question shows answers by area only when **every** area on the report has at
  least five answers to it (`n ≥ 5` in every cell with any answering home). Otherwise the report shows no
  area answers for that question, and "Before you publish" says why and suggests Large areas. The
  decision uses only counts, never answers, so nothing can be worked out from it. This replaces §F5's
  hiding rule.
- **Follow-ups in area view** show area answers only when every question they depend on shows its area
  answers on that report. A follow-up of a multiple-choice question never shows area answers. Every cell
  where a question isn't shown carries one state, "no answers to show", whatever its counts.
- **Tags.** A shown tag carried by an option of a hidden question, or of a follow-up of one, is flagged in
  "Before you publish".

### O6. Follow-up dependencies

- **`SurveyTemplate.depsEver`**: question key → every key it has ever depended on. Create, PATCH and
  Duplicate union into it and never remove (a monotone record), so a condition edited away mid-campaign
  still counts. `questionDeps` is its transitive closure. The migration seeds it from today's `visibleIf`
  and lists templates whose in-scope responses span more than one `surveyTemplateVersion`, whose past
  conditions can't be known; the builder warns on those.
- **Map and cell answers come only from responses of the report's own template** (`surveyTemplateId`),
  as the charts already do, so a duplicated or swapped survey can't bring old answers onto the map.
- A rule that accepts **every** option of its parent carries no information about the parent's answer and
  isn't a dependency. Script-flow surveys, where later blocks formally depend on every earlier branch,
  stay mappable when their rules are of that kind.
- **Builder copy:** "Asked only on some paths through 'Back the recall?' — mapping it shows who took that
  path." The default suggestion is to leave the follow-up off the map, not to map the parent. A follow-up
  that depends on a text question can't be mapped, and says so.

### O7. Share links

- **Failure budget, rolling.** A link keeps `failedUnlockAt`, the last 50 failure times, each with a random
  id. A wrong-password attempt reserves a slot with one pipeline `findOneAndUpdate`: drop entries older
  than 24 hours, and if fewer than 50 remain, push `{ at: now, id }`. No slot → **429 `SHARE_LOCKED`**,
  no bcrypt compare. A correct password removes its own entry by id. So no link ever accepts more than 50
  wrong passwords in any 24 hours, and the lock lasts until the oldest of the 50 is 24 hours old (shown
  as that time). `failedUnlocksTotal` and per-day counts for the last 7 days are kept for the panel.
- **Every lock** shows "Someone else has this link — rotate it" (50 wrong passwords is never the client),
  and so does a week with 50 or more. Rotate and Unlock now clear the list. History gets one row per lock
  and, at most, one per day with 10 or more. Link rows carry no IP address or user agent.
- **429 copy by code:** `SHARE_LOCKED` → "This link is locked after too many wrong passwords. Try again
  later, or ask the person who sent it"; the per-IP limiter's `rate-limited` → "Too many tries from this
  connection — wait 15 minutes."
- `passwordMeetsRule` has **no default**; null means unknown.
- §I's Terms row reads: new devices can be locked out until the link is rotated.

### O8. History

- `CampaignChange` declares `clientReportId`, `shareLinkId` and `periodLabel` (strictQuery dropped them
  when undeclared, verified), with an index `{ campaignId, clientReportId }`. Erase-all works by
  `clientReportId`, including after the report is deleted; Delete's confirm offers to erase its earlier
  text.
- **Edits and Restore write with one `findOneAndUpdate({ … }, { … }, { returnDocument: 'before' })`**, and
  `fromValue` comes from that pre-image, so overlapping edits keep exactly one copy of each version.
  **Erase** increments a report-level `eraseEpoch`; Restore's CAS requires it unchanged (409 otherwise),
  so an Erase landing mid-restore wins. Erase also offers to remove the same text from later drafts that
  Next copied it into, resetting their `copiedNotesReviewed`, and warns when the text is the report's
  current text.

### O9. Smaller

- `firstCheck` becomes **`build.fenceSeen`**, written in the same CAS that sets `fenceAt` (each source
  row in the skew window, by id and `updatedAt`) and rewritten at every fence; step 7 counts only rows that
  are new or changed since. `waitingSince` is unset at the fence, and `BLOCKED` names what is running.
- **Earlier totals are computed when shown**: the build freezes `{ comparedReportId, recomputed cards }`,
  and the line compares them with that report's current frozen cards, only while it is still the
  series' latest shown, published report ending on or before this one's start (tie-break `publishedAt`
  descending, then `_id`). Otherwise the "since …" clause, or the line, is dropped.
- **Copy:** "Numbers as of Oct 24" (not "through"); `REPORT_NOT_FOUND` → "This report was taken down or
  removed"; unticking a parent's Map box says it also removes its follow-ups; the Refresh dialog's map
  options are mutually exclusive where they conflict, its row reads "Areas on the map" on an area report,
  and choosing exact doors or turning the map on warns that street addresses go back in front of the
  client.
- **Wire times:** hub rows send civil dates and no `campaignId`. Report ids in URLs are ObjectIds whose
  time is the draft's creation, not the numbers' cut-off; that exception is named in §F0.
- **PNG:** `IHDR` compression and filter-method bytes must be 0, and the fresh PNG writes them as 0.
- `POST …/opened` is behind `requireShareAccess`. The §F0 counter rule covers every counter that can be
  null.
- **Index definitions are final at first deploy.** Once the new collections hold data, a changed
  partial filter makes the boot-time `syncIndexes` drop and rebuild a unique index on a live collection.

## P. As built (2026-10-24)

Built 2026-10-24 in four stages (server; links, opens and branding; the admin pages; the client's
pages), uncommitted. Code review rounds 1 and 2 of §M are done and their findings fixed (§Q, which also
updates P2 and P3 below, and §R); the owner's walkthrough is next. What was built is documented
in [CLIENT_PORTAL.md](CLIENT_PORTAL.md); the release steps are in [OPERATIONS.md](OPERATIONS.md) →
*Release: client reports upgrade*; the privacy record is [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
items 34 (closed in code) and 38 (what the upgrade stores, shows and keeps), with D11 stamped. Where the
build differs from the plan above, read from the code:

### P1. Decisions the plan left open, settled in the build

- **Turning the map off doesn't cancel a build.** §F3 said map-off cancels any live build or ready
  result. Instead the one removal path prunes `build.inputs.showMap` (and the live snapshot's inputs) and
  deletes every map row of the report at once; a running build keeps going and commits without a map,
  and a ready refresh can still be applied, now without one.
- **Map-off keeps the map-question picks.** §F1 said a key that leaves `mapKeysFor` leaves
  `mapAnswerKeys`. `mapKeysFor` is empty while the map is off, but the PATCH keeps the picks in
  `mapAnswerKeys`; the switch gates them, so turning the map back on brings the same questions back: on
  a draft with a Recompute; on a published report, Refresh numbers offers them ticked and the operator
  can untick any before the build (since code review round 2, VERIFY-1 and VERIFY-2, §R; round 1's
  code wiped a published report's kept picks on any edit, and a Refresh put every one of them on the
  map unseen).
- **"Accepts every option"** (§O6) means every live (non-retired) option of the parent, plus Other when
  the parent has it on: the set the script-flow compiler gates on.
- **`depsEver` is an edge list**, `[{ q, on }]`, not a map keyed by question (a key need not be a valid
  field name). Create writes today's edges, a questions PATCH `$addToSet`s the replaced and stored
  versions' edges, Duplicate copies the union, and the migration seeds it (its step 0).
- **Publish without previewed ids** freezes whatever snapshot and edit version are live. The builder
  always sends them; since code review round 1 the edit version is the one its screen reflects, never
  one learned from a later re-read (§Q, ADMINUX-1).
- **Earlier totals when the compared report changes** (§O9): the whole line is dropped when that report
  is deleted or no longer published, and (since code review round 1, NUM-1) when its numbers were
  refreshed after the later report's build recounted them; only the "since …" clause is dropped when it
  is taken down or no longer the series' latest shown report before this one.
- **The migration's survey listing** (§O6) is `olderVersionTemplates: [{ templateId, from, versions }]`
  since code review round 1: every survey with answers given under a version older than the one its
  `depsEver` record starts at (`SurveyTemplate.depsEverFromVersion`), not only surveys whose answers
  span more than one version (the old `multiVersionTemplates`, which missed a single old version).
- **A map request for the wrong mode** (`/map` on an area report, `/areas` on a pins report) answers
  `409 MAP_UPDATED`, like a stale snapshot key: the page is out of date.
- **Name checks have two codes:** a team label is refused (`TEAM_LABEL_HAS_NAME`); a walk-list label, a
  combined team-and-walk-list label, or a walk-list Rename that matches a canvasser's name gets
  `WALK_LIST_LABEL_HAS_NAME` with `confirmable: true` (§O4's warning).
- **Next on a report that isn't the latest of its series** is refused `409 NOT_LATEST_REPORT` (any other
  report of the series starting at or after its end), beside `NEXT_PERIOD_MISMATCH` and `NEXT_RACE`.
- **`TEAM_CHANGED` is a failed build** whose `build.error` carries `seriesId`, `departed` and `returned`;
  the builder renders the team-changed card from `GET /series/:seriesId/team-changed`.
- **Coverage isn't computed.** Builds store `stats.*.coverage` as `{}`; the client never received it
  after §F1, and nothing on the operator's side read it.
- **What clears what on a link:** Unlock now clears only the 24-hour budget (the entries and
  `lockedUntil`); Rotate and Renew also clear the week's per-day counts, since the advice to rotate is
  about the address that drew the guesses; `failedUnlocksTotal` is never cleared.
- **Extend on a link that never expires** gives it its first expiry and starts its one-year life; Extend
  on an **expired** link is `409 SHARE_NEEDS_RENEW` (renewing gives it a new address); a racing change is
  `409 SHARE_CHANGED`.
- **Disable bumps `cv`** (as §F6 said), and so does the revoke-legacy sweep.
- **Logo refusals carry codes:** `LOGO_NOT_PNG`, `LOGO_INVALID` (400), `LOGO_TOO_LARGE`,
  `LOGO_UPLOAD_REFUSED` (413), `LOGO_REQUIRED` (400). The check drops ancillary chunks and a `PLTE`
  before the image data (the re-encode would drop them anyway) and refuses an unknown critical chunk.
- **`OrgBranding` is not in `LATE_WRITE_MODELS`.** It has no `campaignId`, so a campaign-scoped late-write
  sweep's filter would be stripped by strictQuery and the delete would match every organization's logo.
  It rides `ORG_SCOPED` only.
- **The client's pages are pinned to the light theme** (`theme-light`, the map's filter drawer too).
- **The hub groups every whole-campaign report in one tab**, whatever its series key (a report from before
  series and one after the migration read as one tab).
- **PDF text is folded to printable characters** (the walk packets' `pdfText.js`, now applied to every
  string the report PDF prints), which also fixed a pre-existing dropped en dash.
- **Field names:** `lastLockedUntil` became `lastLockedAt` (the latest lock's start; whether a link is
  locked is read from the entries), §O7's per-day counts are `failedByDay` (UTC days, last 7), and §O9's
  `build.fenceSeen` replaced `firstCheck`. `CampaignChange` also declares `seriesId`.
- **The old `POST /:id/unpublish`** is kept as an alias of Take down, so nothing calling it 404s; it never
  returns a report to draft.
- **Link routes live in their own router**, [clientReportShares.js](../server/src/routes/admin/clientReportShares.js),
  mounted at `/admin/client-reports/shares` ahead of the reports router.
- **Added endpoints:** `GET /admin/client-reports/series/:seriesId/team-changed` (the card's data),
  `GET /admin/client-reports/series/affected` (the teams with reports whose numbers a coordinator change
  moves, for the Team tab's confirm, §O4), and `GET /admin/branding` (the card's facts). New public codes:
  `SHARE_PASSWORD_WRONG` (401), `SHARE_PASSWORD_MISSING` (400), `INVALID_ID` (400), and a coded `404
  NOT_FOUND` for any other `/share` path.
- **Smaller:** the map payload rounds coordinates to six decimal places and adds `mode`, `count`,
  `statusKeys` and a `questions` legend; "Last opened" is stamped at most once a minute per link;
  generated passwords are 12 characters from a 56-character alphabet without look-alike glyphs; the API
  accepts any expiry from 1 to 365 days (the picker offers 30, 90, 180, 365); when a series' last report
  already reaches yesterday, the default period keeps that report's length into the future instead of
  ending before it starts; hub and admin list rows carry `campaignType` (null on reports from before the
  field); `checks.hiddenParentCharts[].parents[]` is `{ key, label, type }`, so a written-question parent
  reads "a written answer to …".
- **The coordinator-change confirm** (`CoordinatorConfirm.jsx`, the web Team page) names the
  client-report teams whose numbers a move changes (§O4), through the new `series/affected` endpoint; the
  phone's member sheet doesn't yet (it needs an app update).
- **The demo seed's share link** follows the one-year life: a reset moves its expiry out to 90 days,
  never shorter and never past the year, and renews it as Renew does (a new URL unless
  `SEED_DEMO_SHARE_TOKEN` pins it) once less than 90 days of the year remain.
- **Known limits:** after a worker crash BullMQ redelivers a build in about 30 seconds (default lock and
  stall timers), and the report reads "running" until then; the `BLOCKED` message's "30 minutes" is
  worded for the default (`CLIENT_REPORT_BLOCKED_AFTER_MS` is a test override). Since code review round
  1: closing the tab, or a Back that leaves the app, doesn't save a pending change (the `beforeunload`
  guard only prompts). Round 1 also listed a change made in the last 800 ms before leaving a draft that
  someone had just published as refused and lost; since round 2 (P-3, §R) it is kept on the device first
  and offered back.

### P2. Not built at first; both built in code review round 1

- **"Before you publish" on team reports** first showed only the period's canvassers for the team and a
  "more than one team" figure that counted crews, not teams. **Built** (contract C1, with NUM-2's fix):
  `checks.team` lists each active team's door visits this period, this report's team first (its frozen
  crews), "Together" with two or more teams, the base scope's door visits (the whole campaign or the walk
  list), the visits two or more teams made and the visits no team made (no crew in a team, or entered
  in bulk), from one aggregation counted the way the build counts doors.
- **Continue's default period after a long gap** (§O4: "the current week"). **Built** as a general rule
  in `defaultPeriod` (reportDates.js): when at least one more whole report-length stretch would stay
  unreported after the natural next period, the dialog suggests the same length ending yesterday and
  names the uncovered days ("Your last Paid team report ended Sep 13. No report covers Sep 14 – Oct 16 —
  change the dates to cover it."). Ended teams also gained "Continue this team" (ADMINUX-10).

### P3. Found while documenting, for the code reviews

- **"N views before per-link counts" double-counted.** `recordReportOpen` kept incrementing `viewCount`
  on every link open, while the panel's `opensLine` labels `viewCount` as views *before* per-link counts.
  **Fixed in code review round 1** (ADMINUX-12): opens no longer move `viewCount` or `lastViewedAt`, so the
  line is a frozen before-the-upgrade number, as §F7 meant ("the old `viewCount` and `lastViewedAt`
  stay"); `clientReportOpens.int.test.js` now pins that it stays still.
- **`migrate:build-indexes` has two indexes to build**, not one (§L step 3 named only the map points'):
  `ClientReportMapPoint { clientReportId, snapshotId, seq }` and §O8's `CampaignChange { campaignId,
  clientReportId }`. Both are on existing collections; OPERATIONS.md's release steps say so.

## Q. Code review round 1 (2026-10-24)

Six reviewers (staff pages, upgrade safety, security, numbers, the build pipeline, the client's pages)
each reproduced their findings against the real app and throwaway databases; every finding below is
fixed in the code, with tests, and documented in [CLIENT_PORTAL.md](CLIENT_PORTAL.md). Severity in
brackets. Round 2 is next.

**Staff pages (ADMINUX)**

- **ADMINUX-1** [high] Publish could freeze text or settings the operator never saw (the screen seeded
  from a stale cached copy, and Publish sent the highest edit version any re-read had seen). Fixed: the
  screen seeds only from a copy fetched after the page opened, tracks the edit version it reflects, and
  Publish sends that one; every re-read is compared with the screen (catch up, keep both, or ask).
- **ADMINUX-2** [high] A draft left open kept auto-saving after someone else published it, so
  half-written text went live with no confirm. Fixed: draft saves send `ifStatus: 'draft'`, the PATCH
  pins the status it read and answers `409 STATUS_CHANGED`; the change becomes an unsent edit of the
  published report, kept on the device.
- **ADMINUX-3** [medium] The builder never saw changes made elsewhere, and Publish looped on `409 SAVING`
  / `SNAPSHOT_CHANGED` with "try again". Fixed: the report re-reads on window focus, and those refusals
  (`REREAD_CODES`) re-read the report, build and preview and say what changed.
- **ADMINUX-4** [medium] A new draft's first numbers built twice when the builder was open as they
  finished. Fixed: the auto-start is judged once per report, only for a draft first seen with no numbers
  and an idle build.
- **ADMINUX-5** [medium] Switching campaign in the sidebar on a report kept it under the other campaign,
  with that campaign's links. Fixed: a report whose campaign isn't the URL's redirects to that campaign's
  Client Reports list.
- **ADMINUX-6** [medium] Retry on a failed switch to areas threw away an open edit and its device copy.
  Fixed: the retry is its own request.
- **ADMINUX-7** [low] Build polling never stopped or backed off on errors. Fixed: a `404` or `403` stops it
  and re-reads (a deleted report reads "Report not found"); other failures back off 6, 12, 24, 48, 60 s.
- **ADMINUX-8** [low] Rotate was offered on an expired link and promised a working link. Fixed: an
  expired link offers only Renew, and the Rotate, Disable and Renew confirms say exactly what the routes
  do.
- **ADMINUX-9** [low] Restore's confirm said "right away" on a taken-down report. Fixed: it branches on
  taken down.
- **ADMINUX-10** [low] An ended team's tab offered End again and no way back. Fixed: "Continue this
  team", and New report hands an ended team to Continue, keeping the dates and title.
- **ADMINUX-11** [low] Publish… while typing showed a red "didn't save" that wasn't one. Fixed: it waits
  for the last keystroke's save; only a refused save reads as a failure.
- **ADMINUX-12** [low] "N views before per-link counts" kept counting every link open (§P3). Fixed: opens
  no longer move `viewCount` or `lastViewedAt`.

**Upgrade safety (LEGACY)**

- **LEGACY-1** [high] An old report's follow-up dependencies came from the campaign's current survey
  only, so after a survey swap, detach or edited-away condition a follow-up of a hidden question could
  be mapped, and the migration froze that. Fixed (with the lead's ruling on reports without
  `snapshotInputs`): only a **published** report from before snapshots reads the old way, with the
  dependencies of every survey its campaign's answers came from (`legacyTemplatesFor`) and failing
  closed; any other report without them has nothing live. New `SurveyTemplate.depsEverFromVersion`; the
  migration lists every survey with answers older than its record (`olderVersionTemplates`) and a
  draft's Before you publish warns (`conditionsUnknown`) on the one case code can't close: a condition
  removed before the deploy, with answers given under the older version. (Before you publish renders on
  drafts only; round 2's **Worth a look** shows the same warning on a published report, §R P-2.)
- **LEGACY-2** [low] Before the migration, re-showing a chart hidden on an old report was refused
  `NEEDS_REFRESH`, and the builder mis-drew the old map. Fixed: stored map questions the live snapshot
  doesn't serve are treated as already removed, and `GET /:id` returns the server's `liveInputs` for the
  builder to use.
- **LEGACY-3** [low] `--keep-legacy-all` after a plain `--apply` brought back charts without their map and
  logged "KEPT". Fixed: it logs "charts only: its map answers were already discarded", and a dry run with
  the flag counts steps 3 to 5 as the flag leaves them.

**Security (SEC)**

- **SEC-1** [high] The series picker leaked another organization's crew names: `GET /series` authorized
  with `canManageCampaign`, which says yes to any org admin for any campaign id. Fixed: `/series` and
  `/series/affected` load the campaign in the active organization (`404` otherwise), and every read behind
  them carries `organizationId`.
- **SEC-2** [high] A crafted logo upload blocked the shared web dyno's event loop for about 4 s (a
  synchronous level-9 deflate). Fixed: both zlib steps are asynchronous and the re-encode uses level 6;
  the 256 KB limit now applies to the fresh level-6 PNG.

**Numbers (NUM)**

- **NUM-1** [blocker] After the earlier report was refreshed, the later report told the client totals
  went down. Fixed: the build stores the earlier report's snapshot (`comparedSnapshotId`), the client's
  line is hidden once that report's live snapshot moves, and Before you publish names it.
- **NUM-2** [medium] Before you publish's "more than one team" figure counted crews and "No team", not
  teams. Fixed with the team sums (§P2, contract C1).
- **NUM-3** [low] After a mid-period cut-off, a phone clock a few minutes fast produced a false "−1 door"
  line. Fixed: the recount takes rows received by the earlier cut-off plus late rows timed before it.
- **NUM-4** [low] "Remove them — the team's totals drop by N doors" overstated. Fixed: the team's count
  with her crew minus without it, both up to the report's end; the card sends `?reportId=`.
- **NUM-5** [low] The goal refusal said "no door goal set" when the campaign had one but the numbers
  predated it. Fixed: `400 GOAL_AFTER_BUILD`, pointing at Recompute or Refresh numbers.

**The build pipeline (STATE)**

- **STATE-1** [medium] A rebuild could leave its report stuck on "running" (a heartbeat inside the
  rebuild's switch read as superseded). Fixed: the attempt follows the new snapshot before deleting the
  old rows, and a missed beat counts only once a re-read confirms it.
- **STATE-2** [medium] Any visibility edit silently dropped a pending Refresh's added map question (and
  could switch its map off). Fixed: its additions survive unless the edit hides their chart or drops a
  parent, and the build's map goes off only on a real map-off.
- **STATE-3** [low] Ending a team with its open drafts could wipe a just-published report's map. Fixed:
  only what is still a draft is deleted (`findOneAndDelete`), rows only for a deleted report, `nextReportId`
  pointers cleared, and a History "deleted" row per draft.
- **STATE-4** [low] The progress bar topped out at the share of the campaign's households with activity.
  Fixed: the denominator is the walk's own count.

**The client's pages (PUBUX)**

- **PUBUX-1** [medium] The map didn't update when the report around it did. Fixed: an opaque
  `visibility.mapVersion` keys the map data and door lookups (contract C7), and stale filters clear.
- **PUBUX-2** [medium] The org logo went into the PDF uncompressed at full size (a 16 MB PDF). Fixed: it
  is redrawn at about 3 pixels per printed point and embedded compressed.
- **PUBUX-3** [medium] The PDF never wrapped headings. Fixed: long text wraps to the content width, and a
  tall question keeps its heading with its first three rows.
- **PUBUX-4** [medium] Every map open built the whole door payload in memory on the web dyno (eight
  opens of a 250,000-door report peaked at 1.1 GB). Fixed: the rows stream through a cursor, and the
  gzipped payload is kept in a small in-process cache (`CLIENT_REPORT_MAP_CACHE_MB`, 15-minute expiry).
- **PUBUX-5** [low] One tap opened every nearby home and called them one building. Fixed: "N doors near
  here — zoom in to pick one" when the tap catches several spots.
- **PUBUX-6** [low] Older/Newer skipped a report starting the same day. Fixed: the arrows follow the hub's
  order (start, publish time, id).

**Two lead-approved deviations from the reviewers' suggested fixes**

- **The builder merges changes made elsewhere instead of always asking.** ADMINUX-1 suggested re-seeding
  or a "changed elsewhere — reload" stop. The build keeps both sides when they changed different fields
  and asks (Keep mine or Use theirs) only for a field both changed; anything else either side changed is
  kept.
- **Update sends only the operator's changes.** A published report's Update sends what changed since Edit
  was pressed (the edit's starting point is kept with the device copy), not the whole settings object, so
  a change made elsewhere meanwhile is never quietly undone.

## R. Code review round 2 (2026-10-24)

Four reviewers (privacy, concurrency, verification, a full click-through of every page) reproduced their
findings against the real app, throwaway databases and real browsers; three independently found the same
root cause (a save that hadn't seen another editor's change wrote over it). Two fix agents changed the
code; every finding below is fixed, with tests, and documented in [CLIENT_PORTAL.md](CLIENT_PORTAL.md).
The three items carried over from the round-1 docs passes (P-1 to P-3, which carry no severity) are
listed first. Severity in brackets. The owner's walkthrough is next.

**Carried over from the round-1 docs passes (P)**

- **P-1** The map payload cache checked its 15-minute expiry only on a lookup, so an entry nobody
  asked for again stayed in web memory until evicted or a restart. Fixed: a sweep every minute (only while
  the cache holds something, never keeping the process alive) drops expired entries, so nothing is held
  much past 16 minutes.
- **P-2** `conditionsUnknown` and `earlierReportRefreshed` were computed for every report but shown
  only by Before you publish, on drafts. Fixed: a published report's builder shows them in **Worth a
  look**, with the published wording and Refresh numbers.
- **P-3** A draft change sent by the unmount keepalive and refused (someone published in that
  moment) was lost. Fixed: the device copy is written before the keepalive leaves, offered back as a
  Restore, and cleared on its own once the change is seen to have landed.

**Privacy (PRIV)**

- **PRIV-1** [high] A builder screen that hadn't re-read could undo another operator's privacy removal:
  lists and sections were sent whole, so a chart hidden elsewhere, or a deleted section quoting a voter,
  came back when the other operator ticked something else, live at once on a published report. Fixed
  by contract C8: every PATCH carries `ifEditVersion`, pinned in the write's filter (`409
  CHANGED_ELSEWHERE` with the current report, nothing written), and the builder merges three ways, key
  lists member by member and observations by section, before sending only its own changes again.
- **PRIV-2** [low, pre-existing] The share sign-in token's readable payload carried two ObjectIds (the
  link's and the campaign's, each with a creation time), against item 38's "no internal ids". Fixed: new
  tokens carry `link`, an HMAC of the link id, and no campaign id; tokens issued before are honoured
  until they expire (30 days at most).

**Concurrency (CONCUR)**

- **CONCUR-1** [high, same root as PRIV-1] A save from a page that hadn't re-read overwrote another
  editor's title, section, chart or applied map question, and nobody was asked (four cases verified in
  two real browsers). Fixed by C8, with Apply and the remap commit now bumping `editVersion` and the C5
  branch running the same merge.
- **CONCUR-2** [medium] Pressing Edit deleted the unsent edit kept on the device, with no confirm.
  Fixed: Edit opens the kept copy; the copy is written only once the edit has a change and deleted only
  by Update, Cancel edit (which now asks when there are changes), Discard it or undoing every change.
- **CONCUR-3** [low] The PATCH rewrote all seven visibility keys from its own read, so two writes a few
  milliseconds apart undid each other (an Apply turning the map on, raced by an Update, left the client
  with no map). Fixed: the PATCH writes only the keys it was sent, and map-question pruning filters the
  list as it stands at the write.

**Verification (VERIFY)**

- **VERIFY-UI-1** [high] The same root cause as PRIV-1 and CONCUR-1, reproduced a third time in the UI
  (a published hide undone, a published map question lost, a draft section deleted, draft map ticks
  lost). Fixed by C8.
- **VERIFY-1** [medium, a regression from round 1's LEGACY-2 fix] On a published report with its map
  off, any unrelated edit wiped the stored map picks. Fixed: the narrowing runs only while the map is
  served, and a refresh that leaves the map off keeps the picks at Apply.
- **VERIFY-2** [medium, pre-existing] Refresh numbers turning the map on put every stored pick on the
  client's map while the dialog showed them unticked and the review never named them. Fixed: the dialog
  pre-ticks the kept picks (each can be unticked), the route builds exactly the final list it is sent,
  and the ready review names the map questions.

**The click-through (WALK)**

- **WALK-1** [medium, client-facing] The area legend didn't match the hexagons (full-strength swatches
  beside 62% see-through fills). Fixed: each swatch is the class colour blended over the map's own
  ground, read from the basemap at the current zoom.
- **WALK-2** [low] Wrong-password counts showed only when one happened in the last 24 hours. Fixed: the
  muted counts line shows whenever there are any, locked and expired links included; the warning badge
  stays for the last 24 hours.
- **WALK-3** [low] History couldn't say which tab or team a row was about, and Continue left no row.
  Fixed: report rows name their tab ("Oct 12 – Oct 18, 2026 · Paid team report"), team rows carry the
  team's name, and a new "Team continued" row.
- **WALK-4** [low, Help] The Help guide said a hidden chart's question can't reach the client at all,
  which a voter group or a follow-up chart can contradict. Fixed in the docs pass.
- **WALK-5** [low] "Published. Your client can see it now." showed when no link could open it. Fixed:
  "Published — create a link so your client can open it." with Client links.
- **WALK-6** [low] Refresh numbers' expanded rows used console outcome names. Fixed: the client's words
  (Declined to participate, Didn't answer, No-soliciting sign).
- **WALK-7** [low] Adding a single-choice question to an area report's map (Refresh, or a switch to
  areas) never said it would show no answers by area. Fixed: refresh and remap results carry
  `areaWithoutAnswers`, shown in the Refresh review, Worth a look and, ahead of time, the switch confirm.
- **WALK-8** [low] An Update that only switched to areas promised the client would see it "right away".
  Fixed: that sentence is dropped for a switch-only Update.
- **WALK-9** [low, docs and names] Matched canvasser names showed lower-case, and three quotes in the
  docs and Help didn't match the screens. Fixed: the server returns each matched name as written on the
  person's record, and the docs quote the screens.
- **WALK-10** [low, accessibility, pre-existing] Door and area details on the client map needed a mouse
  or a finger. Fixed: a keyboard path (arrows and +/− move, Enter opens what is under a centre ring,
  Escape closes the card) with a screen-reader hint and announcements.
- **WALK-11** [low, pre-existing] The PDF's brand colour was indigo. Fixed: the web's red.
- **Cosmetic:** the builder preview at 1280 px clipped the fourth headline card's "(i)" (the cards now
  go four across only when the report itself is at least 720 px wide, on a screen at least 1024 px wide),
  and Link ready at 390 px showed only the start of the address (it now shows the whole address, with
  the buttons below).

**Lead decision**

- **Unversioned PATCH callers stay accepted.** `ifEditVersion` is optional on `PATCH
  /admin/client-reports/:id`: the builder is the only caller and always sends it, and a builder page
  opened before the deploy keeps working as it did. A request without it can't be refused
  `CHANGED_ELSEWHERE`; a lost race answers `STATUS_CHANGED`, as before.

**Verification of the round-2 fixes (VERIFY2, 2026-10-25)** re-ran every round-2 reproduction against the
fixed code: all fixed, and ordinary single-editor use stays quiet (one save per burst of typing, normal and
at 400 ms latency, no banners). Its six follow-ups, all fixed:

- **VERIFY2-1** [medium] After a conflict that resolved itself (the other editor undid their change), the
  draft's saver stayed held: later changes never saved and Publish… did nothing. Fixed: a rebase ends any
  hold.
- **VERIFY2-2** [low] A change that did save on the way out could come back as "didn't save" once a
  colleague changed the same field. Fixed: the copy kept on the device is deleted as soon as the server
  confirms the keepalive.
- **VERIFY2-3** [low] The operator's own switch to areas finishing under an open edit read as "changed
  elsewhere". Fixed: "Your switch to areas is ready."
- **VERIFY2-4** [low] "Large areas usually fix it" was offered on a report already in large areas. Fixed:
  only for numbers built in small areas (the ready result now carries `areaSize`).
- **VERIFY2-5** [low] A published report kept the copied-notes reminder pointing at Before you publish,
  which exists only on drafts. Fixed: drafts only.
- **VERIFY2-6** [low] "Your changes are kept on top" could be said while a map tick (its parent left the map
  elsewhere, or its chart was hidden there) or a section reorder didn't survive the merge. Fixed: the
  notice names what wasn't kept, and the question table notes it.
