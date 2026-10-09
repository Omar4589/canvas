# Proposal: door counts to FbTime — Doorline fills in FbTime's doors-per-hour page

> **Status: BUILT 2026-10-09 (Doorline's side, uncommitted; not released).** Designed in revision 6 after
> four adversarial review rounds; built to that design with the differences under *Build notes* below.
> FbTime's half — "Doorline decides" and rulings 13-16 — is **committed as FbTimeApp 561327a (on main; its
> title is about another change because it was committed together) and deployed to Heroku 2026-10-09**,
> verified by the FbTimeApp session on that commit (server 935/935, client 260/260). Doorline's turn-on
> gate is the live check that production `/ping` lists `doors:reported-wins` (8c52b5d advertised
> `doors:keep-typed`, which Doorline refuses). `/ping` advertises `features: ["doors:reported-wins"]`; explicit clears carry
> `restoreTyped: true`; the response adds `replacedTypedChanged` and `restoredTyped`; FbTime's "other
> doors" per day are never touched by a report or a clear. The contract is `FbTimeApp/docs/PARTNER_API.md`;
> contract changes go through the FbTimeApp session, never assumed here. What each review round found is in
> [§Q](#q-review-log).
>
> **Build notes — where the build differs from or adds to this design (the build wins):**
> - The "Typed numbers replaced" notice adds up FbTime's `replacedTypedChanged` (typed numbers that
>   differed from Doorline's), falling back to `replacedTyped` from a build without it.
> - A clear request outside an unlink is attributable: new event `doors-clear-requested` (`{all:true}` or
>   `{fbtimePersonId}`). `PATCH /fbtime/doors { clear:true }` while on → `409 DOORS_ENABLED` (Turn off can
>   clear in the same step); `{ clearPerson }` → `409 DOORS_NOT_SENT` / `409 DOORS_PERSON_LINKED`.
> - `GET /fbtime` when not connected adds `doorsAvailable`; `GET /fbtime/people` rows add `clearWaiting`
>   and `linkedStatus` beside `doorsSent` / `deleted` / `alsoCounts` / `canClearSent`; `GET /fbtime/events`
>   adds `subject` (whom a link event is about) beside `by`.
> - The Users list and the per-user profile report a kept earlier account as measured (`fbtime.kept`; the
>   lead-visible per-user block carries the boolean only, no dates).
> - The identity purge's dry run writes no `RetentionRun` row (a counting pass must never make a dead job
>   read green); `RetentionRun` gains `failed`.
> - `POST /fbtime/sync` stamps its cooldown with an atomic update (no whole-document save), and the hours
>   sync's recovery ping stores the key's scopes through a key-filtered update.

What this covers: what is sent, to whom, how often, and exactly which number; how it is released and turned
on; what an admin sees on both apps; what happens when links, keys, accounts or door results change; and —
in Part 2 — the model, the count, the send, explicit clears, kept accounts (which also fix how Doorline
attributes a returning canvasser's hours), the status model, the routes, the screens, the phone copy, the
docs and Help Center cascade, the privacy record (including two older deletion gaps this build closes), the
tests and the rollout.

Related: [FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md) (the hours half of the same connection),
[METRICS.md](METRICS.md) (what a knock is), [TIMEZONES.md](TIMEZONES.md) (anchor-zone days),
[AUDIT.md](AUDIT.md), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the v5 FbTime entry this
changes), [DPA.md](DPA.md) §2 and §6.

---

# Part 1 — For everyone

## What it is

FbTime's **doors-per-hour page** divides each canvasser's doors by the hours they were on the clock. Today
somebody types the doors in by hand, reading them off Doorline. With door counts turned on, Doorline sends
them instead: each linked canvasser's **doors for each day** — every 15 minutes for the last week, and every
night for the last 120 days.

## The decisions

Ruled by the owner in the FbTimeApp session (relayed here): **(1)** the number is the Timeline's — per
canvasser per local day, the **Doors** column of the canvasser table on Doorline's **Timeline** tab, added up
across campaigns; **(2) Doorline decides** — on a day Doorline reports, FbTime shows Doorline's number and
nobody types over it there (this replaced an earlier "a typed number always wins"); **(3)** every 15 minutes
the last 7 days, nightly the last 120.

Chosen by the owner in this session:

4. **It starts off** — an org admin turns it on, only with a key FbTime allows to fill in door counts.
5. **Doorline releases it with a config var** (`FBTIME_DOOR_COUNTS`), like *Not a target voter*: until it is
   set, the card, the switch and every send don't exist (the Help Center describes the feature conditionally);
   unsetting it stops every organization's door counts at once.
6. **Only against an FbTime that applies these rules** — FbTime advertises `doors:reported-wins`; without it
   Doorline refuses to turn door counts on and sends nothing.
7. **No customer notice** beyond the updated privacy wording — a customer's admin turning it on is that
   customer's instruction (DPA §2).
8. **Clearing a wrong link reaches back to the first day Doorline sent.** The last 120 days refill with the
   right canvasser's doors; on older days, a number someone had typed comes back (decision 14) and the rest
   stay blank for someone to type.
9. **A canvasser who comes back with a new account counts as one person** for door counts: both accounts'
   doors are added together.
10. **Two older privacy gaps are closed in this build** — a deleted canvasser's email no longer survives in the
    FbTime link or its history, and nothing on Doorline's side ties a deleted account to an FbTime person once
    Doorline's 180-day name removal runs.
11. **A returning canvasser's old hours stay with the old account** in Doorline's own reports, so last season's
    measured rates stay measured.
12. *(Superseded by decision 2.)*
13. **A Doorline day is locked on FbTime only while a door-count key is live.** Once door counts are stopped for
    good (the door-count key revoked), FbTime lets people edit those days again (FbTime's side).
14. **An explicit clear brings typed numbers back.** When an admin clears in Doorline, FbTime restores, on exactly
    those days, the numbers people had typed before Doorline's replaced them (FbTime's side).
15. **A day Doorline emptied is marked**, not shown as "needs doors": "Doorline: none — doors moved or removed",
    so nobody types the moved doors in twice (FbTime's side).
16. **FbTime gets an "other doors" box** per person per day — doors Doorline can't know (paper after a phone
    died, another platform) — added to Doorline's number for doors per hour; Doorline's number stays locked
    (FbTime's side).

## Exactly what is sent

- **To:** the FbTime organization the connected key belongs to — nobody else.
- **About whom:** every Doorline canvasser **linked** to an FbTime person on the Integrations page, plus a kept
  earlier account of the same person (decision 9). A canvasser with no link is never sent — except when an admin
  asks Doorline to clear what it sent for that FbTime person.
- **Which number:** that day's **doors** — the results that count as knocks: *Survey / talked to them, Lit
  dropped, Not home, Wrong address, Refused, Not a target voter, No soliciting* — the Timeline's Doors column,
  added up across the organization's campaigns. **Restricted access** never counts.
- **Which days:** only days the canvasser recorded something at a door. A day where every result was Restricted
  access is sent as **0**. A day with nothing recorded sends **nothing**. Notes, and Restricted marks set from the
  desk, never count and never make a day count.
- **Which date:** the local day in the campaign's own time zone — the day the Timeline files it under; two
  campaigns on one date give one number, added together.
- **What is in the message:** FbTime's own id for the person, the date and the number. **Never** names, emails,
  voter names, addresses, survey answers, notes or locations.

**A door recorded again moves to the later day.** Doorline keeps one result per canvasser per door per round —
the latest. If Maria marks 40 doors *Not home* on Monday and records them again on Thursday in the same round,
the Timeline — and so FbTime — shows those 40 on Thursday, and Monday's number drops. A callback in a **new
round** leaves Monday alone. Doorline's own doors-per-hour uses the same rule.

## FbTime's page — Doorline decides

- **A day Doorline reports shows Doorline's number, locked** ("from Doorline") while a door-count key is live.
  To change it, fix the door results in Doorline. Any number typed on that day before is filed away by FbTime
  (never shown or counted) — whether it was typed before door counts were turned on or later.
- **Doors Doorline can't know** — paper after a phone died, another platform — go in FbTime's **other doors** box
  for that day; they are added to Doorline's number.
- **A day Doorline never reports** works as today: a typed number stands; hours with no number show "needs doors".
- **A day Doorline emptied** (its doors moved to another day, were unknocked, or a round's knock history was
  cleared) shows **"Doorline: none — doors moved or removed"** — don't type those doors in again, or they count
  twice.
- **An explicit clear in Doorline** (Unlink → Clear, Turn off with Clear, Clear…) removes Doorline's numbers from
  those days and **brings back** any number someone had typed there; days with nothing typed go blank.
- **Once door counts are stopped for good** (the door-count key revoked in FbTime), Doorline's days unlock on
  FbTime and can be edited there.

## Releasing it, and turning it on

**Doorline's side (once):** the updated privacy wording goes live, FbTime deploys its side, and Doorline sets
`FBTIME_DOOR_COUNTS=on` in the Heroku dashboard. Until then, nobody sees the card.

**Each organization — an org admin who is a member of the organization:**

1. **Get a key that allows it — when you're ready to turn door counts on.** In FbTime, create a key with **"Also
   let it fill in door counts"** ticked; it also reads hours, so it replaces the old key. FbTime allows one such
   key per organization (if the option is greyed out, one already exists), and while it exists FbTime's page
   expects Doorline's numbers — so don't create it early.
2. **Put the key into Doorline.** Already connected: **Integrations → Settings → Replace key** — paste, **Test**,
   confirm the FbTime organization's name is yours, **Use this key**. Hours keep flowing and your links are kept.
   Not connected yet: paste it into the connect card.
3. **Turn on door counts** on the **Door counts to FbTime** card. The confirmation says what will be sent, for how
   many people (everyone linked now, and anyone linked later), and that numbers typed on FbTime on those days are
   replaced — tell whoever types doors on FbTime. The first send — the last 120 days — usually goes within a few
   minutes.
4. In FbTime, **revoke the old key** — once no other Doorline organization uses it.

Only one Doorline organization can send door counts to a given FbTime organization. If another already does, the
card says so — Doorline support can help if that's unexpected.

## Replacing a door-count key later

FbTime allows only one door-count key at a time, so the order is: in FbTime **revoke** the current key, **create**
the new one with door counts ticked, then **Replace key** in Doorline straight away. In between, hours and door
counts pause (the status bar shows the connection needs attention), and — with no door-count key live — Doorline's
days are briefly editable on FbTime; the next send restores Doorline's numbers. If another Doorline organization
reads hours with the same key, give it its own hours-only key first.

## What the card shows

One **state**, and under it any **notices**. Off with nothing waiting is a single compact line.

| State | Meaning |
|---|---|
| **Off** | Not sending. **Turn on…** — or a hint: the key reads hours only, another Doorline organization already sends, or (after door counts were on) the door-count key is still live in FbTime. When Doorline has sent numbers and can still remove them: **Clear the numbers Doorline sent…** |
| **Starting** | Turned on; the first send since then hasn't finished |
| **Sending** | Working — when it last sent, and for how many people ("nobody is linked yet" when nobody is) |
| **Clearing** | Removing numbers you asked Doorline to clear — with **Cancel** |
| **Needs attention** | On, but something you can fix stops it: another Doorline organization sends to this FbTime organization; the key lost its door permission; a campaign has a time zone Doorline can't use; FbTime refused a send; or sends have kept failing for about two hours |
| **Paused** | On, but waiting on something else: the FbTime connection needs attention (the status bar says why), Doorline has paused door counts for everyone, or FbTime needs updating |

| Notice | Meaning |
|---|---|
| Typed numbers replaced | Since door counts were turned on, about how many numbers typed on FbTime Doorline's have replaced |
| Links FbTime doesn't recognise | Linked people who aren't in your FbTime organization — shown as **Broken link** rows below |
| A day over 2,000 | A person-day too big for FbTime that wasn't sent |
| Clears waiting | A clear that can't run yet, why — with **Cancel** |

**Sync now** on the status bar (it reads **Refresh hours** while door counts are off) re-pulls hours and re-sends
door counts.

## When numbers change

While a canvasser is linked and door counts are on, for the last 120 days:

- **A door result is corrected, unknocked, reclassified or moved to a later day:** the next send fixes FbTime —
  within 15 minutes for the last 7 days, otherwise overnight. Late results (a phone that was offline) follow the
  same rule. A day that empties completely is marked "Doorline: none".
- **A round's knock history is cleared in Turf Cutting:** those doors leave the Timeline, so those days drop on
  FbTime too.
- **A canvasser is linked:** within 15 minutes Doorline sends their last 120 days.
- **A campaign's time zone is changed:** its doors move to the matching dates at the next send.

**Corrections don't reach FbTime** for days older than 120, for anyone unlinked (Keep or a plain unlink), or after
door counts are turned off, stopped for good, disconnected or switched to another FbTime organization. Those days
keep what Doorline last sent — locked while a door-count key is live, editable once it is revoked — unless an admin
clears them.

## Unlinking — was the link right?

Unlinking **never clears anything by itself**. When Doorline has sent door counts for the person, or the canvasser
deleted their account, **Unlink** asks one question — **was the link right?**

- **Yes — keep** (they left, or they'll come back with a new account). What Doorline sent stays, and corrections
  stop reaching FbTime for them. The old account still counts for that FbTime person: its doors are added to a new
  account's (decision 9) and its clocked hours stay its own in Doorline's reports (decision 11). The FbTime person's
  row shows "also counts *Maria (earlier account)*", with **Stop counting** if that was a mistake.
- **No — the link was wrong.** Doorline clears every number it sent for that FbTime person (including any earlier
  account's), bringing back numbers someone had typed; if the person is linked to the right canvasser while door
  counts are on, the last 120 days refill in the same run (decision 8). Where nothing was sent, it simply unlinks.

**Undo** after an unlink cancels a waiting clear for anyone it re-links to the same canvasser; if the clear already
ran, its days stay cleared. A **deleted** account, and a member who **left your organization**, can't be linked again
once unlinked. A Broken-link row for someone who left should usually be left alone; a row for someone **no longer in
FbTime** can be unlinked. For an FbTime person who is no longer linked but whose numbers Doorline sent, the row offers
**Clear the numbers Doorline sent for *Maria D.***.

**A canvasser who deleted their account and came back:** add them as a new person, unlink the old account choosing
**Yes — keep**, then link the new account to the same FbTime person.

## Turning it off, disconnecting

- **Turn off** stops sending. Days Doorline sent keep its numbers (locked while the door-count key is live) unless you
  tick **"Also clear the numbers Doorline sent"** — which brings back numbers typed there, and blanks the rest.
- **Stopping for good:** clear first if you want Doorline's numbers gone, then in FbTime create a key **without** door
  counts, **Replace key** in Doorline, and **revoke the door-count key** — Doorline's days then unlock on FbTime.
- **Disconnecting** turns door counts off too; clear first if you want, then revoke the key in FbTime. If a clear is
  still waiting, Doorline asks first — disconnecting abandons it.
- **Reconnecting** starts with door counts off.

## Limits worth knowing

- A day with more than **2,000 doors** for one person isn't sent (FbTime's limit); the card names it.
- Doorline re-sends at most **120 days** back; a clear goes back to the first day Doorline ever sent.
- FbTime files a whole shift under the day it **started**, in the zone where the person clocked in; Doorline files
  doors in the campaign's zone. A shift past midnight, or work in a zone behind the campaign's, can put hours and
  doors on neighbouring days.
- A Restricted-access-only day is sent as 0; doors done elsewhere that day go in FbTime's **other doors** box.

---

# Part 2 — Technical reference

## A. The contract, and how each rule is kept

Source: `FbTimeApp/docs/PARTNER_API.md` — 8c52b5d plus the working-tree "Doorline decides" change, and decisions 13-16
being built by the FbTimeApp session.

| Contract rule | Mechanism here |
|---|---|
| `PUT /api/partner/v1/doors`, Bearer key; send nothing without both `doors:write` in `key.scopes` and `doors:reported-wins` in `features` | `putDoors()` (§D); the step's gates (§E) and `PATCH /fbtime/doors` (§I) require both; `features` is top-level, server-wide, stored as `fbtimeFeatures`. 8c52b5d alone (which advertised `doors:keep-typed`) is refused |
| One live `doors:write` key per FbTime organization (`409 DOORS_KEY_EXISTS`); rotation is revoke → create → paste | Part 1 *Replacing a door-count key*; the errored state in between is the existing fatal path (one `sync-failed`); Replace key works on an errored connection |
| Window-replace per listed person; a missing day clears; unlisted people untouched | Every send lists every linked person (§D); a day gets a count only if it had activity (§C); unlinked people are not listed |
| Window ≤ 120 days; `endDate` ≤ tomorrow UTC; `startDate` ≥ 2 years back | Windows of 7/120 from their own constants (§C); clears ≤ 120-day slices from `max(earliestDate, addDays(utcToday, -729))` to tomorrow UTC (§F) |
| 1–500 `userIds`, 24 hex (either case), no repeats; one count per person-day; two Doorline accounts on one FbTime id: sum | One account loader lower-cases and de-duplicates; cells keyed `personId|date` and summed; requests sized by person-days (§D) |
| 400 `VALIDATION` writes nothing; re-sending a 400 window each run is harmless (recipe step 6, as amended) | Definitive failure recorded; the next run rebuilds and re-sends |
| 401/403 → stop; 429/5xx → next run | §E answers |
| **Decision 2 (working tree):** a reported day shows Doorline's number, locked; a typed number on a reported day is replaced and kept on file; a typed edit there gets `409 DOORS_FROM_INTEGRATION` | Part 1; the Turn-on modal says it |
| **Decision 13 (to build):** the lock applies only while the org has a live `doors:write` key | Part 1 *Turning it off*; the Off hints |
| **Decision 14 (to build):** an explicit clear restores the filed-away typed number on the rows it clears — Doorline marks its explicit clears with a request flag (proposed `restoreTyped: true`; the field name is FbTime's) | §F: every explicit clear request carries the flag; window-replace sends never do |
| **Decision 15 (to build):** a day emptied by a report (not an explicit clear) is kept as a marker, "Doorline: none — doors moved or removed", outside "needs doors" | Part 1; FAQ |
| **Decision 16 (to build):** a typed "other doors" number per person-day, summed into FbTime's doors per hour | Part 1; FAQ |
| Response `{ window, applied, unchanged, cleared, replacedTyped, unknownUserIds }` | Summed per window group into `lastResult`; `replacedTyped` also `$inc`s a cumulative counter (§E) |

## B. Model changes

[`FbTimeConnection`](../server/src/models/FbTimeConnection.js). **No leaf below has a default and every array is
`default: undefined`** — Mongoose writes non-null defaults for paths missing when a document was loaded, so the
hours sync's existing `connection.save()` would otherwise write `doors.enabled: false` over a mid-run turn-on
(reproduced, MongoDB 7.0.2 + Mongoose 8.23.1). Every reader takes a **lean** document and is null-safe. Resetting
door counts is `$unset: { doors: '' }`. Array writes are always `$push` / `$pull` / positional `$set` — never a
whole-array `$set` (three parallel Keep unlinks: read-modify-write kept 1 of 3 entries, `$push` kept 3) — and every
positional or `arrayFilters` write is filtered on the array element existing (an `arrayFilters` update on a row
without the array throws).

```js
keyScopes: { type: [String], default: undefined },       // GET /ping key.scopes
fbtimeFeatures: { type: [String], default: undefined },  // GET /ping features (server-wide)

// Kept accounts (§G) — OUTSIDE `doors`: turning door counts off, clears and an org change never touch them,
// because they also decide whose hours a shift is (decision 11).
keptAccounts: { type: [{ fbtimePersonId: String, userId: ObjectId, until: Date,
                         keptByUserId: ObjectId, keptAt: Date, _id: false }], default: undefined },

doors: {
  enabled: Boolean,
  enabledAt: Date,                  // set only on the off→on transition
  enabledByUserId: ObjectId,

  reported: { type: [String], default: undefined },   // write-ahead ledger: FbTime person ids ever listed
  earliestDate: String,             // earliest startDate ever sent — where a clear starts

  clearPersons: { type: [{ fbtimePersonId: String, fromUserId: ObjectId /* null: unlinked or purged */,
                           confirmAfter: Date, _id: false }], default: undefined },
  clearAll: Boolean,
  clearAllDone: { type: [String], default: undefined },  // persons whose clear-all pass finished (progress)
  clearAllConfirmAfter: Date,
  rejected: { type: [{ fbtimePersonId: String, userId: ObjectId, _id: false }], default: undefined },

  deepDueAt: Date,                  // a turn-on, key change or link change asked for a full 120-day run
  deepRetry: { type: [String], default: undefined },  // people still owed a 120-day send

  lastFinishedAt: Date, lastSkip: String,
  lastSentAt: Date,
  lastResult: { type: [{ windowDays: Number, startDate: String, endDate: String, people: Number,
                         applied: Number, unchanged: Number, cleared: Number, _id: false }], default: undefined },
  lastDeepSentAt: Date, lastDeepResult: { /* one group's shape, written only by a full run */ },
  replacedTyped: Number,            // cumulative since enabledAt; reset by Turn on
  overCap: { type: [{ fbtimePersonId: String, date: String, knocks: Number, _id: false }], default: undefined },
  unknownPersonIds: { type: [String], default: undefined },
  failCode: String, failPhase: String, failDetail: Mixed,  // a current definitive failure (§H)
  transientStreak: Number,
  lastError: String, lastErrorAt: Date,
},
```

**The ledger write is also the send gate** — one atomic pipeline update that matches only while the run may still
send:

```js
FbTimeConnection.updateOne(
  { _id, keyCiphertext: usedKey, 'doors.enabled': true },
  [{ $set: {
    'doors.reported': { $setUnion: [{ $ifNull: ['$doors.reported', []] }, personIds] },
    'doors.earliestDate': { $min: ['$doors.earliestDate', startDate] },  // aggregation $min skips null
  } }]);                                                               // matched 0 → stop sending
```

Every other door-step write is an atomic `updateOne` filtered on `{ _id, keyCiphertext: usedKey }` (`usedKey`
non-null). `keyCiphertext` changes on every connect and rotate (random IV) and is nulled by Disconnect, so it is the
run's identity.

[`FbTimePersonLink`](../server/src/models/FbTimePersonLink.js): `fbtimePersonId` lower-cased on write.
[`FbTimeShift`](../server/src/models/FbTimeShift.js): unchanged in shape; the purge writes the sentinel
`fbtimePersonId: 'purged'` (§M). [`IntegrationEvent`](../server/src/models/IntegrationEvent.js): `type` gains
`doors-enabled`, `doors-disabled`, `doors-failed`, `doors-recovered`, `doors-cleared`, `doors-clears-abandoned`,
`account-kept`, `account-kept-removed`. The **link-type** events (`link-created`, `link-removed`, `account-kept`,
`account-kept-removed`) hold `detail { userId, fbtimePersonId }` and are de-paired by the purge (§M); door-count
events never hold a user id beside a person id (`overCap` and clears store person ids only; names resolve at read).
`link-created` stops storing `userEmail`. The model comment's "append-only … never updated" names its two exceptions
(the one-off email scrub; the purge's de-pairing) and the existing org-deletion cascade.

No new index: the count reads `CanvassActivity` via `{ userId: 1, timestamp: -1 }`; the purge's shift updates are
scoped `organizationId: { $in: <orgs with a connection row> }` so they use `{ organizationId, userId, clockIn }` (a
`{ userId }`-only query is a collection scan).

## C. The count

New file [`server/src/services/fbtime/doorCounts.js`](../server/src/services/fbtime/doorCounts.js).

**The numerator is the Timeline's** (`routes/admin/reports.js`, canvasser-timeline): `actionType` in
`[...KNOCK_ACTIONS, 'restricted']` and `NOT_BULK`, a row counting unless it is `restricted`; constants from
[`services/reports/aggregations.js`](../server/src/services/reports/aggregations.js). Never `knocksPipeline`. The
org-wide form of the Timeline's match (no campaign filter); round 2 found 0 mismatches against a Timeline-equivalent
per-campaign sum at nine "now"s, including the UTC+14/UTC−11 date flips and 2026-11-01.

```js
export const DOORS_RECENT_DAYS = 7;
export const DOORS_DEEP_DAYS = 120;   // asserted ≤ 120 at load

// Zones from ONE resolver, mirroring the Timeline's fallback (campaign → org → America/New_York), each resolved
// zone checked against the server's curated US_TIMEZONES (utils/usStateTimeZone.js — 8 zones, all accepted by
// MongoDB and exact in zonedDayRange every day 2025-2028). Intl alone accepts spellings $dateToString rejects.
// → { orgTz, all: string[], byZone: Map<tz, ObjectId[]> }; invalid → DoorCountError('INVALID_TIMEZONE',
//   { campaignId, campaignName } | { organization: true })
export async function resolveZones(organizationId) { … }

export const doorsWindow = (zones /* string[] */, windowDays, now) => {
  const endDate = zones.map((tz) => zonedDayStr(now, tz)).sort().at(-1);
  return { startDate: addDays(endDate, -(windowDays - 1)), endDate };
};

// accounts: [{ userId, fbtimePersonId, until? }] — linked accounts plus kept accounts (with `until`); NEVER empty
// (§E skips the count when nobody is linked — an empty $or is a MongoDB BadValue).
// Returns { startDate, endDate, cells } — the window travels WITH the cells (§D asserts it).
export async function countDoorsByPersonDay({ organizationId, accounts, startDate, endDate, zones }) {
  const orgId = new mongoose.Types.ObjectId(String(organizationId));
  const gte = new Date(Math.min(...zones.all.map((tz) => zonedDayRange(startDate, startDate, tz).$gte)));
  const lt = new Date(Math.max(...zones.all.map((tz) => zonedDayRange(endDate, endDate, tz).$lt)));
  // a Number in an aggregate $match matches NOTHING, silently — assert instanceof Date
  const who = accounts.map((a) => ({
    userId: new mongoose.Types.ObjectId(String(a.userId)),
    ...(a.until ? { timestamp: { $lt: a.until } } : {}),   // a kept account counts only before `until`
  }));
  const others = [...zones.byZone].filter(([tz]) => tz !== zones.orgTz);
  const tzExpr = others.length
    ? { $switch: { branches: others.map(([tz, ids]) => ({ case: { $in: ['$campaignId', ids] }, then: tz })),
                   default: zones.orgTz } }
    : zones.orgTz;                                         // never a zero-branch $switch (error 40068)
  const rows = await CanvassActivity.aggregate([
    { $match: { organizationId: orgId, timestamp: { $gte: gte, $lt: lt },
                actionType: { $in: [...KNOCK_ACTIONS, 'restricted'] }, ...NOT_BULK, $or: who } },
    { $group: { _id: { userId: '$userId',
                       day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: tzExpr } } },
                knocks: { $sum: { $cond: [{ $eq: ['$actionType', 'restricted'] }, 0, 1] } } } },
  ]);
  // keep days inside [startDate, endDate]; map each userId to its person; SUM into "personId|date".
}
```

- **All or nothing.** Any throw fails the send before a single send request. A MongoDB 40485 maps to
  `INVALID_TIMEZONE`. Clears never depend on the count (§E).
- **Campaign zones are validated where they are written:** `routes/admin/campaigns.js` answers
  `400 { error: 'Choose one of the listed US time zones.', code: 'INVALID_TIMEZONE' }` for a zone outside
  `US_TIMEZONES` on create, and on update unless it equals the stored value (checked after the campaign loads — the
  drawer re-sends the stored zone on every save).
- `addDays` / `daysBetween`: [`services/reports/goalProgress.js`](../server/src/services/reports/goalProgress.js);
  `zonedDayStr` / `zonedDayRange`: [`utils/timezone.js`](../server/src/utils/timezone.js).

## D. Building the requests

**The account loader** (one owner — the count, the requests, the clears, the per-request re-check and the card):
every `FbTimePersonLink` of the org, `fbtimePersonId` lower-cased, filtered to 24 hex, de-duplicated; plus each
`keptAccounts` entry whose **person is linked**, whose **account has no link of its own** now, and whose person has
**no first-pass clear waiting**; accounts de-duplicated by `userId` (zero double counts in every interleaving of the
loader's reads against the link routes' writes).

**`planDoorRequests(countResult, groups)`** (pure) takes the count's `{ startDate, endDate, cells }` — a request whose
window doesn't match its cells cannot be built (asserted) — and the people grouped by window (§E):

1. **Size by person-days:** people per request = `min(500, floor(5000 / windowDays))` — 500 at 7 days, 41 at 120. The
   working-tree FbTime handler clears 41 people × 120 days in ~0.11 s and first-fills them in ~0.6 s locally, far inside
   FbTime's 30-second router limit; re-measured against the build FbTime names for deployment (§N).
2. Each request: its people, sorted; `counts` = their cells inside the request's window, sorted; a cell over **2,000** is
   left out (FbTime clears that day) and recorded as `{ fbtimePersonId, date, knocks }`.

**`putDoors({ apiKey, body, timeoutMs })`** in [`client.js`](../server/src/services/fbtime/client.js): `request()` gains
`method` and a JSON `body`; the key only in the `Authorization` header; `return await res.json()` (the abort timer then
covers reading the body); `FbtimeApiError` gains `detail`; `ping({ apiKey, timeoutMs })`. The per-request timeout stays
30 s — a shorter one widens the gap where Doorline gives up but FbTime still writes (§F's confirm pass covers that gap).
The header comment becomes "read-only except `PUT /doors`".

**Laptop guard** — on the network path only, after the `fbt_test_` seam: outside production a `PUT` is refused unless
`new URL(base).hostname` is `localhost`, `127.0.0.1` or `[::1]`; it throws `LAPTOP_GUARD`, recorded as
`lastSkip: 'laptop-guard'`, never transient.

## E. The door step

New file [`server/src/services/fbtime/doorPush.js`](../server/src/services/fbtime/doorPush.js):
`runDoorStep(connectionId, { deep, now })`. `syncOneConnection()` calls it **after the hours step's try/catch, whatever
the hours result** — the step re-reads the connection and gates on its own status, so a failing hours pull never
silences door counts. `deep` comes from the job name (`fbtime-hours-deep` and `fbtime-hours-org` — connect, turn-on,
clear, Sync now — are deep; `fbtime-hours-recent` is not). The maintenance queue runs one job at a time on **one worker
dyno** — an operating rule in OPERATIONS.md (§L); the per-request re-check narrows, but does not remove, what a second
worker dyno could interleave. Each evaluation has a **budget of 60 seconds** of FbTime requests per organization; while
door counts are on, clears use at most about 40 of them.

**Order:**

1. **Deep job, var on:** refresh `keyScopes` and `fbtimeFeatures` by `/ping` (8 s) for every connected connection,
   writing only on change.
2. **Nothing to do** — off, no clear waiting, no confirm pass due → return with **no write**.
3. **Gates**, from a fresh read (`status`, `keyCiphertext`, `keyScopes`, `fbtimeFeatures`, `fbtimeOrgId`, `doors`,
   `keptAccounts`): the var not on (`unavailable`; read at call time — `on`, `true` or `1`, trimmed, any case); the org
   being deleted (`org-deleting`); not `connected` (`paused`); `keyScopes` absent → `/ping` once and store; no
   `doors:write` (`needs-permission`); `fbtimeFeatures` lacks `doors:reported-wins` (`fbtime-outdated`); another
   connection is the reporter (`conflict`). A gate stop writes one key-filtered update — `lastSkip`, `lastFinishedAt`
   and, per §H, `failCode` — and stops.
4. **Clears** (§F) — UTC date ranges, so they need neither zones nor the count. Group by group with saved progress, from a
   rotating starting group; 3 transient answers in a row end this phase only (the counter resets at the phase boundary);
   a 429, 401 or 403 ends the step.
5. **If the fresh read had `doors.enabled`: choose the windows, per person, before counting.** A **full run** (the deep
   job, or `deepDueAt` set at the step's start) sends everyone 120 days. Otherwise the 120-day group is `deepRetry` ∪ the
   people with a clear phase this run (first pass or confirm pass) who are linked now; everyone else gets 7.
6. **Nobody linked** → no count and no sends; the evaluation counts as all-definitive (`lastResult` one group with
   `people: 0`). Otherwise **zones and the count** over the widest window needed, all or nothing; each request takes its
   people's cells inside its own window.
7. **The send**, request by request.

**Before every request** (clears and sends): the reporter predicate again; then the conditional gate update — for sends
the §B pipeline write (`'doors.enabled': true`); for clears `{ _id, keyCiphertext: used }` plus "still asked for"
(`clearAll: true`, or the person still in `clearPersons` with the same `fromUserId`). Matched nothing → stop sending, or
drop those people from the clear. For a send, each person's **set of accounts** is re-read through the loader; anyone
whose set changed since step 6, or who now has a first-pass clear waiting, is dropped from the request.

**The reporter predicate.** A connection may send or clear only if no **other** non-disconnected connection with the
same non-empty `fbtimeOrgId` is ahead of it: when this one is **not** enabled, any enabled one is ahead; among enabled
ones, earlier `enabledAt` (then `_id`) is ahead. Errored connections stay in.

**Answers:**

| Answer | What Doorline does |
|---|---|
| `200` | Sum `applied/unchanged/cleared` into its window group; `$inc doors.replacedTyped` by `replacedTyped` (filtered on `{ _id, keyCiphertext: used, 'doors.enabledAt': <the run's> }`); union `unknownUserIds` |
| `400 VALIDATION`, other `4xx` except 401/403/429 | Definitive: `failCode` (FbTime's code), `failPhase`, `lastError` (FbTime's message) + `lastErrorAt`, `failDetail` (its detail); `console.error` a summary (never the body); the next request still goes |
| `401`/`403` `KEY_REVOKED` · `KEY_EXPIRED` · `KEY_INVALID` · `ORG_INACTIVE` | End the step; the errored transition (below) |
| `403 SCOPE_REQUIRED` | End the step; `/ping`, store `keyScopes`; `failCode: 'SCOPE_REQUIRED'` |
| any other `401` / `403` | End the step; definitive |
| `429` | End the step (the limit is per key); transient |
| `5xx`, timeout, network | Transient: `lastError` + `lastErrorAt`, **continue** with the next request; 3 in a row end the phase |
| Count failure | `INVALID_TIMEZONE` → `failCode`, `failDetail` naming the campaign or the organization; any other throw → transient. Either way no send request; clears already done stay done |
| `LAPTOP_GUARD` | `lastSkip: 'laptop-guard'`; not transient, no event |

**The errored transition** (hours and doors alike, replacing `markConnectionError`'s save): one update filtered on
`{ _id, keyCiphertext: used, status: 'connected' }`; `sync-failed` only if it modified a document. Otherwise the error
fields refresh through a key-filtered update with no event.

**After the run** (key-filtered):

- **`deepRetry`** = (`deepRetry` ∪ the step-5 120-day group) − people whose 120-day request got a definitive answer,
  limited to people linked now — so a count failure, a dropped request or a budget cut leaves everyone it owed 120 days
  still owed. A full run `$unset`s `deepDueAt` by compare-and-set even if something failed.
- **`failCode`** — one end-of-evaluation update filtered on the value read at the start: the evaluation's definitive code
  if it had one; else `STUCK` once `transientStreak` reaches 8 (about two hours); else null when every request got a
  definitive answer (including "nobody linked"). A Doorline-set code (`DOORS_REPORTER_TAKEN`, `SCOPE_REQUIRED`,
  `INVALID_TIMEZONE`) is also cleared by any evaluation that got past the step that set it, even if it then ends on
  transients. Left as is for a gate stop at paused / unavailable / fbtime-outdated / org-deleting / laptop-guard.
  `doors-failed` / `doors-recovered` only when the update changed the row.
- **`transientStreak`** +1 for an evaluation ending on a transient; 0 for an all-definitive one.
- **`lastFinishedAt`** on every evaluation past step 2 (Sync now waits for it). **`lastSentAt`, `lastResult` (per window
  group), `unknownPersonIds`** only when the regular send finished definitively; **`lastDeepSentAt` / `lastDeepResult`**
  only from a full run. **`overCap`**: entries are replaced only for the (person, date) pairs some request in the run
  covered.

## F. Explicit clears — the only way Doorline removes a person's numbers

A person who leaves `userIds` is never touched again (contract step 3), so an unlinked person's numbers **freeze**.
Doorline clears only when an admin asks, and **every explicit clear request carries the decision-14 flag** (proposed
`restoreTyped: true`), so FbTime brings back the numbers people had typed on those days:

| Asked by | Recorded as |
|---|---|
| **Unlink → "No — the link was wrong"** (row or bulk; a row unlink runs as a one-item batch) | `{ fbtimePersonId, fromUserId }` in `clearPersons` — only for a person in `doors.reported` (otherwise a plain unlink, `clear: false`); refused while disconnected (`409 DOORS_NOT_CONNECTED`); the pair also goes into `doors.rejected` |
| **Clear the numbers Doorline sent for *person*** (a roster row for an FbTime person in `doors.reported` who is not linked now) | `{ fbtimePersonId, fromUserId: null }` in `clearPersons` |
| **Turn off → "Also clear the numbers Doorline sent"**, or **Clear the numbers Doorline sent…** on the Off card | `clearAll: true` |

The clear phase (step 4):

1. **Who:** `clearAll` → every person in `reported` not yet in `clearAllDone`; per-person clears → the entries without a
   future `confirmAfter`.
2. **Range:** `max(earliestDate, addDays(utcToday, -729))` to **tomorrow UTC**, ≤ 120-day slices, `counts: []`. No
   `earliestDate`, or an empty range → done, nothing sent.
3. **Group by group, with saved progress.** A group is up to 41 people and all their slices; groups run from a rotating
   starting group each tick, so one failing group can't starve the rest. When every slice of a group returns `200` (a
   person answered in `unknownUserIds` counts as done): per-person entries get `confirmAfter = now + 15 min`; clear-all
   `$addToSet`s the group's people into `clearAllDone`. A failure keeps the group's state; the next tick retries that
   group only.
4. **The confirm pass — for every per-person clear, linked or not, and for clear-all.** A request can be cut off by
   Doorline's 30-second timeout while FbTime still writes it (reproduced: a stalled send landed after the clear and, under
   "Doorline decides", stayed locked). So each clear is repeated once, identically, at least 15 minutes later; a person
   linked now is in that run's 120-day group, so the refill follows the confirm pass. Clear-all: when every reported
   person is in `clearAllDone`, it sets `clearAllConfirmAfter`, unsets `clearAllDone`, and runs the same groups again.
5. **Done:** after the confirm pass, `$pull` the entry from `clearPersons` and the person from `reported`; when a
   clear-all's confirm pass finishes, `$unset` `clearAll` / `clearAllConfirmAfter` / `clearAllDone`, and `earliestDate`
   if `reported` is now empty. One `doors-cleared {count}` event per run. **Clears never remove `keptAccounts`.**
6. **No cut for a person linked again.** The clear covers the whole range; the same run's 120-day send refills the right
   canvasser's last 120 days (decision 8). If the refill fails, FbTime shows blank or restored-typed days — never the
   wrong canvasser's number — and `deepRetry` refills on the next tick.
7. **Cancelled:** linking a person to the **same** canvasser it was unlinked from (`POST /links`, Undo — never
   auto-match) `$pull`s the entry and its `rejected` pair and answers `clearCancelled: true` (also in the `link-created`
   detail); **Cancel** (`PATCH /fbtime/doors { cancelClears: true }`) drops every waiting clear, confirm pass and
   `clearAllDone`, and writes `doors-clears-abandoned {count}`; the per-request "still asked for" check makes either take
   effect mid-run. **Turning on** cancels `clearAll` (`doors-enabled` carries `clearCancelled: true`); per-person clears
   stay. **Turning off** never cancels a waiting clear.
8. **When:** whether door counts are on or off — but never while the var is off, the key can't write, FbTime lacks
   `doors:reported-wins`, or another connection is the reporter. **Disconnect** and an **organization change** refuse
   while a first pass is waiting unless overridden (`leaveDoorCounts: true` — the waiting clears are unset and
   `doors-clears-abandoned` written); a pending confirm pass alone is dropped without a 409.
9. **Rejected pairs:** `doors.rejected` keeps a "link was wrong" pair out of the roster's suggestions and the email
   auto-match. A manual link of that exact pair removes it. An org change unsets it with `doors`; the purge removes the
   purged user's entries.

**A documented limit:** a send FbTime writes more than 15 minutes after Doorline gave up on it, landing after both
passes, can't be caught; it needs an FbTime database stall of that length.

## G. Kept accounts — one person across Doorline accounts (decisions 9 and 11)

**Recorded** by `DELETE /fbtime/links/:userId` with body `{ doors: 'keep' }`, offered when the account is **deleted**
(always — it decides hours too) or when Doorline has sent door counts for that person (`$push`): `{ fbtimePersonId,
userId, until }`, where `until` is the account's `deletedAt` if deleted, otherwise the unlink time; event `account-kept
{ userId, fbtimePersonId }`.

**Cut at link time.** When `POST /links` or auto-match links a person (Undo included), for each kept entry K of that
person: `cut = max(start of the local day of the linked account's first door result in the org — in the zone the
Timeline files that result under, K's account's last door result + 1 ms)` ("door result" = the count's match:
`KNOCK_ACTIONS` + `restricted`, `NOT_BULK`); if `cut < K.until`, `K.until = cut` (positional `$set`), then the
`shiftOwner` reassign. Two indexed reads per entry on `{ userId, timestamp }`. Round 4 showed why: admins link the new
account after it has worked, so an `until` at the unlink time (or the deletion, if the new account started first)
handed the new account's first shifts to the old one and flipped the current campaign to estimated; the cut keeps both
accounts measured in every ordering tested, and its floor keeps the count and `shiftOwner` sharing one `until`.

**Removed** by **Stop counting** (`DELETE /fbtime/kept/:fbtimePersonId/:userId`, event `account-kept-removed`), when
that account is linked again anywhere, and by the purge (§M) — `$pull`, then a `shiftOwner` reassign over **all** of
that person's shifts (and, for a re-link, of every person whose kept entry it dropped). Never removed by a clear, Turn off
or an org change.

**Hours — one owner function**, `shiftOwner(fbtimePersonId, clockIn)` in `services/fbtime/`: the kept entry for that
person with the smallest `until` later than `clockIn` owns the shift; otherwise the person's current link; otherwise
nobody. It replaces the places that assign `FbTimeShift.userId` today and runs in every writer:

| Writer | Today | With `shiftOwner` |
|---|---|---|
| Unlink (`integrations.js:573-576`) | every shift of the person → null | each shift → `shiftOwner` (after the kept entry, if any, is written) |
| Link and auto-match backfill (`:542-545`, auto-match) | every shift of the person → the new user | each shift → `shiftOwner`, after the cut |
| Sync (`sync.js:142`) | `userOf(personId)` | `shiftOwner(personId, clockIn)` |
| Stop counting, a kept account linked again | — | `shiftOwner` over all of the person's shifts |

With no kept entry, `shiftOwner` gives exactly today's result. `loadMeasuredHours`' linked-account set and the profile's
`fbtime` block include kept accounts, so a kept account's row never reads "none of their clocked hours count — link them".

**Door counts:** the loader adds a kept account to its person's accounts with `until`, and the count takes its knocks
only before `until` (§C).

**The screen:** the FbTime person's row shows "also counts *name (earlier account)*" with **Stop counting** (Modal:
"Doorline will stop counting this earlier account for *Maria D.* — its hours return to the current link, so the earlier
account's past rates become estimated, and door counts re-send." For a deleted account: "This can't be undone."); sets
`deepDueAt`.

## H. The status model — one owner

`doorsStatus(leanConnection, extras)` in `doorCounts.js`; web and phone render it, never re-derive. `extras = {
available, otherReporter, enabledBy, people: Map(fbtimePersonId → { userId, name, fbtimeName }) }`, names from the account
loader plus the repo's `hydrateCanvassers` (which never drops an id).

| Card value | Derived from | Set by | Cleared by | Event |
|---|---|---|---|---|
| paused `connection` (on) | `status: 'errored'` | the errored transition | the probe recovers; Replace key | `sync-failed` / `sync-recovered` (existing, once) |
| paused `doorline` (on) | `extras.available` false (the gate `unavailable`) | the var unset | the var set | none |
| paused `fbtime-outdated` (on) | `fbtimeFeatures` lacks `doors:reported-wins` | any `/ping` | a later ping that lists it | none |
| attention `conflict` (on) | `extras.otherReporter` | — | the other connection turns off, disconnects or changes org | `failCode: 'DOORS_REPORTER_TAKEN'` → `doors-failed` / `doors-recovered` |
| attention `needs-permission` (on) | `keyScopes` without `doors:write` | `/ping` (connect, rotate, nightly, gate, after a 403) | Replace key with a door-count key | `failCode: 'SCOPE_REQUIRED'` → `doors-failed` / `doors-recovered` |
| attention `timezone` (on) | `failCode: 'INVALID_TIMEZONE'` + `failDetail` | the count | a later count that succeeds; Turn on/off | `doors-failed {code, campaign}` / `doors-recovered` |
| attention `refused` (on) | `failCode` not null and not in {`DOORS_REPORTER_TAKEN`, `SCOPE_REQUIRED`, `INVALID_TIMEZONE`, `STUCK`}; `failPhase` | a send or clear answered 4xx | an evaluation where every request got 200; Turn on/off | `doors-failed {code, phase}` / `doors-recovered` |
| attention `stuck` (on) | `failCode: 'STUCK'` (`transientStreak` ≥ 8) | the end-of-evaluation update | an all-definitive evaluation; Turn on/off | `doors-failed` at 8 / `doors-recovered` |
| `pendingClears.blockedBy` (on or off) | first that applies: `paused` → `unavailable` → `fbtime-outdated` → `conflict` → `needs-permission` → `refused` (`failPhase: 'clear'`) → `stuck` → null (runnable → state `clearing`) | as above | as above; the clear completing; Cancel | `doors-cleared`; `doors-clears-abandoned` |
| `offHint` (off, nothing waiting) | first that applies: `conflict` → `hours-only-key` (canWrite false) → `revoke-door-key` (canWrite true and `enabledAt` set) | live | live | none |

**State precedence:** while **on** — paused (`connection` → `doorline` → `fbtime-outdated`) → attention (`conflict` →
`needs-permission` → `timezone` → `refused` → `stuck`) → `clearing` → `starting` (no successful send since `enabledAt`)
→ `sending`. While **off** — `clearing` if a runnable clear waits, else `off` with its `offHint`. A waiting clear that
can't run is a notice with `blockedBy`, drawn on or off and whatever the var. **Turn on and Turn off** both `$unset`
`failCode`, `failPhase`, `failDetail`, `lastError` and `transientStreak`; Turn on also `$unset`s `replacedTyped`;
`lastResult` and `unknownPersonIds` show only when `lastSentAt ≥ enabledAt`, and `lastDeepResult` only when
`lastDeepSentAt ≥ enabledAt`.

The `doors` block of `GET /fbtime`:

```js
doors: {
  available, enabled, enabledAt, enabledBy: { name } | null,
  canWrite, reportedWins,             // keyScopes has doors:write; fbtimeFeatures has doors:reported-wins
  state, reason,                      // reason = the paused / attention value, or offHint when off
  lastSentAt, lastResult: [ … ], lastDeepSentAt, lastDeepResult, lastFinishedAt, lastErrorAt, lastError,
  failCode, failPhase, failDetail,
  replacedTyped, everSent,            // everSent = `reported` non-empty
  canClearAll,                        // everSent and the clear could run now (var, key, feature, no conflict)
  unknownPeople: [{ userId, name, fbtimeName }],
  overCap: [{ name, date, knocks }], overCapCount,
  pendingClears: { all, persons: [{ fbtimePersonId, name }], confirmPending, blockedBy },
}
```

## I. Routes — [`routes/admin/integrations.js`](../server/src/routes/admin/integrations.js)

All behind the router's `requireOrgRole('admin')`; leads never reach them.

| Route | Change |
|---|---|
| `GET /fbtime` | Adds `keyScopes`, `fbtimeFeatures` and the `doors` block (§H). Additive; the phone reads the same GET |
| `GET /fbtime/people` | Each person and orphan link gains `doorsSent` (in `reported`), `deleted`, `alsoCounts` (kept accounts) and `canClearSent` (in `reported`, not linked now); suggestions skip `doors.rejected` pairs |
| `GET /fbtime/events` | Each event gains `by: { name, status } \| null` via `hydrateCanvassers` (deleted users show their snapshot name until the purge; null `byUserId` reads "automatic") |
| `POST /fbtime/test` | Also returns the ping's `features` (additive) — the Replace-key form shows the door-count line only when `doors.available` |
| `POST /fbtime/connect` | **An organization change** = the ping's org id differs from a stored non-empty `fbtimeOrgId`, at any status — a rotate (`ORG_CHANGE_CONFIRM` first, as today) or a reconnect of a disconnected row. With a first-pass clear waiting and no `leaveDoorCounts: true` → `409 DOORS_CLEAR_PENDING` (`{ all, persons }`); otherwise `$unset doors`, `doors-disabled {reason:'org-changed'}` if it was on, and auto-match runs. **Same organization:** keeps `doors` (clears included — a waiting clear runs with the new key, or stays blocked if that key can't write) and sets `deepDueAt`; a reconnect after Disconnect forces `doors.enabled: false`; auto-match does **not** run. Stores `keyScopes` and `fbtimeFeatures`. The write is filtered on `{ organizationId, keyCiphertext: <as read> }` plus, for an org change, "no first-pass clear waiting"; nothing matched → re-read and answer `409 DOORS_CLEAR_PENDING` or `409 CONNECTION_CHANGED`; a first connect upserts, and a racing insert's duplicate-key error becomes a 409 |
| `PATCH /fbtime/doors` *(new)* | `{ enabled }`, `{ enabled: false, clear: true }`, `{ clear: true }` while off, `{ clearPerson: fbtimePersonId }`, or `{ cancelClears: true }`. **On**, checks in order: `403 DOORS_STAFF_FORBIDDEN` under a support grant (staff may turn it off) → `409 DOORS_NOT_AVAILABLE` → `409 DOORS_NOT_CONNECTED` → fresh `/ping` (8 s; a failure goes through `sendProviderError` — nothing written) → `409 DOORS_ORG_UNKNOWN` (the ping has no org id, or one different from a stored non-empty id; empty stored + the ping's → stored) → `409 DOORS_REPORTER_TAKEN` (on the ping's org id: "This FbTime organization already gets door counts from another Doorline organization. Only one can send them — contact Doorline support if that's unexpected.") → `409 DOORS_SCOPE_MISSING` → `409 DOORS_FBTIME_OUTDATED`; then one update filtered on `{ status: 'connected', keyCiphertext: <the key just pinged>, 'doors.enabled': { $ne: true } }` storing the ping's `keyScopes` / `fbtimeFeatures` and setting `enabled`, `enabledAt`, `enabledByUserId`, `deepDueAt`, unsetting `clearAll` / `clearAllDone` and the §H fields; `doors-enabled` (with `clearCancelled` when it cancelled a `clearAll`); enqueue `fbtime-hours-org`. Already on → 200, nothing written. **Off:** `enabled: false` and the §H unsets; with `clear: true` it also needs the var on, a connected connection, `doors:write` and `doors:reported-wins` (else 409 naming which), sets `clearAll`, enqueues the job, never lowers a waiting `clearAll`; `doors-disabled {reason:'admin', clear}`. **clearPerson** (a person in `reported`, not linked now; same preconditions as a clear) → `{ fbtimePersonId, fromUserId: null }`. **cancelClears:** unsets `clearPersons`, `clearAll`, `clearAllDone` and the confirm passes; `doors-clears-abandoned {count}` |
| `DELETE /fbtime` (disconnect) | One conditional update: no first-pass clear waiting, else `409 DOORS_CLEAR_PENDING` — unless `leaveDoorCounts: true` in the JSON body (unsets the clears, `doors-clears-abandoned`). A pending confirm pass alone is dropped. Sets `doors.enabled: false` (`doors-disabled {reason:'disconnected'}` if it was on). The ledger, `rejected` and `keptAccounts` stay for a same-org reconnect |
| `POST /fbtime/sync` | Unchanged; the web's one **Sync now / Refresh hours** button |
| `POST /fbtime/links` | Lower-cases `fbtimePersonId`. Refuses a **deleted** account (`409 ACCOUNT_DELETED`) and **moving a linked canvasser to a different person** (`409 LINK_CHANGE` — "Unlink first"). Applies the kept-account cut (§G); cancels a same-pair clear and removes the pair from `rejected` (`clearCancelled`); removes `keptAccounts` entries for this canvasser and reassigns via `shiftOwner`; sets `deepDueAt` |
| `DELETE /fbtime/links/:userId` | JSON body `{ doors: 'keep' \| 'clear' }` or none. `keep` → a `keptAccounts` entry (§G); `clear` → §F (only for a person in `reported`; otherwise a plain unlink); none → as today. Shifts re-assigned via `shiftOwner`; sets `deepDueAt` |
| `DELETE /fbtime/kept/:fbtimePersonId/:userId` *(new)* | Stop counting (§G) |
| auto-match | Skips `doors.rejected` pairs; never cancels a clear; applies the kept-account cut; removes `keptAccounts` entries for anyone it links and reassigns via `shiftOwner`; sets `deepDueAt` when it linked anyone |

## J. Web — design

**Placement.** A new [`DoorCountsCard`](../client/src/components/integrations/DoorCountsCard.jsx) under the
`StatusStrip` on [`IntegrationsPage.jsx`](../client/src/pages/IntegrationsPage.jsx); drawn when `doors.available`, or
door counts are on, or a clear is waiting. Compact when off. Theme tokens only, the red brand accent on the primary
button, `IconAlert` for notices, completion announced in an `aria-live` region.

```
┌───────────────────────────────────────────────────────────────────────┐
│ Door counts to FbTime · Off      Fill in FbTime's doors-per-hour page │
│                                  from Doorline.       [ Turn on… ]    │
└───────────────────────────────────────────────────────────────────────┘

┌─ Door counts to FbTime ─────────────────────────────────── ● Sending ─┐
│ Last sent 2:34 PM — the last 7 days, 42 people.                       │
│ Turned on by Ada Admin, Oct 9.                                        │
│ Since door counts were turned on, Doorline's numbers have replaced    │
│ about 29 numbers typed on FbTime.                                     │
│ ⚠ 2 linked people aren't in your FbTime organization — shown as       │
│   Broken link below.                                                  │
│ ⚠ Not sent: Ann Lee, Oct 3 — 2,140 doors (FbTime's limit is 2,000).   │
│                                                          Turn off…   │
└───────────────────────────────────────────────────────────────────────┘
```

- **Off hints** (`offHint`): another organization reports; hours-only key ("When you're ready, create a key in FbTime
  with *Also let it fill in door counts* ticked, then **Replace key** in Settings." `[Open Settings]`); door-count key
  still live ("Doorline's days stay locked on FbTime while your door-count key exists — to stop for good, clear first if
  you want, then replace it with an hours-only key and revoke it in FbTime."). **Clear the numbers Doorline sent…** only
  when `canClearAll`; when Doorline sent numbers but can't clear now, the card explains how (a door-count key, Replace
  key, Clear, then back to an hours-only key and revoke).
- **Turn on…** Modal: "Turn on door counts? Every 15 minutes Doorline will send FbTime the doors each linked canvasser
  recorded each day — 42 people now, and anyone you link later — for the last 7 days, and every night the last 120 days.
  FbTime receives its own person id, the date and the number; nothing about voters. On days Doorline reports, FbTime
  shows Doorline's number, locked; numbers typed there are filed away by FbTime — tell whoever types doors on FbTime.
  Clearing later in Doorline brings typed numbers back." Says when it will cancel a waiting clear-all. A 409 shows its
  message in the Modal.
- **Turn off…** Modal: "Days Doorline sent keep its numbers — locked while your door-count key is live — unless you
  clear them. Clearing brings back numbers typed there and blanks the rest." A labelled checkbox **"Also clear the
  numbers Doorline sent"**, and the stop-for-good line.
- **Clearing** state and the **Clears waiting** notice both carry **Cancel**.
- **Unlink** — one Modal, **"Was the link right?"**, when any selected row has `doorsSent` or is a deleted account:
  **Yes — keep** (row copy: "They left, or they'll come back with a new account. What Doorline sent stays, corrections
  stop reaching FbTime for them, and the account keeps counting for *Maria D.* if you link a new account later." —
  the door-count clauses only when `doors.available`) / **No — the link was wrong** ("Doorline removes every number it
  sent for *Maria D.*, bringing back numbers typed there." — for rows with door counts sent; other rows simply unlink).
  Bulk: "N of these have door counts on FbTime"; the inline confirm remains only for selections with neither. Deleted
  accounts and members who left: "This account can't be linked again." After a clear the banner says "Undo cancels the
  clear if it hasn't run yet." Undo skips deleted accounts.
- **Roster.** `fbtime-gone` separates *the FbTime person is no longer in FbTime* from *the Doorline member left*. A
  person with kept accounts shows "also counts *name (earlier account)*" with **Stop counting**. An FbTime person with
  `canClearSent` shows **Clear the numbers Doorline sent for *name***.
- **Sync now** — the status bar's one button (**Refresh hours** while door counts are off). Checked **failed first**
  (the connection's or the door counts' `lastErrorAt` past the returned `requestedAt`, or status `errored`), then
  **done** (`lastSyncAt` and — door counts on — `doors.lastFinishedAt` past it).

**Settings modal** gains **Replace key** above Disconnect:

```
Replace key
[ fbt_live_…                         ]  [ Test ]
This key reads Fox Bryant (key "Doorline (production) 2").
It can also fill in door counts.            [ Use this key ] [ Cancel ]
```

The door-count line shows only when `doors.available`. While door counts are on, an hours-only key adds "Door counts will
stop and the card will show Needs attention until a key that can fill them in is in place." A waiting clear adds "It will
run with this key." A `409 ORG_CHANGE_CONFIRM` shows "This key reads **a different** FbTime organization (X), not Y. Door
counts will be turned off; numbers already sent stay in Y — locked while its door-count key is live, so clear first if you
want them gone, then revoke that key — and your links probably won't match. Use it anyway?" and, when a clear is waiting,
that it will be abandoned (one request carries both `confirmOrgChange` and `leaveDoorCounts`). The holdings note gains
(when available): "When door counts are on, Doorline also sends FbTime each linked canvasser's doors per day."
**Disconnect**'s confirmation gains (when available) the door-count lines, "clear first if you want, then revoke the key in
FbTime", and the waiting-clear override.

**Recent activity** shows who and why, from `by`: "Door counts turned on — by Ada Admin" · "Door counts turned off — by Ada
Admin (cleared)" · "— disconnected" · "— FbTime organization changed" · "Door counts started failing (VALIDATION)" · "Door
counts recovered" · "Cleared door counts for 3 people" · "Waiting clears abandoned (2)" · "Kept an earlier account for
*Maria D.*" · "Stopped counting an earlier account".

## K. Phone — copy only

[`mobile/app/(app)/admin/more.jsx`](<../mobile/app/(app)/admin/more.jsx>), driven by `doors.state`:

| `doors` | Sub-line | Note adds |
|---|---|---|
| absent, off, or paused `doorline` / `fbtime-outdated` | "Connected — measured hours on" (as today) | Paused: "Door counts are paused by Doorline." / "… until FbTime is updated." (no badge) |
| `starting` | "… · door counts starting" | "The first send is under way." |
| `sending` | "… · door counts on" | "Door counts go to FbTime every 15 minutes; last sent 2:34 PM." |
| `clearing` | "… · clearing door counts" | "Removing the numbers you asked Doorline to clear." (no badge) |
| `attention`, paused `connection` | "… · door counts need attention" (badge `!`) | One sentence for the reason; "Manage on the web dashboard (Integrations)." |

The errored note becomes "Hours and door counts have stopped …" when door counts are on. The stale "Doorline shows daily
totals only" sentence becomes the web modal's wording. Over the air, staging then production; older apps ignore the new
fields; no `CLIENT_API_VERSION` bump.

## L. Docs and Help Center

Help ships with the server deploy, before the var is set, so every door-count article is worded conditionally ("If you
don't see a **Door counts to FbTime** card on Integrations, it isn't available to your organization yet"); `faq/_INBOX.md`
names `FBTIME_DOOR_COUNTS` (never named to customers).

| File | Change |
|---|---|
| [`docs/FBTIME_INTEGRATION.md`](FBTIME_INTEGRATION.md) | Part 1 "Door counts to FbTime", "FbTime's page — Doorline decides", "Replacing a door-count key", kept accounts; Mapping/Broken link (:110-116), Disconnecting (:176-178), "Refresh hours" (:168, :227), auto-match (:385); Part 2 the model, files, step, clears, kept accounts and `shiftOwner`, routes, status table; the Privacy section's first outbound sentence and the deletion changes; the IntegrationEvent append-only exceptions |
| [`docs/PRIVACY_VERIFICATION.md`](PRIVACY_VERIFICATION.md) | §M stamp, watchlist line, the deletion gaps; `:909` amended by stamp |
| [`docs/METRICS.md`](METRICS.md) | Knocks leave the system per canvasser per day; changing `KNOCK_ACTIONS` changes what FbTime receives (and `aggregations.js:15-19`); a returning canvasser's hours stay with the old account |
| [`docs/TIMEZONES.md`](TIMEZONES.md) | Campaign create/update now refuse a zone outside the curated list (`400 INVALID_TIMEZONE`) |
| [`docs/OPERATIONS.md`](OPERATIONS.md) | `FBTIME_DOOR_COUNTS` (values, kill switch); the one-worker-dyno rule; `DELETED_IDENTITY_RETENTION_DAYS` must stay ≥ 121 (default 180) |
| [`docs/DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md) | `migrate:fbtime-deletion-gaps` — list line and rollback row |
| [`docs/README.md`](README.md) | The FBTIME_INTEGRATION row (:27); this proposal's index row |
| `server/src/content/help/guides/fbtime-hours.md` | "Sending door counts to FbTime", "What FbTime's page shows", "Replacing a door-count key"; Mapping (:66-68), the refresh button (:81-85), Disconnecting/Broken link (:107-111), "Was the link right?", kept accounts, clearing an unlinked person's numbers, "clear before you revoke" |
| `server/src/content/help/pages/page-integrations.md` | The card, Sync now, Replace key (:30-33), unlinking (:79-81), Broken link (:85-86), Recent activity (:90-94), "also counts" and Stop counting, the per-person clear |
| `server/src/content/help/faq/fbtime-door-counts.md` *(new, admin)* | "Why can't I change a door count on FbTime — and where does it come from?" — Doorline decides while a door-count key is live (fix the door results in Doorline); where to look (the Timeline's canvasser table, Doors column, per campaign, added up); typed numbers on reported days are filed away, and come back when Doorline clears; "Doorline: none" days — don't retype moved doors; doors Doorline can't know go in **other doors**; which days corrections don't reach (older than 120, unlinked people, after stopping); Restricted-only days are 0; desk Restricted marks and notes don't count; timing; a campaign zone change; the two different-date cases |
| `faq/fixed-fbtime-shift-not-updating.md` (:8, :23-26), `faq/why-does-doors-per-hour-say-estimated.md` (:55-56) | "Refresh hours (Sync now when door counts are on)" |
| `faq/canvasser-deleted-their-account.md` (:12-15, :30-33) | With FbTime: unlink the old account choosing **Yes — keep**, then link the new account to the same FbTime person — their old hours and doors stay theirs |
| `client/src/components/integrations/RosterTable.jsx:140` | The refresh-button hint |
| Code comments | `client.js:3`, `IntegrationEvent.js:3-17`, `sync.js:26-29`, `FbTimeConnection.js:5-7`, `integrations.js:18-21` |

## M. Privacy record — owner sign-off required before release

**Privacy-affecting.** Per-canvasser daily door counts are a new category of personal data leaving Doorline. Not a new
subprocessor (FbTime is already disclosed, engaged by the customer); no customer notice (decision 7) — the customer's admin
turning door counts on is the customer's instruction under **DPA §2**. Nothing is sent until the var is set, and it is set
only after this wording is live. **Terms of Service: unaffected** — §3 and §4 (`terms.html:106`) already cover it.

Statements that become false once a send happens: DPA §6 ("Doorline sends FbTime **only** date ranges and a timezone");
privacy.html:106 ("we send date ranges, and receive …"); PRIVACY_VERIFICATION's v5 "What LEAVES … read-only inbound" and the
v6 2026-09-03 "still only date ranges and a timezone"; and the §L lines. The record and docs change in the build (the record
by a new stamp); **DPA.md and privacy.html change only at the owner's direction**. Proposed wording:

- **DPA §6:** "… Doorline sends FbTime date ranges and a timezone and, if Customer also turns on door-count reporting, the
  number of doors each linked staff member recorded each day (including up to the 120 days before reporting is turned on),
  identified only by FbTime's own person identifier; and receives Customer's staff names, …"
- **Privacy Policy:** "… we send date ranges — and, if your administrator also turns on door-count reporting, the number of
  doors each linked staff member recorded each day, so FbTime can show doors per hour — and receive staff names, …"

Also for the owner in the same edit: privacy.html's "Last updated" (:81) still reads July 17, 2026 after four content edits
(7b69c0b, d5854e8, 84b3771, 8b4bdb2), so :143 is already untrue; and the project-label wording left open on 2026-09-03.

**The two older gaps (decision 10):**

- **Emails.** privacy.html:127 says deletion removes "your email address … immediately", but the link's `fbtimeEmail` and the
  `link-created` event's `detail.userEmail` outlive the account. **Going forward:** account deletion
  (`services/users/deleteAccount.js`) `$unset`s `fbtimeEmail` on the deleted user's links in every org; `link-created` no longer
  stores `userEmail`. **Backfill:** a one-off `migrate:fbtime-deletion-gaps` (`server/src/migrations/`, dry run by default,
  `--apply` writes, counts per step; root `package.json` proxy `"migrate:fbtime-deletion-gaps": "npm --prefix server run
  migrate:fbtime-deletion-gaps --"`; run from the repo root before handing over): (1) unset `fbtimeEmail` on every link whose
  user has `deletedAt`; (2) unset `detail.userEmail` on **every** `link-created` event (read nowhere — a per-user match silently
  misses: `detail.userId` is stored as a string, sometimes upper-case); (3) the purge's FbTime step (below) for records already
  purged (expected 0 — the first default purge is ~2027-01-08). Idempotent.
- **Pairing after the 180-day purge.** `purgeDeletedIdentities` gains an FbTime step **keyed on the account — every org, every
  connection status** (a disconnected or errored connection, and an org the person had already left, keep links and events too;
  `DeletedUserRecord.organizationIds` lists only memberships active at deletion). Per record, **before** the `purgedAt` stamp, in
  its own try/catch — a record that throws is counted and left unstamped for the next night, the rest proceed, and a run with any
  failure writes `RetentionRun { ok: false, failed }` so the health check goes red; dry run counts only. **De-pairing, not
  reverting** (reverting the account's shifts flipped every campaign rate over their days to estimated; reproduced):
  1. `FbTimePersonLink.deleteMany({ userId })`;
  2. three separate `FbTimeConnection` updates (combined, an `arrayFilters` write throws on rows without the array): `$pull
     keptAccounts { userId }`; `$pull doors.rejected { userId }`; `$set doors.clearPersons.$[c].fromUserId: null` filtered on
     `'doors.clearPersons.fromUserId': userId` (the clear stays — it is the admin's request about the FbTime person);
  3. its shifts, scoped `organizationId: { $in: <orgs with a connection row> }` (so the index serves it): clocked **before**
     `deletedAt` → keep `userId`, `fbtimePersonId: 'purged'` (hours stay measured — decision 11; no row pairs the account with a
     person; a later link of that person claims none of them); at or after → `shiftOwner` without the account;
  4. `IntegrationEvent`, no org filter, `type ∈ { link-created, link-removed, account-kept, account-kept-removed }`, matched
     `{ $or: [{ 'detail.userId': { $in: ids } }, { 'detail.userId': { $in: ids.map(caseInsensitiveRegex) } }] }` → `$unset
     detail.fbtimePersonId`;
  5. one `link-removed {reason:'identity-purge', count}` per org touched — no ids.
  The migration's step 3 reuses the same function. This holds while `DELETED_IDENTITY_RETENTION_DAYS` ≥ 121 (default 180),
  documented in OPERATIONS.md.

**IntegrationEvent is append-only in operation**; the stamp, the model comment and FBTIME_INTEGRATION.md name the two exceptions
(the migration's email scrub; the purge's de-pairing) and the existing org-deletion cascade.

**The stamp** (a v6 entry under the v5 record) records: what leaves (FbTime person id, date, number — the PUT body's exact keys
plus the explicit-clear flag, pinned by a test); when (var on + the org's switch + a `doors:write` key + FbTime's
`doors:reported-wins`); who can turn it on (the customer's own admin — staff under a grant are refused; staff can already
*connect* under a grant, so "nobody at Doorline can wire it up" is enforced by process); account deletion (a deleted account's link
survives until the purge, so its existing counts are restated for at most 119 days after its last knock; emails go at deletion,
pairings at the purge); kept accounts (an admin's choice that one FbTime person is one human across Doorline accounts — no new data,
a mapping between existing records); retention (Doorline holds the ledger and last-run summaries; numbers already sent live in the
customer's FbTime, outside Doorline deletion — privacy.html:122 stays true); the record's own inconsistency (v5 "a NEW subprocessor"
vs DPA §6 "engaged by Customer"; DPA §6 governs); a **watchlist** line ("never names, emails, voter data …" kept true by
`planDoorRequests` and the body-keys test); and — worded like the build-indexes precedent (`PRIVACY_VERIFICATION.md:56-57`) — "rows
from before this deploy stay as they were until `npm run migrate:fbtime-deletion-gaps -- --apply` runs (operator-attested run
<date>, counts …)", with the post-run edit named in the hand-off.

## N. Tests

All temporary scripts live in the session scratchpad, never under `server/test/`.

- **`fbtimeDoorCounts.test.js`** (pure): `doorsWindow`; `planDoorRequests` (500 at 7 days, 41 at 120; a window that doesn't match
  the cells refused; 2,001 recorded; never an empty request; cells summed); clear slicing and grouping (floor, ≤ 120-day slices to
  tomorrow UTC, empty = done, rotating start); `doorsStatus` — one case per §H row and per event transition, the `refused`
  predicate, off + hours-only key = `off` with a hint, a waiting clear drawn with the var off, `starting` after an off/on cycle, the
  read-side filters, `canClearAll`; the zone resolver; `shiftOwner` (no kept entry = today; two kept entries; boundaries); the
  kept-account cut (every ordering: the new account starting before/after the deletion, a non-deleted earlier account, two kept
  entries, a wrong link undone, a true overlap); the var parser; the PUT body's exact key set, with the flag only on explicit clears.
- **`fbtimeDoorPush.int.test.js`** (throwaway mongod, `fbt_test_` fake modelling window-replace, "Doorline decides", the
  lock-while-live rule, the explicit-clear restore, the emptied-day marker, and a stalled write):
  - **Parity with the real Timeline** through `processMaintenanceJob({ name: 'fbtime-hours-org', data: { organizationId: String(id)
    } })`: org on America/New_York; a Chicago campaign with a 23:30 knock and an Eastern 21:00 knock; an archived campaign; every
    `actionType` incl. `note_added`, `restricted` and a desk mark; a canvasser in a second org; window-edge knocks; 2026-11-01 23:30;
    linked people with zero campaigns; injectable `now`; compared both ways per person and date against `GET
    /admin/reports/canvasser-timeline` per campaign in ≤ 62-day slices.
  - **Same-round revisit**; **the save race**; **created through `POST /fbtime/connect`**; **nobody linked** (no count, `sending`
    with 0, never `stuck`); **a failing hours pull** still runs the door step.
  - **Run order:** an off org with a campaign zone outside the list and a waiting clear → the clear runs; a count failure sends
    nothing but clears already done stay and the newly linked are still owed (`deepRetry`); a 120-day window never carries 7-day
    cells.
  - **The per-request gate:** Disconnect / Turn off / an org-changing Replace key mid-run → no further request, nothing written to
    the new org; a changed account set mid-run → dropped; the reporter predicate.
  - **Answers:** 200 (per-group summaries; the cumulative `replacedTyped`, incl. a chunk lost to a 503); 400 (definitive, once);
    403 `SCOPE_REQUIRED`; 401 `KEY_REVOKED` (one `sync-failed`; none for an already-errored re-probe; none for a replaced key);
    429; 503 (continue; 3 in a row end the phase; owed people in `deepRetry`; a full run still clears `deepDueAt`; 8 → `stuck`); the
    budget; `LAPTOP_GUARD` (fetch stubbed).
  - **Clears:** unlink-keep; unlink-clear (flagged, from `earliestDate` to tomorrow UTC; typed numbers restored in the fake);
    `clear` for a person never sent → plain unlink; the per-person clear for an unlinked person; clear then relink to a different
    canvasser (older days cleared, 120 refilled; refill 503 + a run after midnight → no wrong number); the confirm pass for a linked
    person catches a stalled write; group progress survives the budget (a 2,000-person clear-all finishes); same-pair relink and Undo
    before the run → cancelled; Cancel mid-run; turn-off-and-clear and Off-card clear → everyone cleared after the confirm pass,
    `earliestDate` unset; clears never drop `keptAccounts`; rejected pairs kept out of suggestions and auto-match.
  - **Kept accounts:** X kept for P, P linked to Y → doors X (before `until`) + Y summed; hours — every ordering keeps X's history
    and Y's current campaign measured; Stop counting → all of P's shifts reassigned, X's past rates estimated; X linked again
    elsewhere → entry dropped and shifts reassigned; parallel Keep unlinks keep every entry.
  - **Gates:** var off → no PUT and no write for orgs with nothing to do; `fbtime-outdated` → paused.
- **`fbtimeIntegration.int.test.js`** (extend): every `PATCH /fbtime/doors` check in order (403 staff, each 409, a ping failure
  writes nothing, the filtered update racing a disconnect, no-op when on, scopes/features stored on turn-on, `clearCancelled`, Off
  with/without clear, clear while off, `clearPerson`, `cancelClears`); connect (org change at any status incl. a reconnect of a
  disconnected row to another org; `ORG_CHANGE_CONFIRM` then `DOORS_CLEAR_PENDING`; a same-org rotate with a waiting clear keeps it;
  no auto-match on a same-org rotate; `CONNECTION_CHANGED`); reconnect starts off; Disconnect's conditional 409 + override, a confirm
  pass dropped silently; links (lower-cased, `ACCOUNT_DELETED`, `LINK_CHANGE`, `{ doors: 'keep' | 'clear' }`, Stop counting);
  `/fbtime/people` fields; `/fbtime/events` names; a lead refused on every new route.
- **Deletion, purge and migration:** deletion unsets the link's `fbtimeEmail` in every org; a new `link-created` has no email; the
  migration (dry run counts, apply, re-run zero; events created through `POST /links` with a mixed-case id); the purge across a
  connected, a disconnected, an errored and a left org (no pairing left anywhere; X measured before and after; a later link of P claims
  no 'purged' shift); a record that throws stays unstamped while the others are purged, and `RetentionRun.ok` is false; dry run writes
  nothing; the CLI does the same.
- **`fbtimeClient.test.js`:** `putDoors` (PUT, JSON, Bearer, body read under the timeout, `detail`); `ping` timeout; the laptop guard
  after the seam (`[::1]`).
- **Campaigns:** create refuses a zone outside `US_TIMEZONES` (400 `INVALID_TIMEZONE`); update refuses one unless unchanged.
- **Web:** `integrationsRender.smoke.test.js` — every card state and notice, `canClearAll` on/off, Cancel while clearing, the "Was the
  link right?" Modal (single, bulk mix, deleted account with door counts sent), the per-person clear, the Undo banner, Replace key
  (door-count line, hours-only, a waiting clear, org change + waiting clear), "also counts" and Stop counting, Sync now (failed checked
  first), Recent activity names; `fbtimeRoster.test.js` — `fbtime-gone`, `alsoCounts`, `canClearSent`.
- **Phone:** babel-parse the changed file and a full `expo export` bundle.
- **End to end, locally:** a scratchpad server implementing `PUT /doors` on `127.0.0.1`, `FBTIME_API_BASE` pointed at it, an
  `fbt_live_`-shaped test key — the real `fetch` path once; **request sizing re-measured** against the FbTime build named for deployment
  on a throwaway database. Never production.
- Full suites: server unit + integration, client, `npm run audit:mobile-api` (integrations and campaigns routes change; all additive
  except the zone refusal, which only refuses zones no screen offers).

## O. Rollout

1. **Build, verify, hand over** the commit message. The owner commits with `git add -A`; other sessions have uncommitted work in the
   same folder (today: a GPS stamp in `docs/PRIVACY_VERIFICATION.md` — the same file this build stamps — and an untracked
   `docs/PROPOSAL_LEAD_CAMPAIGN_LANDING.md`); the hand-off names them.
2. **`npm run audit:mobile-api`**, then **deploy Doorline** from the Heroku dashboard. The var is unset: no card, no switch, no sends
   (Help is worded conditionally); the deletion fixes and `shiftOwner` are live at once.
   - **2b.** Heroku dashboard → **More → Run console** → `npm run migrate:fbtime-deletion-gaps` (dry run — read the counts) → `npm run
     migrate:fbtime-deletion-gaps -- --apply` → the bare command again (zeros). The privacy stamp's counts are filled in from that
     output (the hand-off names the edit).
3. **The owner approves the privacy wording** (§M) — or approves it before step 2 so it ships in the same deploy; privacy.html (with its
   Last-updated date) and DPA.md are edited at the owner's direction.
4. **FbTime deploys "Doorline decides" and decisions 13-16** (the FbTimeApp session's work — `/ping` lists `doors:reported-wins`); the
   owner confirms it is live, and that FbTime's key-creation text (web and phone) and DPH help describe these rules — the feature flag
   can't detect stale wording.
5. **Check, then set the var.** Open the live Privacy Policy and confirm the door-count sentence, and confirm `docs/DPA.md` §6 on `main`
   (the signing template). Then Heroku dashboard → Settings → Config Vars → `FBTIME_DOOR_COUNTS` = `on` (the dynos restart). Confirm the
   card appears.
6. **An admin who is a member of the organization** (staff under a grant are refused by design) creates the door-count key in FbTime,
   then **Integrations → Settings → Replace key**.
7. **Turn on door counts.** Within a few minutes the card says **Sending**; FbTime's DPH page shows Doorline's days locked, "from
   Doorline".
8. **Revoke the old key** in FbTime — once no other Doorline organization uses it.
9. **Phone copy:** check what else is unreleased on `main` under `mobile/` (`ota:production` publishes the whole tree), then `npm run
   ota:staging` from `mobile/`, check, then `npm run ota:production` from `main`.

**Kill switches:** delete `FBTIME_DOOR_COUNTS` (every organization, no deploy), or **Turn off** on one organization's card.

## P. What this deliberately does not do

- No sending for unlinked canvassers, and no zero for a day with nothing recorded.
- No per-campaign or per-project split (the owner's ruling).
- No automatic clearing of a person — only the explicit requests in §F (window-replace still clears single days by design, and FbTime marks
  them).
- No re-send older than 120 days except clears, and no refill of older days after a clear (decision 8).
- No reconciliation pass — every send restates its window from scratch.
- No "visits per day" count — the latest result per canvasser per door per round, as the Timeline.
- No warning for days FbTime files under a different date — the only check that could find them also fires on an ordinary forgotten
  clock-in, and a false alarm is worse than a miss. The FAQ explains it.
- No moving a linked canvasser to another FbTime person in one step: Unlink (keep or clear), then link.
- No catching a send FbTime writes more than 15 minutes after Doorline gave up on it (§F's documented limit).

## Q. Review log

**Round 1** — three reviewers (counting and time; protocol, state and failure; product, privacy, docs and rollout), 39 findings, each
re-checked by a skeptic against the code: one refuted, several narrowed, four to the owner. Changed: typed-number handling (later
superseded); explicit clears; no schema defaults and one ledger write; the org-wide, all-or-nothing count; the release var, the laptop
guard, write-ahead, person-day sizing; Replace key without auto-match; staff refused on turn-on; the key-conditional errored transition.

**Round 2** — three reviewers on revision 2, 45 findings, each re-checked: none refuted outright, one idea refuted (naming the other
Doorline organization — cross-tenant), two to the owner. Changed: no-cut clears with a same-run refill; one per-request gate; the reporter
predicate; card states only while on; same-pair relinks cancel clears; Cancel; kept accounts; the two deletion gaps; the curated zone list;
`sync-failed` once; transients continue.

**Round 3** — three reviewers on revision 3, 38 findings, each re-checked against FbTime's committed 8c52b5d and the real `hoursSource`:
none refuted, two to the owner. Changed: the purge de-pairs instead of reverting; a returning canvasser's hours stay with the old account
(`shiftOwner`); the deletion-email backfill; clears before and independent of the count; per-person windows; `deepRetry`; a time budget;
the confirm pass; FbTime 8c52b5d facts; the status model as one table. After this round the owner ruled **"Doorline decides"**, which
removed the adoption, override, restore and flag machinery from both apps (revision 5).

**Round 4** — three reviewers on revision 5 (the mechanisms against FbTime's working-tree "Doorline decides" handler; an end-to-end
walkthrough of both apps; consistency and build readiness), 39 findings, then one skeptic who re-ran every Doorline-side fix; four
FbTime-side questions went to the owner. Changed in revision 6:

- **Owner rulings 13-16 (FbTime's side):** a Doorline day is locked only while a door-count key is live (days Doorline stopped updating were
  locked forever — reproduced); an explicit clear brings typed numbers back (a one-week trial plus "turn off and clear" erased months of typed
  history — reproduced); emptied days are marked so moved doors aren't typed in twice (reproduced: a week of 92 against Doorline's 52); an
  "other doors" box for doors Doorline can't know. Doorline adds a per-person clear for unlinked people and the explicit-clear flag.
- **The purge is keyed on the account** across every org and connection status, record by record (it missed disconnected, errored and left
  orgs, and kept-account events; one bad record could stall the name purge for everyone — reproduced).
- **The kept-account cut** at link time — the earlier `until` handed the new account's first shifts to the old one and flipped the current
  campaign to estimated (reproduced); the reviewer's first fix still did, the skeptic's day cut did not.
- **Removing a kept account reassigns all of the person's shifts**, with atomic array writes (parallel unlinks lost entries — reproduced).
- **Clears keep group progress** (a large clear-all never finished within the budget — simulated), the **confirm pass covers linked people**
  (a stalled write stayed locked — reproduced), and **`deepRetry` owes everyone a run planned** (a count failure dropped a newly linked
  canvasser's 120 days).
- **Connect** refuses only on an organization change (a same-org Replace key dead-ended a waiting clear), at any status; the **turn-on check
  order** is buildable; **one unlink request shape and one "Was the link right?" modal**; **nobody linked** no longer reads as stuck; the
  **door step runs after any hours result**; every bookkeeping field has one writer; the **"Typed numbers replaced"** notice is cumulative and
  the summaries are per window group.
- **Copy** says what "Doorline decides" means on both apps, when corrections stop reaching FbTime, and "clear before you revoke"; FbTime
  defects passed to the FbTimeApp session (consent text, a handler race, copy).
