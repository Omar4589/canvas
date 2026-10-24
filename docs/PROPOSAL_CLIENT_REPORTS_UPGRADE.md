# Client reports: audit, plan and design

**Status.** Audit 2026-10-23. Owner rulings 2026-10-23 and 2026-10-24 (§E). Plan and design revised
after review round 1 (2026-10-24, §N). **Nothing is built.** Round 2 is next (§M).

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
question showed all of them. *(all verified)*

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
  a paid team**, told apart by their coordinator, and the client may want a report for each.
- **Recipients keep using a link and a password**, hardened. No accounts, no email addresses stored.
  Your client can tick **Keep me signed in on this device** to skip the password for 30 days.
- **Published reports get two kinds of fix:** edit the words in place while the numbers stay frozen,
  or **Refresh numbers**, which shows the before-and-after first.
- **A ready-to-send message** for any published report. You send it yourself; nothing is stored or
  sent by us.
- **Next report in one click**, starting the day after the last report ended.
- **Your organization's logo** on the client's page and PDF, with a small "Powered by Doorline".
- **Exact door pins stay the default**; any report can switch to an **area view**.
- **When both teams reached the same home or voter, it counts in both team reports**, and each team
  report says so.
- **Area view shows a block's survey answers only when at least five people there answered.**
- **No Privacy Policy sentence** about recording when a report link is opened.
- **The homepage line** "the numbers never change under you" gets reworded.

## What changes for the person building reports

- **One row per survey question:** show its chart, use it as a map filter, or make it the headline. A
  question you don't show can't reach the map or the client. "None" really means none.
- **Numbers build in the background.** Creating a report, Next report and Recompute build the numbers
  on the worker with a progress bar, and you can leave the page. If someone is editing answers,
  unknocking, converting, relabelling or re-cutting the campaign, the build waits for them to finish,
  and says so.
- **Publish is instant and freezes exactly what you previewed.** The builder shows "Numbers as of 9:14
  am". If those numbers are old or the period hasn't ended, Publish says so and offers Recompute first.
- **"Before you publish"** gathers what's worth a look: open mock-GPS flags in this report's scope,
  answers an admin entered or edited, a period that isn't over, no live link for the client, notes
  copied from last week that you haven't reviewed, numbers from your earlier reports that have moved
  since you sent them, and on team reports, how many canvassers worked and how many homes both teams
  visited.
- **On a published report:**
  - **Edit** fixes the title, the notes and what is shown. The client sees "Edited Oct 21".
  - **Refresh numbers** rebuilds from today's records, shows what moved, and changes nothing until you
    press **Apply**. It's also how you add to the map: turn it on, add a map question, or switch exact
    doors to areas and back. The client sees "Numbers refreshed Oct 28".
  - **Take down** removes it from the client's page but keeps its numbers; **Put back up** restores
    it unchanged.
- **Team reports.** Pick a crew and type the name your client sees (for example "Volunteer team"),
  never the coordinator's name. That name stays tied to that crew. If the coordinator leaves or the
  crew moves, the next build stops and asks you to move the name to the new coordinator. Team numbers
  follow each canvasser's current coordinator; published reports stay as they were sent.
- **Client links.** Choose how long a link lasts, from 30 days to a year; extend it up to a year from
  when it was made. An expired link is renewed with a new address, which you send to your client.
  Passwords you set need 12 or more characters. A password change or a rotate signs everyone out.
  After 50 wrong passwords in a day the link locks for an hour; if that keeps happening, someone else
  has the link, so rotate it.
- **Who opened what:** "Opened via the Candidate link: 2 visits", counted once per person per report
  per day. Visits by people signed in to your organization are listed separately.
- **History:** publishes, refreshes, edits (with the earlier text, and Restore), take-downs, deletes
  and every link change appear in the campaign's existing History.
- **Report branding** (admins): upload a logo once, as any image; your browser turns it into a clean
  PNG before it's sent.

## What changes for your client

- The password screen shows nothing about the campaign until the password is right, and offers **Keep
  me signed in on this device** (30 days).
- If the link changes under them (new password, renewed or rotated link, expiry), the page says what
  happened and what to do, instead of claiming nothing was published.
- Your logo is at the top. Tabs separate the whole campaign, each team and each walk list. Each tab
  shows its latest report, a small chart of doors knocked "as each report was published", and its
  reports newest first.
- Each report names its period ("+412 this week", or "+812 in these 14 days"), when it was published,
  and when it was last edited or refreshed. If the numbers were taken before the period ended, it says
  "Numbers through Oct 24, 3:10 pm". Arrows move to the older or newer report in the same tab. Team
  reports say that a home both teams visited counts in each team's report.
- The map works on a phone: full width, filters in a drawer, two fingers to pan, door details below
  the map, and real question wording instead of codes.
- **Area view** shows shaded areas with how many doors were reached and how they went. Survey answers
  appear for an area only when at least five people there answered. It never shows an address. Be
  aware that comparing reports over time can narrow things down.

## Big campaigns

Builds run on the background worker and work through the campaign a slice at a time, so a big report
never crowds out the imports and exports the worker runs at the same time. Each build uses a fixed
cut-off time, so late knocks can't make its numbers disagree with each other, and it stops if the
campaign or organization is being deleted. The client's map downloads a compact list of door positions
and results, without addresses, and fetches a door's address only when it is tapped, so even a
100,000-door report opens on a phone.

## What this does not change

How every number is counted ([METRICS.md](METRICS.md)), tags hidden until ticked, door-goal progress
only, and the phone app (nothing here touches it). No new company receives any data. The Privacy
Policy, Terms and DPA need no edit for these changes; the homepage line is reworded at your request
(§I). Pin clustering is not used anywhere: area-view hexagons are fixed and look the same at every
zoom.

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
throwaway `mongod` and drive the real admin and share endpoints. Round 1's reviewers ran their own
probes the same way (§N).

The phone app calls no client-report or share endpoint (`npm run audit:mobile-api -- --list`,
cross-checked by grep). One route this plan touches is mobile-facing: `GET
/admin/campaigns/:campaignId/history` gains an optional parameter (§F9), which is an additive change.
Nothing here needs an OTA or a client-version gate.

## B. Verified defects in today's code

| # | Defect | Where | Probe result |
|---|---|---|---|
| B1 | `showMap: false` only hides the map in the browser. Publish always runs `buildFrozenMapPoints`, and `GET /share/:token/reports/:id/map` never checks `visibility.showMap`. | `clientReports.js:697-704`; `share.js:166-173` | Map off → `/map` 200 with all 3 doors, e.g. `{"addressLine1":"1 Elm St", …, "status":"surveyed", "answers":[{"questionKey":"support","answer":"Yes"},{"questionKey":"bond","answer":"For"}]}` |
| B2 | Hidden questions ride the payload. `mapFilterSurvey` filters on `mapAnswerKeys` only, never `visibleQuestionKeys`, and treats an empty list as every question. `mapAnswerKeys` is seeded with every choice question at create (`clientReports.js:454`), and the builder hides that checklist while the map is off (`ClientReportBuilderPage.jsx:509`). | `clientReportView.js:114-127` | `bond` unticked from visible questions → the share response's `survey.questions` still carries `bond` with `Against 2 · For 1`, and the points carry `bond` answers. With `mapAnswerKeys: []` the preview's `survey` lists both questions. |
| B3 | `visibleQuestionKeys: []` means all (`shapeWindow`), so unticking everything shows everything. The recap chip says "N of N shown" while every checkbox reads unticked. | `clientReportView.js:10-12`; `ClientReportBuilderPage.jsx:147` | Empty list → client breakdowns `['support','bond']`. |
| B4 | No password strength rule. `shareCreateSchema.password` is `min(1)`; `shareUpdateSchema.password` has no minimum. The unlock limiter counts per IP + token, so many IPs each get their own budget. | `clientReports.js:241, 251`; `share.js:106-114` | PATCH `password: "a"` → 200; unlock with `"a"` → 200. |
| B5 | A password change does not end existing unlocks. The share JWT is `{kind, shareId, campaignId}`, lives 24 h, and is never checked against the password. Already recorded in PRIVACY_VERIFICATION.md D11. | `tokens.js:112-119`; `share.js:56-75` | The old JWT after the password change → 200. |
| B6 | Publish has no status guard. A published report can be published again, which recomputes both windows and rebuilds the points, so a frozen report changes. | `clientReports.js:672-717` | Backdated knock added, publish again → 200; `doorsKnocked` 3 → 4; `publishedAt` moved. |
| B7 | The pre-password meta call returns `label`, which no client screen renders. `loadShare` stamps `lastAccessedAt` on every call, meta and failed unlocks included, so "Last opened" means "someone reached the gate". | `share.js:48, 84-99` | Meta with no password → `{"campaignName":"Fall","orgName":"Acme","label":"Internal — do not forward","requiresPassword":true}`; `lastAccessedAt` set. |
| B8 | Hidden question keys still reach link holders through two more fields: `visibility.mapAnswerKeys` (raw) and `supportQuestionKey` (even when that question is hidden). Keys are slugs of the question title (`SurveyBuilder.jsx:107-110`), so a key gives away the hidden question's wording. No client screen reads `visibility.mapAnswerKeys`. | `clientReportView.js:68, 88-91` | Recall question hidden and made the headline → the share response carries `supportQuestionKey: "would_you_back_recall_of_mayor_smith"` and that key in `visibility.mapAnswerKeys`, while the breakdowns show only `support`. (Round 1, privacy reviewer.) |

## C. Defects from code (not run)

- **C1. Public error states.** `PublicReportListPage` has no error branch, so a 401 (the share JWT
  kept in `sessionStorage` past 24 h) renders "No reports have been published yet"
  (`PublicReportListPage.jsx:36`). The detail page renders "Report not found" and the map "Map is
  unavailable right now". `PublicReportLayout` collapses a 404 and the server's `410 SHARE_EXPIRED`
  into "This report link is not available" (`PublicReportLayout.jsx:80`). Nothing clears the stale
  token and shows the password gate again.
- **C2. Legacy link with a password added.** `isLegacyOpen` is `!passwordHash || !expiresAt`
  (`clientReports.js:214`), and adding a password never sets `expiresAt`. The row keeps the "open
  link — add a password" badge, and `revoke-legacy` (filter at `:324`) still disables it.
- **C3. Period wording.** "+N this week" is hard-coded (`ClientReportView.jsx:24`, `reportPdf.js:102`)
  along with about a dozen other weekly strings (§F10), and the hub title falls back to "Week of …",
  but the create form accepts any range.
- **C4. Default week.** `defaultWeek()` uses `toISOString()` (`ClientReportsPage.jsx:14`), which is
  UTC: in the US evening the end date is tomorrow. It ignores the campaign's time zone and the last
  report's end date.
- **C5. Builder state.** Preview reads the saved report, not the draft on screen. There is no
  unsaved-changes guard. `recomputeM`, `publishM` and `unpublishM` have no `onError`
  (`ClientReportBuilderPage.jsx:101-122`). The map-filter checklist disappears while the map is off
  (`:509`), yet `mapAnswerKeys` still drives B1 and B2.
- **C6. Client map.** The door panel prints `a.questionKey` (`ClientReportMap.jsx:359`). The layout is
  a fixed `w-64` filter column beside the map in a 70vh row (`:267`), which leaves the map a sliver at
  phone width.
- **C7. Support subtitle.** `support.subtitle` is `` `${surveysTaken} total responses` ``
  (`reportDerive.js:166`), while the bars count that question's own answers (one per voter per round).
- **C8. Editing after publish.** Unpublish sets `status: 'draft'`, so the report leaves the client's
  hub until it is republished, and republish recomputes (B6's path).
- **C9. Link scope.** A link returns every published report of its campaign (`share.js:77-81`). Ruled
  fine (§E).
- **C10. Expiry choice.** The API accepts `expiresInDays` (1-365); the panel always posts
  `{ campaignId }`, so every link gets the 90-day default. privacy.html line 101 says links expire
  "after 90 days by default, or a period of up to one year chosen by an administrator".
- **C11. What a lead can do.** A lead can create, edit, publish, unpublish and delete reports, manage
  links and passwords, and reads the builder's internal notes and the mock-GPS banner. Ruled: keep.
- **C12. Smaller.** Deleting a published report gives the same warning as deleting a draft. Link and
  report changes leave no history beyond `createdBy` and `publishedBy`. Share API responses carry no
  `Cache-Control: no-store`. The PDF's filename is `weekly-report-<weekEnd>.pdf`, so two scopes of one
  week collide (`reportPdf.js:269`). The "+N" pill is `text-success` on `bg-success-tint`, about 3:1,
  below the contrast floor for small text (`StatCard.jsx:42`). The comment on `generateSharePassword`
  says "~62^12"; the alphabet has 56 symbols (about 70 bits; still strong).

## D. Scale (not measured)

**Production formation** (from the owner's Heroku dashboard, 2026-10-24): one `web` dyno, Standard-2X
(1 GB), running `node src/server.js` with no heap flag; one `worker` dyno, Performance-M (2.5 GB),
with `WORKER_MAX_OLD_SPACE=2000`, a 2,000 MB heap cap instead of the script's 384 MB default.

Today's publish runs on the **web** dyno, with Heroku's 30-second router limit. It loads every in-scope
`Household`, an aggregate pushing every knock per household, and every `SurveyResponse` with its
answers, then writes one row per reached door. `computeWindowStats` also ships every (household, round)
group with its knocks to Node. `GET /:id/preview/map` repeats the map build on every Preview open, and
the share map returns every point, address included, in one JSON body.

The worker has room, but it is one program ([worker.js](../server/src/worker.js), the Procfile's only
`worker` line) running every queue at once: up to two imports (`IMPORT_JOB_CONCURRENCY`, default 2), an
export, turf, deletes, maintenance, conversions and answer edits. If one job pushes the heap past its
cap, Node exits and every job on the dyno is interrupted. §F2 keeps a build's memory small and flat.
Verification includes a timing and memory run on a **synthetic** campaign of Collier's size (§K): a
copy of real customer data would take PII out of production.

## E. Owner rulings

| Date | Question | Ruling | Consequence in this plan |
|---|---|---|---|
| 10-23 | What can a lead do? | **Full control, as today.** | No role change on report and link routes. Org-wide **branding** is admin-only, because it changes every campaign's reports (the reason `revoke-legacy` is admin-only). |
| 10-23 | Different clients per walk list? | **No: one client per campaign.** Volunteer and paid teams, told apart by coordinator, may want separate reports. | Links stay per campaign. **Team reports** (§F4). |
| 10-23 | How do recipients get in? | **Link + password, hardened.** | §F6. |
| 10-23 | Fixing a published report | **Both:** in-place edits that keep numbers frozen, and Refresh numbers with a before-and-after. | §F3. |
| 10-23 | Telling the client about a new report | **Copy-ready message.** | §G6. Built in the browser. |
| 10-23 | Starting next week's report | **One click from last week.** | §F10 `POST /:id/next`. No scheduler. |
| 10-23 | Branding | **Org logo + small Doorline mark.** | §F8. |
| 10-23 | Map precision | **Exact pins by default, area view per report.** | §F5. |
| 10-24 | A sentence about recording link opens? | **No.** | §I records the ruling. |
| 10-24 | Home or voter both teams reached | **Counts in each team's report.** | §F4: the dashboard team filter's semantics, with a note on the report. |
| 10-24 | Homepage "numbers never change under you" | **Reword.** | §J. |
| 10-24 | Survey answers in area view | **Only where 5+ people answered.** | §F5, with honest wording. |
| 10-24 | Client stays signed in | **Opt-in, 30 days.** | §F6. |

## F. Server plan

### F1. Visibility, enforced on the server

- **One meaning of "empty": none.** `visibleQuestionKeys` and `mapAnswerKeys` both mean "show none"
  when empty, for every report. Create, Next and the builder always write explicit keys.
- **`visibleKeysFor(report)`** (in `clientReportView.js`) = `visibleQuestionKeys` ∩ the report's frozen
  breakdown keys. **`mapKeysFor(report)`** = `mapAnswerKeys` ∩ `visibleKeysFor(report)`, and `[]` when
  `showMap` is false. Every shaper, the builder (§F2) and the map endpoints use these two, and nothing
  else decides visibility.
- **The client payload** (`shapeReportForClient`) changes:
  - `visibility` carries `{ showMap, mapMode, areaSize }` only; `mapAnswerKeys` is no longer sent (B8).
  - `supportQuestionKey` is sent only when it is in `visibleKeysFor` (B8); `reportDerive.js` already
    falls back.
  - each window drops `coverage`, which no client screen reads and which an area report could be
    subtracted from (§F5).
  - `survey` (map filters) lists `mapKeysFor` questions only.
  - new: `scope: { kind: 'campaign' | 'team' | 'walk_list', label }` (labels only, never an id),
    `statsComputedAt`, `editedAt`, `numbersRefreshedAt`.
- **The map endpoints** return **404 `MAP_NOT_SHARED`** when `showMap` is false and strip every answer
  outside `mapKeysFor` before anything else touches the rows, including the area shaper
  (`shapeAreaCells`). This also fixes already-published reports at read time.
- **At rest.** Builds store no points or cells when the map is off. Turning the map off, or dropping a
  map question, on a published report cleans storage at once (§F3).
- **Migration `migrate:client-report-visibility`** (dry run unless `-- --apply`; proxied in the root
  `package.json`):
  - **Legacy reports with an empty `visibleQuestionKeys`.** Create has seeded every choice key since
    the feature's first commit, so a stored empty list means the operator unticked them all. The dry run
    lists every such report with non-empty breakdowns (campaign, period, status, opens). On apply they
    keep "none", which is what the operator chose; `--keep-legacy-all` instead writes their breakdowns'
    keys, so the client keeps seeing every chart. The owner picks before applying. Until the migration
    runs, those reports show no charts, which errs toward hiding.
  - Every report's `mapAnswerKeys` becomes `mapKeysFor(report)`.
  - Points of every report whose map is off (drafts included) are deleted; answers outside `mapKeysFor`
    are `$pull`ed from the rest.

### F2. Snapshots, built on the worker

A **snapshot** is one build's frozen output: the numbers on the report document and the map rows (pins
or cells) tagged with its `snapshotId`. A build never writes over a live snapshot; it writes a new one
and a single atomic update swaps it in.

**Fields on `ClientReport`:**

| Field | Meaning |
|---|---|
| `snapshotId` | The live snapshot: public on a published report, the latest recompute on a draft. `null` on reports built before this change, whose rows carry no `snapshotId` (Mongo's `{ snapshotId: null }` matches the missing field, verified). |
| `snapshotInputs` | The map settings the live snapshot was built with: `{ showMap, mapMode, areaSize, mapKeys }`. Used to tell the operator the map preview is out of date. |
| `statsComputedAt` | The live snapshot's cut-off time. |
| `stats`, `goalSnapshot`, `mapPointCount`, `areaCellCount`, `movedSincePrevious` | The live numbers. |
| `editVersion` | Incremented by every PATCH; Publish compares it (§F3). |
| `build` | `{ kind: 'recompute' \| 'refresh' \| 'remap', status: 'queued' \| 'waiting' \| 'running' \| 'ready' \| 'failed' \| 'idle', jobId, snapshotId, inputs, fenceAt, startedAt, beatAt, progress: { phase, done, total }, waitingFor, error: { code, message }, result, requestedBy }` — one object for the build in progress and a refresh awaiting review (`ready`, with `result` holding its numbers). |

**Claim** (web, one request). `findOneAndUpdate({ _id, organizationId, status: <draft for recompute,
published for refresh and remap>, $or: [{ 'build.status': { $nin: ['queued', 'waiting', 'running'] } },
{ 'build.beatAt': { $lt: now − 5 min } }] }, { $set: { build: { kind, status: 'queued', jobId: <new
ObjectId hex>, snapshotId: null, inputs, startedAt: now, beatAt: now, … } } })`. No document back →
**409 `REPORT_BUSY`** with the current build state. `inputs` freezes the map settings at claim (for a
refresh, the settings sent with it). A claim overwrites a `ready` result; its rows are swept (below).
The job is enqueued through `queueOp` with a timeout; if enqueueing fails, a CAS on `{ 'build.jobId',
'build.status': 'queued' }` marks the build `failed` ("Couldn't start — try again"), the `parkUnqueued`
pattern. This closes B6 and the double-click race.

**Queue.** A new `QUEUE_NAMES.CLIENT_REPORT`, registered in [worker.js](../server/src/worker.js) at
concurrency 1 with `attempts: 1` and `maxStalledCount: 2`, plus a `failed` listener that CASes `{
'build.jobId' }` to `failed` with the error (the answer-edit reconcile pattern).

**Each attempt** (worker):

1. **Own the attempt.** CAS `{ _id, 'build.jobId', 'build.status': { $in: ['queued', 'waiting',
   'running'] } }` → `$set { 'build.status': 'running', 'build.snapshotId': new ObjectId(), beatAt }`.
   No match → exit. Every attempt, a stall redelivery included, writes under its own `snapshotId`, so
   nothing it writes can collide with an earlier attempt's rows.
2. **Wait for other changes.** While `otherChangeRunning(campaignId)` reports something, set `status:
   'waiting'` with `waitingFor` (its message, reworded for reports) and re-check every 30 s, for up to
   30 minutes. Then fail `BLOCKED`. An open one-person answer-edit session never times out on its own,
   so that message says "press Stop on Door Outcomes".
3. **Fence.** `fenceAt = now`. Every `CanvassActivity` and `SurveyResponse` read adds `createdAt: { $not:
   { $gt: fenceAt } }`; the `$not` form keeps rows that have no `createdAt` (verified). Knocks that
   arrive during the build are left for the next one.
4. **Heartbeat.** A 30-second timer (`unref`) CASes `{ _id, 'build.jobId', 'build.snapshotId' }` →
   `beatAt`, `progress`. When it matches nothing, the build was cancelled or superseded: stop, delete
   this snapshot's rows, exit.
5. **Deletion.** `deletionRequested({ campaignId, organizationId })`
   ([lateWriteSweep.js](../server/src/services/platform/lateWriteSweep.js)) is checked before every
   batch; if true, delete this snapshot's rows and stop with `UnrecoverableError`. `ClientReportMapPoint`
   and `ClientReportAreaCell` join `LATE_WRITE_MODELS`, and the commit runs inside `sweptAfter(tenant,
   …)`.
6. **Build** (below).
7. **Changed during the build?** Any of `AnswerEditRun`, `SurveyConversionRun`, `UnknockRun` or
   `ReclassifyRun` for the campaign with `updatedAt >= fenceAt − 60 s` (60 s covers clock skew between
   dynos); a `TurfSnapshot` with `clearedKnocks: true` and `createdAt` or `restoredAt >= fenceAt − 60
   s` (a re-cut that cleared or restored knocks; its lock is released by then, so the lock can't be
   checked); and for team reports a `CoordinatorChange` for the campaign with `createdAt >= fenceAt −
   60 s`. If any: delete this snapshot's rows, go back to step 2 once with a new snapshot and fence. A
   second hit fails the build `CHANGED_DURING_BUILD`.
8. **Check the invariants.** For each window, Σ `contactBreakdown` === `doorsKnocked`, and the period's
   doors ≤ the cumulative doors. A failure fails the build loudly; it never commits.
9. **Commit** (one CAS on `{ _id, 'build.jobId', 'build.snapshotId', status }`, using the pre-image):
   - `recompute`: swap in the live numbers, `snapshotId`, `snapshotInputs`, `statsComputedAt: fenceAt`;
     `build.status: 'idle'`. Then delete exactly `{ clientReportId, snapshotId: <previous> ?? null }`.
   - `refresh`: `build.status: 'ready'`, `build.result` = the new numbers. The live snapshot is
     untouched until Apply (§F3).
   - `remap`: swap `snapshotId` and set `mapMode: 'area'`; numbers untouched (§F5).
   A commit that matches nothing (deleted, cancelled, superseded) deletes its own rows.

**The build.** One function, `buildReportSnapshot()`, replaces `computeBothWindows` and
`buildFrozenMapPoints`.

- **Walk the households that have knocks.** An aggregation cursor over `CanvassActivity` (`{
  organizationId, campaignId, timestamp: { $lt: rangeEndUtc } }` + fence, `$group` by `householdId`,
  `$sort` by `_id`, `allowDiskUse`) yields every household with activity before the end, including any
  whose household record is gone, in batches of `CLIENT_REPORT_BATCH` (default 2,000). Doors with no
  activity are unknocked and never on the map, so they are never read.
- **Per batch, at most two indexed finds** (`{ householdId: { $in } }` is indexed on both collections):
  1. The **scope rows**: `CanvassActivity` with `KNOCK_ACTIONS`, the window and fence, and the report's
     scope clauses applied in Mongo, never re-implemented in JavaScript: walk list = the activity's
     `effortId`; team = `withTeam(…, teamMatch(coordinatorId))` + `NOT_BULK`.
  2. The **status rows** for the map, when they differ from (1): `STATUS_ROW_MATCH` rows of the batch's
     households, campaign-wide, for whole-campaign and walk-list reports (as today); for team reports,
     the team's own rows plus every `restricted` row on those doors, so a door the rest of the product
     calls Restricted reads Restricted here too.
- **Door numbers come from one fold.** The scope rows are grouped in Node into (household, round)
  groups. From the same groups, for each window (cumulative, period, and cumulative to the previous
  report's end in the same scope, for "moved since you sent it"): `doorsKnocked`, the surveyed, lit,
  refused, not-target and contact flags, the contact breakdown via `resolveStatus`, and
  `homesKnocked`. So Σ breakdown === `doorsKnocked` by construction, and step 8 confirms it.
- **The map.** In-scope households (walk list: the household's current `effortId`, as today; team:
  households with a team knock before the end) with coordinates; status from the status rows; answers
  from the latest response that carries a map answer (today's rule, sorted `{ submittedAt: 1, _id: 1 }`
  so ties are stable), each passed through `publicPointAnswer`. Pins are inserted per batch (`ordered:
  false`); area cells accumulate in memory and are written once at the end (§F5).
- **Survey numbers** (surveys taken, voters surveyed, breakdowns, tags, provenance) stay server-side
  aggregations with the fence and the scope. Voters surveyed becomes `$match: { voterId: { $ne: null }
  }` + `$group` + `$count` instead of a `distinct` array (the `$match` keeps it identical to `distinct`,
  verified).
- **Parity with today, pinned.** Today's `computeWindowStats` and `buildFrozenMapPoints` stay in the test
  suite as oracles. The new builder must match them exactly on a fixture with a door moved between walk
  lists, a two-voter door whose later answer skips a map question, equal `submittedAt` values, a team
  crew with a lead's own doors, a desk `bulk` row, a door both teams knocked in one round, and a
  re-stamp; then again with `CLIENT_REPORT_BATCH=2`. (The only household hard-delete,
  `undoImport.js:184`, requires `status: 'unknocked'`, so a knocked household that later vanished is
  the rare case where the new walk can see more than the old builder; the fixture asserts the walk counts
  it.)

**Nightly sweep** (registered with the existing maintenance scheduler,
[scheduler.js](../server/src/services/retention/scheduler.js); the test pinning the scheduled-job list
is updated): deletes map rows whose report no longer exists; rows of map-off reports; and rows whose
`snapshotId` is neither the report's live one nor its current `build.snapshotId` and was minted more
than 24 hours ago (`snapshotId < ObjectId.createFromTime(now − 24 h)`, so a build that starts between
the sweep's read and its delete is never touched; verified).

### F3. Publishing, editing, refreshing

- **Publish is not a build.** It freezes the draft's live snapshot:
  `findOneAndUpdate({ _id, status: 'draft', snapshotId: <previewed>, editVersion: <previewed>,
  'build.status': { $nin: ['queued', 'waiting', 'running'] } }, { $set: { status: 'published',
  publishedAt, publishedBy, openMockFlagsAtPublish } })`. Refused with **409 `RECOMPUTE_NEEDED`** when
  there is no snapshot yet, or when the current map settings differ from `snapshotInputs`; with **409
  `SAVING`** when `editVersion` moved (an auto-save landed). The builder flushes pending auto-saves
  before sending it. The confirm offers **Recompute first** when the numbers are more than an hour old
  or the period hasn't ended.
- **Edits.** `PATCH /:id` writes only the fields it was sent, with a targeted `$set` and `$inc:
  { editVersion: 1 }`; it never saves the whole document, so it can't overwrite numbers a build just
  committed (a lost update round 1 reproduced). `isSupportQuestion` is no longer stored; the headline
  comes from `supportQuestionKey`. On a **published** report it accepts the title, the observations,
  the support question, the visible questions and tags, the goal tick, and two **removals**:
  - turning the map off: deletes every map row of the report, discards a `ready` refresh and cancels a
    running build (its heartbeat then finds nothing and it cleans up);
  - dropping map questions: `$pull`s their answers from the live and any `ready` snapshot's points and
    `$unset`s them on cells.
  Anything that adds to the map (map on, a map question, pins ↔ areas, area size) is **400
  `NEEDS_REFRESH`**; the builder routes those settings into the Refresh dialog. Map and headline edits
  are **409 `REPORT_BUSY`** while a build is queued, waiting or running. An accepted edit on a published
  report stamps `contentEditedAt/By` and writes a History row with the earlier text (§F9).
- **Refresh numbers.** `POST /:id/refresh { map? }` claims a `refresh` build with the map settings it
  carries (validated: choice questions only, ⊆ the visible set). On `ready`, the builder shows "New
  numbers ready to review (built Oct 22, 3:10 pm)". **Apply**: CAS `{ status: 'published', 'build.status':
  'ready', 'build.snapshotId': <reviewed> }` → swap the result and its map settings in, stamp
  `numbersRefreshedAt/By`, `build.status: 'idle'`, then delete the previous live rows. **Discard**: CAS
  `ready → idle`, then delete its rows. Take down, Delete, map-off and any new claim also discard it, so
  an old result can never land over a newer state.
- **Take down** (today's Unpublish): `status → 'draft'`, discards a `ready` refresh, keeps the live
  snapshot. **Put back up** is an ordinary Publish of that same snapshot: same numbers, instant.
- **Delete** deletes the report, then every map row with its `clientReportId`; a running build's next
  heartbeat finds nothing and removes its own rows; the sweep catches anything left.

### F4. Team reports

- **A team series** is a campaign's (coordinator, label) pair. Create takes `team: { coordinatorId, label
  }` (label 1-60 characters, typed by the operator, never defaulted to the coordinator's name), alone or
  with a walk list. Within a campaign, one label belongs to one coordinator and one coordinator has one
  label: **409 `TEAM_LABEL_TAKEN`** ("Volunteer team is Maria's crew") or **409 `TEAM_LABEL_EXISTS`**
  ("Maria's crew is already reported as Volunteer team").
- **The picker** lists current crews first: coordinators of the campaign's `CampaignAssignment` rows.
  Former crews that still own history are listed below, marked. It explains that a crew appears once a
  coordinator is assigned, and that canvassers without a coordinator belong to no team report. No
  change to `routes/admin/reports.js`, which the phone app calls.
- **Before every build** of a team report, the coordinator must still run a crew here (a
  `CampaignAssignment` with that `coordinatorId`). If not, the build fails `TEAM_GONE`: "Maria no longer
  runs a crew on this campaign — move Volunteer team to [Sam ▾]". On a draft, `PATCH { team: {
  coordinatorId } }` moves the series and keeps the label, with a History row. A published team report
  whose crew is gone can't be refreshed; it stays as sent.
- **An org without team attribution** (`teamAttributionReadyAt` unset) gets **400
  `TEAM_ATTRIBUTION_NOT_READY`**, and the dialog disables "A team" with that reason.
- **Numbers: each team's own work** (owner ruling 10-24). Doors use `teamMatch` + `NOT_BULK`, matching
  `/team-breakdown`. Surveys, voters, breakdowns and tags use `teamMatch`, matching the crew-filtered
  `/campaign-rollup` and `/survey-results`. A home or voter both teams reached counts for both. Homes
  knocked is **not** compared with the dashboard, whose figure is all-time coverage by design.
- **What the operator and client are told.** Team reports and their PDF carry "A home both teams
  visited counts in each team's report." "Before you publish" shows the window's team sums against the
  whole campaign (cross-team doors and doors no team covered, from the `/team-breakdown` fold), the
  number of canvassers who knocked for this team in the period (with a note when it's one: the report
  then shows one person's work), and "moved since you sent it".
- **Re-stamping.** The current coordinator owns all history. A build that overlaps a coordinator change
  rebuilds (§F2 step 7). The Refresh dialog names "a canvasser changed teams" among the reasons numbers
  move.
- **No door goal** on team reports; `NO_GOAL_SNAPSHOT`'s message gains a team branch. **Mock-GPS
  counts** follow the report's scope: `countOpenMockFlags` gains the walk-list and team clauses.

### F5. Area view

- `visibility.mapMode: 'pins' | 'area'` (a missing value reads as `'pins'`) and `visibility.areaSize:
  'small' | 'large'` → H3 resolution 9 (about 1,100–1,400 ft across, 23–30 acres) or 8 (about 0.55–0.7
  mi across). `h3-js` 4.4.0 is already a server dependency, unused today; `latLngToCell(lat, lng, res)`
  and `cellToBoundary(h, true)` (a closed ring of `[lng, lat]`) were verified.
- **Cells** accumulate in an in-memory map keyed by H3 index for the whole build and are inserted once
  at the end into `ClientReportAreaCell { organizationId, campaignId, clientReportId, snapshotId, h3,
  doors, byStatus, answers }`, unique on `{ snapshotId, h3 }`.
- **What a cell holds.** `doors`: reached doors. `byStatus`: door counts by result, always. `answers`:
  per map question, option counts built through `publicPointAnswer`, **only when at least 5 households
  in the cell answered that question**; otherwise that question is omitted for the cell. No table that
  crosses results with answers. The same rule is enforced again when cells are read.
- **Pins → areas on a published report** is a `remap` build: it reads the live snapshot's points, bins
  them with the same rules, writes cells under a new snapshot, swaps it in and deletes the points. The
  numbers don't change. Areas → pins adds addresses, so it goes through Refresh numbers.
- **Honest wording** wherever the area view is described: it never shows an address; a block's answers
  appear only when at least five people there answered; comparing reports over time can narrow things
  down. Round 1 showed by simulation that two overlapping reports can be subtracted; the owner chose
  answers with this wording (§E).
- **Not clustering.** Cells are fixed hexagons that look the same at every zoom; nothing merges or splits.

### F6. Share links

- **Passwords.** An operator-set password must be at least 12 characters, on create and PATCH (400
  `SHARE_PASSWORD_TOO_SHORT`). Generated passwords stay as they are.
- **`credentialVersion`** (default 0), `$inc`ed by a password change, a rotate and a renewal. The share
  JWT carries `cv`; `requireShareAccess` requires `(payload.cv ?? 0) === (share.credentialVersion ?? 0)`.
  (Round 1 caught the unparenthesised form, which `===` binds before `??`, accepting stale tokens.)
- **Failure budget, atomic.** A wrong-password attempt first reserves a slot: `findOneAndUpdate({ _id,
  failedUnlocks: { $lt: 50 }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }, { $inc:
  { failedUnlocks: 1 } })` (with a reset when `failedWindowStart` is over 24 h old). No slot → **429
  `SHARE_LOCKED`** without a bcrypt compare; a correct password refunds its slot. The 50th failure sets
  `lockedUntil = now + 1 h`; the window is fixed at 24 h. **Unlock now** resets the counter and window.
  A second lock in a window makes the panel say "Someone else may have this link — rotate it", because
  a rotate (new URL, budget reset, `cv` bump) is what actually stops it. The per-IP limiter stays.
- **Nothing before the password.** `GET /share/:token` returns `{ requiresPassword }` only. The
  campaign name, org name and `hasLogo` ride `GET /share/:token/reports`, behind `requireShareAccess`.
  The link's label is never sent.
- **"Last opened"** is stamped in `requireShareAccess`'s success path.
- **Keep me signed in.** `POST /share/:token/unlock { password, remember: true }` returns a 30-day share
  JWT (24 h otherwise). The page keeps it in `localStorage` instead of `sessionStorage` and drops it on
  any 401, 404 or 410. A password change, rotate, renewal, disable or expiry still ends it, because every
  request re-checks the link and `cv`.
- **Expiry within a one-year life.** `lifetimeStartAt` is set at create and by rotate or renewal;
  `expiresAt` may never pass `lifetimeStartAt + 365 days`. Create offers 30, 90, 180 or 365 days (default
  90; `SHARE_LINK_DEFAULT_DAYS` must stay 90 while the policy says "90 days by default"). **Extend** sets
  `expiresAt = max(current, now + days)`, capped by the lifetime, and shows the resulting date; it never
  shortens a link. An **expired** link can't be extended: **Renew** rotates it (new URL, new lifetime,
  `cv` bump, password kept), so a URL forwarded long ago stays dead.
- **Legacy links.** Adding a password also sets `expiresAt` and `lifetimeStartAt`, so the link leaves
  `isLegacyOpen` and the revoke sweep. Badges split into **No password** ("Add a password") and **Never
  expires** ("Set an expiry").
- **Headers.** `Cache-Control: no-store` on every `/share` response, the logo included. robots.txt's
  `Disallow: /r/` is replaced by `X-Robots-Tag: noindex, nofollow` on `/r/` pages: a crawler blocked by
  robots.txt never sees a noindex, and can still list a forwarded link's bare URL. The page shell holds
  no data; `/api` stays disallowed.

### F7. Opens

- **No new collection.** `ClientReport.views`: `{ byLink: { <shareId>: { opens, firstOpenedAt,
  lastOpenedAt } }, members: { admins: { opens, lastOpenedAt }, leads: { opens, lastOpenedAt } } }`,
  updated by one `updateOne` with `$inc`, `$min` and `$max` (40 concurrent opens on one link counted
  exactly 40 in round 1, with no index). The old `viewCount` and `lastViewedAt` stay, shown as "N views
  before per-link counts".
- **An open is a ping, not a fetch.** The page sends `POST /share/:token/reports/:id/opened` once per
  report per browser per day (a `localStorage` key with the date). Prefetching a neighbouring report no
  longer counts, and the view stamp leaves `GET /reports/:id`.
- **Members are counted separately, never discarded.** When the page has a Doorline session it sends
  the token (a new `identifyIfSignedIn` option on `api()`, which keeps `sentToken` null so a stale
  token can't trigger the sign-out handling). The server checks it with `verifySessionToken` +
  `sessionClaims` and a membership lookup, after responding; a failure just counts the open under the
  link. Org admins and super admins go to `members.admins`, leads to `members.leads`, since a lead may
  be the client. This never grants or refuses access.

### F8. Branding

- **`OrgBranding`** `{ organizationId (unique), logo: Buffer, width, height, bytes, updatedAt,
  updatedBy }`, its own collection, because `orgContext` loads the whole `Organization` on every request.
- **Upload.** The browser draws the chosen image (PNG, JPEG or SVG) onto a canvas no larger than 800 ×
  320 and uploads a PNG, which also drops embedded metadata. The server accepts **PNG only**: checks
  the signature and `IHDR` (at most 2,000 px a side and 4 megapixels, so a tiny file declaring a huge
  image is refused), keeps only `IHDR`, `PLTE`, `tRNS`, `IDAT` and `IEND` (dropping text and EXIF
  chunks), and caps the result at 256 KB. multer memory storage with `limits: { fileSize, files: 1,
  fields: 0 }`; a `MulterError` maps to 413 as in `imports.js`.
- `PUT` / `DELETE /admin/branding/logo` behind `requireOrgRole('admin')`; `GET` for admins and leads
  (leads see it read-only, or "No logo yet").
- **Public:** `GET /share/:token/logo` behind `requireShareAccess`. The page fetches it with
  `X-Share-Token` and shows a blob URL (revoked on unmount); an `<img src>` can't send the header, and a
  token in the URL would land in the request logs.
- The PDF draws it with jsPDF's `addImage` and adds a "Powered by Doorline" footer.
- Added to `ORG_SCOPED`; its unique index is built at worker boot (`syncIndexes`, the pattern used for
  other new collections).

### F9. History

The existing campaign History feed, `CampaignChange` (read by `GET /admin/campaigns/:campaignId/history`,
already in both deletion cascades and in `LATE_WRITE_MODELS`), gains `source: 'client_report'`. Rows:
`field: 'clientReport.created | published | edited | numbersRefreshed | refreshDiscarded | takenDown |
putBackUp | deleted | teamMoved'` and `field: 'reportLink.created | passwordChanged | rotated | renewed |
extended | disabled | enabled | locked | unlocked | deleted'`, with small `fromValue` / `toValue` (an
edit keeps the earlier title or observations, which History offers to **Restore**; a refresh keeps the
before-and-after totals). The Client Reports tab's History drawer reads the existing route with a new
optional `?fields=clientReport.,reportLink.` prefix filter, so the route's 200-row cap can't push report
rows out. Leads read this history on their campaigns, so it is customer-facing (§I).

### F10. Next report, dates and wording

- **`POST /:id/next`** creates the following period's draft in the same scope. Idempotent: it claims
  the source with a CAS on `{ _id, nextReportId: null }`, so a double click returns the same draft. It
  is offered only on the latest report of each scope. Dates: the same number of days, starting the day
  after the source's `weekEnd`, computed in the source's frozen `timeZone`, asserting the new range starts
  exactly at the source's `rangeEndUtc`; a source that is exactly one calendar month rolls by month. It
  warns when the new period would start after today. It copies the observations (marked "Copied from Oct
  6 – Oct 12" until the operator ticks "I've reviewed these notes"; the publish confirm repeats it),
  the explicit visible keys, tags, goal tick, headline and map settings, and re-validates the team.
- **Create and Next insert the draft with a recompute build already claimed** and enqueue it in the
  same request (201 with `build`). The builder opens on "Building the first numbers…". Publish stays
  disabled until a snapshot exists.
- **Dates on the server.** "Period not over" is `now < rangeEndUtc`, computed in `GET /:id`. The custom
  default is the day after the scope's last report, else yesterday minus six days to yesterday, in the
  campaign time zone. The "New report" dialog has no "Start from" choice; Next report is the way to
  copy.
- **Period wording.** `periodPhrase(weekStart, weekEnd)` counts civil days (`daysBetween` in
  [goalProgress.js](../server/src/services/reports/goalProgress.js), so a DST week is 7 days) and
  returns "this week", "that day" or "in these N days", plus the noun the other strings need. Every
  weekly string goes through it: the KPI pill and the "No new … this week" lines (`reportDerive.js`), the
  quiet-week banner, the Voters surveyed and goal help, the map's "No mapped doors for this week", the
  hub's heading, and the PDF's title, quiet-week line and filename.
- **When the numbers stop early.** If `statsComputedAt < rangeEndUtc`, the report, its hub row and the
  PDF say "Numbers through Oct 24, 3:10 pm — the period was still running".
- **No tiling claim.** Weekly "+N" figures don't add up to the running total for doors, homes or
  voters: a door reached in two weeks of one round counts in both weeks' "+N" but once in the total.
  The Doors knocked and Homes knocked help text gets the caveat Voters surveyed already has. The gap
  warning between consecutive reports stays, about dates only.

### F11. The client map's payload

- **`GET …/map`** returns a compact, address-free payload for every pins report: `{ ids, lng, lat,
  status, answers: { <questionKey>: [optionIndex …] } }`, columnar arrays built from shaped points
  (`mapKeysFor` only), plus `extent` (frozen at build). A door is about 20 bytes before gzip, so
  100,000 doors is roughly 2 MB.
- **`GET …/map/doors?ids=…`** (at most 200 ids) returns the street line, city, state and answer labels
  for the doors just tapped, or the doors in a tapped building. The building summary uses it.
- Filters and counts run in the browser over the arrays, so "N of M doors" is exact. Pins are drawn with
  a zoom-aware circle radius, never merged. The admin preview uses the same shape.
- The map opens on `extent`. Below `md` it uses `cooperativeGestures` (mapbox-gl 3.23), the filters
  move to a drawer, and the door details sit below the map.

### F12. Models, indexes and cascades

| Model | Change | Indexes |
|---|---|---|
| `ClientReport` | `snapshotId`, `snapshotInputs`, `statsComputedAt`, `editVersion`, `build`, `movedSincePrevious`, `contentEditedAt/By`, `numbersRefreshedAt/By`, `copiedFrom`, `copiedNotesReviewed`, `nextReportId`, `team`, `views`, `visibility.mapMode/areaSize` | none new |
| `ClientReportMapPoint` | `snapshotId` (required on new rows) | `{ clientReportId, snapshotId }` — existing collection, so `migrate:build-indexes` |
| `ClientReportAreaCell` | new | unique `{ snapshotId, h3 }`, `{ clientReportId, snapshotId }` — new collection, built at worker boot |
| `ReportShareLink` | `credentialVersion`, `failedUnlocks`, `failedWindowStart`, `lockedUntil`, `lifetimeStartAt` | none new |
| `OrgBranding` | new | unique `{ organizationId }` — built at worker boot |
| `CampaignChange` | `source` enum gains `'client_report'` | none new |

Every new model declares `organizationId` and `campaignId` (where it has one), because strictQuery
strips undeclared filter keys and a cascade would then delete everything. `OrgBranding` has no
`campaignId` and must never be in the campaign cascade. The campaign cascade
([deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js)) and `ORG_SCOPED`
([deleteOrganization.js](../server/src/services/platform/deleteOrganization.js)) gain
`ClientReportAreaCell`; `ORG_SCOPED` also gains `OrgBranding`. `LATE_WRITE_MODELS` gains
`ClientReportMapPoint` and `ClientReportAreaCell`. [buildIndexes.js](../server/src/migrations/buildIndexes.js)
gets a per-model try/catch, so one model's failure no longer stops every model after it. The demo seed
([seedDemoOrg.js](../server/src/services/platform/seedDemoOrg.js)) builds its report with the new
builder, and its reset also deletes cells.

### F13. Endpoints

| Endpoint | New or changed |
|---|---|
| `POST /admin/client-reports` | Changed: `team`, explicit keys, claims a recompute (201 with `build`) |
| `PATCH /admin/client-reports/:id` | Changed: targeted `$set`, published edits, `NEEDS_REFRESH`, `REPORT_BUSY`, team move on drafts |
| `POST /admin/client-reports/:id/recompute` · `/refresh` · `/remap` | Claim a build (202 with `build`) |
| `GET /admin/client-reports/:id/build` | New: progress and state |
| `POST /admin/client-reports/:id/refresh/apply` · `/refresh/discard` | New |
| `POST /admin/client-reports/:id/publish` | Changed: freezes the previewed snapshot (no build) |
| `POST /admin/client-reports/:id/unpublish` | Kept; UI label "Take down" |
| `POST /admin/client-reports/:id/preview` | New: overlay preview for drafts and published edits, through the public shapers |
| `GET /admin/client-reports/:id/preview/map` · `/preview/map/doors` · `/preview/areas` | Read the draft's live snapshot |
| `POST /admin/client-reports/:id/next` | New, idempotent |
| `GET /admin/client-reports/teams?campaignId=` | New: the team picker |
| `POST/PATCH /admin/client-reports/shares…` | Changed: password length, expiry, extend, renew, unlock, `cv` |
| `GET /admin/campaigns/:campaignId/history` | Changed: optional `fields` prefix filter |
| `PUT/GET/DELETE /admin/branding/logo` | New |
| `GET /share/:token` | Changed: `{ requiresPassword }` only |
| `POST /share/:token/unlock` | Changed: `remember`, atomic failure budget |
| `GET /share/:token/reports` | Changed: also campaign name, org name, `hasLogo` |
| `GET /share/:token/reports/:id` | Changed: shaped per §F1; no longer counts an open |
| `POST /share/:token/reports/:id/opened` | New |
| `GET /share/:token/reports/:id/map` · `/map/doors` · `/areas` · `GET /share/:token/logo` | Changed or new, behind `requireShareAccess` |

## G. Design: the admin pages

Built from the existing pieces (`Card`, `Badge`, `Button`, `Modal`, `Segmented`, `NextStepBanner`) and
the semantic tokens. Small status text on a tint uses the `text-*-fg` tokens, as `Badge` does
(`makeRateColors` is the phone app's helper). Light theme only.

### G1. The Client Reports tab

```
┌ Client Reports ───────────────────────────────────────────────────────────────────────┐
│ Reports your client opens from a link.          [ New report ] [ History ]            │
│                                                                                       │
│ ┌ Reports ─────────────────────────────────────────────┐ ┌ Client links ──────────────┐│
│ │ [ Whole campaign ] [ Volunteer team ] [ Paid team ]  │ │ Candidate          Active  ││
│ │                                                      │ │ doorline.app/r/e67T… [Copy]││
│ │ Oct 13 – Oct 19  Published · Edited Oct 21           │ │ Expires Jan 21 · Extend    ││
│ │ 3,412 doors (+412) · 1,980 surveys (+260)            │ │ Last opened Oct 22         ││
│ │ Opened via Candidate: 2 visits · Consultant: 1       │ │ Password · Rotate · More ▾ ││
│ │ [Open] [Next report] [Copy message] [More ▾]         │ │ [ + New link ]             ││
│ │ Oct 6 – Oct 12   Published                           │ └────────────────────────────┘│
│ │ Oct 20 – Oct 26  Draft · Building… 62% (mapping)     │ ┌ Report branding ───────────┐│
│ │ ── Oct 27 – Oct 28 not covered by any report ──      │ │ [logo]  Change · Remove    ││
│ └──────────────────────────────────────────────────────┘ └────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- Build states on rows and in the builder: **Waiting** ("for the answer edit on this campaign to
  finish"), **Building n%** (phase), **New numbers ready to review**, **Failed** (reason + Retry),
  **Stalled** (no heartbeat for 5 minutes + Retry).
- **Next report** appears only on the latest report of each tab. **More ▾**: Take down, Delete (on a
  published report the warning names the live links it shows on).
- Below `lg`, the right column stacks under the reports.

### G2. New report

```
┌ New report ──────────────────────────────────────────────────────┐
│ Covers       (•) Whole campaign                                  │
│              ( ) A team       [ Maria's crew (current) ▾ ]       │
│                   Name your client sees [ Volunteer team      ]  │
│                   Never the coordinator's name.                  │
│              [ ] Only one walk list  [Choose ▾]                   │
│ Period       [Oct 20] – [Oct 26]   7 days                        │
│              Starts the day after your last Volunteer team report│
│ Title        [                              ]  optional          │
│                                     [Cancel]  [Create draft]     │
└──────────────────────────────────────────────────────────────────┘
```

The team picker lists current crews first and former crews marked, and explains missing crews and
canvassers without a coordinator. "A team" is disabled with the reason when the org isn't ready for
teams. An existing label pre-fills for the chosen crew.

### G3. The builder, on a draft

```
┌ ‹ All reports ─────────────────────────────────────────────────────────────────────────┐
│ Oct 20 – Oct 26  [Draft]  Team: Volunteer team                  Saved · just now       │
│ Numbers as of Oct 27, 9:14 am · Recompute                               [ Publish… ]   │
├───────────────────────────────────────────┬────────────────────────────────────────────┤
│ BEFORE YOU PUBLISH                        │ PREVIEW: exactly what your client sees      │
│ ! 3 unreviewed mock-GPS flags   [Review]  │ [logo] Fall 2026 · Fox Bryant              │
│ ! Period isn't over (ends Oct 26)         │ Oct 20 – Oct 26 · Team: Volunteer team     │
│ i Oct 13 – Oct 19 report: 1,200 doors     │ Doors knocked 3,412   +412 this week       │
│   when sent, 1,180 now (canvassers        │ …                                          │
│   changed teams)                          │                                            │
│ i 6 canvassers · 14 homes both teams      │                                            │
│ i 12 of 980 answers edited by an admin    │                                            │
│ [ ] I've reviewed the copied notes        │                                            │
│ OBSERVATIONS                [+ Section]   │                                            │
│ SURVEY QUESTIONS           Show: All·None │                                            │
│ Question                 Chart  Map  Headline                                          │
│ Support for Smith?        [x]   [x]   (•) │                                            │
│ Bond measure?             [ ]   [–]   ( ) │                                            │
│ VOTER GROUPS  hidden until ticked         │                                            │
│ MAP  [x] Show the map                     │                                            │
│      (•) Exact doors ( ) Areas [Small ▾]  │                                            │
│      Map preview is from 9:14 am, before  │                                            │
│      your map changes — Recompute         │                                            │
└───────────────────────────────────────────┴────────────────────────────────────────────┘
```

- **Auto-save** after 800 ms of quiet, through targeted PATCHes. The preview uses `POST /:id/preview`
  with the on-screen state, so it never waits for a save and is shaped by the server.
- **Leaving.** There is no data router (`<BrowserRouter>`, so `useBlocker` can't be used). The builder
  guards its own Back and tab links, flushes a pending save on unmount with `fetch(…, { keepalive: true
  })`, and sets `beforeunload` while a save is pending or failed. On a published report, an unapplied
  edit is kept in `localStorage` and offered back ("Restore your unsent edit").
- Every action reports errors in a banner under the header.

### G4. The builder, on a published report

```
│ Oct 13 – Oct 19  [Published · Edited Oct 21]   Opened via Candidate: 2 · Consultant: 1  │
│ [ Edit ]  [ Refresh numbers ]  [ Copy message ]  [ Take down ]                            │
```

**Edit** unlocks the left column and previews the edit before **Update report** sends it. Map additions
read "Add this with Refresh numbers". Removing the map asks first: "This deletes the frozen map;
turning it back on rebuilds every number." Refresh is disabled while an edit is open.

```
┌ Refresh numbers? ────────────────────────────────────────────────┐
│ Map changes to include:  [x] Switch to areas (Small)             │
│ Rebuilt from records as of Oct 28, 3:10 pm, for Oct 13 – Oct 19. │
│                       Now        After                           │
│ Doors knocked         3,412      3,420   (+8)   +412 → +420      │
│ Surveys taken         1,980      1,983   (+3)                    │
│ Voters surveyed       1,702      1,704   (+2)                    │
│ Connection rate       58%        58%                             │
│ Contact breakdown, support split, voter groups, door goal  [▾]  │
│ Doors on the map      2,101      areas: 84                       │
│ Why numbers move: late uploads, answer edits, unknocks, or a     │
│ canvasser changed teams, inside this period.                     │
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
│ • It shows on 2 active links: Candidate, Consultant.             │
│                                        [ Cancel ]  [ Publish ]   │
└──────────────────────────────────────────────────────────────────┘
```

With no live link the last line reads "No live link: your client can't see it until you create one".

### G6. The copy-ready message

Offered on every published report, for active, unexpired, unlocked links only (a select when there are
several); disabled with "Create a link first" when there are none. Built from the shaped report and the
campaign type:

> The Volunteer team report for Oct 13 – Oct 19 is up: 3,412 doors knocked (+412 that week) and 1,980
> surveys (+260). Open it here: https://doorline.app/r/…/reports/… — use the password I sent you.

It deep-links to the report, names the scope, uses "that week" or the dates (it is read later), and
never contains the password.

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
**Expired** (**Renew**: "gives this link a new address — send your client the new link"), **Locked**
("50 wrong passwords in 24 hours; unlocks at 4:10 pm · Unlock now", and on a second lock "Someone else
may have this link — Rotate"), and for legacy links **No password** and **Never expires**. **Extend**
shows the resulting date and offers only later ones, up to a year from when the link was made. "Last
opened" means the password was accepted.

### G8. Report branding

A card on the tab: the logo, **Upload** and **Remove** for admins (any image; converted in the browser),
plain errors, and "Set by an admin" or "No logo yet" for leads.

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

One handler for every share call: **401** → back to the gate with "This link needs its password. If it
no longer works, ask the person who sent it — it may have changed" (and the cached meta is refetched, so
a legacy open link that gained a password shows the gate); **404** "This link isn't available"; **410**
the server's message ("ask them to renew it"); **429** "Too many attempts. Try again later, or ask the
person who sent you this link"; map **404 `MAP_NOT_SHARED`** → the map section is hidden; network or
server errors → "Couldn't load — Try again".

### H2. The hub

```
┌ [org logo]  Fall 2026 · Fox Bryant ─────────────────────────────────────────┐
│ [ Whole campaign ▾ ]                                                         │
│ LATEST  Oct 13 – Oct 19 · Whole campaign                Edited Oct 21        │
│ Doors knocked 3,412  +412 that week      Surveys taken 1,980  +260           │
│ Doors knocked, as each report was published: 2,104 … 3,412  ▁ ▂ ▃ ▅ ▆ ▇     │
│ Oct 13 – Oct 19    3,412 doors  +412    Edited Oct 21                    ›   │
│ Oct 6 – Oct 12     3,000 doors  +380                                     ›   │
│                                                     Powered by Doorline      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Scope tabs (a select on phones) appear when more than one scope has reports; Whole campaign is the
default. LATEST, the trend and the list follow the selected scope. The trend states what it plots, its
first and last values, and has an `aria-label`. Grouping uses the public `scope.label`, never an id.

### H3. A report

Desktop is today's page plus the logo header, the scope label, "Published Oct 20", "Edited Oct 21" and
"Numbers refreshed Oct 28" (later first), the "Numbers through …" note when it applies, **Older** /
**Newer** within the scope, the team note on team reports, and the period phrase everywhere. On a phone:

```
┌──────────────────────────────┐
│ [logo] Fall 2026             │
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

Hexagons shaded by doors reached, with a legend that includes "not enough answers to show" for areas
under the 5-respondent threshold, drawn in their own style, never as 0%. Tapping one: "38 doors reached
· Surveyed 21 · Didn't answer 12 · Declined to participate 5", using the report's own labels, then the
answer counts for each map question that passes the threshold. An answer filter recolours areas by
matching answers ÷ that question's answers in the area.

### H5. PDF

The logo top left; the scope label, period phrase, published, edited and refreshed dates in the header;
"Numbers through …" when it applies; the team note; "Powered by Doorline" in the footer; no map. The
filename carries the campaign, scope and both dates.

## I. Privacy and legal

**These fixes make what our Privacy Policy says about published reports true again.** privacy.html line
101 says the map shows door statuses "and, where the customer chooses, responses to selected survey
questions, shown at the address level". Today a customer who turned the map off still has address-level
points served behind the link (B1), and hidden question names still reach the client (B2, B8). §F1 fixes
both, for published reports too. Gap 34 in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) records
them and closes when this ships.

| Change | What it touches | Policy text |
|---|---|---|
| §F1 visibility enforced; payload trimmed; cleanup migration | Less exposed, less kept | Makes line 101 true. No edit. |
| §F6 expiry picker, one-year life, renew = new URL | "after 90 days by default, or a period of up to one year chosen by an administrator" | Keeps the sentence true: no link outlives a year, an expired URL never comes back, the default stays 90. |
| §F6 `cv`, atomic lockout, nothing before the password | Less exposed | No edit. Terms §6 ("anyone with an unrevoked, unexpired link (and its password) can view the report") is briefly untrue during a lock; it's a risk disclosure, so no edit is proposed. |
| §F6 keep signed in (opt-in, 30 days) | A longer-lived token on the client's own device, ended by any credential change | No edit. |
| §F4 team reports | Operator-typed team name; never a coordinator's name. A one-person team report shows one person's work (the builder says so) | No edit: "exclude … canvasser identities" holds. |
| §F5 area view | No addresses; answers only where 5+ answered; can be narrowed by comparing reports | No edit. Optional owner refinement: "shown at the address level" over-describes an area report. |
| §F7 per-link opens | Which link opened which report, how often, first and last time; members counted separately. No IP, no device. | **Owner ruled 10-24: no policy sentence.** Recorded in the privacy record. |
| §F8 logo | New in-tenant collection, deleted with the org; metadata stripped | No edit. |
| §F9 history | Staff names on report and link events, the earlier text of edits; readable by leads, who may be the client | No edit; recorded as customer-facing. |

**No new subprocessor.** H3 is a code library, the logo is stored in our MongoDB, area hexagons are
drawn on the Mapbox tiles the map already loads, and Mapbox's Static Images API is not used. The DPA §6
list is unchanged.

**Deliberately not included:** emailing clients and named recipients (ruled out), recording viewer IP
addresses or devices, pin clustering, rounding or suppressing counts (counts stay exact; area answers
use the 5-respondent rule instead).

## J. Docs, Help Center and copy

- [CLIENT_PORTAL.md](CLIENT_PORTAL.md): Part 1 and Part 2 rewritten.
- [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): gap 34 closed; D11's rows updated ("expiry cannot
  be extended", "metadata is never gated", "no rate limit or logging", "password change ≠ revocation"),
  plus new entries for area cells, per-link opens (with the owner's ruling), keep-signed-in and History.
- Help Center: [guides/client-reports.md](../server/src/content/help/guides/client-reports.md) (the
  build, publish, edit, refresh, take-down, team, area, link and branding sections),
  [pages/page-client-reports.md](../server/src/content/help/pages/page-client-reports.md),
  `faq/fix-one-survey-answer.md`, `guides/campaigns-manage.md`, `pages/page-door-outcomes.md` (a
  published report now changes through **Refresh numbers**, not "publish it again"),
  `faq/team-door-counts.md` (team reports don't add up to the campaign) and `faq/how-many-doors-a-day.md`
  (no goal on team reports); new FAQ entries through `_INBOX.md`: "Why did my client's link ask for the
  password again?", "How do team reports work?", "Exact doors or areas?".
- In the app: `components/outcomes/AnswerEditReviewModal.jsx` ("a published client report until you
  publish it again" → "until you refresh its numbers").
- Homepage (owner ruling 10-24): `marketing/CredibilityStrip.jsx`, "Client reports freeze when
  published; the numbers never change under you" → "Client reports freeze when published. Numbers
  change only when you refresh them, and the report says when."
- Other docs that describe today's behavior: CAMPAIGNS.md, MAPS.md, DEPLOY_RUNBOOK.md.
- This file gets an "As built" section.

## K. Tests and verification

**Server integration** (extend [reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js),
plus a new `clientReportBuild.int.test.js`):

- Every verified defect (B1-B8), flipped to assert the fix; the legacy-empty-list migration both ways.
- **Builder parity**: the oracle fixture in §F2, at the default batch and at `CLIENT_REPORT_BATCH=2`.
- **Fence**: knocks inserted mid-build don't count and the breakdown still equals Doors knocked.
- **Attempts**: a stall redelivery writes under a new snapshot and leaves no duplicates; a duplicate
  delivery exits; the `failed` listener marks the build; an enqueue failure parks it; a lost job is
  reclaimable after 5 minutes.
- **Deletion mid-build** with the real `deleteOrganization()` and `deleteCampaign()` leaves no rows.
- **Changes mid-build**: an answer edit, unknock, conversion, relabel, re-cut and (team) coordinator
  change each trigger the one rebuild; a second hit fails; a running change makes the build wait.
- **Sweep**: spares live, current-build and fresh rows; deletes orphans and map-off rows.
- **Publish**: freezes the previewed snapshot; refused on a stale `editVersion` or changed map settings;
  no publish on a published report.
- **Refresh**: Apply swaps atomically; Discard cleans up; Take down, Delete, map-off and a new claim all
  invalidate a `ready` result.
- **PATCH**: no lost update against a concurrent commit; published-edit rules; `$pull` on a dropped
  key.
- **Team**: parity with `/team-breakdown` (doors) and the crew-filtered rollup (surveys, voters, tags);
  `TEAM_GONE`, the label rules, the readiness 400; the team map with a restricted door; no goal; scoped
  mock-GPS counts.
- **Area**: no point rows; the 5-respondent rule on write and read; remap keeps the numbers.
- **Links**: password length; `cv` 0→1→2 plus a fresh unlock at 0; 300 concurrent wrong guesses → 50
  bcrypt compares; the lifetime cap; renew changes the URL; extend never shortens; legacy upgrade sets
  expiry; meta returns only `requiresPassword`; "last opened" only after access; `remember`.
- **Opens**: one ping per day per report; members bucketed; deleted links fall back.
- **Branding**: PNG passes; JPEG, SVG, oversize, a huge-`IHDR` bomb and a lying file fail; text and
  EXIF chunks are stripped; `/logo` needs access; the org cascade removes it.
- **History**: every event writes a `CampaignChange` row; Restore puts the earlier text back.

**Client:** `reportDerive` tests for `periodPhrase` (a DST week is 7 days), every routed string, the
support subtitle and the copy message; render smoke tests for the per-question rows, the link badges, the
gate's states and the area legend; an effects test (auto-save, re-gate on 401, keep signed in) on the
pattern of `client/src/lib/doorOutcomesEffects.smoke.test.js`.

**Verification before hand-over:** re-run round 1's probes against the built tree; seed a **synthetic**
campaign the size of Collier and time a build while watching the worker's memory; walk every screen
above in the browser, at phone width too.

## L. Rollout

1. Before deploying: `npm run audit:mobile-api` (the history route gains a parameter; additive).
2. Server deploy from `main`; the web build and Help Center ride along. No OTA, no client-version gate.
   The worker builds the new collections' unique indexes at boot.
3. Heroku dashboard → **More → Run console**: `npm run migrate:build-indexes` (dry run). It should list
   only the new `ClientReportMapPoint` index; then `npm run migrate:build-indexes -- --apply`.
4. Same console: `npm run migrate:client-report-visibility` (dry run). Read the list of reports whose
   operator unticked every question and decide; then `npm run migrate:client-report-visibility --
   --apply` (add `--keep-legacy-all` to keep their charts).
5. Owner checks: map off on an existing published report → no map, `/map` 404; a team report beside the
   dashboard's team numbers; a password change signs out an open tab; Refresh numbers before and after.

## M. Review plan

Round 1 ran 2026-10-24 (§N). Round 2 targets what this revision introduced: the household walk, the
fence, per-attempt snapshots, the build and publish model, refresh inputs and remap, team series,
the compact map payload, keep signed in, opens, the lifetime cap, the lockout, the branding pipeline;
plus a coverage audit that every accepted round-1 finding landed correctly, and an owner walkthrough.

## N. Review log

**Round 1 (2026-10-24).** Five reviewers, each with a lens: concurrency and data integrity, numbers,
privacy and security, an owner walkthrough, and simplicity and feasibility. About 90 findings, 12 marked
blocker; many were found by two or three reviewers independently. Each blocker and major was checked
against the code before it was accepted. What changed because of them:

- **Deletion:** a build could write a deleted organization's addresses after the cascade had passed
  (reproduced with the real `deleteOrganization()`). Now the build checks for deletion, the commit runs
  under `sweptAfter`, and the sweep removes orphans.
- **Consistency:** chunked reads let late knocks break "the breakdown adds up to Doors knocked"
  (reproduced). Now there is one fold from one household walk, a fence and an invariant check.
- **Retries:** redeliveries reused the claim's snapshot (duplicate doors), a lost job stayed queued
  forever (reproduced), nothing marked failures, and the "previous snapshot" delete filters could wipe
  legacy or pending rows (reproduced). Now each attempt owns a snapshot, beats and fails visibly, and
  deletes by exact id.
- **Changes during a build:** re-cuts release their lock before the check (reproduced), and relabels
  and coordinator re-stamps weren't checked. Now the check covers each, with clock-skew margin.
- **Refresh:** a pending result could roll a re-published report back, and map additions had no path.
  Now there is one `build` object, invalidated by every competing action, and the Refresh dialog carries
  map changes.
- **Publish** froze numbers nobody previewed. Now it freezes the previewed snapshot, instantly.
- **Lost update:** a PATCH could overwrite a just-committed refresh (reproduced). Now PATCHes are
  targeted `$set`s.
- **Privacy:** hidden question keys leaked in two more fields (verified, now B8); Extend and revive
  would have made the expiry sentence false; the lockout wasn't atomic (reproduced) and could be used to
  lock the client out; the area-view promise was false (simulated); the `cv` check had a precedence bug
  (three reviewers); the logo path allowed a decompression bomb and EXIF (verified); a server-side map
  filter would have answered questions about hidden answers.
- **Numbers:** team reports don't partition (the owner chose "each team's own work" with a note);
  weekly "+N" doesn't tile with the totals; the support subtitle counts answers, not people;
  `distinct` vs `$group` null handling; mock-GPS counts ignored the scope.
- **Owner walkthrough:** team series breaking when a coordinator leaves; the hub, trend and message
  ignoring scope; "Updated" hiding a refresh; missing build states; the client's error handling;
  phone usability; misleading view counts; copy elsewhere in the product that would become false.
- **Simplicity:** dropped the planned views collection (counters on the report), the planned history
  collection (`CampaignChange` already is one), the `publish` build kind, the `/hub` endpoint,
  `questionsMode` (a migration instead), viewport paging (the compact payload instead) and the "Start
  from" radio; kept the failure budget plus per-IP limiter, and read-time stripping plus the migration.
- **Rejected or changed:** rounding or complementary suppression of area counts (counts stay exact);
  refusing small team reports (a note instead; a one-canvasser campaign's whole report already shows
  one person's work); a unique index on `{ snapshotId, householdId }` (legacy rows share a null
  snapshot id; per-attempt snapshots make it unnecessary); a "No team" option (not offered; explained).
- **Found in passing, outside this plan:** the dashboard's team views disagree about desk-entered
  (`bulk`) knocks: `/campaign-rollup` and `/knocks-by-pass` count them for a lead's team,
  `/team-breakdown` doesn't. Reported to the owner.
