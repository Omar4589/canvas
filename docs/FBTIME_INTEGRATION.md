# FbTime integration — measured hours in, door counts out

How an organization that clocks its canvassers in and out with **FbTime** (the owner's
time-tracking product) can connect it so doors-per-hour divides by **measured clock time** instead
of the knock-span estimate — and, once an org admin turns it on, have Doorline send each linked
canvasser's **doors per day** back to FbTime, so FbTime's own doors-per-hour page fills itself.
Opt-in per organization; orgs that never connect see zero change, and door counts stay off until an
org admin turns them on.

Related: [METRICS.md](METRICS.md) (what doors-per-hour means, and what counts as a door),
[TIMEZONES.md](TIMEZONES.md) (day bucketing), [EXPORTS.md](EXPORTS.md) (the stamped CSV),
[AUDIT.md](AUDIT.md) (event history), [USERS.md](USERS.md) (account deletion),
[OPERATIONS.md](OPERATIONS.md) (the door-count release var and the one-off deletion-gaps migration),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the v5 entry for this feature, and its
2026-10-09 door-count stamp),
[PROPOSAL_FBTIME_DOOR_COUNTS.md](PROPOSAL_FBTIME_DOOR_COUNTS.md) (the door-count design: the owner's
rulings, four review rounds, the tests and the rollout — where the two differ, this doc describes
what was built). The provider contract lives in the FbTime repo: `FbTimeApp/docs/PARTNER_API.md` —
its **Connecting** section is the citation source for the base URL and key naming, and its
**`PUT /doors`** section for door counts.

---

## Part 1 — For everyone

### What it does

Doorline normally *estimates* time on doors: each day's first knock to its last knock, added up.
That estimate is wrong in both directions — one knock at 9am and one at 5pm reads as eight hours;
an hour of driving between turfs reads as canvassing. If your canvassers already clock in and out
with FbTime, connecting it makes doors-per-hour divide by the hours they were actually on the
clock.

The connection can also run the other way. FbTime has its own **doors-per-hour page**, where
somebody usually types each canvasser's doors in by hand, reading them off Doorline. With **door
counts** turned on, Doorline sends those numbers instead — see *Door counts to FbTime* below. It
exists only once Doorline has released it; until then the Integrations page has no **Door counts to
FbTime** card.

### What "measured" and "estimated" mean

Every hours figure in your reports now says which it is:

- **Measured** — from FbTime clock time. Marked **FbTime** on the canvasser tables, or the word
  "measured" on mobile.
- **Estimated** — the old knock-span math, used wherever no measured hours exist.

### Why someone's hours are estimated

"Estimated" is not one situation, it is four, and only two of them are anybody's to fix. Rather
than leaving you to work out which from a missing marker, the canvasser tables label the cause
next to that person's doors-per-hour:

| Marker | What it means | What to do |
|---|---|---|
| **FbTime** | Every day in range came from their clock time. | Nothing. |
| **Part** | Some days measured, the rest estimated. | Nothing, unless the split surprises you — hover for the reason. |
| **No link** | FbTime is connected, but this person is not mapped to an FbTime profile, so **none** of their clocked hours count. | Link them on the Integrations page. |
| **Open shift** | A shift was left open from an earlier day (a missed clock-out), so it was ignored rather than counted as a 30-hour day. | Close it in FbTime; the range re-measures itself on the next sync. |
| **Est** | They're linked and everything is healthy — they just have no clocked hours in this range. | Usually nothing; this is a day off. |

An organization that has not connected FbTime sees **no marker at all** on any row, exactly as
before the integration existed. Hovering any marker explains it in full. An earlier account an
admin **kept** for an FbTime person (see *A canvasser who comes back with a new account*) still owns
the hours it clocked before, so it never reads **No link**.

**The two are never mixed into one team or campaign rate.** A team rate shows measured numbers only
when *every* contributor is fully measured; otherwise it stays estimated for everyone. A rate that
quietly blended both could not be defended to a client — or reconciled against payroll.

### Which hours count

FbTime tracks three versions of a shift's hours. Doorline uses **Adjusted hours** by default —
total time minus break overage, the same "Adjusted total" your FbTime timesheets show and the
number you run payroll on, so the leaderboard and a paycheck can never disagree. An admin can
switch to Worked hours (all breaks out) or Total hours (breaks in) on the Integrations page, but
Adjusted is the recommended setting and Total is not recommended as a rate denominator.

### Connecting (org admins)

1. In **FbTime**, an admin of your organization creates an API key (Integrations → New key) named
   for its purpose. The key is shown once.
2. In **Doorline → Integrations**, paste the key and press **Test connection**. Doorline shows you
   which FbTime organization the key reads — **confirm the name is yours** (this is the guard
   against pasting another customer's key).
3. Press **Yes — connect**. Doorline stores the key encrypted, matches canvassers to FbTime people by
   email, and pulls the last 120 days of hours within a couple of minutes.

Canvassers whose email differs between the two apps are linked by hand on the same page. A person
with clocked hours but no link is marked **"Hours not counted"** — their hours count nowhere until
linked.

**Replacing the key later** — a new key, or one that can also fill in door counts — is **Settings →
Replace key**: paste it, press **Test**, confirm the FbTime organization's name is yours, then **Use
this key**. Hours keep flowing and your links are kept; the email match does not run again, so a link
you removed stays removed. A key that reads a **different** FbTime organization asks first, turns door
counts off, and does run the email match — your links probably won't match the new roster.

### The mapping table, both sides at once

The table lists **both rosters together**, one row per pairing:

- a **matched pair** — an FbTime person and the Doorline canvasser they're linked to;
- a **Doorline person with no FbTime match** — the one whose hours will never arrive, and who used
  to be invisible on this page entirely;
- an **FbTime person with no Doorline match**.

Each row shows the campaigns that person is on beside **the FbTime project they've most recently
clocked into**, so you can see at a glance whether the two agree. Doorline never judges that for
you: the two labels come from different systems and are written by different people ("Miami Field
Office" may well be how your team refers to "FL-27 GOTV"), so both are shown plainly and nothing on
screen claims they disagree. **The project label is information only — it never affects a single
number.** Hours attach to campaigns from the knock ledger, not from what someone picked in FbTime.

Finding the person you want:

- **Search** matches names, emails and project names on either side.
- **Sort** defaults to *needs attention* — broken links first, then people whose hours aren't
  counting, then unlinked people, with everything already correct at the bottom. The top of the
  list is the work.
- **Filter** by campaign, or by whether someone is linked.
- **Inactive people are hidden by default** — departed FbTime staff and switched-off Doorline
  accounts. The count line says how many are hidden, and *Include inactive* brings them back. Rows
  that matter are never hidden: a linked pair, a broken link, or anyone with hours going nowhere
  always shows, whatever their status.

### Linking several people at once

- **Suggested matches.** When people have the same email in both systems, Doorline offers them as a
  list you can review — each row showing both sides, their campaigns, and their recent project —
  and you tick off any that look wrong before applying. (The blind *Auto-match everyone by email*
  button still exists under **Settings**; it's the quicker tool for a first connect.)
- **Tick several rows** and link or unlink them together. Unlinking asks first and tells you what
  happens: those people's reports go back to estimated hours immediately. When one of them deleted
  their account, or Doorline has sent door counts for one of them, the question is **Was the link
  right?** instead (see *Unlinking — was the link right?* below).
- **A linked canvasser can't be moved straight to another FbTime person.** Unlink them first —
  which asks whether the old link was right — then link them to the right person.

### Two rows that mean something is wrong

- **Broken link** — the link points at somebody who is no longer in your organization, or at an
  FbTime person who is no longer in FbTime. A row for a member who **left your organization** should
  usually be left alone: the link is what keeps their past clocked hours their own, and once
  unlinked they can't be linked again. A row for someone **no longer in FbTime** can be unlinked.
- **Orphan hours** — hours from a person who is no longer on your FbTime roster at all. They can
  still be linked to the right canvasser.

### Checking one person without leaving what you're doing

The Integrations page is the only place links are *edited*, and it is admin-only. But whether a
particular canvasser's hours are measured shows up in two other places, so you rarely have to go
looking:

- **Their profile** — open anyone from Users (or a campaign's Team page) and the Activity section
  says **"FbTime linked"** or **"FbTime not linked"**, with a shortcut to go fix it. **Team leads
  see this too**, since they cannot open the Integrations page at all; theirs reads "ask an org
  admin to link them" instead of offering the shortcut.
- **The canvasser tables** on Campaign Home and Timeline — the marker beside doors-per-hour, above.

An earlier account kept for an FbTime person reads as measured on the Users list and on its own
profile — never "link them".

### Trust notes

- A shift still open right now counts "so far" and keeps moving until clock-out.
- A shift someone forgot to close (open since an earlier day) is **ignored** for that day's rate —
  a 30-hour ghost shift must not flatten someone's pace — and the day falls back to the estimate.
  **Only that day is affected.** The same person's other days, including one they are on the clock
  for right now, still measure normally — so one forgotten clock-out costs you a single day, not
  that canvasser's whole week.
- Hours an admin typed into FbTime by hand count, and the report notes the range includes manual
  entries — hover the marker beside doors-per-hour on the canvasser tables, or read the sub-line
  under **Hours on doors** on a canvasser's detail screen in the mobile app.
- **Someone can work several shifts in one day, and that is handled** — a 9–12 and a 2–6 read as
  one day of 7 hours, added together the same way FbTime's own timesheet adds them.
- **Campaigns in different timezones all measure.** Hours follow each campaign's own calendar
  automatically — an organization running an Eastern campaign and a Central one sees measured
  hours on both, each bucketed into its own local days.
- A day that carries a shift someone is **still clocked into** is marked as such, because that
  day's number keeps moving until they clock out.
- A day someone was clocked in but knocked no doors still counts its hours — that is exactly the
  time the estimate could never see.
- **Hours follow the knocks.** A canvasser who splits time across campaigns is only charged, on
  each campaign's screens, for the days they actually worked it: a day they knocked a *different*
  campaign counts there instead, and clocked days before their first knock (or after their last)
  on this campaign never count here. A clocked day with no doors *anywhere* still counts toward
  the campaign they were working at the time — that is the idle day the previous note is about.

### When a timesheet fix shows up in Doorline

Doorline re-reads FbTime on a schedule rather than live: shifts from the **last 7 days** are
re-pulled about **every 15 minutes**, and everything from the **last 120 days** is re-pulled
**nightly**. So a correction someone makes in FbTime — a fixed clock-in, a closed shift, a deleted
entry — shows up on its own within 15 minutes if the shift is recent, or by the next morning if it
is older. Doors-per-hour itself is computed fresh on every report load; only the copy of the hours
lags.

When you don't want to wait for the nightly pass — you just fixed a weeks-old shift and want the
report right now — press **Refresh hours** in the status bar at the top of the Integrations page
(while door counts are on it reads **Sync now**, and re-sends door counts too). It re-pulls the
last few months on the spot; the button reports when the numbers are in (typically a few seconds),
and it can be pressed once a minute. On a connection marked "Needs attention", the same button also
retries the key — if the problem was fixed on the FbTime side, the connection heals itself
without re-pasting anything.

### Disconnecting

**Settings → Disconnect FbTime.** Reports revert to estimated hours immediately, the stored key is
destroyed, the pulled hours are deleted, and door counts turn off. Your canvasser links, the earlier
accounts you kept, and the connection history are kept, so reconnecting later finds the roster
already mapped; a reconnect starts with door counts off. Doorline can't reach FbTime once
disconnected, so if you want its door counts gone from FbTime, clear them first (*Turning door
counts off* below); if a clear is still waiting, Disconnect asks first, because disconnecting
abandons it.

### Door counts to FbTime

FbTime's **doors-per-hour page** divides each canvasser's doors by the hours they were on the clock.
With door counts on, Doorline fills in the doors: each linked canvasser's **doors for each day** —
every 15 minutes for the last 7 days, and every night for the last 120 days. The owner's rulings
behind it, in short:

- **The number is the Timeline's** — per canvasser per local day, the **Doors** column of the
  canvasser table on a campaign's **Timeline** tab, added up across the organization's campaigns.
- **Doorline decides** — on a day Doorline reports, FbTime shows Doorline's number and nobody types
  over it there (*FbTime's page* below).
- **Off until an org admin turns it on**, only with a key FbTime allows to fill in door counts, and
  only against an FbTime that applies the "Doorline decides" rules.
- **Released by Doorline.** Until Doorline sets its release config var (`FBTIME_DOOR_COUNTS` —
  [OPERATIONS.md](OPERATIONS.md)), the card, the switch and every send don't exist, and the Help
  Center describes the feature conditionally. Unsetting it later stops every organization's door
  counts at once.
- **No customer notice.** FbTime is already disclosed and engaged by the customer, and a customer's
  admin turning door counts on is that customer's instruction (DPA §2). The privacy wording that
  mentions door counts is pending the owner's sign-off; the var is set only after it is live (see
  *Privacy*).

### Exactly what is sent

- **To:** the FbTime organization the connected key belongs to — nobody else.
- **About whom:** every Doorline canvasser **linked** to an FbTime person on the Integrations page
  (anyone linked later too), plus an earlier account an admin **kept** for the same person (*A
  canvasser who comes back with a new account*). A canvasser with no link is never sent — except
  when an admin asks Doorline to clear what it sent for that FbTime person.
- **Which number:** that day's **doors** — the results that count as knocks: *Survey / talked to
  them, Lit dropped, Not home, Wrong address, Refused, Not a target voter, No soliciting* — added up
  across the organization's campaigns. **Restricted access** never counts.
- **Which days:** only days the canvasser recorded something at a door. A day where every result
  was Restricted access is sent as **0**; a day with nothing recorded sends **nothing**. Notes, and
  Restricted marks set from the desk, never count and never make a day count.
- **Which date:** the local day in the campaign's own time zone — the day the Timeline files it
  under. Two campaigns on one date give one number, added together.
- **What is in the message:** FbTime's own id for the person, the date and the number. **Never**
  names, emails, voter names, addresses, survey answers, notes or locations.

**A door recorded again moves to the later day.** Doorline keeps one result per canvasser per door
per round — the latest. If Maria marks 40 doors *Not home* on Monday and records them again on
Thursday in the same round, the Timeline — and so FbTime — shows those 40 on Thursday, and Monday's
number drops. A callback in a **new round** leaves Monday alone. Doorline's own doors-per-hour uses
the same rule.

### FbTime's page — Doorline decides

These are FbTime's side of the rules; FbTime advertises them as `doors:reported-wins`, and Doorline
sends nothing to an FbTime that doesn't.

- **A day Doorline reports shows Doorline's number, locked** ("from Doorline") while a door-count key
  is live. To change it, fix the door results in Doorline; the correction arrives with the next
  send. A number someone typed on that day — before door counts were turned on or since — is filed
  away by FbTime, never shown or counted.
- **Doors Doorline can't know** — paper after a phone died, another platform — go in FbTime's
  **other doors** box for that day. FbTime adds them to Doorline's number; no Doorline send or clear
  ever touches them.
- **A day Doorline never reports** works as before: a typed number stands, and hours with no number
  show "needs doors".
- **A day Doorline emptied** (its doors moved to another day, were unknocked, or a round's knock
  history was cleared) shows **"Doorline: none — doors moved or removed"** — don't type those doors
  in again, or they count twice.
- **An explicit clear in Doorline** (Unlink → *No — the link was wrong*, Turn off with *Also clear*,
  **Clear the numbers Doorline sent…**) removes Doorline's numbers from those days and **brings
  back** any number someone had typed there; days with nothing typed go blank.
- **Once door counts are stopped for good** (the door-count key revoked in FbTime), Doorline's days
  unlock on FbTime and can be edited there.

### Turning door counts on (org admins)

1. **Get a key that allows it — when you're ready to turn door counts on.** In FbTime, create a key
   with **"Also let it fill in door counts"** ticked; it also reads hours, so it replaces the old
   key. FbTime allows one such key per organization (if the option is greyed out, one already
   exists), and while it exists FbTime's page expects Doorline's numbers — so don't create it early.
2. **Put the key into Doorline.** Already connected: **Settings → Replace key** — paste, **Test**,
   confirm the FbTime organization's name is yours, **Use this key**. Hours keep flowing and your
   links are kept. Not connected yet: paste it into the connect card.
3. **Turn on** on the **Door counts to FbTime** card. The confirmation says what will be sent, for
   how many people (everyone linked now, and anyone linked later), and that numbers typed on FbTime
   on those days are replaced — tell whoever types doors on FbTime. The first send — the last 120
   days — usually goes within a few minutes.
4. In FbTime, **revoke the old key** — once no other Doorline organization uses it.

**Only the organization's own admin can turn it on.** Doorline staff working in the organization
under a support session are refused (they may turn it off). Only **one** Doorline organization can
send door counts to a given FbTime organization; if another already does, the card says so —
Doorline support can help if that's unexpected.

### Replacing a door-count key later

FbTime allows only one door-count key at a time, so the order is: in FbTime **revoke** the current
key, **create** the new one with door counts ticked, then **Replace key** in Doorline straight away.
In between, hours and door counts pause (the status bar shows the connection needs attention), and —
with no door-count key live — Doorline's days are briefly editable on FbTime; the next send restores
Doorline's numbers. If another Doorline organization reads hours with the same key, give it its own
hours-only key first.

### What the card shows

The **Door counts to FbTime** card sits under the status bar. It shows one **state** and, under it,
any **notices**; off with nothing waiting is a single compact line.

| State | Meaning |
|---|---|
| **Off** | Not sending. **Turn on…** — or a hint instead: the key reads hours only, another Doorline organization already sends, or (after door counts were on) the door-count key is still live in FbTime. When Doorline has sent numbers and can still remove them: **Clear the numbers Doorline sent…** |
| **Starting** | Turned on; the first send since then hasn't finished |
| **Sending** | Working — when it last sent, and for how many people ("nobody is linked yet" when nobody is) |
| **Clearing** | Removing numbers you asked Doorline to clear — with **Cancel** |
| **Needs attention** | On, but something you can fix stops it: another Doorline organization sends to this FbTime organization; the key lost its door permission; a campaign has a time zone Doorline can't use; FbTime refused a send; or sends have kept failing for about two hours |
| **Paused** | On, but waiting on something else: the FbTime connection needs attention (the status bar says why), Doorline has paused door counts for everyone, or FbTime needs updating |

| Notice | Meaning |
|---|---|
| Typed numbers replaced | Since door counts were last turned on, about how many numbers typed on FbTime that **differed** from Doorline's have been replaced (a typed number that already matched isn't counted) |
| Links FbTime doesn't recognise | Linked people who aren't in your FbTime organization — shown as **Broken link** rows below |
| A day over 2,000 | A person-day too big for FbTime that wasn't sent |
| Clears waiting | A clear that can't run yet, and why — with **Cancel** |

The status bar's one button reads **Sync now** while door counts are on (**Refresh hours** while
they're off): it re-pulls hours and re-sends door counts — the full 120 days — on the spot.

### When door numbers change

While a canvasser is linked and door counts are on, for the last 120 days:

- **A door result is corrected, unknocked, reclassified or moved to a later day:** the next send
  fixes FbTime — within 15 minutes for the last 7 days, otherwise overnight. Late results (a phone
  that was offline) follow the same rule. A day that empties completely is marked "Doorline: none".
- **A round's knock history is cleared in Turf Cutting:** those doors leave the Timeline, so those
  days drop on FbTime too.
- **A canvasser is linked:** within 15 minutes Doorline sends their last 120 days.
- **A campaign's time zone is changed:** its doors move to the matching dates at the next sends —
  within 15 minutes for the last 7 days, overnight for older days.

**Corrections don't reach FbTime** for days older than 120, for anyone unlinked (*Yes — keep* or a
plain unlink), or after door counts are turned off, stopped for good, disconnected or switched to
another FbTime organization. Those days keep what Doorline last sent — locked while a door-count key
is live, editable once it is revoked — unless an admin clears them.

### Unlinking — was the link right?

Unlinking **never clears anything by itself**. When Doorline has sent door counts for the person, or
the canvasser deleted their account, **Unlink** asks one question — **was the link right?** (For a
deleted account it asks even where door counts aren't available: the answer also decides whose
hours are whose.)

- **Yes — keep** (they left, or they'll come back with a new account). The old account **keeps
  counting** for that FbTime person: its clocked hours stay its own in Doorline's reports, so its
  past rates stay measured; with door counts, what Doorline sent stays, corrections stop reaching
  FbTime for them, and its doors are added to a new account's once one is linked. The FbTime
  person's row shows "also counts *Maria (earlier account)*", with **Stop counting** if that was a
  mistake.
- **No — the link was wrong.** Doorline clears every number it sent for that FbTime person
  (including any earlier account's), bringing back numbers someone had typed, and won't suggest or
  auto-match that pair again. If the person is then linked to the right canvasser while door counts
  are on, the last 120 days refill in the same run. Where nothing was sent, it simply unlinks.

**Undo** after an unlink cancels a waiting clear for anyone it re-links to the same canvasser; if
the clear already ran, its days stay cleared. A **deleted** account, and a member who **left your
organization**, can't be linked again once unlinked. For an FbTime person who is no longer linked but
whose numbers Doorline sent, the row offers **Clear the numbers Doorline sent for *Maria D.***.

### A canvasser who comes back with a new account

A deleted account can't be restored; a returning canvasser gets a new Doorline account. To keep them
as **one person** across both: add them as a new person, **unlink the old account choosing *Yes —
keep***, then **link the new account to the same FbTime person**.

- **Hours:** the old account's clocked hours, up to when the new account started, stay with the old
  account in Doorline's reports, so last season's measured rates stay measured; the new account's
  start with its own first door results.
- **Door counts:** both accounts' doors are added together for that FbTime person — the old
  account's only from before the new one started.
- **The row** shows "also counts *Maria (earlier account)*" with **Stop counting**, which hands the
  earlier account's hours back to the current link (its past rates become estimated) and re-sends
  door counts without it. For a deleted account it can't be undone.

Linking a kept account again, to anyone, ends its "also counts".

### Turning door counts off, stopping for good

- **Turn off** stops sending. Days Doorline sent keep its numbers (locked while the door-count key
  is live) unless you tick **"Also clear the numbers Doorline sent"** — which brings back numbers
  typed there, and blanks the rest. **Clear the numbers Doorline sent…** on the Off card does the
  same later. While door counts are on, clearing everyone is refused — Turn off clears in the same
  step.
- **Stopping for good:** clear first if you want Doorline's numbers gone, then in FbTime create a
  key **without** door counts, **Replace key** in Doorline, and **revoke the door-count key** —
  Doorline's days then unlock on FbTime. **Clear before you revoke:** without a key that can fill in
  door counts, Doorline can't clear anything.
- **Disconnecting** turns door counts off too; clear first if you want, then revoke the key in
  FbTime. If a clear is still waiting, Doorline asks first — disconnecting abandons it.
- **Reconnecting** starts with door counts off.

### Door-count limits worth knowing

- A day with more than **2,000 doors** for one person isn't sent (FbTime's limit); the card names
  it.
- Doorline re-sends at most **120 days** back; a clear goes back to the first day Doorline ever sent
  (at most two years).
- FbTime files a whole shift under the day it **started**, in the zone where the person clocked in;
  Doorline files doors in the campaign's zone. A shift past midnight, or work in a zone behind the
  campaign's, can put hours and doors on neighbouring days. Doorline doesn't warn about it: the only
  check that could find those days also fires on an ordinary forgotten clock-in, and a false alarm
  is worse than a miss.
- A Restricted-access-only day is sent as 0; doors done elsewhere that day go in FbTime's **other
  doors** box.

---

## Part 2 — Technical reference

### The moving parts

| Piece | Where |
|---|---|
| Sealed key storage (AES-256-GCM, env master key) | [`server/src/utils/sealedSecret.js`](../server/src/utils/sealedSecret.js) |
| Connection / links / shift cache / audit models | [`FbTimeConnection`](../server/src/models/FbTimeConnection.js) · [`FbTimePersonLink`](../server/src/models/FbTimePersonLink.js) · [`FbTimeShift`](../server/src/models/FbTimeShift.js) · [`IntegrationEvent`](../server/src/models/IntegrationEvent.js) |
| HTTP client + test seam (`fbt_test_` → in-process fake) — read-only except `PUT /doors` | [`server/src/services/fbtime/client.js`](../server/src/services/fbtime/client.js) |
| Sync jobs (replace-range re-pulls; each run ends with the door step) | [`server/src/services/fbtime/sync.js`](../server/src/services/fbtime/sync.js), registered in [`services/retention/scheduler.js`](../server/src/services/retention/scheduler.js) |
| Door counts: the count, the request plan, clear slices, the status model (pure, plus one aggregation) | [`server/src/services/fbtime/doorCounts.js`](../server/src/services/fbtime/doorCounts.js) |
| Door counts: the door step (gates, clears, sends, bookkeeping) | [`server/src/services/fbtime/doorPush.js`](../server/src/services/fbtime/doorPush.js) |
| Whose hours a shift is — kept accounts and the link-time cut | [`server/src/services/fbtime/shiftOwner.js`](../server/src/services/fbtime/shiftOwner.js) |
| The one errored transition (hours and door counts) | [`server/src/services/fbtime/connectionState.js`](../server/src/services/fbtime/connectionState.js) |
| The 180-day purge's FbTime step | [`server/src/services/fbtime/purgePairing.js`](../server/src/services/fbtime/purgePairing.js), called per record by [`services/retention/purgeDeletedIdentities.js`](../server/src/services/retention/purgeDeletedIdentities.js) and by the migration below |
| One-off deletion-gaps backfill | [`server/src/migrations/backfillFbtimeDeletionGaps.js`](../server/src/migrations/backfillFbtimeDeletionGaps.js) (`npm run migrate:fbtime-deletion-gaps`) |
| The hours resolver (merge + labels) | [`server/src/services/reports/hoursSource.js`](../server/src/services/reports/hoursSource.js) |
| Admin routes | [`server/src/routes/admin/integrations.js`](../server/src/routes/admin/integrations.js) (`/admin/integrations/fbtime…`) |
| Web UI | [`client/src/pages/IntegrationsPage.jsx`](../client/src/pages/IntegrationsPage.jsx) (`/integrations`, orgAdmin RoleGate) — a shell over [`client/src/components/integrations/`](../client/src/components/integrations/); the door-count card, **Replace key** and the "Was the link right?" question follow the proposal's §J |
| The roster row model (pure — folding, filter, sort, candidates) | [`client/src/lib/fbtimeRoster.js`](../client/src/lib/fbtimeRoster.js) + `fbtimeRoster.test.js` |
| Bulk link/unlink runner + the invalidation rule | [`client/src/lib/fbtimeBulk.js`](../client/src/lib/fbtimeBulk.js) |
| Per-row provenance marker | [`client/src/components/CanvasserSummaryTable.jsx`](../client/src/components/CanvasserSummaryTable.jsx) `HOURS_MARK` — the five states, their words and their tooltips, in one table |
| Per-person link state | [`client/src/components/UserProfileModal.jsx`](../client/src/components/UserProfileModal.jsx) Activity section, off `stats.fbtime` |
| Mobile | read-only status row on admin **More** ([`more.jsx`](<../mobile/app/(app)/admin/more.jsx>) — door-count copy driven by the server's `doors.state` / `doors.reason`, never re-derived); badges on every hours surface |
| Tests | `test/fbtimeClient.test.js`, `test/hoursSourceFold.test.js`, `test/fbtimeSync.int.test.js`, `test/fbtimeIntegration.int.test.js`, `test/reportsHoursSource.int.test.js`; door counts: `test/fbtimeDoorCounts.test.js` (pure), `test/fbtimeDoorPush.int.test.js` (the step, against an `fbt_test_` fake of FbTime's rules), `test/fbtimeDoorRoutes.int.test.js`, `test/fbtimeDeletionGaps.int.test.js` (deletion, purge, migration); web `client/src/lib/fbtimeRoster.test.js` + `integrationsRender.smoke.test.js` |

### Configuration

- **`CREDENTIAL_SEAL_KEY`** — 32 bytes base64, on web AND worker dynos. Absent = the integration is
  dormant (connect answers 503 `SEALING_UNCONFIGURED`, sync no-ops) — the mailer's dormant-switch
  posture, so the code ships before the config exists.
- `FBTIME_API_BASE` (defaults to the production URL from the provider contract),
  `FBTIME_TIMEOUT_MS`, `FBTIME_RECENT_CRON` / `FBTIME_DEEP_CRON`,
  `FBTIME_RECENT_WINDOW_DAYS` (7) / `FBTIME_DEEP_WINDOW_DAYS` (120).
- **`FBTIME_DOOR_COUNTS`** — the door-count release var. `on`, `true` or `1` (trimmed, any case)
  releases door counts; anything else, or unset, means they don't exist: no card, no switch, no
  send, no clear, and no write for an organization with nothing to do. Read at call time
  (`doorCountsAvailable()` in `doorCounts.js`), so a dashboard change restarts the dynos and takes
  effect with no deploy. Unsetting it after a release is the Doorline-wide kill switch: sends and
  clears stop everywhere, an enabled card reads **Paused** (`doorline`), and Turn off still works.
  **Never named to customers.** Release steps: [OPERATIONS.md](OPERATIONS.md).
- The door-count windows are their own constants — `DOORS_RECENT_DAYS` (7) and `DOORS_DEEP_DAYS`
  (120, FbTime's per-request maximum, asserted at load) — independent of the two hours windows
  above; they run on the hours jobs' crons.
- **One worker dyno.** The maintenance queue runs one job at a time per worker
  (`concurrency: 1` in [`worker.js`](../server/src/worker.js)). A second worker dyno could interleave
  two door runs for one organization; the per-request re-check narrows that but does not remove it
  — an operating rule ([OPERATIONS.md](OPERATIONS.md)).
- **`DELETED_IDENTITY_RETENTION_DAYS` must stay ≥ 121** (default 180) — the purge's FbTime step
  relies on it (*Account deletion and the 180-day purge*, below).
- Run `npm run migrate:build-indexes -- --apply` after a deploy that adds indexes (prod runs
  `autoIndex: false`); the worker also `syncIndexes()`es the shift cache at boot. **Door counts add
  no index**, so their release needs no index build.
- **Door-counts release:** `npm run migrate:fbtime-deletion-gaps` (dry run), then `-- --apply`, once,
  straight after the deploy — Heroku dashboard → **More → Run console**, repo root (proxied in the
  root `package.json`). See *Account deletion and the 180-day purge*.
- **Cutover from the day-total cache (2026-08):** `npm run migrate:fbtime-shifts -- --apply`
  deep-resyncs every connected org into the shift cache immediately (instead of waiting for the
  nightly deep job); a later `-- --apply --drop-legacy` drops the retired `fbtimedailyhours`
  collection once the numbers are confirmed. Dashboard Run console, repo root — both proxied.

### The sync model — and the provider traps it honors

Two maintenance jobs re-pull **date ranges of shifts** (`GET /shifts`) and make the cache equal
the response over that range (upsert by the provider's shift id, delete what it no longer has):

- `fbtime-hours-recent` — every 15 min (off the quarter-hour), trailing 7 days, `connected` orgs.
- `fbtime-hours-deep` — nightly 06:29, trailing 120 days; also re-pings `errored` connections and
  self-heals (`sync-recovered`).
- `fbtime-hours-org` — one-off, deep window, for a single org. Enqueued at connect (so a fresh
  connection has a season of hours in seconds), by a door-count turn-on and every clear request,
  and by **`POST /admin/integrations/fbtime/sync`**, the status bar's **Refresh hours** button
  (2026-08-24; it reads **Sync now** while door counts are on) — the admin's escape from the nightly
  wait after fixing a weeks-old timesheet. The route stamps `manualSyncRequestedAt` on the
  connection with one atomic `$set` (never a `save()`, which would write the loaded document back
  over a turn-on or a clear that landed in between) — a 60-second cooldown, 429 `SYNC_COOLDOWN`
  inside it — and answers 202 with `requestedAt`; the client polls the status GET until
  `lastSyncAt` (and, door counts on, `doors.lastFinishedAt`) or `lastErrorAt` moves past that
  instant (`lastErrorAt` rides the status payload for exactly this — additive, no version bump; the
  mobile More row reads the same GET). The job accepts `errored` connections and runs
  `syncOneConnection` — the cron loop's per-connection body, extracted — so a manual refresh
  probes-and-recovers a fixed key like the deep job would, and absorbs failures onto the
  connection's `lastSyncError`/`lastErrorAt` where the status card explains them, instead of
  dying as an invisible failed job. (Trade accepted: job-level retries are gone for this path —
  a transient blip now waits for the next 15-minute tick rather than BullMQ backoff.)

**Every run ends with the door step** (`runDoorStep`, [`doorPush.js`](../server/src/services/fbtime/doorPush.js)),
called by `syncOneConnection` after the hours step's try/catch — whatever the hours result, because
it re-reads the connection and gates on its own state, so a failing hours pull never silences door
counts. `deep` comes from the **job**, never the hours window: `fbtime-hours-deep` and
`fbtime-hours-org` are deep (a full 120-day door run), `fbtime-hours-recent` is not. An org that
never turned door counts on and has no clear waiting gets no door-count write — apart from a deep
job, var on, storing the key's scopes and FbTime's features when they changed.

**Whose hours a shift is.** The sync writes each shift's `userId` through `loadShiftOwners`
([`shiftOwner.js`](../server/src/services/fbtime/shiftOwner.js)) — the person's current link, or a kept
earlier account for shifts clocked before its cut (*Kept accounts*, below) — instead of a plain
link map.

The traps, from the provider's contract, all deliberate here:

1. **Never an `updatedSince` cursor for shifts.** FbTime hard-deletes time entries; a deleted row
   is never "updated". Replace-range propagates deletions for free. The delete scan uses the SAME
   UTC bounds the provider derives from `[startDate, endDate]` in the pull zone (its inclusive
   `23:59:59.999` end and our exclusive next-midnight are the same set at integer-millisecond
   resolution), so "inside the window" can never disagree between the two systems.
2. **No reconciliation machinery.** Every poll re-reads from scratch; live surfaces are
   self-healing by construction. One bounded exception: `/shifts` paginates on `clockIn` — a
   mutable sort key — so `getShifts` re-pulls ONCE if `pagination.total` moves between pages of a
   single pull (a mid-pull edit shuffled the pages); a second drift is accepted and the next
   15-minute tick heals it.
3. **Absence ≠ zero.** A person missing from `/shifts` (or a day with no shifts) falls back to
   the span estimate, labeled — never a 0 that would read as an infinite rate.
4. **The timezone parameter only shapes the pull window.** Shifts are cached as INSTANTS and
   bucketed into local days at read time, in each report's own anchor zone — so one pull serves
   every campaign the org runs, whatever zone each anchors to. (The previous day-total cache was
   stamped with the org's zone, and any campaign anchored elsewhere silently read zero measured
   rows — the failure the shift cache exists to make unrepresentable.)

Fatal provider codes (`KEY_REVOKED`, `KEY_EXPIRED`, `KEY_INVALID`, `ORG_INACTIVE`) mark the
connection `errored` with exactly **one** `sync-failed` event per transition; transient errors
mark-and-continue and never change status. Hours and door counts share **one** errored transition,
`markErroredIfCurrent` ([`connectionState.js`](../server/src/services/fbtime/connectionState.js)): an
update filtered on `{ _id, keyCiphertext: <the key this run used>, status: 'connected' }`, with
`sync-failed` written only when it changed the row. So a sweep that loaded the old key before an
admin's **Replace key** never marks the connection now holding the new key as errored (the old key
was revoked on purpose — the documented rotation), and an already-errored connection re-probed by
the nightly job writes no second event; otherwise the error fields refresh, key-filtered, with no
event. A recovery ping also stores the key's `keyScopes` and FbTime's `fbtimeFeatures`.

### The merge rules (`services/reports/hoursSource.js`)

- **The day is built HERE, in the report's own anchor timezone.** The cache holds shifts
  (instants); each belongs entirely to the local day its `clockIn` falls on in the request's
  anchor tz — the provider's own bucketing rule (`localDateOf`), applied to the same instants in
  the report's zone instead of one stamped at sync time. Hours-days and knock-days therefore
  share a bucketing **by construction**: the same request resolves one anchor tz and feeds it to
  both. Day totals sum the per-shift figures **already-rounded** (each arrives 2dp per the
  contract), which is literally how the provider's own `/hours` computes its totals — so a day
  here equals the timesheet, always.
- Multi-shift days are summed here (a 9–12 and a 2–6 make one 7-hour day). A day is still usable
  or not *as a whole*: one runaway open shift spoils its day even beside a clean one — falling
  back to the span entirely rather than salvaging the half is conservative and honest, and it is
  the same whole-day rule the day-total cache had.
- Per **user-day**: the measured hours win when present AND usable — `hours > 0` and not stale
  (a forgotten clock-out falls back to the span and keeps its flag). `isOpen` days count ("so
  far"); `isManualEntry` days count, flag rolled up.
- **Staleness is derived, exactly, per request** — a day is stale when it holds an open shift AND
  lies strictly before today-in-anchor-tz ("stale" *means* open since an earlier day, so today's
  open shift is just open). Never cached: a "today" baked into a row is wrong from the next
  midnight and frozen wrong for any org whose sync is erroring, which is why sync deliberately
  ignores the provider's per-shift `isStale` field. With shift-level data the old broad-write /
  read-narrow dance is gone — only the forgotten clock-out's own day falls back (and still
  raises `hasStaleShift`); the same person's other days, today included, measure normally.
  `staleDay()` survives as a guard for hand-built overlays: a stale flag with no calendar keeps
  the conservative broad reading.
- A user's day set is the **union** of knock-days and measured days — clocked-but-not-knocking
  lowers the rate. `daysActive` keeps its knock-day meaning.
- **CAMPAIGN-SCOPED ATTRIBUTION, by the knock ledger** (owner-ruled 2026-08-16 — **never** by
  FbTime location, an honor-system dropdown; knocks carry GPS, a timestamp, and a campaign id
  recorded at the moment of work). On a campaign-scoped report, a clocked day with **no knocks on
  that campaign** joins the union only when it sits inside the canvasser's all-time knock stint
  there (first knock-day … last knock-day) AND the org-wide ledger shows no knocks on any other
  campaign that day. Knocked elsewhere = the hours visibly belong there; clocked and knocked
  nowhere = the idle day, still charged. One owner: `unionDayAllowed()` — the fold and any
  union-day surface ask it, never re-derive. Org-wide reports are untouched: every clocked day
  counts, as always. The case that forced it: a canvasser's spring hours on another project sat
  inside a fall campaign's all-time denominator, reading 9.2 doors/hr against a true ~19. Honest
  limits, both accepted: a day knocked on two campaigns charges its full hours to both rates, and
  an idle day inside two overlapping stints does the same — the day is the atom.
- Per-canvasser rows: `hoursSource` = `measured` | `estimated` | `mixed` (mixed exists ONLY at this
  labeled per-person grain).
- **Aggregates are all-or-nothing**: a campaign/team figure is measured only when every
  contributing user is fully measured; otherwise it is the span figure for everyone, labeled
  estimated. `mixed` never appears at aggregate level.
- **`hoursReason` names WHICH estimated** — `null` when the row is fully measured, otherwise
  `not-connected` | `not-linked` | `stale-shift` | `no-hours`, in that precedence. Precedence is
  "who can act on it", outermost first: an unconnected org has nothing to fix, an unlinked person
  is an admin's two-click fix, a stale shift is somebody's forgotten clock-out, and `no-hours` is
  the residue that is usually a day off. `loadMeasuredHours` carries the org's `linkedUserIds`
  alongside the hours for exactly this — the two answer one question between them, and a caller
  that had to load links separately is the caller that forgets to. **Kept accounts are in
  `linkedUserIds` too**: a kept account owns its shifts from before its `until`, so it is never
  `not-linked`. A fold whose overlay has **no** `linkedUserIds` (a pre-existing fixture) yields
  `no-hours`, never `not-linked`: never accuse a mapping of being missing without having looked at
  the mapping.

### Endpoint additions (all additive — no client-version bump)

| Endpoint | Added |
|---|---|
| `/admin/reports/canvassers` | rows' `hoursOnDoors`/`doorsPerHour` become **merged** values + `hoursSource`, `hoursReason`, `hoursFlags` |
| `/admin/reports/canvasser-timeline` | rows **keep the derived** `hoursOnDoors` (shipped builds sum it into the KPI — replacing it would make them blend) + additive `measuredHoursOnDoors`, `hoursSource`, `hoursReason`, `hoursFlags`; top-level `measuredKpi {hoursOnDoors, hoursSource}` (all-or-nothing; null when not all-measured) |
| `/admin/memberships/:userId/stats` | `fbtime {connected, linked, personName, source, kept}` — **link state only, never this person's hours**. Admin **or lead** (the route's existing `leadMaySeeTarget` gate), which is the only FbTime fact a lead can see anywhere. A kept earlier account reads `linked: true, kept: true` (its hours before `until` count), so its profile never says "link them"; no dates, because a lead can read it |
| `/admin/reports/team-averages` | all-or-nothing applied server-side + top-level `hoursSource` |
| `/admin/reports/canvassers/:id/summary` | merged `kpi.hoursOnDoors` + `kpi.hoursSource`/`hoursFlags`; `lastSevenDays[].hoursSource` |
| `/admin/reports/canvassers/:id/daily` | per-day merge; each day exactly `measured` or `estimated` |
| `/admin/integrations/fbtime/people` | additive `orphanLinks[]` (a link whose FbTime person left the provider roster — it still attributes cached hours, so it must be visible and unlinkable) and `ghostPersonIds[]` (unlinked person ids with cached hours that `/people` cannot return). Without them `unmatchedWithHours` counted people the table had no row for. **Web-only endpoint** |
| `/admin/integrations/fbtime/projects` | **new.** `{ windowDays, startDate, endDate, timeZone, projects: [{ fbtimePersonId, lastShiftAt, projects: [{id, name, lastAt, shifts}] }], degraded, reason }`. See *Recent project labels* below |
| `POST /admin/integrations/fbtime/links` | additive optional `fbtimeName` / `fbtimeEmail`. `FbTimePersonLink` has always carried these so a row still names somebody once the person leaves `/people`, but only the auto-match pass wrote them — every hand-made link was blank in exactly the case the fields exist for |
| `/admin/memberships` | additive `campaignIds[]` per member (rostered campaigns, from `CampaignAssignment` — distinct from `managedCampaignIds`, which is a lead's grant), **lead-scoped**; `fbtime {linked, personName, source, kept}` (**admin-only**, null when the org has no connection — a kept earlier account reads `linked: true, kept: true`, so the Users list shows it as measured); `user.isDeleted` |
| `/admin/reports/canvassers.csv` | preamble stamp rows (`Canvasser export, <range>, hours as of <ISO>` + blank) and an `Hours source` column appended after every existing one. Since 2026-10-02 the `Not a target` column follows it (the header ends `…,Hours source,Not a target`, present for every org); no existing column moved — see [EXPORTS.md](EXPORTS.md) for the standing rule |

Clients: the web/mobile Timeline KPI applies the all-or-nothing rule over the rows **in view**
(the crew filter changes who is included), summing server-computed per-row fields — composing,
never re-deriving. The canvasser's own pace lane (`mobile/lib/rates.js` `formatPace` off
`firstDoorAt`/`lastDoorAt`) is deliberately untouched: it is a within-day span, and a live
"measured pace" would need mid-shift freshness the 15-minute poll cannot honestly claim.

### Recent project labels — displayed, never stored, never an attribution key

`GET /people` **does not expose location**: the provider's contract names that `.select()` as its
privacy boundary and withholds `locations` along with pay rates and phone numbers. The label is
only reachable as `project: { id, name }` riding each **shift** row.

So `GET /admin/integrations/fbtime/projects` derives it: `getShifts` over a trailing window
(`FBTIME_PROJECT_WINDOW_DAYS`, default 30, clamped 7–120, using `sync.js`'s own exported
`windowFor` so the mapping screen and the cron share one definition of "the window in the org's
zone"), grouped per person in memory, most-recent-first, **capped at three** — one label would hide
the split-week case, which is exactly when the column earns its place. Then it is thrown away.
`FbTimeShift` is unchanged and its "DELIBERATELY NOT STORED" minimization list still holds;
`fbtimeSync.int.test.js` pins that no shift document ever gains a project field.

**A LABEL, NEVER A KEY.** Hours are attributed to campaigns by the **knock ledger**
(`hoursSource.js` → `unionDayAllowed`), owner-ruled 2026-08-16, precisely because an FbTime
location is an honor-system dropdown a canvasser forgets to switch and would silently move hours
between campaigns' rates. The projectLocation-mapping idea is dead; do not re-propose it. The
resolver cannot reach this value even by accident — it is not in the cache, and nothing in the
report path reads it.

**Its own route, deliberately.** `/fbtime/people` already pages the provider's whole roster on
every load and is the one request the table cannot render without; `getShifts` pages to exhaustion
too, so stacking both in one handler would put a multi-page pull on the critical path and can
overrun Heroku's 30s router limit. Split, the roster renders immediately and a provider failure
here costs an em-dash in one column: the route answers **200 with `degraded: true`** rather than a
4xx, since a decoration must never paint an error over a working table. `getShifts` gained an
optional `timeoutMs` (default unchanged, so the cron is untouched) which this path sets to 8s.

### Bulk linking

A client loop with bounded concurrency (3), not a batch endpoint. The per-item routes already
enforce both unique indexes, re-resolve `FbTimeShift.userId` through `shiftOwner`, and write **one
`IntegrationEvent` per link** — per-link provenance is the point, because a wrong link is a
payroll-adjacent mistake somebody has to be able to trace. Partial failure is the normal case (a
`LINK_TAKEN` or `LINK_CHANGE` race), so results are per row and the caller invalidates **once** at
the end. The unlink route takes the same optional `{ doors: 'keep' | 'clear' }` body whether a row is
unlinked alone or as part of a bulk run.

That invalidation is load-bearing: the page used to invalidate the prefix `['admin','integrations']`,
which now also matches the projects query, so a prefix would put a paged provider `/shifts` pull
behind every click of *Link*. `lib/fbtimeBulk.js` names the exact keys instead.

### Identity mapping

`FbTimePersonLink`, one-to-one per org in both directions (DB-unique). Person ids are lower-cased on
write (`normPersonId` — 24 hex, or nothing); `LINK_TAKEN` matches case-insensitively, so a link made
before the lower-casing still counts as the same person. Auto-match by lowercase email is an
explicit, audited **action** — at a first connect or an FbTime **organization change**, and the
Settings button — never a background sweep, and never on a same-organization **Replace key** or
reconnect, so an admin's unlink is never silently undone. It skips deleted accounts and any pair an
admin unlinked as "the link was wrong" (`doors.rejected`, which the roster's suggestions skip too).
`POST /links` refuses a **deleted** account (`409 ACCOUNT_DELETED`) and **moving a linked canvasser
to a different person** (`409 LINK_CHANGE` — unlink first, which asks whether the old link was
right); it used to re-point silently. Link and unlink re-resolve `FbTimeShift.userId` immediately
through `shiftOwner`. Links **survive disconnect**; the shift cache does not. Account deletion nulls
the link's `fbtimeEmail` at once; the link itself goes at the 180-day purge (below).

### Door counts — the model

[`FbTimeConnection`](../server/src/models/FbTimeConnection.js) gains `keyScopes` and
`fbtimeFeatures` (from `GET /ping`: the key's `key.scopes`, and FbTime's server-wide top-level
`features`), `keptAccounts` (deliberately **outside** `doors` — they also decide whose hours a shift
is, so turning door counts off, a clear or an organization change never drops them), and the `doors`
block:

| Field | Meaning |
|---|---|
| `enabled`, `enabledAt`, `enabledByUserId` | The admin's switch; `enabledAt` is set only on the off→on transition |
| `reported`, `earliestDate` | The write-ahead ledger: every FbTime person id ever listed in a send, and the earliest `startDate` ever sent — whom a clear must reach, and where it starts. Written in the same atomic update that gates each send |
| `clearPersons [{ fbtimePersonId, fromUserId, confirmAfter }]`, `clearAll`, `clearAllDone`, `clearAllConfirmAfter` | Explicit clears waiting — a first pass, or the confirm pass due after `confirmAfter` |
| `rejected [{ fbtimePersonId, userId }]` | "The link was wrong" pairs, kept out of the roster's suggestions and the email auto-match |
| `deepDueAt`, `deepRetry` | A full 120-day run is owed (turn-on, a key change, a link change); people still owed one |
| `lastFinishedAt`, `lastSkip`, `lastSentAt`, `lastResult`, `lastDeepSentAt`, `lastDeepResult` | Run bookkeeping; `lastResult` is one summary per window group, `{ windowDays, startDate, endDate, people, applied, unchanged, cleared }` |
| `replacedTyped` | Cumulative since `enabledAt`; reset by Turn on |
| `overCap [{ fbtimePersonId, date, knocks }]`, `unknownPersonIds` | Person-days over 2,000 that weren't sent; ids FbTime answered as not in its organization |
| `failCode`, `failPhase`, `failDetail`, `transientStreak`, `lastError`, `lastErrorAt` | A current definitive failure, and the run of transient ones |

**Nothing in it has a default, and every array is `default: undefined`.** Mongoose writes non-null
schema defaults for paths missing when a document was loaded, so the hours sync's own `save()` on a
connection made before this feature would otherwise write `doors.enabled: false` over a turn-on
that landed mid-run (reproduced; pinned by the "save race" test). Readers take lean documents and are
null-safe; a reset is `$unset: { doors: '' }`; array writes are `$push` / `$pull` / positional `$set`,
never a whole-array `$set` (three parallel Keep unlinks kept 1 of 3 entries under read-modify-write).

**A run's identity is the key it read.** Every door-step write is filtered on `{ _id, keyCiphertext:
usedKey }`. `keyCiphertext` changes on every connect and rotate (random IV) and is nulled by
Disconnect, so a run that outlives a Disconnect or a key change can't write onto the new connection;
and the send gate also matches only `'doors.enabled': true`, so a Turn off stops it at the next
request.

`FbTimePersonLink.fbtimePersonId` is lower-cased on write. `FbTimeShift` is unchanged in shape; the
purge writes the sentinel `fbtimePersonId: 'purged'`. **No new index:** the count's `$or` of accounts
can use the existing `CanvassActivity` `{ userId: 1, timestamp: -1 }`, and the purge's shift updates
are scoped to organizations with a connection row so the existing `{ organizationId, userId,
clockIn }` can serve them (a `{ userId }`-only query would be a collection scan).

### Door counts — the count

`countDoorsByPersonDay` in [`doorCounts.js`](../server/src/services/fbtime/doorCounts.js). **The
number is the Timeline's** (`routes/admin/reports.js`, canvasser-timeline), in its org-wide form —
rows with `actionType` in `[...KNOCK_ACTIONS, 'restricted']` and `NOT_BULK`, each counting 1 unless it
is `restricted`. So a Restricted-only day is a 0, a day with no door result is absent (never a 0), and
notes and desk marks never make a day. Never `knocksPipeline`, which dedupes doors **across**
canvassers for billing. The constants are imported from
[`aggregations.js`](../server/src/services/reports/aggregations.js), so a change to `KNOCK_ACTIONS`
changes what FbTime receives ([METRICS.md](METRICS.md) §A).

- **Zones from one resolver** (`resolveZones`), mirroring the Timeline's fallback (campaign → org →
  `America/New_York`), each checked against the server's curated `US_TIMEZONES`
  ([`utils/usStateTimeZone.js`](../server/src/utils/usStateTimeZone.js)). `Intl` alone accepts
  spellings MongoDB's `$dateToString` rejects (error 40485), and one such campaign would stop the
  whole organization's count, unnamed; here it throws `INVALID_TIMEZONE` with the campaign (or the
  organization) in `failDetail`. Campaign create and update now refuse such zones at the door
  ([TIMEZONES.md](TIMEZONES.md) §E).
- **The window** is N days ending at the **latest** local today across the org's zones
  (`doorsWindow`). The `$match` spans the union of the zones' day ranges; each row is bucketed in its
  campaign's zone (a `$switch` on `campaignId`, the org zone as default — and never a zero-branch
  `$switch`, MongoDB error 40068), then cut back to `[startDate, endDate]`.
- **Accounts — one loader** (`loadDoorAccounts`) for the count, the requests, the clears, the
  per-request re-check and the card: every link (ids lower-cased, 24 hex, de-duplicated), plus each
  kept account whose person is linked, whose account has no link of its own, and whose person has no
  first-pass clear waiting; de-duplicated by `userId`. A kept account counts only rows before its
  `until`; two accounts of one person are summed into one `personId|date` cell.
- **All or nothing.** Any throw fails the send before a single request — a partial count would read
  as "nobody worked", and FbTime would clear those days. Clears never depend on the count.
- **Parity is a test:** `fbtimeDoorPush.int.test.js` compares what FbTime receives, per person and
  date in both directions, with the real `GET /admin/reports/canvasser-timeline` for a Chicago, a New
  York and a Honolulu campaign — including a late-evening knock that two zones date differently, the
  night the clocks go back (2026-11-01), window edges, notes and desk marks.

### Door counts — the requests and the client

`planDoorRequests(count, groups)` (pure) takes the count — whose window travels with its cells, so a
request can never be built over another window's cells (asserted) — and the people grouped by window:

- **Sized by person-days:** people per request = `min(500, floor(5000 / windowDays))` — 500 at 7 days,
  41 at 120 — far inside FbTime's 30-second router limit.
- Each request lists its people (sorted) and their cells inside its own window. A day with no
  activity gets **no** count. A cell over **2,000** is left out (FbTime then clears that day) and
  recorded in `overCap`.
- **The body is exactly `{ startDate, endDate, userIds, counts: [{ userId, date, doors }] }`**, with
  FbTime's own person ids — never Doorline's. An explicit clear adds one key, `restoreTyped: true`
  (FbTime brings back the typed numbers on those days); window-replace sends never carry it. Both key
  sets are pinned by tests.

[`client.js`](../server/src/services/fbtime/client.js) — "read-only except `PUT /doors`":
`putDoors({ apiKey, body, timeoutMs })` (a JSON body; the key only in the `Authorization` header;
`return await res.json()`, so the abort timer also covers reading the body and a body that stalls
after the headers can't hold the one-at-a-time maintenance queue); `ping({ apiKey, timeoutMs })`; and
`FbtimeApiError.detail`, FbTime's machine detail beside the code. **The laptop guard:** on the network
path only, after the `fbt_test_` seam, a write from outside production is refused unless
`new URL(FBTIME_API_BASE).hostname` is `localhost`, `127.0.0.1` or `[::1]` — FbTime has no staging
tenant, and a laptop's seeded knocks would window-replace a customer's real page. It throws
`LAPTOP_GUARD`, recorded as `lastSkip: 'laptop-guard'`, never transient and never an event.

### Door counts — the door step

`runDoorStep(connectionId, { deep, now })` in [`doorPush.js`](../server/src/services/fbtime/doorPush.js).
Never throws — every failure is recorded on the connection, where the card explains it. Each
evaluation has a **60-second budget** of FbTime requests per organization; while door counts are on,
clears use at most 40 of them.

1. **A deep job, var on, connected:** refresh `keyScopes` / `fbtimeFeatures` by `/ping` (8 s), writing
   only on change — so even an Off card can say "your key reads hours only".
2. **Nothing to do** — off, and no clear due → return with **no write**.
3. **Gates**, in order: the var off (`lastSkip: 'unavailable'`); the organization being deleted
   (`org-deleting`); not `connected` (`paused`); scopes never read → `/ping` once; no `doors:write`
   (`needs-permission`; `failCode: 'SCOPE_REQUIRED'` while on); no `doors:reported-wins`
   (`fbtime-outdated`); another connection is the reporter (`conflict`; `failCode:
   'DOORS_REPORTER_TAKEN'` while on). A gate stop writes `lastSkip` and `lastFinishedAt` and stops.
4. **Clears** (below) — UTC date ranges, so they need neither zones nor the count.
5. **While on, choose the windows per person, before counting.** A **full run** (a deep job, or
   `deepDueAt` set) sends everyone 120 days; otherwise the 120-day group is `deepRetry` plus anyone
   whose clear pass succeeded this run, and everyone else gets 7.
6. **Nobody linked** → no count and no request; the evaluation counts as all-definitive (`lastResult`
   is one group with `people: 0`, and the card reads **Sending** for nobody — never stuck).
   Otherwise **zones and the count** over the widest window needed, all or nothing.
7. **The send**, request by request.

**Before every request**, clears and sends alike: the reporter predicate again; for a send, each
person's set of accounts is re-read through the loader, and anyone whose set changed since the count,
or who now has a first-pass clear waiting, is dropped from that request; then the **gate** — for a
send, one atomic pipeline update that writes the ledger (`$setUnion` into `reported`, `$min` into
`earliestDate`) and matches only `{ _id, keyCiphertext: usedKey, 'doors.enabled': true }`; for a
clear, a key-filtered re-read keeping only the people still asked for (the same `fromUserId`, or
`clearAll` still set). Nothing matched → stop. A Turn off (for sends), a Disconnect, a Cancel or a
key change mid-run therefore takes effect at the next request.

**The reporter predicate** (`otherReporterAhead`) — one sender per FbTime organization. A connection
may send or clear only if no **other** non-disconnected connection with the same non-empty
`fbtimeOrgId` is ahead of it: when this one is off, any enabled one is ahead; among enabled ones, the
earlier `enabledAt` (then `_id`). Errored connections stay in.

| Answer | What Doorline does |
|---|---|
| `200` | Sum `applied` / `unchanged` / `cleared` into its window group; `$inc doors.replacedTyped` by FbTime's `replacedTypedChanged` — the typed numbers that **differed** from Doorline's (`replacedTyped` from a build without it) — filtered on the run's `enabledAt`; union `unknownUserIds` |
| `400 VALIDATION`, any other `4xx` except 401/403/429 | Definitive: `failCode` (FbTime's code), `failPhase` (`send` or `clear`), `failDetail`, `lastError`; the next request still goes |
| `401`/`403` `KEY_REVOKED` · `KEY_EXPIRED` · `KEY_INVALID` · `ORG_INACTIVE` | End the step; the one errored transition |
| `403 SCOPE_REQUIRED` | End the step; re-ping and store `keyScopes`; `failCode: 'SCOPE_REQUIRED'` |
| any other `401` / `403` | End the step; definitive |
| `429` | End the step (the limit is per key); transient |
| `5xx`, timeout, network | Transient: `lastError`, continue with the next request; three in a row end the phase |
| A count failure | `INVALID_TIMEZONE` is definitive, naming the campaign or the organization; anything else is transient. No send request either way; clears already done stay done |
| `LAPTOP_GUARD` | `lastSkip: 'laptop-guard'`; not transient, no event |

**After the run** (key-filtered): `deepRetry` = (`deepRetry` ∪ this run's 120-day group) − people
whose 120-day request got a definitive answer, limited to people linked now — so a count failure, a
dropped request or a budget cut leaves everyone owed still owed — and a full run `$unset`s
`deepDueAt` by compare-and-set. `failCode` is settled by one compare-and-set on the value read at the
start: the run's definitive code; else `STUCK` once `transientStreak` reaches **8** (about two hours
of 15-minute runs); else cleared when every request got a definitive answer, and a Doorline-set
`DOORS_REPORTER_TAKEN` / `SCOPE_REQUIRED` / `INVALID_TIMEZONE` is also cleared by a run that got past
it. `doors-failed` / `doors-recovered` are written only when that update changed the row — once per
transition, like `sync-failed`. `lastSentAt`, `lastResult` and `unknownPersonIds` move only when the
regular send finished definitively; `lastDeepSentAt` / `lastDeepResult` only on a full run; `overCap`
is replaced only for the (person, date) pairs a successful request covered; `lastFinishedAt` on every
evaluation past step 2 (Sync now waits for it).

### Door counts — explicit clears

FbTime never touches a person who leaves `userIds`, so an unlinked person's numbers **freeze**.
Doorline removes a person's numbers only when an admin asks, and every explicit clear request carries
`restoreTyped: true`:

| Asked by | Recorded as |
|---|---|
| **Unlink → "No — the link was wrong"** (`DELETE /fbtime/links/:userId` with `{ doors: 'clear' }`, a row or a bulk unlink) | `{ fbtimePersonId, fromUserId }` in `clearPersons` and the pair in `rejected` — only for a person in `reported` (otherwise a plain unlink, answering `clear: false`); refused while disconnected (`409 DOORS_NOT_CONNECTED`) |
| **Clear the numbers Doorline sent for *person*** — an FbTime person in `reported` who isn't linked now (`PATCH /fbtime/doors` `{ clearPerson }`) | `{ fbtimePersonId, fromUserId: null }`; event `doors-clear-requested { fbtimePersonId }` |
| **Turn off → "Also clear the numbers Doorline sent"** (`{ enabled: false, clear: true }`), or **Clear the numbers Doorline sent…** on the Off card (`{ clear: true }`) | `clearAll: true`; the Off-card form writes `doors-clear-requested { all: true }` |

The clear phase:

1. **Who:** `clearAll` → every person in `reported` not yet in `clearAllDone`; per-person → each entry
   whose confirm pass isn't still in the future.
2. **Range:** from `max(earliestDate, today − 729 days)` to **tomorrow UTC**, in ≤ 120-day slices, with
   `counts: []`. Nothing ever sent → done without a request.
3. **Group by group, with saved progress:** up to 41 people and all their slices per group, from a
   starting group that rotates every 15 minutes, so one failing group can't starve the rest. When every
   slice of a group answers 200 (a person FbTime answers as unknown counts as done), per-person entries
   get `confirmAfter = now + 15 min` and a clear-all adds the group to `clearAllDone`. A failure keeps
   the group's state for the next tick.
4. **The confirm pass, for every clear.** Each is repeated once, identically, at least 15 minutes
   later: a request cut off by Doorline's 30-second timeout can still be written by FbTime after the
   clear (reproduced — a stalled send landed after the clear and, under "Doorline decides", stayed
   locked). A person linked now is in that run's 120-day group, so the refill follows the confirm pass.
5. **Done:** after the confirm pass the entry leaves `clearPersons` and the person leaves `reported`;
   when a clear-all's confirm pass finishes, `clearAll`, `clearAllConfirmAfter`, `clearAllDone`,
   `reported` and `earliestDate` are unset. One `doors-cleared { count }` per run that finished any.
   **Clears never remove kept accounts.**
6. **No cut for a person linked again.** The clear covers the whole range, and the same run's 120-day
   send refills the right canvasser's last 120 days. If the refill fails, FbTime shows blank or
   restored-typed days — never the wrong canvasser's number — and `deepRetry` refills on the next tick.
7. **Cancelled** by linking the person to the **same** canvasser it was unlinked from (`POST /links`, as
   Undo does — never by the auto-match), which pulls the entry and its `rejected` pair and answers
   `clearCancelled: true`; by **Cancel** (`{ cancelClears: true }`), which drops every waiting clear,
   confirm pass and `clearAllDone` (`doors-clears-abandoned { count, all }`); and, for a waiting
   clear-all only, by **Turn on** (`doors-enabled { clearCancelled: true }` — the first send restates
   the last 120 days anyway). Turning off never cancels a clear.
8. **When:** with door counts on or off — but never while the var is off, the key can't write, FbTime
   lacks `doors:reported-wins`, or another connection is the reporter. **Disconnect** and an
   **organization change** refuse while a first pass waits (`409 DOORS_CLEAR_PENDING`, carrying
   `{ all, persons }`) unless the request says `leaveDoorCounts: true` — the clears are then unset and
   `doors-clears-abandoned` written; a pending confirm pass alone is dropped without a 409.

**A documented limit:** a send FbTime writes more than 15 minutes after Doorline gave up on it,
landing after both passes, can't be caught — it needs an FbTime database stall that long.

### Kept accounts — whose hours a shift is (`shiftOwner`)

A **kept account** is an admin's "the link was right" on unlink: one FbTime person is one human across
more than one Doorline account (they deleted theirs and came back with a new one).

- **Recorded** by `DELETE /fbtime/links/:userId` with `{ doors: 'keep' }` — offered for a deleted account
  (always: it decides hours too) or when Doorline has sent door counts for that person — as
  `{ fbtimePersonId, userId, until, keptByUserId, keptAt }` pushed onto `keptAccounts`, where `until` is
  the account's `deletedAt`, or the unlink time; event `account-kept { userId, fbtimePersonId }`.
- **Cut at link time** (`cutKeptAccounts`). When `POST /links` or the auto-match links that FbTime
  person to an account that has already worked, each kept entry's `until` moves earlier to
  `max(start of the local day of the new account's first door result — in the zone the Timeline files
  it under, the kept account's last door result + 1 ms)` whenever that is earlier. Admins link the new
  account after it has worked, so an `until` at the unlink (or the deletion) would hand the new
  account's first shifts to the old one and turn the current campaign "estimated" (round 4,
  reproduced); the floor keeps every one of the kept account's own door results before the cut, so the
  count and the shift owner always share one `until`.
- **Removed** by **Stop counting** (`DELETE /fbtime/kept/:fbtimePersonId/:userId`, event
  `account-kept-removed`), when that account is linked again (to anyone, by hand or by the
  auto-match), and by the 180-day purge — each followed by a re-resolve of **all** of that person's
  shifts. Never removed by a clear, Turn off or an organization change.
- **One owner for `FbTimeShift.userId`:** `shiftOwner` — the kept entry for that person with the
  smallest `until` later than the shift's `clockIn` owns it; otherwise the person's current link;
  otherwise nobody. With no kept entry that is exactly the old rule. Every writer goes through it: the
  unlink, the link and auto-match backfills (after the cut), the hours sync, Stop counting, and the
  purge.
- **Reads as measured.** `loadMeasuredHours`' `linkedUserIds`, the Users list (`fbtime.kept`) and the
  profile (`/memberships/:userId/stats` → `fbtime { linked: true, kept: true }`) include kept accounts,
  so a kept account never reads "No link" or "link them".
- **Door counts:** the loader adds a kept account to its person's accounts with `until`, and the count
  takes its knocks only before `until`.

### Door counts — the status model

`doorsStatus(connection, extras)` in `doorCounts.js` is the **one owner** of what the card means; the
web card and the phone's More row render it and never re-derive.

**State precedence.** While **on**: `paused` (`connection` — the connection errored → `doorline` — the
var off → `fbtime-outdated`) → `attention` (`conflict` → `needs-permission` → `timezone` → `refused`, any
`failCode` Doorline doesn't set itself → `stuck`) → `clearing` (a runnable clear) → `starting` (no
successful send since `enabledAt`) → `sending`. While **off**: `clearing` if a runnable clear waits,
else `off`, with a hint in `reason` — `conflict` → `hours-only-key` → `revoke-door-key` (the key can
write and door counts were on before). A waiting clear that can't run is a notice, its
`pendingClears.blockedBy` the first of `paused` → `unavailable` → `fbtime-outdated` → `conflict` →
`needs-permission` → `refused` (only a refused clear) → `stuck`, drawn on or off and whatever the var.
Turn on and Turn off both unset `failCode`, `failPhase`, `failDetail`, `lastError` and
`transientStreak`; Turn on also unsets `replacedTyped`. Results from before the latest turn-on are
hidden on read — nothing is lost.

The `doors` block of `GET /fbtime`:

```js
doors: {
  available, enabled, enabledAt, enabledBy: { name } | null,
  canWrite, reportedWins,               // keyScopes has doors:write; fbtimeFeatures has doors:reported-wins (null: never read)
  state, reason,                        // reason = the paused / attention value, or the off hint
  lastSentAt, lastResult: [ … ], lastDeepSentAt, lastDeepResult, lastFinishedAt, lastSkip,
  lastErrorAt, lastError, failCode, failPhase, failDetail,
  replacedTyped, everSent,              // everSent = `reported` is non-empty
  canClearAll,                          // everSent, and a clear-all could be asked for right now
  unknownPeople: [{ fbtimePersonId, name }],
  overCap: [{ name, date, knocks }],    // the first five
  overCapCount,
  pendingClears: { all, persons: [{ fbtimePersonId, name }], confirmPending, blockedBy },
}
```

`canClearAll` = something was sent, the var is on, the connection is connected with a key that has
`doors:write`, FbTime lists `doors:reported-wins`, nobody else reports, and no clear-all is already
waiting. Names come from the links, kept accounts and waiting clears through `hydrateCanvassers`, at
read time.

### Door counts — routes ([`routes/admin/integrations.js`](../server/src/routes/admin/integrations.js))

All behind the router's `requireOrgRole('admin')`; leads never reach them. Everything the phone reads
(`GET /fbtime`) is additive — no client-version bump.

| Route | Change |
|---|---|
| `GET /fbtime` | Adds `keyScopes`, `fbtimeFeatures` and the `doors` block. Not connected: `{ connected: false, configured, doorsAvailable }`, so the connect card's Test result can say a key also fills in door counts |
| `GET /fbtime/people` | Each person and orphan link gains `doorsSent`, `clearWaiting`, `canClearSent` (sent, not linked now, no clear waiting), `linkedStatus`, `deleted` and `alsoCounts [{ userId, name, deleted, until }]`; `suggestions` skip `doors.rejected` pairs |
| `GET /fbtime/events` | Each event gains `by: { name, status } \| null` (null = automatic) and `subject` (whom a link event is about) — names resolved at read time and never stored; a deleted account shows its snapshot name until the purge |
| `POST /fbtime/test` | Also returns the ping's `features` |
| `POST /fbtime/connect` | **An organization change** — the ping's org id differs from a stored non-empty `fbtimeOrgId`, at any status (a rotate still asks `ORG_CHANGE_CONFIRM` first; a reconnect of a disconnected row doesn't) — answers `409 DOORS_CLEAR_PENDING` while a first pass waits unless `leaveDoorCounts: true`; otherwise `$unset doors`, `doors-disabled { reason: 'org-changed' }` if it was on, and the email auto-match runs. **The same organization** (Replace key) keeps `doors`, clears included — a waiting clear runs with the new key, or stays blocked if that key can't write — and sets `deepDueAt` while on; a reconnect after Disconnect forces `doors.enabled: false`; the auto-match does **not** run. Stores `keyScopes` / `fbtimeFeatures`. The write is filtered on the key as read (`409 CONNECTION_CHANGED` if it moved; a racing first connect's duplicate key answers the same). The response gains `orgChanged` |
| `PATCH /fbtime/doors` *(new)* | Exactly one of `{ enabled }`, `{ clear: true }`, `{ clearPerson }`, `{ cancelClears: true }` (plus `{ enabled: false, clear: true }`), else `400 INVALID_INPUT`. **Turn on** — checked in this order, nothing written until all pass: `403 DOORS_STAFF_FORBIDDEN` under a support grant → `409 DOORS_NOT_AVAILABLE` → `409 DOORS_NOT_CONNECTED` → already on: 200, nothing written → a fresh `/ping` (8 s; a failure answers FbTime's error) → `409 DOORS_ORG_UNKNOWN` (no org id, or one different from a stored one; an empty stored id takes the ping's) → `409 DOORS_REPORTER_TAKEN` → `409 DOORS_SCOPE_MISSING` / `409 DOORS_FBTIME_OUTDATED` (the ping's scopes and features are stored first, so the Off hint is right on the next load). Then one update filtered on `{ status: 'connected', keyCiphertext: <the key just pinged>, 'doors.enabled': { $ne: true } }` sets `enabled`, `enabledAt`, `enabledByUserId`, `deepDueAt`, cancels a waiting clear-all and unsets the failure fields and `replacedTyped`; `doors-enabled`; the one-off org job is enqueued. **Turn off** (`{ enabled: false }`) always works — staff included; with `clear: true` and something sent it needs what any clear needs (the var, a connected key with `doors:write`, `doors:reported-wins`, no other reporter) or answers the matching 409; `doors-disabled { reason: 'admin', clear }`. **`{ clear: true }`** while off is the same clear; while on, `409 DOORS_ENABLED` ("Turn door counts off first — the same step can clear"). **`clearPerson`** has the same preconditions, plus `409 DOORS_NOT_SENT` (not in `reported`) and `409 DOORS_PERSON_LINKED` (linked — unlink and choose "No" instead). **`cancelClears`** → `doors-clears-abandoned { count, all }` |
| `DELETE /fbtime` (Disconnect) | `409 DOORS_CLEAR_PENDING` while a first pass waits, unless the JSON body says `leaveDoorCounts: true`; unsets every waiting clear (`doors-clears-abandoned`); sets `doors.enabled: false` (`doors-disabled { reason: 'disconnected' }` if it was on). The ledger, `rejected` and `keptAccounts` stay for a reconnect to the same FbTime organization |
| `POST /fbtime/sync` | Unchanged in shape — the status bar's one button; its one-off org job is a full door run. The cooldown stamp is one atomic `$set` |
| `POST /fbtime/links` | Lower-cases `fbtimePersonId`; refuses `409 ACCOUNT_DELETED` and `409 LINK_CHANGE`; ends kept entries for the linked account and applies the cut; cancels a same-pair clear and removes the pair from `rejected` (`clearCancelled`, also in the `link-created` detail); re-resolves shifts through `shiftOwner`; sets `deepDueAt` while on. `link-created` no longer stores `userEmail` |
| `DELETE /fbtime/links/:userId` | Optional JSON body `{ doors: 'keep' \| 'clear' }` — `keep` records a kept account, `clear` an explicit clear (only for a person in `reported`); no body is a plain unlink. Shifts re-resolve through `shiftOwner`; sets `deepDueAt` while on; `link-removed` carries `doors` / `clear`; answers `{ removed, kept, clear }` |
| `DELETE /fbtime/kept/:fbtimePersonId/:userId` *(new)* | Stop counting: pulls the kept entry (404 if there is none), re-resolves the person's shifts, sets `deepDueAt` while on |
| `POST /fbtime/links/auto`, and the connect-time pass | Skip deleted accounts and `doors.rejected` pairs; never cancel a clear; end kept entries for anyone linked and apply the cut; re-resolve shifts; set `deepDueAt` while on |

[`routes/admin/campaigns.js`](../server/src/routes/admin/campaigns.js) also changed: a campaign zone
outside the curated list is refused (`400 INVALID_TIMEZONE`, [TIMEZONES.md](TIMEZONES.md) §E) — the
one non-additive change in this release, and it refuses only zones no screen offers.

### Door counts — events

[`IntegrationEvent`](../server/src/models/IntegrationEvent.js) `type` gains: `doors-enabled` (`{
clearCancelled }` when it cancelled a clear-all); `doors-disabled` (`{ reason: 'admin' | 'disconnected'
| 'org-changed', clear }`); `doors-failed` (`{ code, phase, campaign }`) and `doors-recovered`
(`{ code }`), once per transition; `doors-cleared` (`{ count }`); `doors-clears-abandoned` (`{ count,
all }`); `doors-clear-requested` (`{ all: true }` or `{ fbtimePersonId }` — a clear asked for outside an
unlink, so the request is attributable); and `account-kept` / `account-kept-removed` (`{ userId,
fbtimePersonId }`). The **link-type** events — `link-created`, `link-removed`, `account-kept`,
`account-kept-removed` — hold `{ userId, fbtimePersonId }` and are de-paired by the purge. Door-count
events never hold a user id beside a person id: over-cap entries and clears store person ids only, and
names resolve at read time. `byUserId: null` is the worker.

### Account deletion and the 180-day purge

Door counts closed two older deletion gaps (the proposal's decision 10):

- **The email.** The Privacy Policy says deletion removes "your email address … immediately", but the
  FbTime link's `fbtimeEmail` (the FbTime person's email — for the same human, theirs) and the
  `link-created` event's `detail.userEmail` outlived the account. Now `deleteAccount`
  ([`services/users/deleteAccount.js`](../server/src/services/users/deleteAccount.js)) nulls
  `fbtimeEmail` on the account's links in every org at deletion, and `link-created` stores no email.
  The **link itself stays until the purge** — it keeps the person's measured hours theirs, and an
  admin's "was the link right?" needs it — so a deleted account's existing door counts are restated for
  at most 119 days after its last knock.
- **The pairing.** The 180-day identity purge
  ([`services/retention/purgeDeletedIdentities.js`](../server/src/services/retention/purgeDeletedIdentities.js))
  now runs **record by record**, and for each record runs the FbTime step (`depairFbtimeAccount`,
  [`purgePairing.js`](../server/src/services/fbtime/purgePairing.js)) **before** the record's
  `purgedAt` stamp. It is keyed on the **account**, across every org and every connection status — a
  disconnected or errored connection, and an org the person had already left, keep links and events too
  (`DeletedUserRecord.organizationIds` lists only the memberships active at deletion). **De-pairing,
  not reverting** — reverting the account's shifts flipped every campaign rate over their days to
  estimated (reproduced):
  1. the account's `FbTimePersonLink`s are deleted;
  2. three separate `FbTimeConnection` updates (combined, an `arrayFilters` write throws on rows
     without the array): `$pull keptAccounts { userId }`, `$pull doors.rejected { userId }`, and
     `doors.clearPersons.$[c].fromUserId` → `null` — a waiting clear stays (it is the admin's request
     about the FbTime person) but loses the account;
  3. its shifts, scoped to orgs with a connection row: clocked **before** its deletion they keep their
     `userId` and get `fbtimePersonId: 'purged'` (its hours stay measured, no row pairs the account with
     a person, and a later link of that person claims none of them); at or after it, they re-resolve
     through `shiftOwner` without the account;
  4. its link-type events lose `detail.fbtimePersonId` (and any `userEmail`), matched on
     `detail.userId` as stored — a string, sometimes upper-case;
  5. one `link-removed { reason: 'identity-purge', count }` per org touched — with no ids.

  A record whose FbTime step throws is counted, logged and left unstamped for the next night while the
  rest are purged, and the run is recorded `RetentionRun { ok: false, failed }` — not a success, so a
  record that keeps failing turns the retention health check red within its 48 hours. A dry run (the
  CLI without `--apply`) counts and writes **nothing**, not even a `RetentionRun` row: a counting pass
  must never make a dead job read green. All of this holds while `DELETED_IDENTITY_RETENTION_DAYS` is
  **≥ 121** (default 180) — a shift clocked before the deletion is then older than the 120-day re-pull,
  so no later sync re-pairs it with its person.
- **Rows from before the deploy:** `npm run migrate:fbtime-deletion-gaps`
  ([`backfillFbtimeDeletionGaps.js`](../server/src/migrations/backfillFbtimeDeletionGaps.js); a dry run
  by default, `-- --apply` writes, idempotent; proxied in the root `package.json` and run from the
  Heroku dashboard → **More → Run console**, which starts at the repo root): (1) nulls `fbtimeEmail` on
  links of deleted accounts; (2) strips `detail.userEmail` from **every** `link-created` event — nothing
  reads it, and a per-user match would miss rows whose `detail.userId` is stored upper-case; (3) runs
  the purge's FbTime step for records purged before it existed (expected 0 — the first default purge is
  around 2027-01-08). A record that fails is printed and the exit code is 1; a re-run retries it. After
  `--apply`, the bare command reads 0 on every count.

### Privacy

The org's own admin connects it — that act is the consent. **What leaves Doorline:** date ranges and
a timezone, to read hours — and, **only once an org admin has turned door counts on**, each linked
canvasser's number of doors per day (including up to the 120 days before door counts were turned on),
identified only by FbTime's own person id: the `PUT /doors` body above — person id, date, number,
never a name, email, voter, address, survey answer, note or location (`planDoorRequests` and the
body-keys tests keep that true). Per-canvasser daily door counts are a new category of personal data
leaving Doorline, but not to a new recipient: FbTime is already disclosed and engaged by the customer
(DPA §6), and a customer's admin turning door counts on is that customer's instruction (DPA §2), so
no customer notice is sent. Turning door counts on is refused to Doorline staff working under a
support grant (`403 DOORS_STAFF_FORBIDDEN`); staff can already *connect* under a grant, so "nobody at
Doorline wires it up" is kept by process there. **Until the owner approves and publishes the
door-count wording** (proposed in [PROPOSAL_FBTIME_DOOR_COUNTS.md](PROPOSAL_FBTIME_DOOR_COUNTS.md) §M),
the Privacy Policy and DPA §6 say Doorline sends FbTime only date ranges (and a timezone) — which is
why `FBTIME_DOOR_COUNTS` is set only after that wording is live.

What Doorline stores: the sealed key, FbTime person ids/names/emails for the mapping, and
per-person **shift-level hours records** — each shift's start instant, its three hour figures, and
its open/manual flags. Deliberately NOT stored, by data minimization: clock-outs (`isOpen` carries
the only fact reports need), the breaks array, and every break-minutes figure — and never GPS, never
pay rates (the provider doesn't offer them and the client never asks). The start instant is held
because it is what a shift's local day is derived from; it is the one granularity increase over the
retired day-total cache, stamped in PRIVACY_VERIFICATION.md (v5 entry). For door counts Doorline holds only its own
bookkeeping: the ledger of FbTime person ids it reported and the earliest date sent, waiting clears,
rejected pairs, kept accounts, and the last runs' summaries (over-cap entries name a person id, a date
and a count). The numbers already sent live in the customer's FbTime, outside Doorline's deletion. All
four collections are org-scoped and in the org-delete sweep.

**`IntegrationEvent` is append-only in operation**, with two privacy exceptions — the one-off
`migrate:fbtime-deletion-gaps` strips `detail.userEmail` from `link-created` events, and the 180-day
purge strips `detail.fbtimePersonId` from a purged account's link-type events — plus the existing
org-deletion cascade, which deletes an organization's events with it. **Deletion:** an account's
email leaves its FbTime links at deletion, and its pairing with an FbTime person leaves everything at
the 180-day purge (*Account deletion and the 180-day purge*, above).

**The project label is DISPLAYED, not held.** The mapping screen shows each FbTime person's recent
project so an admin can sanity-check a pairing before linking. It is derived per request from a
trailing window of `/shifts` and discarded — no collection, log, export or `IntegrationEvent`
detail ever receives it, which is what keeps the minimization list above true as written. Same
provider, same sealed key, same `timesheets:read` scope, same read-only inbound direction, same
admin-only audience: no new recipient, no new outbound data, **not a subprocessor event**. Stamped
in PRIVACY_VERIFICATION.md (v6).

**Who sees what.** Everything that *configures* the integration — the key, the hours figure, the
mapping table, the event history — is admin-only, and leads deliberately cannot reach any of it.
The one thing a lead can see is **whether a canvasser they already manage is linked**, on that
person's profile modal, because a lead reading a doors-per-hour they cannot explain is the whole
problem this feature exists to solve. That is a boolean about a person already in their scope
(the route's existing `leadMaySeeTarget` gate), never hours, never the key, never the roster of
other people's links, and it adds no new data category and no new recipient. Door counts add
nothing a lead can see: the card, the switch, the clears and their history are on the admin-only
Integrations page, and the phone's More row reads the same admin-only `GET /fbtime`, so a lead's row
shows none of it; a kept account's profile adds only `kept: true`, with no dates.
See PRIVACY_VERIFICATION.md (the v5 entry, and its v6 2026-10-09 door-count stamp — which records
what leaves, the deletion fixes and the migration run still to be attested) and the DPA §6
subprocessor listing.
