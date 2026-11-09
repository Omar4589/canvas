# Proposal: Billing that renews monthly from each campaign's first knock

> **Status: BUILT 2026-11-03 (uncommitted, not deployed) to PLAN v4**, settled by the owner the same day:
> decisions 1–10 and 15 (the switch day, **November 5, 2026**) are the owner's, and the open question is
> answered (no client's agreement says calendar months). Decisions 11–14, 16 and 17 came from the reviews
> and are the owner's to overrule. Two plan review rounds (§J), then a three-reviewer code review of the
> build (§K, which also lists where the build differs). For campaigns first out from the switch day:
> campaigns already running, and every invoice already sent, are untouched. One server deploy (the web
> console and the Help Center ship with it); nothing for phones; no migration, no new index, no config var.
> Line references are to HEAD `77fb703`.

Related: [BILLING.md](BILLING.md) (the rules this extends), [CAMPAIGNS.md](CAMPAIGNS.md) (archiving, still
the only thing that stops billing), [MARKETING_SITE.md](MARKETING_SITE.md) (the public "$300 per campaign,
per month" line, which stays true), [TIMEZONES.md](TIMEZONES.md) (dates on the campaign's own calendar),
[ROLES.md](ROLES.md) (a client's rep never sees billing), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
(why this needs no item).

# Part 1 — For everyone

## Why

Today a campaign pays for every calendar month it is active in. A campaign whose first knock was September
15 and which finished on Election Day, November 3, pays for September, October and November: three months
for seven weeks of work. A client argued it should be two: September 15 to October 15, then October 15 to
November 3. The owner agreed, for campaigns from now on.

## The new rules

For a campaign whose first field visit is on or after **November 5, 2026** (the switch day, decision 15):

1. **Billing starts on the day of the first field visit**: a knock, or a home a canvasser walked to and
   couldn't get into. Setup (creating the campaign, importing voters, cutting turf) stays free, and marking
   a book or a home restricted from your desk still doesn't count.
2. **It renews on that same date every month.** Each renewal is one month's charge at the campaign's rate
   ($300 unless negotiated). Nothing is charged by the day. A campaign that starts on the 29th, 30th or
   31st renews on the last day of shorter months (January 31, February 28, March 31, April 30).
3. **Archive before the next renewal date and that renewal never happens.** Archiving is still the only
   thing that stops billing. Nothing archives a campaign on its own.
4. **The 3-day rule:** archive on a renewal day or in the two days after it, with nobody out since that
   renewal, and that renewal is free.
5. **The first month always bills.** A campaign that went to the field pays for at least one month. This
   used to need a rule of its own; now it follows from rule 1, because the first month starts with a knock.
6. **Renewal dates follow the campaign's own time zone**, the way months do today.
7. **Still one bill per client per calendar month.** Each renewal goes on the bill for the month it falls
   in, so a running campaign shows $300 on every monthly bill, and closing the month works as it does now.
8. **Between the first knock and the archive, every renewal bills, knocks or not.** There is still no
   pause.

The last-week rule (a first knock in the last 7 days of a month makes that month free) does not apply to
these campaigns. It existed so nobody paid a full month for a few days; when billing renews from the first
knock, nobody ever pays for a partial month.

## Who it applies to

- **Campaigns whose first field visit is on or after November 5, 2026**, on the campaign's own calendar. That
  includes a campaign created earlier that is still in setup on that day.
- **Campaigns first out before then keep calendar months, under today's rules, for good**, even if they are
  archived and reactivated later.
- **A campaign's rule is set by the day of its first field visit, so it doesn't switch partway.** The
  exceptions are rare and are flagged on any invoice they would change (§D): a correction that deletes the
  first visit, a phone that uploads an earlier offline visit late, or an edit to the campaign's time zone near
  the switch day (an edit to the time zone also moves the renewal day by up to a day).
- **Invoices already sent are untouched**, and the switch alone doesn't mark any of them as changed. There
  is nothing to do before it goes live except deploy it, ideally before the switch day (§I).

This fall's campaigns therefore finish on calendar months. The September 15 campaign that prompted this pays
three months if anyone knocked November 1–3. To bill it two, take $300 off the invoice you send. The app has
no discount line, so note the courtesy on the organization's Account tab (internal notes); the app's
November statement will still show the full figure.

## Examples

How the new rules bill some typical campaigns, beside what today's rules bill:

| First knock | Archived | Renewals that bill | Months | Today's rules |
|---|---|---|---|---|
| Sep 15 | Nov 3, knocking Nov 1–3 | Sep 15, Oct 15 | 2 | 3 |
| Sep 1 | Nov 3, knocking Nov 1–3 | Sep 1, Oct 1, Nov 1 | 3 | 3 |
| Sep 1 | Nov 2, nobody out in November | Sep 1, Oct 1 (Nov 1 is free under the 3-day rule) | 2 | 2 |
| Sep 28 | Nov 1, nobody out in November | Sep 28, Oct 28 | 2 | 1 |
| Jan 31 | still running | Jan 31, Feb 28, Mar 31, Apr 30, … | every month | every month from February (January is free under the last-week rule) |

Most campaigns pay the same or less than under today's rules, because the final month is free when they
archive before that month's renewal date. A campaign that starts in the last week of a month is the
exception: it pays for the month it started in, which today's rules usually make free, and can pay one month
more in total, as in the September 28 row. That follows from dropping the last-week rule (decision 2).

## What you'll see

**Your Billing page (org admins with billing access).** A running campaign on the new rules reads *billing
since Dec 15 · renews on the 15th*; one that started on the 29th–31st reads *renews on the 31st (or the
month's last day)*. Once it's archived it shows the archive date instead. Every first-visit and archive date
on the page is on the campaign's own calendar. In the month history, a free month on the new rules reads *free
— archived before its renewal* or *free — archived within 3 days of its renewal*. The *started in the last
week of the month* line only ever counts older campaigns. There are still no prices anywhere.

**The election-day reminder (org admins only, as today).** For one campaign past its election day:

- **New rules, admin with billing access:** *Archive before Dec 15 and it won't renew.* On a renewal day or
  the two days after it, other than the first one (which always bills): *It renewed on Dec 15. Archive by
  Dec 17 and, if nobody's been out since, that renewal is free.*
- **New rules, any other admin:** no date. *Archiving stops the billing — otherwise it renews every month,
  knocks or not.*
- **Calendar months:** everyone keeps today's wording (the owner's call), including its note that archiving
  in the first few days of a month makes that month free.
- **Never been to the field:** *It hasn't been out, so it isn't billing. Archive it when you're done.*
  (Today's wording says it is billing, which isn't true.)

When several campaigns are past election day, the reminder lists them and never shows a date. If none has
been out: *None of these has been out, so none is billing. Archive them when you're done.* If every one that
has been out is on calendar months: today's wording. Otherwise: *Archiving stops the billing — otherwise the
ones that have been out keep billing every month, knocks or not.*

**Account managers (the organization page).** On the Campaigns tab, *Bills from* reads *December 2026 ·
renews on the 15th* for a campaign on the new rules; only older campaigns can show the *start grace* chip.
The Campaigns tab, the Statements tab and the statement CSV show first-visit and archive dates on the
campaign's own calendar, and each line's renewal date. The CSV gains two columns at the end, *Billing rule*
and *Renewal date*; its *Reason* column keeps printing the reason code, as now. On screen, free months read
*Free — archived before its renewal* or *Free — archived within 3 days of its renewal, nobody out since*.
Issuing a month now also warns when a renewal in it can still turn free (one that's early in its three days,
or any renewal in a month issued early), as late knocks already can.

**Phones:** nothing changes.

## What doesn't change

The price and negotiated rates; trials and account states; one bill per client per month; issuing, voiding,
due dates and marking paid; the month-close board; what counts as a field visit; reactivating an archived
campaign (it still bills the archived stretch, and still warns before it does); no partial charges.

## Words that change, and words that don't

- **Website: no change.** "$300 per campaign, per month" stays true (12 renewals a year), and "billing
  starts the month of your first knock" is exactly true for every new campaign.
- **Help Center, in the same deploy:** the *Billing and your account* guide (it currently says a month is
  "not 30 days counted from your first knock, and not an anniversary date"; it will explain both kinds of
  campaign and name the switch day), *The Billing page*, *Can I see previous months?*, and one sentence in
  *Can I bill for restricted doors?* All are admin articles. The lead-readable *Archive or delete a
  campaign?* drops its billing rules for one neutral line (decision 16).
- **Privacy Policy, Terms, DPA: no change.** When billing renews touches no personal data, retention,
  access, sharing or exports. The Terms (§8) defer fees to each client's agreement, and no agreement says
  calendar months (the open question, answered).

## Decisions

Settled by the owner, 2026-11-03:

1. **Renew on the same date each month**, not every 30 days exactly. (Exact 30-day cycles would bill a
   year-long campaign 13 times, and put two charges, or none, on some monthly bills.)
2. **Drop the last-week rule** for new campaigns.
3. **Keep the 3-day rule**, counted from each renewal.
4. **One bill per client per calendar month**, each renewal on the bill for the month it falls in.
5. **New campaigns only.** Campaigns already running finish on calendar months, invoices already sent are
   untouched, and there is no step before go-live. (This replaced an earlier answer, "every month not yet
   invoiced", after the owner said the change is for the future.)

Proposed in this plan and approved by the owner, 2026-11-03 (9 as the owner changed it):

6. **The switch is per campaign, by its first field visit**, compared on the campaign's own calendar with
   the switch day (decision 15).
7. **Renewals on the 29th–31st fall on the last day of shorter months**, then go back to the original day.
8. **The 3-day window is the renewal day and the two days after it**, as "the 1st to the 3rd" is today.
9. **Only admins with billing access see renewal dates** on the election-day reminder (the owner's change).
   Other admins see the reminder without dates, and leads never see the reminder.
10. **A late-month renewal made free after its month was invoiced shows as a change on that invoice** (§E),
    rather than every month staying open three extra days before it can be invoiced.

Made in review round 1, for the owner to overrule:

11. **The new 3-day rule gets its own label.** The old label says "archived in the first days" and "with no
    knocks", which would be false for an archive on the 16th after knocking on the 14th.
12. **Campaigns that never went to the field get a reminder that says they aren't billing.**
13. **The reminder for several campaigns never shows a date** (wording above).
14. **First-visit dates show on the campaign's own calendar** on the Billing page, the Campaigns and
    Statements tabs and the CSV. Today they use the viewer's time zone or UTC, and could read a day off next
    to a renewal date.

Raised in review round 2 and settled by the owner, 2026-11-03 (as the owner changed it):

15. **The switch day is November 5, 2026.** Round 2 found that "the day it goes live" can't be kept exactly
    (the date is written into the code before the owner deploys, separately) and proposed December 1. The
    owner chose November 5: their next campaign starts after November 4, under a new signed agreement.
    Campaigns first out before November 5 stay on calendar months. What this asks of the deploy is in §I.

Made in review round 2, for the owner to overrule:

16. **The lead-readable *Archive or delete a campaign?* keeps one neutral line about billing** ("archiving
    also stops the campaign's billing; an org admin handles that"). Today it spells out the calendar rules to
    leads, against the rule that a client's rep never sees billing, and the new rules would let a lead work out
    the renewal dates that decision 9 keeps from them.
17. **Archive dates show on the campaign's own calendar too** (as decision 14 does for first visits). An
    evening archive printed in UTC reads as the next day, which can make the CSV contradict the reason a month
    was free.

## The open question, answered

- **Does any client's signed agreement spell out calendar-month billing? No** (the owner, 2026-11-03): none
  does or ever did, and the next campaign, after November 4, comes with a new signed agreement. (The Terms let
  a signed agreement override, and the app has no per-client switch, which is why it was asked.)

# Part 2 — Technical reference

## A. Where the rule lives today

- **The rule:** [billingMonths.js](../server/src/services/billing/billingMonths.js) is pure string math over
  campaign-tz `'YYYY-MM-DD'` days. `decideMonth` (:150) returns `{ billable, reason, startMonth, floorMonth }`;
  `billingStartMonth` (:90) applies the start grace; `needsStartMonthVisitCount` (:129) asks for the one
  extra fact the floor can need, and v3 throws when that fact is missing (:112–:114).
- **The queries:** [statement.js](../server/src/services/billing/statement.js). `monthlyStatement` (:120)
  and `monthlyStatementRange` (:257) gather `firstVisitDay`, `archivedDay` and per-month visit counts, and
  both build lines through the one `statementLine` (:41), which hands `decideMonth` an explicit list of facts
  (:59–:65). The range path asks the floor's question once per month (:319–:330). `campaignFacts` (:345)
  feeds the org page's Campaigns tab. `RULES_VERSION = 3` (:19).
- **Frozen invoices:** [Statement.js](../server/src/models/Statement.js) freezes every line (including
  `reason` and `billingStartMonth`) and `rulesVersion`. Statements can be issued early with `force`
  ([issueStatement.js](../server/src/services/billing/issueStatement.js) :40–:51; *Issue early…* in
  [StatementsTab.jsx](../client/src/components/org/StatementsTab.jsx) :273), and the "month has ended" check
  runs on UTC. [statementDrift.js](../server/src/services/billing/statementDrift.js) recomputes live and
  diffs `LINE_FIELDS` (:24), the total, the rate and `rulesVersion` (:61).
- **Readers:** [invoicingState.js](../server/src/services/billing/invoicingState.js) (billing since,
  `graceCount`), the customer projections `publicUsage` (:377) and `publicMonthHistory` (:419), and the
  client surfaces in §F.

There is still no renewal job after this change. A renewal is computed when a statement is read, exactly as
a billable month is today ([BILLING.md](BILLING.md), *No periods, no proration, no renewal job*).

## B. The rule engine — billingMonths.js

The v3 functions keep their behavior for calendar campaigns. `decideMonth` and `needsStartMonthVisitCount`
gain a rule check; every other v3 function is unchanged. New code, as `const` arrows defined before use:

```js
// The switch day (decision 15): a civil date, compared in each campaign's own time zone. A campaign whose
// FIRST field visit is on or after it renews monthly from that visit; an earlier one keeps calendar months
// (v3) for good. A code constant: a frozen business fact with RULES_VERSION as its audit trail. Change it
// only before it has passed, and move the Help Center sentence that names it in the same change.
export const CYCLE_BILLING_FROM = '2026-11-05';

// The one seam for tests. Every server caller reads the switch day through cycleBillingFrom(); an
// integration suite can move it with setCycleBillingFromForTests(), which throws outside NODE_ENV=test.
export const cycleBillingFrom = () => { /* the override if set, else CYCLE_BILLING_FROM */ };
export const setCycleBillingFromForTests = (day) => { /* … */ };

// The pure helpers take the switch day as an argument, so unit tests pin a regime directly.
export const billingRuleFor = (firstVisitDay, cycleFrom) =>
  !firstVisitDay ? null : firstVisitDay >= cycleFrom ? 'cycle' : 'calendar';

// 'YYYY-MM' + first-visit day → the renewal date in that month, clamped to its last day
// (anchor 31 → Feb 28/29, Apr 30).
export const renewalDayIn = (month, firstVisitDay) => { /* … */ };

// 'YYYY-MM-DD' + n days → 'YYYY-MM-DD', Date.UTC arithmetic like daysInMonth.
export const addDays = (dayStr, n) => { /* … */ };

// Around `day`: `last` = the latest renewal on or before it OTHER THAN the first visit (null until the
// second renewal, because the first renewal is the first visit and always bills); `next` = the earliest
// renewal after it. Both null when `day` is before the first visit.
export const renewalsAround = (firstVisitDay, day) => { /* … */ };

// What the election-day reminder may say for a campaign on `today` (all campaign-tz days):
// { nextRenewalDay, lastRenewalDay, graceUntilDay }, with last/graceUntil only while today <= last + 2.
// Everything null when the first visit is after today (a phone's clock can stamp the future).
export const reminderDates = (firstVisitDay, today) => { /* … */ };

// The month a campaign bills from, by its rule: the first-visit month for cycle, v3 for calendar.
export const startMonthFor = (firstVisitDay, cycleFrom) =>
  billingRuleFor(firstVisitDay, cycleFrom) === 'cycle' ? monthOf(firstVisitDay) : billingStartMonth(firstVisitDay);
```

**`decideCycleMonth({ month, firstVisitDay, archivedDay, visitsSinceRenewal })`**, checked in this order:

1. `month < monthOf(firstVisitDay)`: not billable, `'before-start'`, `renewalDay: null`.
2. `month === monthOf(firstVisitDay)`: billable, `'billable'`, `renewalDay: firstVisitDay`. The first renewal
   is the first visit, so it always bills (rule 5), even in the anomaly where `archivedDay` precedes the visit
   (an offline upload stamped after an archive). No floor is needed.
3. `R = renewalDayIn(month, firstVisitDay)`. If `archivedDay && archivedDay < R`: not billable —
   `'archived-before-renewal'` with `renewalDay: R` when `monthOf(archivedDay) === month`, otherwise
   `'archived-earlier'` with `renewalDay: null`.
4. If `archivedDay && archivedDay <= addDays(R, 2)`: `visitsSinceRenewal` must be a number (throw otherwise,
   like v3); when it is 0, not billable, **`'renewal-grace'`**, `renewalDay: R`.
5. Otherwise billable, `'billable'`, `renewalDay: R`.

Every return also carries `startMonth: monthOf(firstVisitDay)`, `floorMonth: null` and `billingRule: 'cycle'`.
A dedicated `'renewal-grace'` rather than v3's `'end-grace'`: the old code's labels say "archived in the first
days" and "with no knocks", false for an archive on the 16th (decision 11).

**`needsRenewalVisitCount({ month, firstVisitDay, archivedDay, cycleFrom })`** returns `{ from, to }` or null,
the cycle counterpart of `needsStartMonthVisitCount`, asked per month the same way. Non-null only for a cycle
campaign, archived, when `month > monthOf(firstVisitDay)` and `renewalDayIn(month, firstVisitDay) <=
archivedDay <= addDays(that renewal, 2)`. Then `from` is the renewal and `to` is `archivedDay`. Renewals are at
least 28 days apart, so at most one month per campaign asks.

`visitsSinceRenewal` is flag-independent like `visitsThisMonth`: any `fieldVisitMatch` row (knocks and
non-desk restricted marks) from the start of `from` through the end of `to`, in the campaign's time zone.

**`decideMonth(facts)`** takes `cycleFrom` among its facts and dispatches on `billingRuleFor(firstVisitDay,
cycleFrom)`: `'cycle'` goes to `decideCycleMonth`; everything else runs the v3 body unchanged, and every path
now also returns `billingRule` (`'calendar'`, or null with no visit) and `renewalDay` (null for calendar).
`needsStartMonthVisitCount` takes `cycleFrom` too and returns null for a cycle campaign (no start grace).
`REASONS` gains `'archived-before-renewal'` and `'renewal-grace'`. There is no `renewsOnDay` field anywhere:
the renewal day of the month is `firstVisitDay`'s day, and screens derive it from that.

## C. The queries — statement.js

- **The switch day** is read once per statement build with `cycleBillingFrom()` and passed down.
- `statementLine` forwards `visitsSinceRenewal` and `cycleFrom` to `decideMonth` explicitly (it passes a
  fixed list today, :59–:65; a missing fact would now throw and fail the Billing page, the org page, the desk
  and month close for any org with a campaign archived inside a renewal window).
- **The renewal probe.** Both paths ask `needsRenewalVisitCount` per month, as the range path already asks
  the floor's question (:319–:330), and probe once when a month asks:
  `CanvassActivity.findOne({ ...fieldVisitMatch(c._id), timestamp: zonedDayRange(from, to, tz) }, { _id: 1 })`
  for 0 or 1, the same existence probe the floor uses (:169–:177). The range path cannot read this from its
  month buckets, because the window is a day range that can cross a month (`zonedDayRange` runs from 00:00 on
  `from` to 00:00 the day after `to`, so both ends are included).
- `statementLine` adds four line fields: `billingRule` (`'calendar' | 'cycle' | null`), `renewalDay`,
  `firstVisitDay` and `archivedDay` (`'YYYY-MM-DD' | null`, campaign-tz days, which the screens and the CSV
  print instead of formatting `firstKnockAt` and `archivedAt` in the viewer's zone or UTC, decisions 14 and
  17). It also fills the line's existing `timeZone` field (Statement.js :52, never filled today). For a cycle
  campaign `billingStartMonth` is the first-visit month.
- `campaignFacts` (:345): `billingStartMonth` becomes `startMonthFor(firstVisitDay, cycleFrom)` (today it
  calls the v3 function at :357, which would show *December 2026* plus a *start grace* chip for a Nov 28 start),
  and it adds `billingRule` and `archivedDay` (`firstVisitDay` is already there, :353).
- `RULES_VERSION = 4`, commented: *v4 (Nov 2026): a campaign first out on or after CYCLE_BILLING_FROM renews
  monthly from that visit; earlier campaigns keep v3.*
- **Customer projections.** `HISTORY_INTERESTING_REASONS` (:417) adds `'archived-before-renewal'` and
  `'renewal-grace'`. `publicMonthHistory` adds `firstVisitDay` and `archivedDay`; `publicUsage` and
  `currentUsage` add `billingRule`, `firstVisitDay` and `archivedDay`. None is money, so the no-`*Cents` walks
  in billing.int are unaffected.

## D. Issued statements, drift, and facts that can move

- [Statement.js](../server/src/models/Statement.js): the line schema adds `billingRule`, `renewalDay`,
  `firstVisitDay` and `archivedDay`, each defaulting to null. Billing reads are `.lean()`, so a legacy frozen
  row comes back with those keys **missing**, not null. Readers treat a missing `billingRule` as calendar when
  the line has a first visit (`billingRule ?? (firstKnockAt ? 'calendar' : null)`), and fall back to today's
  formatting of `firstKnockAt` and `archivedAt` when the day fields are missing. (So a combined CSV spanning
  the deploy can print a legacy row's dates on the UTC day and a new row's on the campaign's day.)
- **`statementDrift` stops reporting `rulesVersion`** (drop :61–:63). The version says how a statement was
  computed, not something that changed; it is already printed on each statement (StatementsTab :29, :417).
  Reported alone it would flag every invoice already sent as changed, and attached to other drift (a setup
  campaign frozen as *not started* that later went out) it would suggest the rule change caused it. Nothing
  reads `drift.rulesVersion` and no test asserts it. A real retroactive rule change still shows, through line
  and total differences.
- The new fields stay out of `LINE_FIELDS`. They are derived from facts that are already compared, and a
  legacy row's missing key against a live null (`undefined !== null`) would be phantom drift on every old line.
- **When the switch can't change a sent invoice.** The switch can only change months from November 2026 on,
  because a campaign first out from November 5 has nothing to bill before November. So every invoice sent
  before the deploy for October or earlier is untouched whenever the deploy lands. November is the one month
  the deploy's timing touches: until the update is live, a campaign first out from November 5 is computed
  under v3, which agrees with the new rules about November except for a first visit in its last week (24th to
  30th), where v3 makes November free and the new rules bill it. Hence §I's gate. Separately, a month issued
  early (`force`) can already change through later activity, under v3 too; nothing new there.
- **Facts that can still move after the fact** (live for months not issued, drift for issued ones): an edit to
  the campaign's time zone shifts its first-visit day by up to a day, and with it the renewal day and, near the
  switch day, the rule; an unknock deleting the first visit; a late offline upload stamped before the first
  visit. Deleting visits never raises a new-rule campaign's total, but can move a charge to a different month.
  Frozen lines keep `timeZone`, `firstVisitDay` and `archivedDay`, so a drifted month explains itself.

## E. The edge: a renewal's three days ending after its month is invoiced

A renewal's 3-day window can end after its month has been issued: for renewals on a month's last three days
(the "month has ended" check runs on UTC, so a US campaign's month can be issued on the evening of its last
local day, and an ordinary issue on the 1st can land inside a 30th or 31st renewal's window), and for any
renewal in a month issued early. An archive inside the window then makes that renewal free after the invoice
went out. It shows as a material change on the organization's page (the Statements tab's *Drifted* badge) and
on the month-close board in its live check
([superAdmin/statements.js](../server/src/routes/superAdmin/statements.js) :58); the desk's *Drifting* chip
([orgDesk.js](../client/src/lib/orgDesk.js) :129) does not see it, because the desk's scan skips issued months
([invoicing.js](../server/src/services/billing/invoicing.js) :136). The account manager voids and reissues.
The issue dialog now warns ahead of time (§F). Holding every month open until the 3rd would change month close
for every organization to cover a rare case (decision 10).

## F. Client

- **Labels.** [invoicing.js](../client/src/lib/invoicing.js) `REASON_LABEL` (:62–:70) adds
  `'archived-before-renewal'`: *Free — archived before its renewal*, and `'renewal-grace'`: *Free — archived
  within 3 days of its renewal, nobody out since*. [BillingPage.jsx](../client/src/pages/BillingPage.jsx)
  `REASON_LABEL` (:21) adds *free — archived before its renewal* and *free — archived within 3 days of its
  renewal*. The CSV's *Reason* column keeps printing the code (statementCsv.js :30).
- **Dates.** Every `'YYYY-MM-DD'` (`firstVisitDay`, `archivedDay`, `renewalDay`, the reminder's dates) renders
  with `formatDateLabel` ([electionDates.js](../client/src/lib/electionDates.js) :25, UTC-safe; pass
  `{ year: 'numeric' }` where the neighbouring dates show a year), never `formatDate`
  ([dates.js](../client/src/lib/dates.js) :8) or BillingPage's `fmtDate`, which read a date-only string as UTC
  midnight and print the day before in US time zones. The CSV prints the ISO day as is. One ordinal helper
  ("1st", "15th", "22nd") goes in [months.js](../client/src/lib/months.js); anchors 29–31 read *renews on the
  31st (or the month's last day)*.
- [CampaignsTab.jsx](../client/src/components/org/CampaignsTab.jsx): *Bills from* (:101, :113, :146–:153)
  reads *December 2026 · renews on the 15th* for a running cycle campaign (`monthLabel` prints the full month
  name) and drops the renewal once archived; the *start grace* chip shows only for calendar rows. *First visit*
  (:143) prints `firstVisitDay` and the archived note (:134) `archivedDay`. The column tooltip covers both
  rules.
- [StatementsTab.jsx](../client/src/components/org/StatementsTab.jsx) line detail: *First visit* (:79)
  prints `firstVisitDay`; a cycle line shows its `renewalDay` beside *Bills from* (:80).
- [statementCsv.js](../client/src/lib/statementCsv.js): *First visit* and *Archived* print `firstVisitDay` and
  `archivedDay` (legacy rows fall back to today's UTC day, :12, :24), and two columns go on LAST so every
  existing column keeps its place: *Billing rule* (*Calendar month* or *Monthly from first visit*; a legacy row
  with a first visit reads *Calendar month*) and *Renewal date*. Title Case, like the headers at :36–:37.
- [BillingPage.jsx](../client/src/pages/BillingPage.jsx): a running cycle campaign reads *billing since Dec 15
  · renews on the 15th* (:232 today formats `firstKnockAt` in the viewer's zone); the archived notes (:89,
  :228) print `archivedDay`; the month history's *Billing started* (:94) prints `firstVisitDay`; the status
  card's sentence (:199, "A campaign starts billing the month of its first field visit…") is rewritten to cover
  both kinds.
- [StatementModals.jsx](../client/src/components/org/modals/StatementModals.jsx): the warning that a renewal
  can still turn free shows (a) inside the existing early-issue box (:94–:95), and (b) whenever a selected
  month has an active cycle line whose `renewalDay` plus two days is today or later in that line's `timeZone`
  (`todayInTz`, [datePresets.js](../client/src/lib/datePresets.js) :18). Today's `open` test (:20) uses the UTC
  month, so an ordinary issue on the 1st shows no warning at all.
- [ArchiveNudge.jsx](../client/src/components/ArchiveNudge.jsx) (:44–:78), still rendered only for org admins
  (CampaignsPage.jsx :367, DashboardPage.jsx :587). Each stale campaign already carries `hasCanvassed` from
  `/admin/campaigns` ([campaignSummaries.js](../server/src/services/reports/campaignSummaries.js) :135, :156):
  false means no activity at all, so the campaign is certainly never out and is worded at once. The reminder
  asks the renewals route only about the rest (at most 50, oldest election day first).
  - **One stale campaign.** Never out (`hasCanvassed` false, or `billingRule` null): *It hasn't been out, so it
    isn't billing. Archive it when you're done.* (info). Calendar: today's wording and tone, unchanged, for
    every admin. Cycle, with dates in the response: *Archive before {next} and it won't renew.* (info), or, with
    `lastRenewalDay`, *It renewed on {last}. Archive by {graceUntil} and, if nobody's been out since, that
    renewal is free.* (warning). Cycle, no dates (any other admin): *Archiving stops the billing — otherwise
    it renews every month, knocks or not.* (info). The dated wording keys on whether the response HAS dates,
    not on `canViewBilling`, because memberships refresh only at sign-in.
  - **Two or more stale campaigns.** Never a date. None out: *None of these has been out, so none is billing.
    Archive them when you're done.* (info). Every campaign that has been out on calendar months: today's
    wording and tone. Otherwise: *Archiving stops the billing — otherwise the ones that have been out keep
    billing every month, knocks or not.* (info).
  - **While the rules load:** the title only. **If the request fails, or more than 50 would be asked about:**
    *Archiving stops any billing.* (info), true in every case.
  - `END_GRACE_DAYS` (:20) and the calendar wording stay as they are.
- **The renewals route: `GET /admin/billing-renewals?ids=…`**, a new file
  `server/src/routes/admin/billingRenewals.js`, mounted at `/admin/billing-renewals` in
  [index.js](../server/src/routes/index.js) with `requireAuth, orgContext, requireOrgRole('admin')` (so a lead
  gets 403 `FORBIDDEN_ROLE`).
  - **A sibling prefix, not a route inside `/admin/billing`,** so that router keeps its rule that everything
    on it is billing-gated (admin/billing.js :67–:68, BILLING.md :772–:774 stay true). The `/admin/billing`
    router never sees `/admin/billing-renewals`.
  - **Dates are gated in the handler** with one shared `hasBillingAccess(req)` (`req.user.isSuperAdmin ||
    req.activeMembership?.billingAccess`), which the billing router's gate (:26–:29) is changed to use too, so
    the two can't drift apart.
  - **Response,** for each requested campaign in the active organization: `{ campaignId, billingRule }` for
    every org admin, and exactly those keys; for billing admins, an active cycle campaign also gets
    `reminderDates(firstVisitDay, today)` with today from `zonedDayStr(new Date(), tz)`. Calendar, never-out
    and archived campaigns get no dates. One `fieldVisitMatch` `findOne` per campaign.
  - **Guards:** 400 without an active organization (as admin/billing.js :46, :79, :97 do); ids must be valid
    ObjectIds (a bad one is a 400, not a CastError 500); at most 50 ids, else 400; ids from another
    organization return nothing.
  - **Why a route rather than `GET /admin/billing`:** that endpoint is billing-gated, so non-billing admins
    couldn't learn the rule, and its usage list holds only campaigns billable this month. No phone screen calls
    either.

## G. Help Center and docs, in the same change

- [BILLING.md](BILLING.md) Part 1: *What Doorline charges* and *The month is a calendar month…* describe the
  two kinds of campaign and the switch day; *"Billing since"…*, *What a customer sees* and *The organization
  page* (:195, *bills from*) gain the renewal date. Part 2: *Models* (:281 "bills through the archive month",
  and the Statement row's line fields), *Billing rules*, *Statement math*, *No periods, no proration, no renewal
  job* (still none: a renewal is computed, not scheduled), *Issuing, voiding, drift* (§D), *Endpoints* (the
  renewals route), *Onboarding & per-admin billing access* (:772–:774: the new route returns rules to every org
  admin and dates only to billing admins), *Client surfaces*, and a *Migration & deploy* entry for
  `CYCLE_BILLING_FROM`.
- [CAMPAIGNS.md](CAMPAIGNS.md) :813–:823: the archive reminder, who sees which wording, and the 3-day rule for
  each kind of campaign.
- [PLATFORM.md](PLATFORM.md) :104 (*bills from*) and :399 (its one-line statement of the rule is already out of
  date; point it at billingMonths.js instead).
- [TIMEZONES.md](TIMEZONES.md) §F: add the billing screens and the CSV to its table of what is shown on the
  campaign's calendar.
- Help Center: [billing.md](../server/src/content/help/guides/billing.md) (*What you pay* :18 and :20, *What
  "per month" means exactly*, *Looking back at previous months*; it names the switch day, and moves with it),
  [page-billing.md](../server/src/content/help/pages/page-billing.md) (*Account status*, *This month*, the
  *Month by month* notes), [can-i-see-previous-months.md](../server/src/content/help/faq/can-i-see-previous-months.md)
  :14 (its reasons a month was free), [bill-restricted-doors.md](../server/src/content/help/faq/bill-restricted-doors.md)
  :42, and [archive-vs-delete-campaign.md](../server/src/content/help/faq/archive-vs-delete-campaign.md) :14
  (audience lead; its billing rules become one neutral line, decision 16, matching
  [loadHelp.js](../server/src/services/help/loadHelp.js) :15–:17 and [ROLES.md](ROLES.md) :35).
- No [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item: nothing here collects, keeps, exposes or
  shares personal data.

## H. Tests

- **The switch day in tests.** Unit tests pass `cycleFrom` to the pure helpers. Integration suites that need a
  campaign on the new rules with a first visit in the past call `setCycleBillingFromForTests` with an early
  day, so they never depend on today's date. Suites with first visits relative to now
  (billingAccess.int :108–:117, restrictDoors.int) set it to `'9999-12-31'` so they keep testing calendar
  months whenever they run, and billingAccess's start-grace comment stays true.
- [billingMonths.test.js](../server/test/billingMonths.test.js): the cycle regime at every boundary. Anchors
  1, 15, 28, 29, 30 and 31 across February (leap and not), 30-day months and December to January; an archive
  the day before, the day of and the day after a renewal; the window's last day and the day after, inside a
  month and across a month end; `visitsSinceRenewal` 0 and 1, and the throw when it's missing; the first month
  billing even with an earlier archive; the switch on `cycleFrom` and the day before; `needsRenewalVisitCount`
  per month, null in the first month; `renewalsAround` and `reminderDates` (a first visit on Nov 30 offers no
  free renewal on Dec 1; a first visit after today gives no dates); `startMonthFor`.
- **Existing unit tests that change, and why.** The no-visit `deepStrictEqual` (:107–:110) gains
  `billingRule` and `renewalDay`. `runMonths` (:89–:98) builds `decideMonth`'s facts field by field and must
  forward `cycleFrom`. The floor case at :262 (first visit 2026-12-31) moves to 2025-12-31 so it stays a v3
  case. Every v3 expectation still holds.
- [statement.int.test.js](../server/test/statement.int.test.js) and
  [statementRange.int.test.js](../server/test/statementRange.int.test.js): the leap-year start-grace fixture
  (statement.int :176, 2028-02-22) moves to 2024-02-22; `rulesVersion` is asserted against `RULES_VERSION`
  (:373); both paths agree month by month for cycle campaigns, including the probe, and a pre-switch campaign's
  lines are unchanged from v3. `currentUsage(orgId, now)` already takes `now`, which the "this month" cases use.
- Drift: a v3-issued statement against a v4 recompute with the same lines reports no drift, and
  `statementDrift` never reports `rulesVersion`.
- [billing.int.test.js](../server/test/billing.int.test.js): the public payloads carry the new fields and
  still no `*Cents` key.
- The renewals route: a lead gets 403; an admin without billing access gets exactly `{ campaignId,
  billingRule }`; a billing admin and a super admin get dates for an active cycle campaign; no dates for an
  archived one; another organization's ids return nothing; a malformed id and 51 ids are 400s.
- Client: [invoicing.test.js](../client/src/lib/invoicing.test.js) (both labels),
  [statementCsv.test.js](../client/src/lib/statementCsv.test.js) (*First visit* and *Archived* on the
  campaign's day, the legacy fallback, two trailing columns),
  [billingRender.smoke.test.js](../client/src/lib/billingRender.smoke.test.js) (*renews on the 15th*, the
  29th–31st wording, none once archived), a CampaignsTab render (a Nov 28 cycle start reads *November 2026*, no
  chip, first visit on the campaign's day), the issue dialog's warning for a closed month with an open window,
  and an ArchiveNudge render for each row of §F's matrix, the several-campaigns cases, loading and error, with
  the clock pinned and the route's response passed in.
- Integration suites run through the runner (`npm --prefix server run test:int -- test/<file>`), never bare
  `node --test`.

## I. Release

- **The switch day is November 5, 2026** (decision 15). Aim to have the update live by then, so no campaign
  on the new rules is ever shown today's wording. **The hard gate is November 24:** until the update lands, a
  campaign first out from November 5 shows today's wording and is computed under it, which agrees with the new
  rules about November unless the first visit is in November's last week (§D). Live before the 24th, nothing
  is billed or shown differently except that wording. If it can't be, move `CYCLE_BILLING_FROM` and the Help
  Center sentence that names it to a day no earlier than the deploy, in the change itself, before deploying.
- One server deploy; the web console and the Help Center ship with it. No OTA or native build, no migration,
  no index, no config var, nothing in the Heroku dashboard beyond the usual deploy.
- The renewals route is a new file that no phone screen calls (`npm run audit:mobile-api -- --list` lists no
  billing route), so `npm run audit:mobile-api` should flag nothing; run it anyway. Nothing is removed or
  renamed, so no client-version bump.
- **After the deploy, one check the owner can do from the screens:** on Close the month, run the live check
  on October; nothing should be newly *Drifted*.

## J. Review rounds

### Round 1 (2026-11-03): three reviewers

Lenses: the rule engine, with a simulation of §B (about 4.6 million month decisions; every anchor 1–31 over
48 months; both statement paths); the billing system (statements, drift, invoicing, gates); and an owner
walkthrough with a claims, cascade and release audit. Every finding was checked against the code.

- **Blockers (2), both fixed.** Admins without billing access had no way to learn a campaign's rule, so their
  reminder couldn't be built. The org page's *Bills from* used the v3 start-grace month for new campaigns
  (`startMonthFor`); all three reviewers found it.
- **Majors, all fixed.** "A month is issued only after it closes" was false (*Issue early*, the UTC check).
  Reusing `'end-grace'` would put false labels on new months (`'renewal-grace'`). The reminder could promise a
  free first month. The several-campaigns, loading and error reminders were unspecified. Dates could print a
  day off. §G missed five places that state the old rules. §H's "every existing case passes unchanged" was
  false, and v3 fixtures dated after the switch would silently test the new rules.
- **Minors folded in:** the probe asked per month; a missing fact throws instead of billing; no `renewalDay`
  on months archived earlier; no *renews* text on archived campaigns; the examples table; time-zone edits,
  late uploads and unknocks documented; §E's reach; the Sep 15 courtesy; missing versus null on legacy rows;
  CSV header style; labels; one ordinal helper.

### Round 2 (2026-11-03): three reviewers, on what v2 added

Lenses: an audit of every round-1 fix plus a simulation of v2's engine (8.5 million month decisions over 3.7
million sub-ranges, both paths, zero differences; 332,169 reminder cases with no false or missed free
renewal); access and an owner pre-mortem, with the real routing middleware run on the repo's Express 4.22.1;
and document consistency, simplicity and a release rehearsal. Every finding was checked against the code.

- **No blockers.**
- **Majors, all fixed or put to the owner.** The switch day: "never earlier than the deploy" contradicted
  setting the date at hand-over, which the owner's routine can't correct (two reviewers); now decision 15,
  December 1, waiting for the owner. Archive dates still printed in UTC or the viewer's zone beside the new
  renewal dates (decision 17, `archivedDay`). The reminder said "billing" for never-out campaigns in the
  several-campaigns, loading and error cases (now worded from `hasCanvassed`).
- **Minors folded in:** the route moved to a sibling prefix with one shared `hasBillingAccess`, so the billing
  router's rule stays true; the 29th–31st wording; the issue dialog's warning for ordinary issues on the 1st;
  the lead-readable FAQ (decision 16); `renewalsAround` defined so the first renewal can't be offered as free,
  and no dates for a future-stamped first visit; `statementLine` forwarding its new facts; tests freed from the
  real clock (one test seam, pinned clocks); the Campaigns tab's first-visit date, the history's *Billing
  started*, and two more docs (PLATFORM.md :399, TIMEZONES.md §F).
- **Simplicity cuts taken:** no `renewsOnDay` field (derived from `firstVisitDay`); the range path asks per
  month instead of a second predicate; the customer projections trimmed to what the pages read.
- **Considered and not taken:** dropping the injectable switch day (route and "this month" tests need a
  campaign on the new rules with a past first visit before December 2026 exists).

## K. As built (2026-11-03)

Built the same day to PLAN v4. Uncommitted and not deployed at the time of writing.

**Where the build differs from the plan:**

- **The test seam refuses only in production** (`NODE_ENV === 'production'`), not "outside
  NODE_ENV=test": the integration runner never sets `NODE_ENV=test`, so the plan's guard would have
  blocked every suite. Nothing outside tests calls it.
- **A missing switch day defaults to the live one** in `billingRuleFor`, `startMonthFor`, `decideMonth`,
  `needsStartMonthVisitCount` and `needsRenewalVisitCount`. Both statement builds and the renewals route
  still read it once and pass the same value everywhere, so the "is the visit fact needed?" check and the
  decision can't disagree.
- **`restrictDoors.int` is not pinned to calendar months:** its one billing assertion is about a
  campaign that never went out, which no rule changes. **`billing.int` is unchanged:** its walk for any
  `*Cents` key now runs over the new fields; `billingAccess.int` checks the new usage fields over HTTP,
  and `statementRange.int` the history fields.
- **The shared billing-access check** is `hasBillingAccess` / `requireBillingAccess` in a new
  `server/src/middleware/billingAccess.js`.
- **`GET /admin/billing` also returns `cycleBillingFrom`,** so the Billing page names the switch day
  without a copy of the constant in the web client. The org page's *Bills from* tooltip doesn't name it.
- **The renewals route** answers `{ campaigns: [...] }` and also leaves out campaigns being deleted.
- **The reminder (ArchiveNudge):** a campaign missing from the answer reads like a failed request (the
  always-true line); a failed background refetch keeps the last good answer; the answer's dates are
  re-checked against today on the campaign's calendar before they are shown, so a page left open
  overnight never promises a window that has closed, and the query refetches when the tab regains
  focus (the app turns that off globally). With several campaigns the names show while the rules load
  (they identify the campaigns; they say nothing about billing). Rewritten as an arrow component.
- **The issue dialog's warning** (wording chosen in the build) uses one check for closed and open
  months: a running campaign's renewal that is still ahead (a month issued early) or inside its 3 days,
  in the campaign's zone — never a campaign's first month, which always bills. The early-issue box keeps
  its old text.
- **Dates print with the year** on the Billing page (*billing since Dec 15, 2026*), through
  `campaignDayLabel` in `client/src/lib/months.js`, which also holds `addDays`, `renewalGraceEnd`,
  `ordinal`, `renewsOnLabel` and `lineBillingRule`.
- **Render tests are a new file**, `billingCyclesRender.smoke.test.js`. The Billing page's month history
  renders folded (a month opens on click), so its free-renewal labels are checked by reading, not by
  render.

**Code review of the build (three reviewers: server, web, docs and Help Center against the code).**
Server: no blockers or majors; a simulation of 2.18 million month decisions, 109,072 reminder cases and
79,008 time-zone boundary checks found no mismatch. Web: one major, fixed — the issue dialog warned that
a campaign's first month could still turn free (it always bills); and three minors, fixed (open months'
renewals, stale reminder dates, a failed refetch dropping a good answer). Docs: the customer guide's
"two months" example used this fall's dates, which bill three under the calendar rules it would have
contradicted (now December 15 to February 3); "within 3 days" read as one day too many (now "on a renewal
day or in the two days after it"); the switch-day pointers missed `page-billing.md`; "you get one bill a
month" overstated (an account manager can invoice several months together); nine technical-doc
corrections. All fixed.

**Files.** Server: `services/billing/billingMonths.js`, `services/billing/statement.js`,
`services/billing/statementDrift.js`, `models/Statement.js`, `routes/admin/billing.js`,
`routes/admin/billingRenewals.js` (new), `middleware/billingAccess.js` (new), `routes/index.js`. Web:
`components/ArchiveNudge.jsx`, `pages/BillingPage.jsx`, `components/org/CampaignsTab.jsx`,
`components/org/StatementsTab.jsx`, `components/org/modals/StatementModals.jsx`, `lib/statementCsv.js`,
`lib/months.js`, `lib/invoicing.js`. Tests: `billingMonths.test.js` (16 new, 41 in all),
`statement.int.test.js` (5 new), `statementRange.int.test.js` (4 new), new `billingRenewals.int.test.js`
(6), `billingAccess.int.test.js` (pinned, 3 assertions); web: new `billingCyclesRender.smoke.test.js` (7),
`months.test.js` (5), `invoicing.test.js` (1), `statementCsv.test.js` (1). Docs: BILLING.md (both parts),
CAMPAIGNS.md, PLATFORM.md, TIMEZONES.md, the README row; Help Center: `guides/billing.md`,
`pages/page-billing.md`, `faq/can-i-see-previous-months.md`, `faq/bill-restricted-doors.md`,
`faq/archive-vs-delete-campaign.md`.

**Verified:** the server unit suite (no failures), every billing integration suite through the runner,
the whole web suite (1,260), a production web build, and `npm run audit:mobile-api` (only the two
billing routers flagged, which no phone screen calls).
