# Proposal: Find phones with a wrong clock — a read-only check (gap G5)

> **Status: BUILT 2026-10-31 (uncommitted) to plan v2, after one review round (three reviewers); the owner said
> to build once the round came back clean. Where the build differs is in §L, As built.** Gap G5 of [PROPOSAL_RECENT_VISITS.md](PROPOSAL_RECENT_VISITS.md): a phone with a
> wrong clock records wrong visit times. The owner chose (2026-10-31) to find out first whether it happens
> at all, with a read-only check, and to decide the rest from what it finds. One server deploy; nothing for
> phones; no migration, no new index, no config var; the check writes nothing and prints totals only. What
> the review changed is in §K. Line references are to HEAD `95a532e`.

Related: [OPERATIONS.md](OPERATIONS.md) (where the command is listed),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the rule for staff-facing console output, items 27(c),
39(e), 43(g) and 44(g)), [TIMEZONES.md](TIMEZONES.md) (what "a day" is),
[PROPOSAL_RECENT_VISITS.md](PROPOSAL_RECENT_VISITS.md) (gap G5).

# Part 1 — For everyone

## The problem

Every visit a canvasser records carries the time the phone says it is, and Doorline keeps that time as it
is. It can't use the time the visit reached us instead, because a visit saved without signal reaches us
later, sometimes hours later, and the time on it is the true one.

So when a phone's clock is wrong, every visit from it carries the wrong time. Reports, the door counts sent
to FbTime (counted by day) and Turf Cutting's **Visited in the last N days** line all read it as recorded.
A phone two hours behind puts an 8:30 pm visit at 6:30 pm; a phone a day behind puts Monday's visits on
Sunday. Phones set their clocks automatically unless someone turns that off, so nobody knows today whether
any phone is off.

## What the check does

One command, run from the Heroku dashboard like the other checks:

```
npm run audit:phone-clocks
```

For every visit (or every visit since a time you give it), it compares two times Doorline already stores:
the time the phone put on the visit, and the moment our server received it. A visit can reach us late (a
weak signal, a phone pocketed mid-save, no signal at all), but it can never reach us **before** it was
recorded. So the check reads each canvasser's day from its most prompt visits:

- **A phone behind:** every visit that day, even the most prompt, reached us 5 minutes or more after the
  time on it. One visit that arrived within 5 minutes clears the day.
- **A phone ahead:** 3 or more visits reached us 5 minutes or more *before* the time on them, which can't
  happen on a right clock.
- **Not judged:** a day with nothing close enough to tell (for example, everything sent hours later from
  the phone's queue). Never counted as right.

It needs 3 or more live visits from at least 3 different ten-minute stretches to call a phone behind. A slow
moment on our side releases its late visits all at once, in one stretch, so it can't do that.

## What it shows, and what it doesn't

Totals across every customer organization: how many canvassers' phones were off by 5 minutes or more, on
how many canvasser-days, by how much (5 minutes to under an hour, 1 hour to under a day, a day or more) and
which way, whether it looks like a time zone set by hand, and whether any phone was still wrong in the last
2 days. With 3 or more canvassers found, it also prints how many visits carry the wrong time, how many of
those would land on a different day, and the dates.

**It never names an organization, a campaign or a person.** It never even reads a name. Any count of
canvassers under 3 reads *fewer than 3*, and with fewer than 3 found it withholds visit counts and dates,
because a lone canvasser's numbers could be matched to them. The reason: Doorline staff open a customer's
visit records in the product only under a support-access session they start, which names a reason, expires
on its own, is logged and emails the customer's billing contacts. Outside one, staff screens show each
organization's members and how many visits each recorded. Our Terms allow staff to keep aggregate
statistics that identify no customer and no person, and this check stays inside that. So it tells you
**whether** it happens and **how much**, not **where** or **who**.

## What you'd do with the result

- **None found:** no phone was off through the day you ran it. Phones can still go wrong later, so run the
  quick re-run Monday evening (below).
- **Found, before Election Day:** message your crews today: *turn on automatic date and time*. On an iPhone
  that's Settings → General → Date & Time → Set Automatically; on Android, Settings → System → Date & time
  → Set time automatically. The check can't say which organization, so whether to give other customers'
  admins the same tip is your call.
- **Not judged / too little to tell:** most days had nothing prompt enough; run it again after a day of
  live canvassing.
- **"Off by the same amount":** if most phones on a day read off by the same amount, that points at our
  server's clock or the data, not phones. Tell me before acting on it.

After Election Day, if phones were found, two follow-ups are yours to choose:

1. **The phone tells its own canvasser** (§G): our server already sends its clock with every map refresh,
   so the phone can compare and show *Your phone's clock is about 2 hours behind. Turn on automatic date and
   time.* Nothing stored, nothing sent, nobody else sees it. A phone update; it can't reach the old Android
   app, and a phone only gets it after a restart.
2. **Fix the times already stored.** That rewrites customers' records and moves visits between days in
   reports and in FbTime's daily door counts, so it needs its own plan, a privacy-record entry and notice
   to the customers it touches. The check's visit count is an upper bound, not the list of visits to fix.

## When and how to run it

1. Deploy the server from `main` in the Heroku dashboard, when no crew is out.
2. **Sunday evening, 8:30–9:30 pm Central** (two nightly jobs read every visit at 9:47 and 10:07 pm once
   daylight saving ends), or after 11 pm: in **More → Run console**, type `npm run audit:phone-clocks`. It
   should take seconds to a couple of minutes. Wait for *Nothing was changed.* Running it again is safe.
3. Paste the output back to me (it holds totals only), so the privacy record and G5 can be stamped.
4. **Monday evening**, the quick re-run of Monday's visits only:
   `npm run audit:phone-clocks -- --since=2026-11-02T00:00-06:00` (Central is −06:00 from Nov 1; a bare
   date like `2026-11-02` means midnight UTC, which is 6 pm Central the day before).

## The owner's decisions

Nothing to decide before the build. A phone counts as wrong at **5 minutes or more**. The check prints
totals only; naming organizations would need your reading of the Terms' staff-access sentence (the
question item 43(g) left open on Oct 28), so it doesn't.

# Part 2 — Technical reference

## A. What exists today (verified at `95a532e`)

- **The phone's time.** The phone stamps `timestamp: new Date().toISOString()` when it submits a save, after
  the location gate ([recordAction.js:418–422](../mobile/lib/recordAction.js#L418-L422)). A save that fails
  or times out is queued, and the queue sets `wasOfflineSubmission: true` on it
  ([offlineQueue.js:52](../mobile/lib/offlineQueue.js#L52)); the queued copy keeps the original time.
- **A live save can arrive minutes late.** The 20 s abort ([api.js:25](../mobile/lib/api.js#L25)) is armed
  only after `await getToken()` and `await loadActiveOrgId()` (:57, :61); it is a JS timer, which React
  Native pauses while the app is in the background; iOS suspends the app (no background modes); React
  Native's Android HTTP client has no timeouts of its own; and pocketing the phone mid-save is routine
  ([recordAction.js:222–232](../mobile/lib/recordAction.js#L222-L232)). A first delivery that lands late is
  stored as a live row, and the queued retry of the same tap answers `superseded` and writes nothing
  ([canvass.js:320–330](../server/src/routes/mobile/canvass.js#L320-L330)). Shown in review on a throwaway
  database: a delivery 7 minutes late stored live with a 7-minute lag.
- **The server keeps the phone's time.** Two save paths write visit rows, both unclamped:
  `const ts = data.timestamp ? new Date(data.timestamp) : new Date()` — door results (time at
  [canvass.js:460](../server/src/routes/mobile/canvass.js#L460), row at :542) and surveys (time at :913, row
  at :1114). `CanvassActivity` has had `timestamps: true` since the first commit
  ([CanvassActivity.js:162](../server/src/models/CanvassActivity.js#L162)), so `createdAt` is the dyno's clock
  when the row was written; `wasOfflineSubmission` is stored (:103). Desk marks are `via: 'bulk'`, written by
  the server.
- **Rows put back keep their receive time.** Snapshot restore copies `find({ passId }).lean()` rows and
  re-inserts them raw ([snapshot.js:44](../server/src/services/turf/snapshot.js#L44),
  [:172](../server/src/services/turf/snapshot.js#L172)); an Unknock revert re-inserts its frozen rows raw,
  byte-exact, original `_id` ([unknock.js:536–543](../server/src/services/canvass/unknock.js#L536-L543)).
  Reclassify, survey conversion and the old migrations update in place
  ([surveyConversion.js:540, 624](../server/src/services/canvass/surveyConversion.js#L540)). Nothing calls
  `replaceOne` or `findOneAndReplace` on visit rows.
- **Demo data would read as wrong clocks.** The demo story inserts rows whose `timestamp` is staged in the
  past and lets Mongoose stamp `createdAt` at seeding time
  ([demoActivity.js:116–137, 312](../server/src/services/platform/demoActivity.js#L116)); nine in ten are
  live (:173). The demo org is `isInternal` ([Organization.js:19](../server/src/models/Organization.js#L19));
  internal organizations and those being deleted are skipped as `replay:pace-pause` skips them
  ([replayPacePause.js:102](../server/src/migrations/replayPacePause.js#L102)). Campaigns being deleted carry
  the same `deletion.requestedAt` ([Campaign.js:130](../server/src/models/Campaign.js#L130)).
- **The neighbors to copy.** `audit:gps-stamps` ([auditGpsStamps.js](../server/src/migrations/auditGpsStamps.js)):
  read-only, counts only, arguments checked before connecting, a strict `--since=` parser (:45–76), and a
  child-process test ([auditGpsStamps.int.test.js](../server/test/auditGpsStamps.int.test.js)).
  `replay:pace-pause`: the small-count rule, `small = (n) => (n > 0 && n < 3 ? 'fewer than 3' : …)`
  ([replayPacePause.js:21–22, 46](../server/src/migrations/replayPacePause.js#L46)). The read-only connect:
  `connectDb(uri, { autoIndex: false, autoCreate: false })`
  ([reportAllReportsLinks.js:48](../server/src/migrations/reportAllReportsLinks.js#L48)). A day in a zone:
  `zonedDayStr(instant, tz)` and `zonedDayRange` ([timezone.js:51, 77](../server/src/utils/timezone.js#L77)).
- **What staff see without a grant:** every organization's members and, per member, visit counts and first
  and last visit ([superAdmin/organizations.js:396](../server/src/routes/superAdmin/organizations.js#L396);
  [userOversight.js:39–50](../server/src/services/platform/userOversight.js#L39-L50)). Support grants are
  started by staff, name a reason and email the customer
  ([superAdmin/access.js:31, 52–70](../server/src/routes/superAdmin/access.js#L52-L70)).
- **The server already sends its clock to the phone** as `serverTime` on every `GET /mobile/changes`
  ([bootstrap.js:582](../server/src/routes/mobile/bootstrap.js#L582), route at :469); the phone uses it only
  as its next `since` ([map.jsx:582, 639](../mobile/app/(app)/map.jsx#L582)). For §G.
- **FbTime's daily door counts** group by the day of `timestamp`
  ([fbtime/doorCounts.js:186–196](../server/src/services/fbtime/doorCounts.js#L186-L196)).

## B. The rule

For each phone save (a `CanvassActivity` row with `via` not `'bulk'` and a readable `timestamp` and
`createdAt`): **lag = `createdAt` − `timestamp`**. A right clock gives lag ≥ 0 (delivery delay only ever adds
lag); a clock behind by B gives lag ≥ B; a clock ahead by A gives lag = delay − A, negative whenever the
delay is shorter than A.

**Canvasser-day** = `userId` × organization × campaign × the day of `createdAt` (the server's clock, so a
wrong phone can't move it) in the campaign's zone: `campaign.timeZone`, else the organization's, else
`America/New_York`. With `--since`, a canvasser-day whose day starts before `since` (in its zone) is not
judged: it would hold only part of a day.

`WRONG` = 5 minutes. For each canvasser-day:

1. **Ahead** when 3 or more saves, live or queued, have lag ≤ −`WRONG`. Size: the largest of those −lags
   (the clock is ahead by at least that much).
2. **Behind** when no save that day (live or queued) has lag < `WRONG`, and there are 3 or more live saves in
   3 or more different 10-minute windows of `createdAt`. Size: the smallest live lag (at most that much).
   A slow stretch on the server lands its late rows together, in one window; a wrong clock shows in every
   window.
3. **Right** when neither, and at least one save has |lag| < `WRONG`.
4. Otherwise **not judged**.

Sizes: 5 min to under 1 h · 1 h to under 24 h · 24 h or more. *Looks like a time zone set by hand*: a size
of at least 1 hour within 3 minutes of a whole number of hours.

For the totals:

- **Canvassers** are distinct `userId`s (one person in two organizations counts once).
- **Visits with the wrong time** on a wrong day: every save that canvasser made that day. An upper bound (a
  clock fixed mid-day, or a second phone, adds right-time saves).
- **On a different day:** of those, the saves whose day in the campaign's zone changes when the size is
  applied (`timestamp` + size for behind, − size for ahead).
- **Latest day:** for each canvasser found, their newest canvasser-day: still wrong (and within the run day
  or the day before, in its zone), right, not judged, or older than the day before the run (not seen in the
  last 2 days). Printed as yes/no per state, never as counts, so no small group can be worked out.
- **Off by the same amount:** on any day (Central), 3 or more canvassers found whose sizes are within 2
  minutes of each other and who make up at least half of that day's judged canvassers. Printed as a warning
  that the server's clock or the data is the likelier cause.

## C. Server changes

1. **`server/src/services/audit/phoneClock.js`** (new, pure, arrow consts, beside `flagDetection.js`):
   `WRONG_MS`, `MIN_SAVES`, `WINDOW_MS`; `judgeDay(saves)` → `{ verdict: 'ahead' | 'behind' | 'right' |
   'unjudged', sizeMs }` over `[{ lag, live, window }]`; `sizeBucket(ms)`; `looksLikeZone(ms)`; `small(n)`
   (the pace replay's rule); `latestDayState(...)`; `sameOffsetDays(...)`.
2. **`server/src/utils/sinceArg.js`** (new): `parseSince` and its patterns moved out of
   [auditGpsStamps.js:45–76](../server/src/migrations/auditGpsStamps.js#L45), imported back by it and by the
   new script. Its "add an offset" example now names Central's current offset (−06:00 standard, −05:00
   daylight) instead of always −05:00.
3. **`server/src/migrations/auditPhoneClocks.js`** (new script):
   - Arguments: `--since=` only, checked **before connecting** (a bad one exits 1 without touching any
     database), like its neighbor.
   - Read-only connect: `connectDb(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false })`.
   - Reads organizations as `_id isInternal timeZone deletion.requestedAt` and campaigns as
     `_id organizationId timeZone deletion.requestedAt`: **no name is ever read**, so none can be printed.
   - One cursor: `CanvassActivity.find({ via: { $ne: 'bulk' }, ...(since ? { _id: { $gte:
     ObjectId.createFromTime(Math.floor(since.getTime() / 1000)) } } : {}) },
     'organizationId campaignId userId actionType timestamp createdAt wasOfflineSubmission').lean().cursor()`.
     `createFromTime` takes **seconds**: a Date wraps to a random year (review: `2026-10-01` became 2100, a
     false all-clear). `--since` filters on `_id` (indexed; a row written through Mongoose gets `_id` and
     `createdAt` in the same second, and a row put back keeps both originals).
   - Skipped and counted: rows of internal organizations, of organizations or campaigns being deleted, rows
     missing a readable time, partial first days. **Found** and printed as a finding: rows whose organization
     or campaign no longer exists (deletion should have removed them, privacy.html `:122`).
   - In memory, per canvasser-day, each save's lag, live flag, window and `timestamp`: measured in review at
     about 70–85 bytes per save (13 MB at today's ~150,000 visits; about 400 MB at 5 million, where
     `--since` bounds it). Group keys joined with `|`, never a NUL (CLAUDE.md's `grep` trap).
   - Zero visits checked, or zero canvasser-days judged: *Nothing could be judged, so this is not a clean
     result.* and exit 1. Fewer than half the canvasser-days judged: a line saying "none" is not a clean
     result.
   - Ends with *Nothing was changed.*; a failure prints one plain line and exits 1.
4. **`package.json`** (root): `"audit:phone-clocks": "npm --prefix server run audit:phone-clocks --"`.
   **`server/package.json`**: `"audit:phone-clocks": "node src/migrations/auditPhoneClocks.js"`.

No route, model, index or config var changes.

## D. What it prints (the design)

Two examples with made-up numbers, to show the layout only. Fewer than 3 canvassers found:

```
Phone clocks: every visit received, every customer organization (Doorline's own left out). Read-only; totals only.

Checked 151,240 visits by 214 canvassers, received Jul 28 to Nov 1.
  sent live 136,900 · sent later from the phone's queue 14,340
  canvasser-days 3,912: judged 3,640 · not judged 272 (nothing close enough to its time to tell)

Phones off by 5 minutes or more: fewer than 3 canvassers, on 4 canvasser-days.
  behind, 1 hour to under a day: 4 canvasser-days · looks like a time zone set by hand: 4
  still wrong in the last 2 days: yes · right on their latest day: no · not seen in the last 2 days: no
  visits, surveys and dates are withheld when fewer than 3 canvassers are found; some visits land on a different day: no

Skipped: 18,220 visits in Doorline's own organizations · 0 in organizations or campaigns being deleted · 0 missing a time
Found: 0 visits whose organization or campaign no longer exists

Nothing was changed.
```

Three or more found, the found block reads:

```
Phones off by 5 minutes or more: 5 canvassers, on 12 canvasser-days, Oct 28 to Nov 1.
  behind, 5 minutes to under an hour: 3 canvasser-days
  behind, 1 hour to under a day: 9 canvasser-days · looks like a time zone set by hand: 9
  still wrong in the last 2 days: yes · right on their latest day: yes · not seen in the last 2 days: no
  visits with the wrong time: up to 1,830, of them 412 surveys · on a different day in reports: about 12
```

None found: *Phones off by 5 minutes or more: none, among 214 canvassers judged on 3,640 canvasser-days.*
With `--since`, the header names the start in Central. Days print in each campaign's zone, the header's
range in Central (the owner's clock, as `report:memory-watch` does).

## E. Tests

- **`server/test/phoneClock.test.js`** (unit, the pure rule): right; behind (3 live saves in 3 windows, all
  lags ≥ 5 min); behind vetoed by one prompt save, live or queued; behind needs 3 windows (3 late live saves
  in one window → not judged); behind needs 3 live saves (queued alone never); a right phone with 4 of 7
  live saves 5–9 minutes late stays right (the review's false alarm); ahead from 3 negative lags, live or
  queued; 2 → not ahead; exactly ±5 minutes; size estimates; bucket edges; time-zone look; `small`;
  latest-day states; same-offset days.
- **`server/test/sinceArg.test.js`** (unit): bare date → 00:00 UTC; offsets; impossible dates, missing
  offsets and the future refused; the example offset follows Central's current one.
- **`server/test/auditPhoneClocks.int.test.js`** (child process, as the operator runs it). Fixtures, raw
  driver, `_id`s minted from each row's `createdAt`: a right phone; phones 2 hours behind, 30 minutes ahead
  and a day behind; a right phone whose late deliveries would fool a median; a phone that only sent later
  (not judged) and one 20 minutes ahead that only sent later (ahead); three phones an hour behind working
  the same windows (all three found); a 7-minute server stall inside one window (not judged); the DST night
  (06:30Z and 07:30Z on Nov 1 are one Chicago day); one canvasser in two organizations (counted once); an
  even number of saves; a desk row; an internal organization with demo-style rows; an organization and a
  campaign being deleted; a row whose organization no longer exists; a row with no `createdAt`; a row put
  back with an old `_id`. Asserts the lines and numbers; the withheld block with fewer than 3; `--since`
  counts rows inside its window (non-zero) and leaves older ones out; a bad `--since` and an unknown
  argument exit 1 before connecting; zero rows → *not a clean result*, exit 1; **no organization, campaign,
  canvasser or voter name, no email and no 24-hex id** in the output; **writes nothing** (each collection's
  count and a hash of its rows before and after; no collection or index created); and one run **from the
  repo root** through `npm run audit:phone-clocks -- --since=…` with `MONGODB_URI` set to the throwaway
  database (the root proxy and its `--`).
- `auditGpsStamps.int.test.js` passes after `parseSince` moves.

## F. Docs

- [OPERATIONS.md](OPERATIONS.md): a Part 1 section, *Check for phones with a wrong clock*
  (`audit:phone-clocks`): when to run it, each line, what to do per result; the One-off commands row; a Part 2
  note on the rule and its privacy limits.
- [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): item 50 (49 went to another change the same day),
  §H's claims; the first run's totals stamped there later, totals only.
- [docs/README.md](README.md): this plan's row. [PROPOSAL_RECENT_VISITS.md](PROPOSAL_RECENT_VISITS.md): G5
  points here.
- Help Center: nothing; no user sees it.

## G. After Election Day, if phones are found: the phone tells its canvasser (designed, not built)

- **How:** the phone already receives `serverTime` on every `GET /mobile/changes` while the map is open.
  Around that call, read `Date.now()` before and after; offset = `Date.parse(serverTime) − (before + after) /
  2`, trusted only when the round trip is under 10 s. Two polls in a row 5 minutes or more off show a line on
  the map; the first poll that reads right clears it.
- **Copy:** *Your phone's clock is about 2 hours behind. Visits you record get the wrong time. Turn on
  automatic date and time in Settings.*
- **What it never does:** store or send anything, change the server, or change the time a visit is saved
  with (shifting times on the phone mid-day would break the replay checks that compare one phone's own
  times, [canvass.js:296–320](../server/src/routes/mobile/canvass.js#L296-L320)).
- **Reach:** a phone update over the air, staging first; it reaches a phone after its next restart, and
  never the retired `com.canvassapp.mobile` app (only the frozen `sharedVoters` tree can update it). Its own
  short plan pass first.

## H. Privacy, phones, release

**Privacy.** A staff-facing console output that reads every customer organization's visit rows outside any
support grant. Claims checked:

- privacy.html `:88` and `:90` (canvassing activity and its time, used to provide, secure and support the
  Services): holds; this checks that stored times are right.
- `:105` (customer data not visible to other customer organizations): holds; nothing reaches any customer.
- `:112` (staff open voter or canvassing data **in the product** only under a grant): holds; this is the
  console, not the product, and it opens no record.
- `:122` (deletion removes canvassing records): the check counts rows whose organization or campaign is gone;
  a non-zero count is a finding to record, not a change.
- terms.html, the personnel sentence ("Doorline personnel access Customer Data only to provide, secure, and
  support the Service, under time-limited, reason-logged access controls") and the aggregate sentence
  ("aggregate usage statistics … that do not identify the Customer, its users, or any individual in Customer
  Data"): the output is such an aggregate: no organization, campaign or person named, no name read, and the
  small-group rule (39(e), the pace replay's) on every count of people, with visit counts and dates withheld
  under 3. Whether computing an aggregate by machine is "access" under the personnel sentence is the reading
  item 43(g) left to the owner; this check is no different from the GPS stamp audit (27(c)), which already
  reads every customer's visit rows and prints totals only.
- DPA §3(a) (process only to provide the Service): data accuracy is part of providing it. §3(d) (no
  combining one customer's personal information with another's): each canvasser-day is judged from its own
  rows only; the totals add counts. DPA §4's "time-limited and reason-logged controls on Doorline staff
  access" (the sentence earlier notes called §3): the same reading as above. §6: no subprocessor. §9: nothing
  is kept.
- No published sentence changes; no customer notice. Recorded in the privacy record (§F).

**Phones:** nothing ships; no route changes, so no `CLIENT_API_VERSION` bump.

**Release:** one server deploy from `main`; then Part 1's *When and how to run it*.

## I. Edge cases and risks

- **The server's clock is the yardstick.** Heroku keeps dyno clocks set automatically. If one drifted, every
  phone would read off by the same amount; the same-offset warning names that.
- **A clock fixed during the day:** a prompt save after the fix clears "behind" for the whole day (a miss,
  never a false alarm); "ahead" stays flagged from the saves before it. The next day reads right.
- **Queued saves count on the day they reached us**, so a wrong day's saves uploaded the next morning join
  the next day. Upper bounds only.
- **Daylight saving ends 2026-11-01:** days come from `zonedDayStr` in the campaign's zone, so Nov 1 is one
  25-hour day.
- **Two phones, one canvasser:** a prompt save from the right phone clears "behind" for that day.
- **Rows from before 2026-06-07** (bundles without the 20 s abort): lags were unbounded even in the
  foreground; the low-end rule reads them the same way.
- **Load:** one pass over the visit rows on the live database; at today's size, seconds. Run outside field
  hours and away from the 9:47 and 10:07 pm Central nightly jobs.

## J. Verification

The unit and integration tests above, including the run from the repo root; the full server suites (unit
and `test:int`); the fixture run's output read against the rule. Not verifiable here: production data. The
owner's first run is the real result.

## K. What changed after review round 1 (2026-10-31, three reviewers)

- **The rule** (the reviewer who ran it against the real phone and server code): a right phone's live save
  can arrive minutes late (the 20 s abort pauses in the background; shown on a throwaway database), so a
  median of lags could call a right phone behind (simulated: 4 of 7 saves late → "behind 5.5 min") and
  miss a phone ahead. v2 reads each day from its most prompt visit, needs 3 live saves in 3 windows for
  "behind", and calls "ahead" from 3 impossible negative lags.
- **Busy windows dropped** (two reviewers): measured on raw lag, a crew of phones with the same wrong offset
  made their own windows "busy" and hid themselves, and a demo rebuild made one too. The 3-window rule
  replaces them.
- **`--since` read no rows** (all three): `ObjectId.createFromTime` takes seconds; v1 passed a Date, which
  wrapped to the year 2100 and would have printed a false all-clear. Fixed, and the test checks rows inside
  the window are counted; zero rows never reads as clean.
- **Totals only** (the privacy reviewer): v1 printed each organization by name. Staff screens already show
  each member's visit count and first and last visit, so a lone canvasser's exact visits and dates could be
  matched; and naming customers falls outside the Terms' aggregate sentence. v2 names no organization,
  campaign or person, reads no name, applies the small-group rule to every count of people, withholds visit
  counts and dates under 3, and prints the latest-day states as yes/no so nothing can be subtracted.
- **Part 1's staff-access sentence was wrong**: grants are started by staff, not given by the customer.
  Rewritten. DPA citation corrected (§4, not §3), and the Terms' personnel sentence added to §H.
- **What the owner does with the result** (the pre-mortem): Monday's useful act is a crew message to turn on
  automatic time; §G is after Election Day and can't reach the old Android app. "None" now carries its
  denominator; a Monday re-run is in Part 1; "still happening" is defined; the day-shift count shows what
  reports would actually move; fixing stored times needs its own plan and notice (FbTime's daily counts too).
- **Smaller:** the memory figure (measured 70–85 bytes per save, not 16); the run time; partial first days
  under `--since`; campaigns being deleted and rows whose organization or campaign is gone; a run from the
  repo root; the DST night, two-organization canvassers and even-count fixtures; wrong citations fixed
  (two save paths, not three; `serverTime` at :582).

## L. As built (2026-10-31)

Built to v2: [phoneClock.js](../server/src/services/audit/phoneClock.js) (the rule),
[auditPhoneClocks.js](../server/src/migrations/auditPhoneClocks.js) (the script),
[sinceArg.js](../server/src/utils/sinceArg.js) (the parser moved out of `auditGpsStamps.js`), both
`package.json` entries, the runbook (*Check for phones with a wrong clock*, the One-off commands row and a
Part 2 note in [OPERATIONS.md](OPERATIONS.md)) and privacy-record item 50.

**Where the build differs from the plan, or adds to it**
- **One or two early saves read *not judged*, never *right*.** §B's step 3 adds "and no save arrived early":
  a save that reached us 5 minutes or more before its time is impossible on a right clock, so a day holding
  one or two of them is not called right, though it takes 3 to call it ahead.
- **Dates carry their year** when a range spans two years, or a lone day isn't in the current one. Found by
  reading the fixture run's output by eye: a 2025 fixture printed *received Nov 2 to Oct 30*.
- **Counts of canvasser-days and surveys are singular at 1.**

**Verified**
- `phoneClock.test.js` 17 and `sinceArg.test.js` 4 pass. They include the review's false alarm (a right
  phone with 4 of 7 live saves 5–9 minutes late reads right), the stall in one window, and the exact
  5-minute edges.
- `auditPhoneClocks.int.test.js` 9 pass, over the real script as a child process and once from the repo
  root through the root proxy. `auditGpsStamps.int.test.js` 8 pass after the parser moved. The server
  unit suite: 745 pass, 0 fail.
- **Mutation check:** with `createFromTime(since)` put back in a scratch copy of the script, the `--since`
  test fails (no visits read) while the full run still passes, so the test guards the review's bug.
- The fixture run's output was read against the rule; both §D layouts print as designed.

**Not verified:** production data. The owner's first run, Sunday evening, is the real result.

