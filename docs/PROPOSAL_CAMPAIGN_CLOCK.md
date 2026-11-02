# Proposal: A campaign's times on the campaign's clock — the voter page, birth dates, and the same slip elsewhere

> **Status: BUILT 2026-11-02 (uncommitted, not deployed) to PLAN v1, approved by the owner the same day with
> both recommendations (decision 1: upload times move to the campaign's clock; decision 2: the organization's
> clock stays as it is, no setting, so §F is not built). Where the build differs, and what was verified, is
> §J, As built.** Asked by the owner after an Omaha voter's page showed its visits in
> Eastern time while the campaign's Home page showed Central. One server deploy (the web console ships with
> it); nothing for phones; no migration, no new index, no config var; nothing stored is rewritten. Line
> references are to HEAD `a3ab0bb`.

Related: [TIMEZONES.md](TIMEZONES.md) (the rule this restores: a time is shown in the zone of whatever owns
it), [VOTERS.md](VOTERS.md) (the voter page), [FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md) (decision 2),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (why this needs no item).

# Part 1 — For everyone

## The problem

On the Omaha campaign's Home page, times read in Central (CST). Open a voter from the **Voters** tab and
scroll to **Canvass activity**, and the visits read in Eastern:

```
Surveyed · 11/2/2026, 1:30 PM EST · Cornelious Robinson
Not home · 10/27/2026, 12:50 PM EDT · Michael Creamer
```

The visits happened at 12:30 PM and 11:50 AM Omaha time. Nothing is recorded wrong: the voter page shows
every time on the **organization's** clock instead of the **campaign's**. New organizations start on Eastern
and nothing in the app changes that, so for your organization that clock is Eastern. Almost every other page
inside a campaign (Home, Map, Timeline, Audit, Notes, Door Outcomes, Turf Cutting and the rest) already uses
the campaign's clock, and the time-zone doc says they all should.

Both **Voters** links (the one in the main menu and the one inside a campaign) open the same voter page, so
both do this.

Checking every date on the voter page turned up a second problem: **every date of birth shows one day
early.** A voter born May 10, 1980 reads 5/9/1980, in every time zone, not just Eastern. The voter file and
what Doorline stores are right; only the display is off. Staff see the same on their person page.

A sweep of the rest of the web console found the same clock slip in four more places (listed below), and one
page where it's a choice made on purpose (decision 1).

## The rule after this change

**Inside a campaign, every time is on that campaign's clock.** Pages that cover the whole organization (the
Overview, Users, People, the do-not-contact and do-not-knock lists) keep the organization's clock, as now.

On a voter's page that means:

- Everything shows in the voter's campaign's time zone: door visits, survey responses, notes, *Added at the
  door*, *Last edited*, the do-not-contact flag, and Doorline staff access.
- An admin who opens a voter also sees the same person's surveys and notes from your other campaigns. Each of
  those shows on **its own** campaign's clock, so a survey reads the same time on every page that lists it.
  That only looks different when the two campaigns are in different time zones (a statewide Nebraska race on
  Central and a Panhandle race on Mountain, say), and every time carries its zone's short name (CST, MST), so
  it's never ambiguous.
- **Birth dates** show exactly as in the voter file. A date of birth is a calendar date, not a moment, so no
  time zone touches it.

## What you'll see (the design)

Nothing moves on the page and no wording changes; only the clock does. The Omaha voter after the change:

```
Canvass activity
Surveyed · 11/2/2026, 12:30 PM CST · Cornelious Robinson
Not home · 10/27/2026, 11:50 AM CDT · Michael Creamer
```

A survey from the same person's record in a Mountain-time campaign, on that page:

```
Panhandle survey · 11/2/2026, 11:30 AM MST · ‹canvasser›
```

CDT on Oct 27 and CST on Nov 2 are both right: each time carries the name its zone had that day, and daylight
saving ended Nov 1.

The other spots:

| Where | Today | After |
|---|---|---|
| **Pin Fixes**: the date in *Placed by address (Oct 27)* | the organization's clock | the campaign's |
| **Voters list**: the date when you hover *Added at the door* | your computer's clock | that voter's campaign's |
| **People → Automatic pause**: when each pause started and was resolved | the organization's clock | the clock of the campaign it happened in |
| **Printed walk packets**: the date beside a door's last result, and the printed date | your computer's clock | the campaign's |
| **Printed walk packets**: the date in the file name | UTC, so a packet printed after 6 PM Central (7 PM in summer) is named for the next day | the campaign's date |
| **Staff person page**: date of birth | a day early | as in the voter file |

## What stays as it is, on purpose

- **Organization-wide pages** keep the organization's clock (decision 2 is about that clock).
- **The phone** already shows the right times: its voter screen shows "3d ago"-style times, and notes on the
  selected campaign's clock. The one case it can't get right is a note added on the same person's record in
  another campaign set to a different time zone. Fixing that needs a phone update, so it's left unless you
  want it.
- **Staff, billing and integration pages** show dates on the viewer's own computer clock. They aren't a
  campaign's door data, so this plan leaves them.
- **Report-link history** (*Locked until*, *Expires*) is on the reader's own calendar by design.
- **My Stats** on the phone stays on the phone's clock by design.
- **Nothing stored changes.** No visit time, date or birth date is rewritten. Counts, reports, exports and the
  door counts sent to FbTime already use each campaign's clock, so no number moves.

## One trap, for the record

The server has a one-off script, `npm run migrate:timezones`, from when campaigns first got time zones. Run
with `-- --apply` today, it would reset **every** campaign's time zone to its state's usual one, undoing any
picked by hand (a Panhandle race set to Mountain would go back to Central). It fixes nothing here. This plan
adds a warning to the time-zone doc so nobody reaches for it.

## Release

One server deploy; the web console updates with it. Phones need nothing: the server only **adds** a few fields
to what the voter screen receives, and the app ignores fields it doesn't know, so there's no app update and no
"update required" wall. No migration, index or config var.

**Privacy:** not affected. Nothing new is collected or kept, nobody gains access to anything, no new service
receives data, and nothing new is shown to anyone. The added fields are each campaign's time zone (a campaign
setting) and which of your own campaigns a note came from, which the page already lists under *Also in*. A team
lead's view still holds only their campaign.

## The owner's decisions

1. **The Voter Import page's upload times.** They're on the organization's clock today, by a choice the
   time-zone doc records (an upload was treated as an organization-level event), so the Omaha campaign's Import
   page shows uploads in Eastern. **Recommended: move them to the campaign's clock**, so "inside a campaign, the
   campaign's clock" has no exceptions. The Exports page's upload picker follows whichever you choose (today it
   uses your computer's clock, so it changes either way).
2. **The organization's own clock.** It stays Eastern and can't be changed in the app. After this change it
   only shows on organization-wide pages: which date *Today* means on the Overview, join and sign-in times on
   Users and People, the do-not-contact and do-not-knock lists, and the per-person activity chart. It also
   decides which recent days Doorline pulls hours for from FbTime, and the time zone named to FbTime when it
   does. **Recommended: leave it for now.** The other option is a **Time zone** setting on the Settings page for
   org admins, with the same list of zones as campaigns (designed in Part 2 §F).

# Part 2 — Technical reference

## A. What exists today (verified at `a3ab0bb`)

**The voter page.** [VoterDetailPage.jsx:619](../client/src/pages/VoterDetailPage.jsx) reads `useOrgTimeZone()`
and every time on the page uses it: `:766` (Added at the door), `:785` (`VoterFields`: Last edited, and the date
of birth at `:98`), `:794` (`DncSection`), `:867` (`SurveyCard`), `:881` and `:890` (the two Restore confirms),
`:916` (`OverwrittenSurveyCard`), `:950` (admin notes), `:962` (field notes), `:979` (Canvass activity), `:989`
(`StaffAccessCard`). One component serves both routes, `/campaigns/:campaignId/voters/:voterId` and
`/voters/:voterId` ([App.jsx:193, :239](../client/src/App.jsx)). This breaks TIMEZONES.md §F: "A timestamp is
shown in the timezone of whatever owns it."

**The org zone.** `useOrgTimeZone()` returns `activeMembership?.organizationTimeZone || 'America/New_York'`
([AuthContext.jsx:589](../client/src/auth/AuthContext.jsx)), sent by [auth.js:110](../server/src/routes/auth.js).
`Organization.timeZone` defaults to `America/New_York` ([Organization.js:46](../server/src/models/Organization.js)).
No route writes it: super-admin create ([organizations.js:528](../server/src/routes/superAdmin/organizations.js))
takes no zone and PATCH (`:608`) sets name, slug and isActive only. Its only writers are
[migrateTimeZones.js:45](../server/src/migrations/migrateTimeZones.js) and the demo seed
([seedDemoOrg.js:1102](../server/src/services/platform/seedDemoOrg.js)). The model comment at `:45` ("Overridable
in the UI") is false; TIMEZONES.md §E already says the org zone has no customer-facing editor.

**The payload.** [buildVoterProfile](../server/src/services/voters/voterProfile.js) has three callers: the org
profile ([voters.js:80](../server/src/routes/admin/voters.js)), the campaign profile
([campaignVoters.js:127](../server/src/routes/admin/campaignVoters.js)) and the phone
([mobile/voters.js:188](../server/src/routes/mobile/voters.js)). It sends no time zone:

- `household.campaign` is `{ id, name, type }` (the read at `:45` asks for `'name type'`).
- `otherCampaigns[]` is `{ campaignId, name, voterId, surveyStatus }` (the read at `:207` asks for `'name'`).
- `surveys[]` and `overwrittenSurveys[]` carry `campaignId` (`:332`, `:399`).
- `notes.field[]` (built at `:162`) and `notes.admin[]` (`:445`) carry none. Field notes come from
  `CanvassActivity` read with `'_id note timestamp actionType userId'` (`:81`) and from survey notes. `VoterNote`
  stores only `voterId` ([VoterNote.js:9](../server/src/models/VoterNote.js)), so a note's campaign is its row's.
- `activity[]` is the household's door history (read at `:69`), always the row's own campaign.

**Date of birth.** Stored at UTC midnight: [csvImporter.js](../server/src/services/import/csvImporter.js)
`parseDob` (`:28`) turns an Excel serial into `Date.UTC(…)` and parses date strings on a UTC server. The voter
page formats it in a zone (`fmtDate(voter.dateOfBirth, tz, false)`, `:98`), so it reads a day early anywhere in
the US. Run against the page's own `formatInTz`: `1980-05-10T00:00:00Z` gives `5/9/1980` in America/New_York and
America/Chicago, `5/10/1980` in UTC. The page's edit form leaves DOB out (`EDIT_FIELDS`, `:32`), so no save writes
a shifted date: display only. The super-admin person page
([PersonDetailPage.jsx:14](../client/src/pages/PersonDetailPage.jsx), `/super-admin/people/:personId`) formats it
with the device clock (`toLocaleDateString()`), a day early for a US viewer; its edit input (`dobInput`, `:20`)
already reads UTC. The import screen already shows DOB date-only
([ImportPage.jsx:341](../client/src/pages/ImportPage.jsx)), the pattern to follow.

**The phone.** [voters/[id].jsx](../mobile/app/(app)/voters/[id].jsx) shows surveys and field notes with
`timeAgo` (`:156`, `:199`) and admin notes with `formatExact(n.createdAt, campaign?.timeZone)` (`:192`), where
`campaign` is the saved active campaign. Every entry point opens a voter of the active campaign (the search at
`voters/index.jsx:37`, the Notes and Duplicate surveys screens). DOB and canvass activity aren't shown there.
`npm run audit:mobile-api -- --list` confirms the phone reaches `buildVoterProfile` only through
`GET /mobile/voters/:voterId`.

**The sweep.** Every web caller of `useOrgTimeZone()` and every date `toLocale*String` call with no `timeZone`
was read. Campaign data on the wrong clock:

| Spot | Code | Clock today |
|---|---|---|
| Pin Fixes pin-line date | [PinFixesPage.jsx:265](../client/src/pages/PinFixesPage.jsx) | org |
| Voters list *Added at the door* hover | [VotersPage.jsx:300](../client/src/pages/VotersPage.jsx) | device |
| People → Automatic pause | [PersonBody.jsx:223](../client/src/components/people/PersonBody.jsx) → [PacePauseProfileSection.jsx](../client/src/components/users/PacePauseProfileSection.jsx), `statusLine` ([pacePause.js:65](../client/src/lib/pacePause.js)) | org |
| Packet last-result date | [packetPdf.js:401](../client/src/lib/packet/packetPdf.js) | device |
| Packet printed date | packetPdf.js `:848`, `:1073` | device |
| Packet file-name date | packetPdf.js `:1113` (`toISOString().slice(0, 10)`) | UTC |
| Voter Import upload times (decision 1) | [ImportPage.jsx:1216](../client/src/pages/ImportPage.jsx) | org, documented |
| Exports upload picker (decision 1) | [ExportsPage.jsx:642](../client/src/pages/ExportsPage.jsx) | device |

Already right: Campaign Home (`current?.timeZone || orgTz` in DashboardPage), the Map and its house, ping and flag
panels ([MapPage.jsx:317](../client/src/pages/MapPage.jsx), each passed `tz`), Timeline (`:66`), Audit (`:141`),
Duplicate Surveys (`:53`; its `toLocaleString` is only a catch fallback), Notes, Door Outcomes, Overlaps, Turf
Cutting, Walk lists, Early voting, Survey Explorer. Left on purpose: the Overview, Users, People's joined date
(PersonBody.jsx:192) and the do-not-contact and do-not-knock lists (org clock, TIMEZONES.md §F); super-admin,
Support Access, Billing, Integrations and the lockout panel (device clock, not campaign data); report-link history
([campaignHistory.js:382, :387](../client/src/lib/campaignHistory.js), the reader's calendar by design). Server
output already resolves campaign → org → `America/New_York` (exports.js:126, households.js:50, the reports
`resolveAnchorTz`, services/audit/pacePause.js:106, fbtime/doorCounts.js:78); mail dates use UTC
(mail/templates.js:37).

## B. The rule

A time is shown in the zone of the campaign whose record it is. Inside a campaign that is always the campaign's
zone; org-wide and user-level pages keep the org's (TIMEZONES.md §F, unchanged). A calendar date (date of birth)
is shown in UTC, the way it is stored, never in a zone.

On the voter page:

| Item | Zone |
|---|---|
| Canvass activity, Added at the door, Last edited, Do not contact, Doorline staff access | the page zone: the voter row's campaign |
| Survey card and its edited, note-edited, entered and replaced lines; its Restore confirm | the survey's `campaignId` |
| Earlier-answers, Removed and Set aside cards | the archived survey's `campaignId` |
| Field note | the campaign it was recorded in |
| Admin note | the campaign of the row it was added to |
| Date of birth | UTC (calendar date) |

Each falls back to the page zone, then the org zone. A campaign always has a zone today (`Campaign.timeZone`
defaults to America/New_York), so the fallback only covers a payload from before the deploy.

**Why per item and not one clock for the page.** A survey appears on the profile of every row of the person and
on its own campaign's Audit and Timeline. Per item, it reads one time everywhere. It differs from the page zone
only when the person is in two campaigns set to different zones, and each time is labeled.

## C. Server

**C1. `buildVoterProfile`** ([voterProfile.js](../server/src/services/voters/voterProfile.js)), additive only:

- `:45` reads `Campaign.findById(campaignId || voter.campaignId, 'name type timeZone')`. `campaignId` itself stays
  the household's (it drives the voted lookups); `campaign` is rendered only inside `household`, so a voter with no
  household shows nothing new but still gets a zone.
- New top-level `timeZone: campaign?.timeZone || null` (the page zone).
- `:207` reads `'name timeZone'`; each `otherCampaigns[]` entry gains `timeZone`.
- A row → campaign map from `voter` and `siblings` (both already read with `campaignId`):
  `new Map([[String(voter._id), String(voter.campaignId)], ...siblings.map((s) => [String(s._id), String(s.campaignId)])])`.
- Field notes: the read at `:81` adds `campaignId` ([CanvassActivity.js:69](../server/src/models/CanvassActivity.js));
  each `notes.field[]` entry gains `campaignId` (the activity's, or the survey's).
- Admin notes: each `notes.admin[]` entry gains `campaignId` from the row map by `voterId`.

No new queries. Under a lead's scope `siblings` is empty, so every `campaignId` is the scoped campaign and
`otherCampaigns` stays `[]`.

**C2. Packets.** [buildPacket.js:493](../server/src/services/packet/buildPacket.js) adds
`timeZone: campaign.timeZone || null` to the payload's `campaign`. `req.campaign` is the full document
([packets.js:28](../server/src/routes/admin/packets.js)). Web-only route.

**C3. Comments.** [Organization.js:45](../server/src/models/Organization.js) drops "Overridable in the UI".
[AuthContext.jsx:587-588](../client/src/auth/AuthContext.jsx) drops walk lists and turf snapshots from its list
(both on the campaign zone now) and, under decision 1, imports.

## D. Web

**D1. Voter page.** In `VoterDetailPage`, once the profile has loaded (plain values, not hooks):

```js
const zone = p.timeZone || orgTz;
const zones = new Map((p.otherCampaigns || []).filter((c) => c.timeZone).map((c) => [c.campaignId, c.timeZone]));
const zoneOf = (campaignId) => (campaignId && zones.get(String(campaignId))) || zone;
```

Per §B: `zone` at `:766`, `:785`, `:794`, `:979` and `:989`; `zoneOf(s.campaignId)` at `:867`, `:881`, `:890` and
`:916`; `zoneOf(n.campaignId)` at `:950` and `:962`. The date of birth (`:98`) becomes
`fmtDate(voter.dateOfBirth, 'UTC', false)`, with a comment that a birth date is a calendar date stored at UTC
midnight.

**D2. Staff person page.** PersonDetailPage.jsx formats the date of birth (`:84`, `:245`) with
`toLocaleDateString(undefined, { timeZone: 'UTC' })`.

**D3. Pin Fixes.** PinFixesPage.jsx:264 adds `const { campaign } = useCurrentCampaign(campaignId);` (the hook the
other campaign pages use, [useCurrentCampaign.js](../client/src/lib/useCurrentCampaign.js)) and `fmtDate` uses
`campaign?.timeZone || orgTz`.

**D4. Voters list.** VotersPage.jsx:300 formats the hover date with
`formatInTz(v.doorAdded.at, zone, { year: 'numeric', month: 'numeric', day: 'numeric' }, false)`, where `zone` is
the row's campaign (`v.household?.campaignId`) looked up in `campaigns` (already read at `:56`), then
`current?.timeZone`, then `useOrgTimeZone()`.

**D5. Automatic pause on People.** PersonBody passes a `zoneOf(campaignId)` lookup over `useCurrentCampaign()`'s
`campaigns` (falling back to `orgTz`) in place of `tz`; PacePauseProfileSection uses `zoneOf(p.campaignId)` for
`firedAt` and for `statusLine(p, …)`. It has no other caller.

**D6. Packets.** packetPdf.js keeps its `'en-US'` formatting and adds `timeZone: payload.campaign?.timeZone` at
`:401`, `:848` and `:1073` (left out when absent, which is today's behavior); `:1113` takes the campaign's calendar
day (`new Intl.DateTimeFormat('en-CA', { timeZone })`, as `todayInTz` in
[datePresets.js](../client/src/lib/datePresets.js) does) instead of the UTC day.

**D7. Decision 1.** Campaign clock (recommended): ImportPage.jsx adds `useCurrentCampaign(campaignId)` and `:1216`
uses `campaign?.timeZone || orgTz`; ExportsPage.jsx:642 uses `tz || orgTz` (`tz` is already the campaign's, `:214`).
Org clock: ImportPage is unchanged and ExportsPage.jsx:642 uses `useOrgTimeZone()`, so the two pages agree.

## E. Tests

Server, through the runner (`npm --prefix server run test:int -- test/voterProfileZones.int.test.js
test/packet.int.test.js`):

- New `voterProfileZones.int.test.js`: an admin's profile of a voter in an America/Chicago campaign whose person
  also has a row in an America/Denver campaign returns `timeZone: 'America/Chicago'`, the sibling's
  `otherCampaigns[].timeZone: 'America/Denver'`, and on a field note and an admin note on each row the `campaignId`
  of that row's campaign. The campaign route for a lead returns the zone, `otherCampaigns: []` and only this
  campaign's ids. The phone route returns the same fields. A voter with no household still gets `timeZone`.
- [packet.int.test.js](../server/test/packet.int.test.js): the payload's `campaign.timeZone`.
- The suites that already read the profile pass unchanged (additive fields): teamLead, perRoundVoterView,
  supportAccess, answerEdit*, correctionSafety, importHandEdits, mobileIdentityDelta.

Client:

- [campaignVotersRender.smoke.test.js](../client/src/lib/campaignVotersRender.smoke.test.js): a new case with its own
  org stub (America/New_York) and a profile carrying `timeZone: 'America/Chicago'` plus a survey from an
  America/Denver sibling: the activity at `2026-11-02T18:30:00Z` reads `12:30 PM CST`, the sibling survey
  `11:30 AM MST`, and a date of birth of `1980-05-10T00:00:00.000Z` reads `5/10/1980`. Fixed instants, so no label
  depends on today's date. The existing cases keep their stub.
- [packetPdf.test.js](../client/src/lib/packet/packetPdf.test.js): the file-name day for a `generatedAt` of
  `2026-11-03T01:30:00Z` with America/Chicago is `2026-11-02`.
- A server render (or the nearest existing render test) each for Pin Fixes, the Voters hover and the pause section.
- Full runs: `npm --prefix client test`, `npm --prefix server test`, the integration suites above through the runner,
  and a client `vite build`.

## F. Decision 2, if chosen: an organization time zone setting

> **Not built.** The owner chose to leave the organization's clock as it is (2026-11-02). Kept as the design
> if that changes.

- **Route:** a `PATCH` on the org settings, following
  [clientReportSettings.js](../server/src/routes/admin/clientReportSettings.js) (`requireOrgRole('admin')`, a zod
  schema, `Organization.updateOne`). Body `{ timeZone }`, accepted only from `US_TIMEZONES`
  ([usStateTimeZone.js](../server/src/utils/usStateTimeZone.js)), refused with the campaign route's `400
  INVALID_TIMEZONE`.
- **Web:** a **Time zone** section on the Settings page (org admins), a select over the same list with one line on
  what it changes. After a save, AuthContext updates the active membership's `organizationTimeZone` in place (the
  way `acknowledgeMembership` updates `isNew`), so the console switches at once; other admins pick it up at their
  next page load.
- **Effects:** the org-wide pages and the per-person chart move to the new zone; the FbTime pull window and the zone
  named in the pull follow it ([fbtime/sync.js:103](../server/src/services/fbtime/sync.js),
  [integrations.js:966](../server/src/routes/admin/integrations.js)). FbTime door counts use each campaign's zone
  and don't move. Validating on write also retires the door-count *Needs attention* case for an organization
  zone that TIMEZONES.md §E describes.
- **Docs:** TIMEZONES.md (Part 1 "Setting a campaign's timezone", §E), and the Settings help page
  ([page-settings.md](../server/src/content/help/pages/page-settings.md)).

## G. Docs and Help Center

- **TIMEZONES.md:** Part 1, the inside-a-campaign rule with the voter-page and birth-date lines; §E, the
  `migrate:timezones` warning (with `--apply` it resets every campaign whose zone differs from its state's default,
  hand-picked ones included); §F, table rows for the voter profile (per item), printed packets, Pin Fixes, the Voters
  hover and People pauses (and imports, under decision 1), plus a calendar-date line.
- **VOTERS.md:** Part 1 "The profile", one sentence on times and birth dates; Part 2 §C, the new payload fields;
  §E, `zoneOf`.
- **Help Center:** [page-voters.md](../server/src/content/help/pages/page-voters.md), one sentence (times are in
  the campaign's time zone, with its short name; an answer or note from the same person in another of your
  campaigns shows in that campaign's). [page-print-packets.md](../server/src/content/help/pages/page-print-packets.md)
  line 63 says the file is named for "the day you printed it", which is false in the evening today and true after
  D6; add "(by the campaign's calendar)".
- **docs/README.md:** the index row for this proposal.
- **PRIVACY_VERIFICATION.md:** no item (Part 1, Release).

## H. Edge cases

- **No household:** the zone comes from `voter.campaignId` (C1).
- **Sibling campaign deleted between reads:** its items fall back to the page zone.
- **A campaign mid-deletion** ships in the campaigns list's `deleting` array, not `campaigns`: the Voters hover and
  People pauses fall back to the org zone for it.
- **Old phones** ignore the new fields. **An older web bundle** during the deploy falls back to the org zone, which
  is today's behavior.
- **Daylight saving:** each time is labeled with its own date's zone name (EDT, EST), as today.
- **A campaign zone outside the curated list** (TIMEZONES.md §E) still formats, since `Intl` accepts it; this is
  display only, with no MongoDB bucketing.

## I. Verification

The tests above, then the pages themselves: run the console locally against a seeded Central campaign with a
Mountain sibling, open the voter from both Voters links, and check every time on the page and the date of birth;
print a packet; open Pin Fixes, a person with a pause, and the Voters hover. After the deploy the owner reopens
the Omaha voter, which should read *Surveyed · 11/2/2026, 12:30 PM CST · Cornelious Robinson*.

## J. As built (2026-11-02)

Built the same day to this plan with the owner's two decisions (upload times on the campaign's clock; no
organization time zone setting, so §F is not built). Uncommitted and not deployed at the time of writing.

**Where the build differs from the plan:**

- **Pin Fixes (D3) has no rendered assertion.** Its dated line (*Placed by address (Oct 27)*) appears only
  in the card that opens when a home is selected on the map, which a server render can't open. The change
  is the one `fmtDate` expression on `useCurrentCampaign(campaignId)`; the two existing Pin Fixes render
  tests run the page with the new hook and pass, and the date line itself is checked by reading only.
- **Voter Import (D7) needed no new hook:** the page already resolves its campaign (`campaign`, :796), so
  `:1216` reads `campaign?.timeZone || orgTz`. The Exports picker uses `tz || orgTz` (the org zone only
  while the campaign loads).
- **The pause section (D5)** takes `zoneOf` in place of `tz` (its one caller is PersonBody).
- **Packets (D6):** `zoneOpt(payload)` validates the zone once (a try/catch around `Intl.DateTimeFormat`)
  and returns `{ timeZone }` or `{}`; the three date calls keep `'en-US'` and spread it (`ctx.dateZone` for
  a door's last result), and `packetFilename` formats the day with `'en-CA'` in the zone, falling back to the
  old UTC day.
- **One extra test** beyond §E: an Import page render (`importPageRender.smoke.test.js`), since that page had
  no render test.

**Files.** Server: `services/voters/voterProfile.js`, `services/packet/buildPacket.js`, the comment in
`models/Organization.js`. Web: `VoterDetailPage.jsx`, `PersonDetailPage.jsx`, `VotersPage.jsx`,
`PinFixesPage.jsx`, `ImportPage.jsx`, `ExportsPage.jsx`, `people/PersonBody.jsx`,
`users/PacePauseProfileSection.jsx`, `lib/packet/packetPdf.js`, the comment in `auth/AuthContext.jsx`.
Tests: new `server/test/voterProfileZones.int.test.js` (4) and `client/src/lib/importPageRender.smoke.test.js`
(1); added to `packet.int.test.js` (1), `campaignVotersRender.smoke.test.js` (2, with an `orgTz` option on its
harness), `packetPdf.test.js` (2) and `personPanelRender.smoke.test.js` (1, with a `campaigns` seed option).
Docs: TIMEZONES.md (Part 1, §E's warning, §F, §G), VOTERS.md (both parts), the README row; Help Center:
page-voters.md (one paragraph) and page-print-packets.md (the file-name day).

**Verified.** Integration, through the runner: voterProfileZones 4/4, packet 24/24, perRoundVoterView 6/6,
and the 17 suites that read the profile (answerEdit and its rounds, campaignStats, correctionSafety,
importHandEdits, mobileIdentityDelta, supportAccess, teamLead): 383 tests, 379 passed, 0 failed, 4 skipped
(the opt-in `ANSWER_EDIT_SCALE` cases). Client: the full suite 1245/1245 (run before the Import page test was
added; that test passes on its own). Each new client case was also run against the original page code and
failed there; the packet fallback case passes on both, as it should. Server unit: 769 passed, 1 failed:
`readIdColumn.resources.test.js`'s event-loop timing test, a file this build doesn't touch, which passed
4/4 run alone twice (load during the full run). Help links 4/4. A client production build succeeds.
`npm run audit:mobile-api`: `voterProfile.js` is phone-facing through `GET /mobile/voters/:voterId` and its
diff only adds fields; `buildPacket.js` serves a web-only route. No version gate.

**Not verified:** a live browser session. After the deploy, open the Omaha voter from either Voters link
(expect *12:30 PM CST*), a voter's date of birth against the voter file, and a printed packet's dates.

**Release:** one server deploy (it ships the web console). Nothing for phones, no migration, no index
build, no config var. Not privacy-affecting (Part 1, Release).
