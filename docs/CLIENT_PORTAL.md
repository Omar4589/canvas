# Client reports & shareable links

How you send a client the report you used to put together by hand: headline numbers, a voter-contact
breakdown, survey and support breakdowns, your written observations, and a map of where the team has
been. You build a report for a period, check the preview, and publish it. Your client opens a link,
types the password you gave them, and reads every report you've put up for that campaign, newest
first, with no account to create; a link can also open just one report, for someone who should see
only that one. **A published report is frozen: its numbers change only when you press Refresh
numbers, and the report then says so.**

- **Part 1 — For everyone** is plain language: what your client sees, building and publishing a
  report, changing one after it's published, team reports, the area view, client links, branding and
  History.
- **Part 2 — Technical reference** is for developers (and Claude): the models, the snapshot build on
  the worker and its state machine, the visibility rules, series and team reports, the share-link
  security model, opens, branding, History, the endpoints and error codes, and the migration and
  deploy steps.

Related: [PROPOSAL_CLIENT_REPORTS_UPGRADE.md](PROPOSAL_CLIENT_REPORTS_UPGRADE.md) (the October 2026
upgrade: audit, owner rulings, review log, and its "As built" section),
[PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md](PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md) (the follow-up built
2026-10-25: the page's guide, your organization's report week, links to one report, no accidental
doubles), [METRICS.md](METRICS.md) (how
every number is counted), [SURVEYS.md](SURVEYS.md) (where the survey and support breakdowns come from,
follow-up questions, tags), [MAPS.md](MAPS.md) (the shared map rendering), [EFFORTS.md](EFFORTS.md)
(walk lists), [USERS.md](USERS.md) and [ROLES.md](ROLES.md) (crews, coordinators and team leads),
[TIMEZONES.md](TIMEZONES.md) (how a report's days are anchored), [OPERATIONS.md](OPERATIONS.md) (the
build queue, the nightly sweep, the migration), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
(D11; item 34, the audit's findings, closed in code; item 38, what this upgrade stores, shows and
keeps), [PROPOSAL_NOT_TARGET_OUTCOME.md](PROPOSAL_NOT_TARGET_OUTCOME.md)
(the breakdown's conditional Not a target voter row).

---

# Part 1 — For everyone

## What your client sees

You send your client two things, separately: a link like `https://doorline.app/r/<token>` and its
password. Anyone you give both to (the candidate, a consultant, the campaign manager) can open it.
There is no account to create. A link opens **all your reports** for the campaign (the usual kind:
next week's report shows up on it too) or **just one report** (for someone who should see only that
one, like a donor or a board member); each link has its own password.

**The password screen** says only "A report has been shared with you" until the password is right.
It doesn't show the campaign, your organization or the link's label. Under the password box is
**Keep me signed in on this device**: ticked, that browser stays signed in for up to 30 days (some
phones clear it sooner); unticked, only until the tab closes. Once signed in, every page has
**Sign out on this device** (just **Sign out** on a phone's narrow screen).

**The report hub** comes next: your organization's logo at the top if you've added one, the campaign
and organization names, and the reports. When the campaign has more than one kind of report, tabs
separate them: **Whole campaign**, each team, and each walk list (a dropdown on a phone). Each tab
shows its latest report with its headline numbers, a small chart of the doors knocked in each report,
and every report newest first. With nothing up, it says "No reports are available on this link right
now."

**A link to just one report** skips the hub: it opens straight on its report, with no list of other
reports, no "‹ All reports" and no Older or Newer, and the heading says "This link opens this report
only." Back leaves the page rather than landing on a list, and the browser tab reads "{Campaign} ·
Report" (a link to all your reports keeps "· Reports"). If that report is taken down, the link says
"This report was taken down or removed. Ask the person who sent it." (with no "see all reports"); put
back up, it works again. If the report is deleted, its one-report links are deleted with it, so the
link then says "This link isn't available. It may have been replaced or switched off — ask the person
who sent it."

**A report** reads top to bottom as a document:

- **Activity at a glance**: the headline cards (Doors knocked, Surveys taken, Voters surveyed and
  Connection rate; on a lit-drop campaign, Doors knocked, Lit dropped and Homes knocked). The big
  number is the running total. The pill under it is the report's own period: "+412 this week" on a
  seven-day report, "+812 in these 14 days" on a two-week one, "that day" on a one-day one. A period
  with no new doors says so plainly above the cards. The weekly figures don't add up to the running
  total (a door knocked twice in one pass across two weeks appears in both weeks), and each card's
  "(i)" says so. The cards sit two across, and four across only when the report itself is wide enough
  (a wide screen, with the report at least 720 px wide), so the builder's narrower preview shows two
  and no card's "(i)" is cut off.
- **Door goal** (only if you ticked it): progress toward the campaign's door target, *3,412 of 10,000
  doors · 34%*, measured as of the end of the report's period, not today. **Progress only**: never a
  pace, an "on track" verdict or a projected finish date. Those are live management numbers; frozen
  onto a document a client reads weeks later, they would keep asserting something that had stopped
  being true.
- **Voter contact breakdown**: every door knocked lands in exactly one outcome (surveyed, *declined
  to participate*, *didn't answer*, *no-soliciting sign*, wrong address, lit dropped), so the bar adds
  up to Doors knocked. **Declined to participate** is a door where someone answered but wouldn't take
  the survey: a real contact, not a survey. A campaign that uses the **Not a target voter** door
  button (off until an org admin turns it on) also gets a **Not a target voter** row right after it,
  explained as "Doors where someone answered, but it wasn't one of the voters on our list for that
  address and they didn't share their details. We reached a person there, just not a voter we could
  survey." That row appears only when the report has at least one such door, so a low connection
  rate has a visible reason without changing any report that never used the button.
- **Support breakdown**: the question you made the headline, emphasized. Its subtitle counts that
  question's own answers ("1,394 answers", or "selections" on a pick-several question).
- **Voter groups**: the survey tags you ticked, one row each: *Supporter — 400 identified · 380 still
  current*. These count people, once each, and deliberately show no percentages (the groups overlap).
- **Survey breakdowns**: option counts and percentages for the questions you chose to show. Each
  question's percentages total exactly 100% (see [SURVEYS.md](SURVEYS.md)).
- **Canvasser observations**: your written sections (*Voter Intent*, *Opponent Activity*, …).
- **Where we've been**: the map (below).

The heading names the period, the scope ("Team: Paid team", "Walk list: North") and the dates the
report was published and last changed ("Published Oct 20 · Edited Oct 21", "Numbers refreshed Oct
28"), always as dates, never times. Three notes appear only when they apply:

- "**Numbers as of Oct 24 — the period was still running.**" when the numbers were taken before the
  period ended.
- "**Earlier totals were updated by −120 doors since the Oct 13 – Oct 19 report.**" when the totals of
  the previous report in the same tab changed after it was sent: a knock that arrived late, an answer
  edited or unknocked, a canvasser moved between teams. It names the cards that moved and never says
  why. If you later refresh that earlier report's numbers (or switch its map to areas), the line
  disappears, since the two no longer compare like for like, until this report's numbers are built
  again. On a link to just this report, which names no other report, the same counts read "**Totals
  from before Oct 19 were updated by −120 doors after they were first reported.**" (Oct 19 being this
  report's first day), on the page and in the PDF.
- "**A home both teams visited counts in each team's report.**" on a team report.

**Older** and **Newer** step through the reports in the same tab, in the hub's order (two reports
that start the same day each point to the other), and **Download PDF** saves the report as a PDF: your
logo at the top, the same notes, Doorline's red for Doors knocked, the door-goal bar and any bar without
its own colour, "Powered by Doorline" at the foot, and no map. Long names and headings
wrap onto the next line.

### The map

Pins colored by how each door went, showing only the doors we reached (an unknocked door never
appears) and **no canvasser names or locations**. Your client can filter by status and by the survey
questions you put on the map, and "N of M doors" counts exactly. On a phone the map runs full width,
pans with two fingers so the page still scrolls, keeps its filters in a drawer, and shows a tapped
door's details below it, with the questions in their real wording. A door's street address is fetched
only when it is tapped. A spot holding several doors (an apartment building, or homes sharing one map
spot) shows a tally of their results and then each door's result and answers, never an apartment
number. A tap that catches several neighbouring spots at once (easy when the map is zoomed out) lists
them as "12 doors near here — zoom in to pick one", rather than calling them one building.

The map keeps up with the report: when the page reads the report again (coming back to the tab, or
opening it again after a minute) and its numbers were refreshed, its map switched between doors and
areas, or a map question was added or taken off, the map reloads with it, and a filter that no longer
exists is cleared.

**From the keyboard**, with no mouse or finger: Tab to the map, move it with the arrow keys and zoom
with + and −. While the map has keyboard focus (not after a click), a red ring marks its centre.
**Enter** opens the door or doors inside the ring (several spots read "doors near here", as a tap
does) or, on an area report, the area under it; **Escape** closes the open card, from the map or from
inside the card, and puts the focus back on the map. A screen reader hears how: "Use the arrow keys to
move the map, and plus or minus to zoom. Press Enter to show the doors at the centre of the map, and
Escape to close them." (on an area report, "…the area at the centre of the map, and Escape to close
it."), then what happened: "Showing 3 doors at the centre of the map. Press Escape to close.",
"Showing the area at the centre of the map: 64 doors reached. Press Escape to close it.", "No doors at
the centre of the map. Move the map with the arrow keys, then press Enter.", or "Closed." The same
works in the builder's preview.

A **Not a target voter** filter is offered only when a door on that report's map shows that outcome.
The map shows each door once, as it stood at the end of the report's period, while the breakdown
counts the door's result in every round. So a door marked Not a target voter in an earlier round and
knocked again since shows its newer result on the map, and a report can show the breakdown row
without the filter.

### Area view

You can give any report an **area view** instead of exact doors (see *Exact doors or areas* below).
Your client then sees shaded hexagons, fixed in size, each with how many doors were reached there and
how they went. The hexagons are see-through, so the streets show under them, and each legend swatch is
the colour exactly as it looks on the map, over that map style's ground. **Area view never shows an
address.** A single-choice question shows its answers area
by area only when every area has at least five answers to it; otherwise that report shows only the
question's overall chart, and its areas read "No answers to show". How each door went shows for every
area, even one with a single home. Two things are worth knowing: where every home that answered in an
area gave the same answer, that tells you how each of them answered; and other reports on a link to
all your reports (other weeks, teams or walk lists, or an exact-doors report) can narrow things down.
A link to just one report shows only that report, but one person can hold more than one link, so
*Before you publish* still names every shown report that could.

### When something has changed

The page says what happened instead of going blank or claiming nothing was published:

| What happened | What your client reads |
|---|---|
| You changed the password | The password screen again: "This link needs its password. If it no longer works, ask the person who sent it — it may have changed." |
| You rotated, renewed, disabled or deleted the link (on its old address) | "This link isn't available. It may have been replaced or switched off — ask the person who sent it." |
| The link expired | "This report link has expired. Ask your campaign contact for a new one." |
| 50 wrong passwords in a day | "This link is locked after too many wrong passwords. Try again later, or ask the person who sent it." |
| Too many tries from one connection | "Too many tries from this connection — wait 15 minutes." |
| You took the report down, or deleted it | "This report was taken down or removed", with a way back to all reports. Your client stays signed in. |
| The same, on a link to just that report | "This report was taken down or removed. Ask the person who sent it." No way to other reports; put back up, it opens again. Deleting the report deletes its one-report links, so they then read "This link isn't available…". |
| The report's map changed while the page was open, and a door was tapped before the page read the report again | "This report was just updated — reload." |

If your organization's access to Doorline is suspended or canceled, every link stops opening ("This
report is no longer available"); see [BILLING.md](BILLING.md).

## Building a report

**The page says what it's for.** Under the **Client Reports** title, one line: "Make reports for your
client here. Each one shows the campaign's running totals and what was added in the dates you pick.
Share it with a link and its password, or download a PDF." It ends in **How it works**. The first time
you open the page, a short guide, **How client reports work**, sits at the top of the reports list (on
a page with no reports, where "No reports yet" would be):

1. **Make a report** — press New report and pick the dates, usually Last week. After that, Next report
   on your newest report makes the following one in one click, with your settings and notes copied.
2. **Check it, then publish** — the preview is exactly what your client will see. Once it's
   published, its numbers stay as they are until you press Refresh numbers.
3. **Share it** — Share gives you a message with the link to paste into your email or text; send the
   link's password separately. Or open the report and press Download PDF.

On a phone the steps are shorter: "Make a report — usually Last week; then Next report each week.",
"Check the preview, then publish.", "Share the link; send its password separately." **More in the
Help Center →** (not on a phone) opens the Help Center's client-reports guide. **Got it** hides the
guide for you, in this browser (a private window shows it again), and puts the keyboard on **How it
works**, which brings it back.

Open the campaign, go to its **Client Reports** tab, and press **New report**:

- **Covers:** **Whole campaign**, or **A team** (pick one, or make one with **+ New team**; see *Team
  reports*), and optionally **Only one walk list**. A walk list's name appears on your client's report,
  so name walk lists accordingly.
- **Dates:** a list of choices, each with its dates written out, the first one picked. Report dates
  follow **your organization's report week**, Monday to Sunday unless an admin changes it (below).
  - **The first choice is what comes after the tab's last report.** A report that ran **whole weeks**
    (7, 14, … days) is followed by the next run of the same length, on the same weekday: "Last week ·
    Oct 19 – Oct 25 — the week after your last report", "Oct 25 – Oct 31 — the week after your last
    report" (a tab whose weeks run Sunday to Saturday carries on that way), "Oct 26 – Nov 8 · 2 weeks —
    the two weeks after your last report". **Whole calendar months** are followed by the same number of
    months: "November — the month after your last report", "October – December — the three months
    after your last report". A report of **any other length** is followed by a **catch-up** from the
    day after it to the end of last week (or to the end of this week, when your last report already
    reaches into it): "Oct 14 – Oct 25 · 12 days — from the day after your last report to the end of
    last week, so your next report covers a full Monday – Sunday week." The report after a catch-up is
    a normal week, and so is the one after an odd-length report that ended on the last day of a report
    week. This is what ends the "Oct 14 – Oct 26" reports, which came from each new report copying the
    length of the one before.
  - **With no report in the tab yet**, the first choice is **Last week** — or **This week, not over
    yet** for a campaign whose first doors were knocked this week, so its first report isn't an empty
    week.
  - **After a long gap** (you've missed at least one whole week, run of weeks or month after the one
    that comes next), the first choice is the most recent complete one on the tab's own rhythm,
    without "after your last report", and a line under it names the days no report covers: "No report
    covers Oct 12 – Oct 18." A catch-up that would run past two weeks is replaced by **Last week** the
    same way.
  - Then **Last week · Oct 19 – Oct 25** (unless it's already first), **This week, not over yet · Oct
    26 – Nov 1 — refresh it once the week ends** (unless it's already first), and **Pick dates**, any
    first and last day. Dates in another year carry the year. Under the picked choice (or the Pick
    dates boxes), a note when it applies: "This period isn't over yet — you can build it now and
    refresh it later." for dates that run past today (This week's own label already says so), or
    "Starts Oct 26 — its numbers stay empty until then." for dates that haven't begun; such a report
    opens with the builder's "This period hasn't started yet." note.
  - **The dates are read fresh every time New report opens**, so a page left open overnight, or one
    opened before an admin changed the organization's week, never suggests yesterday's dates: the
    choices say "Loading the dates…" until they arrive (Create waits), "Couldn't load the dates." with
    **Try again** if they can't be read, and they are read again if the dialog is still open when the
    campaign's day ends.
- **The report week** is under the date choices. Admins read "Report weeks run Monday – Sunday for your
  organization. **Change**", which opens a small panel right there ("Report weeks run [Monday – Sunday
  ▾]", "This sets the dates new reports suggest, for every campaign in your organization. Reports
  you've already made keep their dates.", **Save** or **Cancel**); leads read "Report weeks run Monday
  – Sunday for your organization (set by an admin)." It is only the *report* week: other pages' This
  week and Last week filters still run Monday to Sunday.
- **When a tab's weeks run on another weekday** (most tabs made before this started on whatever day
  their first report was made), New report says so: "Your last Whole campaign report ran Wednesday –
  Tuesday. Your organization's report weeks run Monday – Sunday." **Move this tab to Monday – Sunday
  weeks** adds and picks a short catch-up first (for example "Oct 21 – Oct 25 · 5 days — …"), after
  which the tab's reports run Monday to Sunday; admins also get **Use Wednesday – Tuesday weeks for the
  whole organization**, and leads read "Ask an admin to change the organization's week, or pick
  dates."
- **Title** (optional; the box shows the picked dates until you type one).

**Create draft** starts the numbers building in the background ("Building the first numbers…"). You
can leave the page; the build keeps going on Doorline's worker and the report's row shows its state:
**Queued (2 ahead)**, **Waiting**, **Building 40%**, **Stalled** or **Failed** (each with **Retry**),
and, on team reports, **Team changed** (see below). **Cancel** stops a build that is queued, waiting
or running.

**No accidental doubles.** If the tab already has a report for exactly those dates, New report asks
before making another: "You already have a draft Whole campaign report for Oct 19 – Oct 25." with
**Open the draft** or **Make a second one**; for a published one, "You already published a Whole
campaign report for Oct 19 – Oct 25. To bring its numbers up to date, open it and press Refresh
numbers." with **Open it** or **Make a second one**; for one that's taken down, "You already published
a Whole campaign report for Oct 19 – Oct 25, taken down." Under the buttons: "Your client sees both
once both are published." (for a taken-down one, "Your client sees only the new one; the taken-down
one stays hidden unless you put it back up."). **Make a second one** makes exactly what you pressed
Create draft for: the same tab, dates and title. Typing a title or your own dates while the question is
up takes it away, as picking another date choice does — press **Create draft** again with what's on
screen. If two people press **Create draft** for the same tab
and dates at the same moment, one draft is made and the other person reads "Ada Lovelace made the
Whole campaign report for Oct 19 – Oct 25 a moment ago — you're both in it." ("Someone else made …"
when the name isn't known; the tab named is the report's own) with **Open it**; when that draft is
your own (a second tab, a double click), it simply opens. The form is locked while Create draft is on
its way, and stays locked under the race note; the dates a message names never move on by themselves.
These messages, like anything else Create draft answers (a walk list named like a canvasser, a team
that has ended, an error), appear right under the dates, scrolled into view, with the keyboard on
their first button or box (on **Open it** for the race note, on the message itself for an error).

If someone is editing answers, unknocking, converting surveys or re-cutting a round on the campaign,
the build **waits** for them ("Waiting for the answer edit on this campaign to finish") and carries on
once they're done. After 30 minutes of waiting it stops and says why; an open **One person at a time**
answer edit counts as running until someone presses Stop on Door Outcomes. A change that finishes
while the numbers are building makes the build start again once, by itself. Knocks the phones send
while it builds aren't counted, and the builder says so: "3 knocks arrived while these numbers were
being built — Recompute to include them."

**The builder.** The left side holds the settings; the right side is the **Preview, exactly what your
client sees**, drawn from what's on screen. A draft saves itself about a second after you stop
typing. The header shows **Numbers as of 9:14 AM** and **Recompute**, which builds the numbers again
from today's records. Opening a report shows a moment's placeholder until a fresh copy arrives, so the
screen always matches what's saved, including a change you made just before leaving.

- **Title** and **Canvasser observations**: sections with a heading and a paragraph each (a section
  without a heading isn't saved).
- **Survey questions**: one row per question, with **Chart**, **Map** and **Headline**. **Show: All ·
  None**, and *None really means none*. A question whose chart you don't show can't go on the map or be
  the headline.
- **Follow-up questions** can only go on the map together with the question they depend on. If
  "Could we put a yard sign up?" is asked only after a Yes to "Back the recall?", showing the yard-sign
  answers on the map shows exactly which homes said Yes to the recall, even with "Back the recall?"
  hidden. So the builder keeps it off the map unless "Back the recall?" is on the map too, and says
  why: "Asked only on some paths through 'Back the recall?' — mapping it shows who took that path."
  Usually the right call is to leave the follow-up off the map. Its chart stays your choice, and
  *Before you publish* warns when a shown follow-up chart hints at a hidden question. A question asked
  only after a written answer can never go on the map.
- **Voter groups**: hidden until you tick them, so an internal tag like "Hostile" can never reach a
  client's page by accident, and a tag you create next month won't appear on its own.
- **Door goal**: **Show door-goal progress to the client**, off by default (anyone with the link can
  read it). It can't be shown on a walk-list or team report: goals are campaign-wide, and measuring
  part of the campaign against the whole target would undersell you badly. If you set the campaign's
  goal after this report's numbers were built, the builder says so: "Your door goal was set after
  these numbers were built. Recompute them to show it" (on a published report, **Refresh numbers**).
- **Map**: **Show the map**, then **Exact doors** or **Areas** (**Small**, about 1,100–1,400 ft
  across, or **Large**, about 0.55–0.7 mi across). Exact doors show your client each home's street
  address and result; areas never show an address.

A map change after the numbers were built (the map turned on, a new map question, switching between
exact doors and areas, a new area size) needs a **Recompute** before you can publish; the builder says
"Map preview is from 9:14 AM, before your map changes — Recompute". Taking something *off* the map
never needs one.

**Before you publish** collects what's worth a look before a report goes out. Nothing here blocks
publishing:

- unreviewed mock-GPS flags in this report's numbers, with **Review** (they count only the report's
  own walk list or team);
- knocks that arrived during the build, or numbers more than an hour old, with **Recompute**;
- a period that isn't over yet;
- a shown follow-up chart whose parent question is hidden ("its total shows how many took that
  path"), or a shown voter group that counts answers to a hidden question;
- on an area report, a question that shows no answers by area ("Large areas usually fix it" — said
  only when the numbers were built in small areas), and other reports on the same link that could
  narrow down what its areas keep hidden;
- answers given under an earlier version of your survey, from before Doorline kept a record of its
  follow-up questions, when a chart is hidden and the map is on: "If a map question used to be a
  follow-up of a question you hide, its answers could hint at the hidden one — check your map
  questions";
- no link your client could open, and the fix ("No link yet — after you publish, Share makes one.",
  "Your only link expired — renew it.", …);
- notes copied by **Next report** that you haven't reviewed, with **I've reviewed the copied notes**
  (the reminder pointing here shows on drafts only — Publish warns about unreviewed notes, and once
  a report is out there's nothing left to tick);
- an earlier report whose totals changed since you sent it: what it sent, what it reads now, and why
  ("records changed after it was sent", or on a team report "the team's crews changed" or "canvassers
  changed teams"); your client's report carries only the one neutral line. If that earlier report's
  numbers were refreshed after these were built, it says the line is hidden instead, with
  **Recompute** to compare again;
- on a team report, **Door visits this period**: a row for each team ("Paid team (this report)" first,
  matching this report's own period doors, then the others, and "Together" when there are two or
  more), then "1,204 door visits in the whole campaign this period" (or the walk list), how many of
  those more than one team made (counted in each team's report), and how many no team made
  (canvassers with no crew in a team, or doors entered in bulk); and how many canvassers knocked for
  this team (with a warning when it's one: the report then shows one person's work);
- how many of the surveys behind the numbers an admin **edited** after they were recorded, or
  **entered on Door Outcomes** instead of a canvasser collecting them at a door. Both count like any
  other answer.

None of this reaches your client.

**Worth a look**, on a published report. Before you publish is for drafts; once a report is out, a
short **Worth a look** box keeps the three checks that can still matter, and only when they apply:

- on an area report, a map question that shows no answers by area (after a Refresh or a switch to
  areas too): "“Yard sign?” shows no answers by area: some area has fewer than five answers to it, so
  your client sees only its overall chart. Large areas (with Refresh numbers) usually fix it." (on a
  report already in large areas the sentence ends at "…only its overall chart.");
- answers from survey versions older than Doorline's record of follow-up questions, in the same words
  as above;
- an earlier report refreshed after these numbers were built: "The Oct 13 – Oct 19 report's numbers
  were refreshed after these were built, so this report's “earlier totals” line is hidden. Refresh
  numbers to compare again.", with **Refresh numbers**.

## Publishing

**Publish…** opens a confirm that repeats what matters (a period not over, numbers over an hour old
with **Recompute first**, knocks that arrived during the build, mock-GPS flags, copied notes), then
"Your client sees exactly the preview" and which links will show it: "It shows on 2 links: Candidate,
Consultant", or why none can. Only links that can open this report count: every link to all your
reports, and this report's own one-report links (a link to another report never does). With none
that works, a link that could open this report decides the words, since each names a fix: "Your only
link expired — renew it.", "Every link is locked — unlock or rotate one.", "Your only link is
disabled — enable it." and so on. Only when no link of any kind opens this report: "No link opens
this report yet. After you publish, Share makes one." if the campaign has links to other single
reports, or "No link yet — after you publish, Share makes one." if it has no link at all (the confirm
offers nothing to make a link with; **Share** does, once the report is up). The same line shows in
*Before you publish*, and on a published report's row, where the other-reports case reads "No link
opens this report — your links open other reports. Share makes one." and no link at all reads "No
link yet — create one."

**Publishing is instant and freezes exactly what your screen shows.** Pressing **Publish…** while
you're still typing waits until your last change is saved. If a recompute is still queued or running,
the confirm says so, and publishing the numbers you looked at cancels it. If the report changed
somewhere else since your screen last read it, nothing is published; the page and the preview update
and say why: "This report changed since the preview — it now shows the latest version. Look it over,
then publish", or "Your numbers were just rebuilt — the preview now shows them. Look it over, then
publish." Press Publish again once you've looked; no reload needed. If your settings add to what the
numbers were built with (see the map change above, or a team whose crews changed), it asks for a
recompute first.

**When someone else works on the same report.** Every save says which version of the report your
screen was built on. If the report changed somewhere else since (another editor's save, an earlier
text restored from History, new numbers applied, a switch to areas finishing), the save is refused, so
nothing of yours overwrites theirs, and the builder merges the two and sends only what is still
yours. It does the same each time it reads the report again (coming back to the tab, after a save):

- with nothing of yours unsaved, the screen simply updates: "Picked up changes made elsewhere. The title
  changed. This screen now shows the latest saved version";
- with your own unsaved changes in other places, both are kept, and only your changes are sent again:
  "…The observations changed there; your changes are kept on top". If one of yours couldn't survive
  the merge, the notice says which instead of claiming everything was kept: "…your changes are kept on
  top, except that "Yard sign?" came off the map — it can go there only with the question it follows"
  (or "…its chart was hidden there", or "your new order of the sections couldn't be kept"), and the
  question table notes it under that question ("Taken off the map — its chart was hidden somewhere
  else.");
- your own switch to areas finishing while you edit isn't news from elsewhere: "Your switch to areas is
  ready. Your edit is still open, as you left it.";
- when you both changed the same thing, a yellow banner names only that and asks you to choose: "This
  report was changed somewhere else while you were editing. You both changed the title, and nothing
  more is saved until you choose: **Keep mine** (it replaces their title "Week 3 final") or **Use
  theirs**. Anything else either of you changed is kept." (In an open edit of a published report,
  nothing is sent until you press Update anyway, so the banner leaves out "and nothing more is saved
  until you choose".) Until then the settings are read-only,
  Publish… and Update are off, and leaving a draft asks first: "This report was changed somewhere
  else while you were editing, so your change isn't saved yet. Leave anyway? It stays on this device —
  you can restore it when you come back." (Leaving an open edit of a published report asks "Leave
  without updating the report? Your edit stays on this device — you can restore it when you come
  back.")

What counts as "the same thing": the title, the headline question, the door goal tick, the map turned
on or off, the map view (exact doors, small or large areas), the copied-notes tick, and an observation
section. **Lists of choices never clash**: which charts, map questions and voter groups show are merged
one by one, so a chart someone else hid stays hidden unless you tick that very chart again, and a
question you ticked is added to theirs. **Observation sections** are matched by their content (a section
moved is still the same section; one whose text was edited keeps its heading; one renamed keeps its
text): a section either of you added is kept (when you both add one in the same place, yours comes
first), one you deleted that they didn't touch goes, and only a section you both changed, or one of you
deleted while the other edited it, is asked about. Keep mine then says exactly what it replaces:
"their version of "North side"", "their deletion of "North side" (yours comes back)", or "their edited
"North side" (it stays deleted)".

If someone publishes the draft you're editing, your change is never sent to the published report. It
is merged the same way and opens as an unsent edit, kept on this device: "Someone published this
report while you were editing. Your change hasn't gone to the client — review it, then press Update
to send it." With nothing unsaved, the page just says "Published elsewhere". New numbers that someone
else already applied or discarded say so too, and a report deleted elsewhere reads "Report not found —
It may have been deleted." If you switch campaigns in the sidebar while a report is open, you land on
that campaign's Client Reports list.

**Leaving the page.** A change you type in the second before you leave is still sent on the way out,
and a copy is kept on this device first. If that last send doesn't land (someone changed the report
in that same moment, or published it), it comes back the next time you open the report: on a draft,
"A change you made didn't save before you left. From 9:14 AM, kept on this device. Restore it or
discard it." (Restore waits while a change is saving); on a report published meanwhile, as an unsent
edit with **Restore your unsent edit** (see *Changing a published report*). Restoring merges it with
whatever the report holds by then, as above. A copy whose change did land is deleted as soon as the
server confirms it, so a later change by someone else is never offered back to you as yours. One limit remains: closing the tab, or going Back
out of Doorline, with a change still waiting to save only makes the browser ask first; it doesn't save
it.

Once it's up, the builder says "Published. Your client can see it now." with **Copy the message for
your client**. When no link can open this report yet, it says "Published — create a link so your
client can open it." instead, with **Share**.

**Share** is on every report your client can see: on its row, and in the builder's header (not on a
draft or a taken-down report, and not while an edit is open: "Finish or cancel the edit first.").
Its title names the report ("Share "Oct 19 – Oct 25 · Whole campaign""), and it says "Paste the
message into your own email or text. It never includes the password — send that separately." It
waits for your links list ("Loading links…", or "Couldn't load the links." with the reason and **Try
again**; opening Share again after a failure reads the list again too), so it never offers to make a
link the report already has.

- **Link**: the links that can open this report, links to all your reports first, each named by who
  it's for and what it opens ("Candidate — opens all your reports", "Board — opens only this
  report"), with the address and **Copy link**.
- **Make a link** is always there (pressed, it opens with the keyboard on its first choice), and it's
  the main action, already open with *All your reports* picked, when no link opens the report: "**All
  your reports** (the usual choice) — one link and one password; next week's report shows up on it
  too." or "**Just this report** — for someone who should
  see only this one (a donor, a board member). It has its own password, and next week's report won't
  be on it." Then "Label (only you see it)", **Expires**, "A password is shown once, right after the
  link is made — copy it then.", and **Create link**. The password is made for you and shown once,
  right there, with the keyboard on its **Copy password**: "Password for Board: … **Copy password** —
  shown once. Send it separately from the message. Lost it? Change password on the link." Every link
  you make in one Share keeps its own password line there until you press **Done**, so making a second
  link doesn't hide the first one's password. (To set your own password, use **+ New link** in the
  links panel.) An existing link's password can't be shown again.
- **Message (no password in it)**, with **Copy message**: the report, its dates and its headline
  numbers, with a link straight to the report. For example: *"The Volunteer team report for Oct 13 –
  Oct 19 is up: 3,412 doors knocked so far (+412 in that period) and 1,980 surveys (+260). Open it here:
  https://doorline.app/r/…/reports/… — use the password I sent you."* Its last words follow the link:
  "— use the password I sent you." on a link to all your reports, "— use the password I sent you for
  this report." on a one-report link made before, and "— I'll send you its password separately." on a
  link made just now in Share.

## Changing a published report

A published report never goes back to being a draft. It changes in exactly these ways, each with its
own confirm:

- **Edit**: the title, the observations, which charts and voter groups show, the headline question
  and the goal tick, and taking questions off the map. **Update report** sends only what you changed
  since you pressed Edit (anything someone else changed meanwhile stays); your client sees the change
  at once, marked "Edited Oct 21", and **the numbers stay as they were**. The earlier text is
  kept in History, where team leads on the campaign can read it (an admin can erase it there). Turning
  the map off **deletes the frozen map**, but the report remembers which map questions you had picked
  (see Refresh numbers below); turning it back on means refreshing the numbers. On a report that's
  taken down, your client sees the edit when you put it back up. If the report changed elsewhere while
  your edit was open, Update merges first and says so: "Picked up changes made elsewhere. The title
  changed there first; your update went on top, so both are kept", or, when your change was already
  there, "Your change had already been made there, so there was nothing more to update."
- **Your edit is kept on this device** as soon as it has a change, until you press Update report or
  **Cancel edit**, discard it, or undo every change yourself. Leave with it unsent and the report
  offers **Restore your unsent edit** next time ("From 9:14 AM, kept on this device." with **Discard
  it**); **Edit** itself opens it too, never wiping it: "Your unsent edit is open. From 9:14 AM, kept on
  this device. Update report sends it; Cancel edit throws it away." Cancel edit with changes asks first:
  "Throw away your edit? Nothing you changed reaches your client, and the copy kept on this device is
  deleted." Only your own changes go back on top of whatever the report holds by then.
- **Switch to areas** (inside Edit): the areas build in the background, your client keeps seeing exact
  doors until they're ready, and then sees "Edited". Going back to exact doors, or changing the area
  size, means refreshing the numbers. The confirm names any single-choice map question that may show no
  answers by area: "“Support Smith?” and “Yard sign?” show answers area by area only when every area
  has at least five answers to them — otherwise your client sees just their charts. Once the areas are
  ready, this page says which ones don't." An Update that only switches to areas doesn't claim your
  client sees it "right away"; on a taken-down report it says "The report is taken down, so your
  client sees the areas when you put it back up."
- **Refresh numbers**: rebuilds the report's numbers from today's records, for the same period, and
  changes nothing until you press **Apply**. The dialog compares **Now** and **After** for every
  headline card, what moved **In the period**, the doors (or areas) on the map, and, folded away, the
  contact breakdown, support split, voter groups and door goal. **Discard** throws the new numbers
  away; **Rebuild** builds them again. It's also how you **add** to the map: turn it on, add map
  questions, go back to exact doors, or change the area size. Choosing exact doors warns that "Exact
  doors put street addresses back in front of your client". **Turning the map back on** offers the map
  questions the report had picked before its map went off, already ticked: "Map questions — the ones
  this report had picked are ticked; untick any you don't want on the map:". Exactly what is ticked
  goes on your client's map, and the review names it before you apply: "The map comes back on with
  “A” and “B”." (or "…with how each door went — no map questions."); on a map that's already on, "Map
  questions after you apply: … (new: …)." On an area report it also names any single-choice question
  that would show no answers by area. The expanded rows use your client's words for each outcome
  (Declined to participate, Didn't answer, No-soliciting sign). A refresh that leaves the map off keeps
  those picks for later. Your client sees "Numbers refreshed Oct 28". New numbers waiting for review
  must be applied or discarded before another build can start.
- **Take down** hides the report from your client but keeps it exactly as it was (numbers, map and
  publish date), and cancels any build or new numbers waiting for review. **Put back up** shows it
  again, unchanged, with its original publish date. A taken-down report still changes only through
  Edit or Refresh numbers. Its confirm names the report's own one-report links that someone could
  still open: "Board, a link to just this report, shows "taken down" until you put it back up." (for
  several, "Board and Donor, links to just this report, show "taken down" until you put it back
  up."). While it's down, each of those links says so in the links panel too: "Its report is taken
  down — the link shows “taken down” until you put it back up."
- **Delete** (from the row's menu) removes it for good. On a report your client can see, the warning
  names the links it shows on (only links that can open it) and suggests Take down instead. **Deleting
  a report deletes its one-report links**, and the warning says so: "Its link Board (just this
  report) stops working for good." Anyone opening such a link then reads "This link isn't available.
  It may have been replaced or switched off — ask the person who sent it." Each one gets a History row,
  "Board · Link deleted", with "Deleted with its report" under it. An admin can tick **Also erase its
  earlier text from History** in the same step.

**Example: fixing answers after the report went out.** A canvasser picked *Volunteer Request*
whenever a voter turned down a yard sign, and last week's report already went to the client. An org
admin fixes the answers on Door Outcomes with **Edit answers…** (see
[CAMPAIGNS.md](CAMPAIGNS.md) → *Editing survey answers*). The published report keeps the old picks
until someone opens it and presses **Refresh numbers**. The dialog shows the headline cards unchanged
(an answer edit keeps every voter surveyed); **Apply** puts the corrected answer counts in front of
the client, marked "Numbers refreshed".

## Next report

On the latest report of each tab, **Next report** makes the next draft in one click, starting the day
after the last one ended, by the same rules as New report's first choice: whole weeks are followed by
the same number of weeks on the same weekday, whole months by the same number of months, and any other
length by the catch-up to the end of last week (or of this week), so the report after it is a normal
week. It copies the observations, marked "Copied from Oct 6 – Oct 12" until you tick **I've reviewed
the copied notes**, and the questions, map settings, voter groups, goal tick and headline. The title
starts blank, and the numbers start building at once. If the new period hasn't started yet, the
builder says so.

- **After a long gap the two differ on purpose.** New report suggests the most recent full week (or
  month) and names the days no report covers; Next report fills the gap from the day after your last
  report. One click never makes a catch-up longer than two weeks, though: Next then opens New report
  on that tab with its answer at the top of the dates, "More than two weeks have passed since this
  report. Choose the next report's dates in New report.", Last week picked and the uncovered days
  named.
- **Pressed twice, it still makes one draft**, and both presses open it. If the tab already has a
  report for exactly the next dates (made in New report, or by another press), Next opens that one
  instead of making another; any other later report in the tab means this isn't the latest report any
  more: "A later report of this series already exists — open it instead."

## Team reports

A campaign can have a volunteer team and a paid team, and your client may want a report for each.
**A team is a name your client sees plus one or more crews** (a crew is a coordinator and the
canvassers who report to them on this campaign). "Paid team" can cover Sam's crew and Dee's crew;
"Volunteer team" can be Maria's crew alone. A crew belongs to one team at a time. Canvassers with no
coordinator belong to no team's report.

- **Names never contain a canvasser's name.** A team name with a coordinator's or crew member's first
  or last name in it (as a whole word of three or more letters) is refused: "Team names can't include
  a canvasser's name — “Dee” matches someone on this campaign." A walk list whose name happens to match
  one ("Marco Island" on a campaign with a canvasser named Marco) gets a warning, "The walk list's name
  matches a canvasser on this campaign (“Marco”). Your client reads this name.", that you can confirm
  with **This is a place, not a person**, or you can type the name your client sees instead. The
  matched name is shown as it's written on the person's record ("McDonald", "José").
- **The numbers are each team's own work.** A home or voter both teams reached counts in both
  reports, and each team report says so, so **team reports don't add up to the whole campaign**.
  Doors marked at the office on Door Outcomes don't count toward any team's doors. Team reports never
  show a door goal. The team's map shows the doors the team knocked, each with the team's own latest result and
  answers.
- **Edit team** on a team's tab renames it, changes its crews, or ends it. Ending keeps its published
  reports exactly as they were sent and offers to delete its open drafts (only reports that are still
  drafts go, each recorded in History). Walk-list tabs get **Rename**.
- **An ended team's tab shows Continue this team** instead of Edit team: "It takes new reports again.
  Pick the crews it covers from now on — its published reports stay exactly as they were sent." A crew
  you leave unticked leaves the team (a crew now in another team can't stay), and a departed lead's
  past doors are kept or removed first. Picking an ended team in **New report** offers **Continue the
  team** before it creates the draft; after Continue, New report reopens on that team with your dates
  and title kept. Reusing an ended team's name offers to continue it rather than start a second team
  under the same name.
- **"A team" is greyed out** on an organization that doesn't have team attribution yet.

**When a crew lead leaves.** Removing a coordinator leaves her crew's past doors stamped with her. The
next time a draft of that team is built, it stops with a **Team changed** card instead of a Retry:
"Dee no longer runs a crew on this campaign", what became of her canvassers ("3 of 5 have no crew now;
2 joined Sam's crew"), and the choices:

- **Keep the crew's past doors in Paid team** (the default): they keep counting while those
  canvassers have no crew. Moving one of them into another crew moves their past doors too (the
  current coordinator owns all history), and on the web the confirm that moves them names the
  client-report team whose numbers change ("This also changes the numbers in the Paid team client
  report"; the phone's member sheet doesn't show that line yet).
- **Remove them**, with what that takes out ("the team's totals drop by 1,400 doors"): the team's
  doors with her crew minus without it, up to the end of the report the card is about, so a door
  another of the team's crews also knocked that round stays, and a knock after the period never
  counted.
- **Change crews**, or **End this team** (an ended team's card offers no End; Change crews opens
  Continue).

**Continue** applies the choice and builds again. If a past crew lead runs a crew again, the card
offers to make her crew current in the team or remove her past doors. **Reports you've already
published stay as they were sent**, and a Refresh rebuilds a published team report with the crews it
was built with, so a report already sent never quietly starts covering another crew.

## Exact doors or areas

**Exact doors** is the default: pins at each home, with its street address when tapped. **Areas** is
for a client who shouldn't see addresses, or a campaign where door-level answers feel too exact: the
report shows hexagons instead (see *Area view* above). Only single-choice questions can show answers
by area; a pick-several question stays a pins-only filter and shows as a chart. If a question shows no
answers by area because one area has fewer than five, **Large areas** usually fixes it. The builder
says which questions that is: *Before you publish* on a draft; on a published report, the switch's
confirm warns ahead, the Refresh review names them before you apply, and **Worth a look** names them
once the areas are up. On a draft, the choice takes effect at the next Recompute. On a published
report, **Switch to areas** is an edit, and going back is a Refresh.

## Client links

The **Client links** panel on the tab holds the campaign's links: "A link opens all your reports, or
just one. Each has its own password — send it separately." A campaign can have several (one for the
candidate, one for a consultant, one for a board member's single report), each with its own password,
expiry and counts. Links to all your reports are listed first; links to one report fold under **Links
to one report (N)**, closed until you open it. Each row says what it opens: "Opens all your reports",
or "Opens only the Oct 19 – Oct 25 report (Whole campaign)", and while that one report is taken down,
"Its report is taken down — the link shows “taken down” until you put it back up." If the list can't
be read, the panel says "Couldn't load the links." with **Try again**.

- **+ New link**: **Opens**: **All your reports**, or **One report only** with the report picked from
  the ones your client can see now ("— next week's report won't be on it."; with none published yet,
  "— publish a report first"; while your reports are still loading, "— loading your reports…"; if
  they couldn't be loaded, "Couldn't load your reports." with **Try again**, and opening New link
  again reads them again too). A
  one-report link is always made for the report the box shows, and **Create link** waits until
  there is one: it never quietly becomes a link to all your reports. Then a **Label** (only you see
  it), **Expires** after 30, 90, 180 or 365 days
  (90 by default; "You can extend it later, up to a year from today"), and a **Password**: **Generate
  a strong one (shown once)** (12 characters, without look-alike letters) or **Set my own** (12 or
  more characters). A link to one report can only be made for a published report that isn't taken
  down. **Link ready** then shows the whole address and the password once, with **Copy link** and
  **Copy message** ("Here's the link to our reports: … — I'll send the password separately.", or "…to
  this report…" for a one-report link); the password is stored scrambled and can't be shown again
  (lost it? **Change password**). **Share** makes links too, from a report (see *Publishing*).
- **A link to one report** reaches that report and nothing else: no list of other reports, no Older or
  Newer, and none of their maps or door details. It's made for one report and never changes to
  another; next week's report won't be on it. Deleting the report deletes it.
- **Extend** offers only later dates, each shown as a date, up to a year from when the link was made.
  An **expired** link offers only **Renew** (no Rotate, Unlock now or lock warnings): it gets a **new
  address** and a new year, keeps its password, and you send your client the new link. The old address,
  and every copy of it ever forwarded, stays dead. Renewing a disabled link keeps it disabled until you
  enable it.
- **Change password** (12 or more characters), **Rotate** (a new address, same password), **Renew**
  and **Disable** all **sign everyone out**. The confirms say what stays: Rotate's "It gets a new
  address, and everyone using the old one is signed out. The password stays the same. It still expires
  Jan 21" (adding "It also lifts the lock" on a locked link, and on a disabled link that the new address
  stays closed until you enable it); Disable's "Nobody can open it until you enable it again. Everyone
  using it now is signed out — once you enable it, they need the password again." Adding a password to a
  link that never expired also gives it an expiry, which you can extend. **Enable** turns a disabled
  link back on; **Delete** removes it for good. A password can be replaced but never removed.
- **Last opened** is the last time someone signed in to the link opened it. Reaching the password
  screen, or guessing wrong, doesn't count.

**Wrong passwords.** The row shows a link's wrong passwords whenever there are any, on a locked or
expired link too, counting only what's above zero: "12 wrong passwords since Oct 24, 9:12 AM EDT · 30
this week · 41 in total", "3 wrong passwords this week · 41 in total", or "41 wrong passwords in
total". The amber **Wrong passwords** badge is only for the last 24 hours (and not on a locked or
expired link, which has its own). **No link accepts more than 50 wrong passwords in any 24 hours.** At 50 it locks ("Locked until Oct 25, 9:12 AM after 50 wrong passwords. Devices
already signed in still work"), and since 50 wrong passwords is never your client, it says "Someone
else has this link" and suggests **Rotate**. **Unlock now** lets the right password in again at once.
Rotating also clears the week's count; the lifetime total stays.

**Older links.** A link whose password turns out to be shorter than 12 characters is flagged **Short
password** the next time it's used. A link from before mid-July 2026 may carry **No password** ("Add a
password") or **Never expires** ("Set an expiry"); adding a password also gives it an expiry, and
Extend gives a never-expiring link its first one. An admin can switch off every remaining open link in
the organization at once (the revoke-legacy switch; Part 2).

**Who opened what.** Each published report's row says how often it was opened: "Opened via Candidate:
about 2 visits" (the line waits for the links list, which names the links). The page counts a visit
once per browser, per report, per day, so it's an estimate.
Visits by people signed in to your organization, and by Doorline staff, are listed apart ("your
organization: 3 visits"), so checking your own work doesn't inflate your client's number. A report
published before these counts existed also shows "N views before per-link counts": the old total,
which no longer changes.

## Report branding

The **Report branding** card puts your organization's logo at the top of your clients' report pages
and PDFs, with a small "Powered by Doorline". It's organization-wide, so only admins change it:
**Upload** takes any image your browser can draw (PNG, JPEG, SVG); the browser turns it into a PNG no
larger than 800 × 320 pixels and 256 KB, and Doorline checks it and keeps its own clean copy, so
nothing else hidden in the file goes along. **Remove** takes the logo off every campaign's reports.
Team leads see the logo, "Set by an admin.", or "No logo yet."

## History

**History** on the tab opens the client-report history: drafts created, publishes, edits, refreshes,
take-downs, deletes, team changes and every link change (including a day with 10 or more wrong
passwords, and each lock), newest first, each with who did it and when.
A report's row names its period and its tab, so four tabs' reports for one week read apart: "Oct 12 –
Oct 18, 2026 · Paid team report · Published", "Oct 12 – Oct 18, 2026 · Whole campaign report ·
Published" (a row from before tabs reads by its period alone). Team rows name the team: "Volunteer
team · Team ended", "Volunteer team · Team continued" (with how many crews it continues with), "Paid
team · Crews changed" ("1 crew → 2 crews"). A row carries the name the team had at the time; an older
"Team ended" or "Crews changed" row uses the team's current name, or "A team". A one-report link that
went with its report reads "Board · Link deleted", with "Deleted with its report" under it. It shows
the latest 200. These rows never appear in the campaign's general History or in the phone app, and a
link row never holds the link's address or password.

**Team leads on the campaign can read it, including the earlier text of every edit.** Anyone who can
edit the report can **Restore** an earlier text, as a new edit. The confirm says when your client sees
it: right away, marked "Edited", on a published report; when you put it back up, on one that's taken
down. Ending a team with its open drafts writes a "Deleted" row for each draft that went. An admin can
**Erase** an earlier text, or **Erase all earlier text for this report** (its confirm names it: "Erase
all earlier text for the Oct 12 – Oct 18, 2026 · Paid team report?"), beyond the latest 200 too, and
even after the report is deleted. Erased text can't be restored, and
if **Next report** copied it into a later draft, the confirm offers to remove it there too.

## Who can do what

Org admins, and team leads on campaigns they run, can do everything on this tab (owner ruling
2026-10-23: full control), with four exceptions that are admins only: the report logo, the
organization's report week (leads see it, "set by an admin"), Erase in History, and switching off
every legacy open link in the organization at once.

## What this doesn't change

How every number is counted ([METRICS.md](METRICS.md)); tags hidden until ticked; door-goal progress
only; and the phone app, which shows nothing from this tab. No new company receives any data.

---

# Part 2 — Technical reference

## A. Where things live

| Concern | Files |
|---|---|
| Admin routes | [routes/admin/clientReports.js](../server/src/routes/admin/clientReports.js) (reports, series, builds, preview), [routes/admin/clientReportShares.js](../server/src/routes/admin/clientReportShares.js) (links, mounted at `/admin/client-reports/shares` **ahead of** the reports router in [routes/index.js](../server/src/routes/index.js) so `/:id` never reads `shares`), [routes/admin/clientReportSettings.js](../server/src/routes/admin/clientReportSettings.js) (the organization's report week, mounted at `/admin/client-reports/settings`, also ahead of it), [routes/admin/branding.js](../server/src/routes/admin/branding.js), History in [routes/admin/campaigns.js](../server/src/routes/admin/campaigns.js) |
| Report weeks and the next period | [services/reports/reportPeriods.js](../server/src/services/reports/reportPeriods.js) (server copy) and [reportDates.js](../client/src/components/clientReports/reportDates.js) (client copy), pinned to each other by one fixture table, [test/fixtures/reportPeriods.json](../server/test/fixtures/reportPeriods.json) (§F) |
| Public routes | [routes/public/share.js](../server/src/routes/public/share.js), mounted at `/share` before the `requireAuth` gate |
| Visibility | [services/reports/reportVisibility.js](../server/src/services/reports/reportVisibility.js) |
| The build | [services/reports/clientReportBuilds.js](../server/src/services/reports/clientReportBuilds.js) (claim, liveness, worker attempt, commit, publish, apply, discard, take down), [services/reports/buildReportSnapshot.js](../server/src/services/reports/buildReportSnapshot.js) (the numbers and the map rows) |
| Area view | [services/reports/areaCells.js](../server/src/services/reports/areaCells.js) |
| Series and teams | [services/reports/clientReportSeries.js](../server/src/services/reports/clientReportSeries.js) |
| Readers and shapers | [services/reports/clientReportMap.js](../server/src/services/reports/clientReportMap.js) (map payloads and their in-process cache, the map version, `mapContextFor` and `legacyTemplatesFor`), [services/reports/clientReportView.js](../server/src/services/reports/clientReportView.js) (the client payload), [services/reports/clientReportRead.js](../server/src/services/reports/clientReportRead.js) (earlier totals, older/newer, current series labels) |
| Before you publish | [services/reports/clientReportChecks.js](../server/src/services/reports/clientReportChecks.js) |
| History | [services/reports/clientReportHistory.js](../server/src/services/reports/clientReportHistory.js) |
| Links | [services/reports/shareLinks.js](../server/src/services/reports/shareLinks.js), [services/auth/tokens.js](../server/src/services/auth/tokens.js) (`signShareToken`) |
| Opens | [services/reports/reportOpens.js](../server/src/services/reports/reportOpens.js), [services/auth/resolveSessionUser.js](../server/src/services/auth/resolveSessionUser.js) |
| Branding | [services/branding/png.js](../server/src/services/branding/png.js), [services/branding/orgLogo.js](../server/src/services/branding/orgLogo.js) |
| Sweep, indexes | [services/reports/clientReportSweep.js](../server/src/services/reports/clientReportSweep.js), [services/reports/clientReportIndexes.js](../server/src/services/reports/clientReportIndexes.js) |
| Migration, console | [migrations/clientReportVisibility.js](../server/src/migrations/clientReportVisibility.js); [migrations/reportTabWeeks.js](../server/src/migrations/reportTabWeeks.js) (`npm run report:tab-weeks`, read-only, §R) |
| Test oracles | [services/reports/computeReport.js](../server/src/services/reports/computeReport.js): `computeWindowStats` and `buildFrozenMapPoints` are no longer called by any route; they stay as the parity oracles the build is pinned against. `computeSurveyBreakdowns`, `computeTagBreakdowns` and `publicPointAnswer` are still the live implementations. |

The phone app calls no client-report, share or branding endpoint. It does call `GET
/admin/campaigns/:campaignId/history`, whose default response excludes client-report rows (§M), so
nothing here needs an OTA or a client-version bump.

## B. Models

**[ClientReport](../server/src/models/ClientReport.js)**, one report. Old documents lack every field
added in October 2026, and JavaScript never trusts a Mongoose default for them: each is read through a
helper with an explicit fallback (`liveInputs`, `numbersCutOff`, `seriesKeyOf`, `scopeOf` in
reportVisibility.js).

| Field | Meaning |
|---|---|
| `organizationId`, `campaignId` | Tenant. |
| `title`, `campaignType` | Optional label; the campaign type, denormalized so the client hides lit-drop or survey rows without a live lookup. |
| `effortId`, `effortName` | Walk-list scope (`null` = not a walk-list report). `effortName` is frozen at creation. |
| `weekStart`, `weekEnd`, `timeZone`, `rangeStartUtc`, `rangeEndUtc` | The period: civil days in the campaign's zone, and the half-open UTC range the build reads (`zonedDayRange`). Any run of days, despite the names. |
| `status` | `draft` or `published` (`archived` is in the enum and unused). |
| `observations` | `[{ heading, body }]`. |
| `stats.cumulative`, `stats.period` | Each `{ totals, contactBreakdown, coverage, surveyBreakdowns, tagBreakdowns, provenance }` (§D). `coverage` is `{}` on everything built since October 2026. |
| `supportQuestionKey`, `goalSnapshot` | The headline question; frozen goal progress (§D). |
| `visibility` | `{ visibleQuestionKeys, mapAnswerKeys, showMap, mapMode: pins \| area, areaSize: small \| large, visibleTags, showGoal }`: the operator's current settings (§C). |
| `mapPointCount`, `areaCellCount`, `extent` | The live snapshot's row counts, and its bounding box `{ minLng, minLat, maxLng, maxLat }`. |
| `snapshotId`, `snapshotKey` | The live snapshot (§E). `null` on a report built before snapshots, whose rows carry no `snapshotId`; `snapshotKey` is its opaque random twin, the only version the client sees (`'legacy'` when null). |
| `snapshotInputs` | What the live snapshot was built with: `{ showMap, mapMode, areaSize, mapKeys, questionDeps, coordinatorIds }`. No default on purpose: a missing one must stay missing. |
| `statsComputedAt` | The live snapshot's cut-off (the build's fence). Read through `numbersCutOff` (`statsComputedAt ?? publishedAt`). |
| `editVersion` | Incremented by every write that changes what the builder edits: every PATCH, Restore, and (since code review round 2, contract C8) a refresh's Apply and a remap's commit. Publish compares it; a PATCH sent with `ifEditVersion` is pinned to it (§C). A missing one reads as 0. |
| `earlierTotals`, `comparedReportId`, `comparedSnapshotId`, `arrivedDuringBuild` | §I (the compared report and its live snapshot when this build recounted it); knocks that arrived after the fence. |
| `build` | The build in flight or its result (§E). Mixed, and always replaced whole by a claim, cancel or reset. |
| `seriesId`, `scope` | The series and the frozen `{ kind: campaign \| walk_list \| team \| team_walk_list, label }`. |
| `takenDownAt/By`, `contentEditedAt/By`, `numbersRefreshedAt/By` | Take down; an accepted edit or a remap ("Edited"); an applied refresh ("Numbers refreshed"). |
| `copiedFrom`, `copiedNotesReviewed`, `nextReportId` | Next report: `{ reportId, weekStart, weekEnd }` of the copied notes, the review tick (`null` when nothing was copied), and the draft Next made from this report. |
| `dupGuard` | `true` on every report New report or Next made without "Make a second one" (2026-10-25, PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §E): it puts the report inside the unique partial index `report_period_guard` (below), one guarded report per tab and period. **Declared with no default** on purpose: absent means outside the guard (every report from before the field, and every deliberate second one); undeclared, strict mode would drop it on create and `strictQuery` from filters, and the guard would hold nothing. Dates never change after creation, so a report's key never moves; deleting it frees the key. |
| `eraseEpoch` | Bumped by every Erase; Restore's CAS requires it unchanged (§M). |
| `views` | `{ byLink: Map<shareId, { opens, firstOpenedAt, lastOpenedAt }>, members: { admins, leads, others, staff } }` (§L). A Map of a declared subschema, because a plain nested object would be stripped. |
| `viewCount`, `lastViewedAt` | The pre-upgrade per-report counter, **frozen**: no open moves it since per-link counts began (code review ADMINUX-12), so the panel's "N views before per-link counts" is exactly that. |
| `createdBy`, `publishedAt`, `publishedBy`, `openMockFlagsAtPublish` | `openMockFlagsAtPublish` is the open mock-GPS flags in the report's scope at the moment of publish: operator-only, never shaped. |

**[ClientReportMapPoint](../server/src/models/ClientReportMapPoint.js)**, one reached door of a pins
snapshot: `clientReportId`, `organizationId`, `campaignId`, `householdId` (never sent), `lng`, `lat`
(the household's coordinates), `addressLine1`, `city`, `state` (no unit line, no ZIP), `status` (as of
the period's end), `answers: [{ questionKey, answer }]` (choice answers only, through
`publicPointAnswer`), `snapshotId` (no default: a legacy row must never hydrate as another snapshot's)
and `seq`, the row's position in the client's payload. **No voter name, no canvasser, no timestamps,
no note.** Index `{ clientReportId, snapshotId, seq }`, added to an existing collection, so production
builds it with `migrate:build-indexes`.

**[ClientReportAreaCell](../server/src/models/ClientReportAreaCell.js)** (new), one hexagon of an area
snapshot: `organizationId`, `campaignId`, `clientReportId`, `snapshotId`, `h3`, `doors`, `byStatus`,
`answers: [{ questionKey, n, options: [{ option, count }] }]` (`n` = homes there that answered). Never
an address or a door's coordinate. Unique `{ snapshotId, h3 }`; `{ clientReportId, snapshotId }`.

**[ClientReportSeries](../server/src/models/ClientReportSeries.js)** (new), one run of reports:
`organizationId`, `campaignId`, `kind` (`campaign`, `walk_list`, `team`, `team_walk_list`), `label`,
`labelKey` (lowercased, trimmed; the campaign series' is the fixed `'whole campaign'`), `effortId`,
`teamSeriesId` (a team on one walk list reads its name, crews and ended state from this parent),
`coordinatorIds`, `pastCoordinatorIds`, `crewKeys` (their union, stored for the index), `endedAt/By`,
`createdBy`. Five named partial-unique indexes (§H).

**[ReportShareLink](../server/src/models/ReportShareLink.js)**: `token` (unique, 24 random bytes,
base64url), `label`, `passwordHash` (bcrypt; `null` only on legacy open links), `expiresAt`,
`isActive`, `createdBy`, `lastAccessedAt`, plus, since October 2026, `credentialVersion`,
`passwordMeetsRule` (no default: `null` means unknown), `failedUnlockAt: [{ at, id }]` (the rolling
budget), `failedUnlocksTotal`, `failedByDay: [{ day, n }]` (UTC days, last 7), `lockedUntil`,
`lastLockedAt` (the latest lock, for the record) and `lifetimeStartAt`. Old links lack all of them
until the migration; every reader goes through shareLinks.js. Since 2026-10-25 also `reportId`
(ObjectId, ref `ClientReport`, default `null`): `null` or missing (every link made before it) opens
every published report of the campaign; set, the link opens that one report only (§K). Set at
creation, never changed. A declared path on purpose: `strictQuery` would drop an undeclared
`{ reportId: … }` filter key and match every link. No index of its own: queries by `{ campaignId,
reportId }` ride the existing `{ campaignId, isActive }` index (a campaign has a handful of links).

**[Organization](../server/src/models/Organization.js)** `reportWeekStartsOn` (Number 0–6, 0 = Sunday,
default 1): the organization's report week (§F). Read through `reportWeekStartsOnOf` (`?? 1`, and
anything that isn't a whole number 0–6 reads Monday), so an organization saved before the field is
Monday with no migration.

**[OrgBranding](../server/src/models/OrgBranding.js)** (new): `organizationId` (unique), `logo` (the
re-encoded PNG, §N), `width`, `height`, `bytes`, `updatedBy`. Its own collection because `orgContext`
loads the whole `Organization` on every request.

**[CampaignChange](../server/src/models/CampaignChange.js)**: `source` gains `'client_report'`; new
declared fields `clientReportId`, `seriesId`, `shareLinkId`, `periodLabel`, `erasedAt`, `erasedBy`
(declared because strictQuery drops undeclared filter keys); new index `{ campaignId, clientReportId }`
(existing collection: `migrate:build-indexes`).

**[SurveyTemplate](../server/src/models/SurveyTemplate.js)** `depsEver: [{ q, on }]`: every
question-to-question dependency the survey has ever had (§C). No default: absent means not seeded.
`depsEverFromVersion` (new in code review round 1, LEGACY-1): the oldest survey version that record
is complete for. Answers given under that version or a later one carry no condition the record
misses; an answer from an older version may, because nobody stored its conditions. Set to 1 on create
and on Duplicate; set by the first questions PATCH that finds it missing, to the version that PATCH
replaces (whose edges it unions in); set by the migration to the version it seeds from. `null` means
unknown, and readers use `version` instead. It drives the `conditionsUnknown` check (§C).

**Cascades.** The campaign cascade ([deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js))
deletes `ClientReport`, `ClientReportMapPoint`, `ClientReportAreaCell`, `ClientReportSeries`,
`ReportShareLink` and `CampaignChange` by `campaignId`; the organization cascade's `ORG_SCOPED`
([deleteOrganization.js](../server/src/services/platform/deleteOrganization.js)) adds `OrgBranding`.
`LATE_WRITE_MODELS` ([lateWriteSweep.js](../server/src/services/platform/lateWriteSweep.js)) gains
`ClientReportMapPoint` and `ClientReportAreaCell`. `OrgBranding` is deliberately not in it: it has no
`campaignId`, so a campaign-scoped sweep's filter would be stripped and the delete would match every
organization's logo.

**Indexes at boot.** autoIndex is off in production. `syncClientReportIndexes` syncs the three new
collections (`ClientReportAreaCell`, `ClientReportSeries`, `OrgBranding`) when the web dyno boots
(awaited before it listens, because it writes series) and when the worker boots; the migration runs
it too. Their definitions are final: once the collections hold data, a changed partial filter would
make the boot-time sync drop and rebuild a unique index on a live collection. The same boot step
(`ensureReportPeriodGuard`) builds the duplicate guard on `ClientReport`, `report_period_guard`:
`{ seriesId: 1, weekStart: 1, weekEnd: 1 }`, unique, `partialFilterExpression: { dupGuard: true }`.
It uses an explicit `ClientReport.collection.createIndex` (never `syncIndexes` on that collection,
which would drop the indexes production built by hand); `createIndex` never drops anything, and the
index covers only guarded reports (none before this release), so it builds at once, before the first
guarded create, with no console step. A failure is never fatal (the create route still looks first),
and the guard **heals itself** (code review round 1 of the simplify build, SRV-1; before, a failed
build was only logged, and once two guarded creates had landed at the same instant while the index
was missing, their shared key failed every later build for good):

- A build that fails on a duplicate key takes every guarded report but the first made of its tab and
  dates (by `createdAt`, then `_id`; grouped by `seriesId`, `weekStart`, `weekEnd`, a missing key
  counting as null) out of the guard by unsetting `dupGuard`: each stays, an ordinary second report,
  as if made with Make a second one, and New report's look-first still finds it. Then it builds again.
- Any other failure (a failover, a dropped connection) is retried in the background after 5 s, 30 s,
  2 min and 10 min, on unref'd timers that never hold a process open; after the fourth, the next boot
  tries again.
- The nightly maintenance job checks it too: the `client-report-row-sweep` run calls
  `ensureReportPeriodGuard('maintenance')` first (a no-op when the index exists; it never throws), so a
  build that ran out of retries is repaired within a day.
- Log lines (tagged `[canvass-server]` on the web dyno, `[worker]`, `[maintenance]` or `[migrate]`; a
  build that succeeds at once logs nothing):
  "ClientReport report_period_guard: a duplicate key failed the build; N report(s) sharing a tab and
  dates with an earlier one now sit outside the guard, as second reports (ids) — building it again",
  "… index built" (after a heal) or "… index built on retry N", "… index failed — retry N of 4 in 5
  s: <error>", "… index failed — no retries left; the next boot tries again: <error>".

The schema declares the index too (`REPORT_PERIOD_GUARD` in ClientReport.js), so
`migrate:build-indexes` lists it as built and its `--sync` never drops it; changing the definition
would fail the boot build until the old index is dropped by hand.

## C. Visibility, enforced on the server

Before October 2026 every visibility switch only hid things in the browser (PRIVACY_VERIFICATION item
34). [reportVisibility.js](../server/src/services/reports/reportVisibility.js) owns the rules; every
writer and reader goes through it.

- **Empty means none**, for `visibleQuestionKeys` and `mapAnswerKeys`, on every report. Create, Next
  and the builder always write explicit keys. A new draft gets every choice question's chart and, on
  the map, every choice question whose dependencies are also on it (`defaultVisibility`), the map on,
  pins, small areas, no tags and no goal.
- **`visibleKeysFor(report)`** = `visibleQuestionKeys` ∩ the frozen breakdown keys.
- **`mapKeysFor(report, questionDeps)`** = `mapAnswerKeys` ∩ `visibleKeysFor`, closed under the
  dependencies (`closeUnderDeps`, to a fixpoint, so a follow-up of a follow-up drops with its middle
  question); `[]` when `visibility.showMap` is false. Turning the map off keeps the map-question picks
  in `mapAnswerKeys`; the switch gates them. On a published report they stay through any edit while the
  map is off (the PATCH narrows only while the map is served, code review VERIFY-1) and through a
  refresh that leaves the map off (Apply keeps `visibility.mapAnswerKeys` unless the build turned the
  map on); Refresh numbers turning the map on offers them ticked and builds exactly the ticked list
  (§F).
- **Readers serve the intersection** of the current settings and the live snapshot: the map is served
  only when `visibility.showMap && liveInputs(report).showMap` (`mapServed`), and its questions are
  `mapKeysFor(report, inputs.questionDeps) ∩ inputs.mapKeys` (`servedMapKeys`). Neither side alone can
  put something on the client's page.
- **`liveInputs(report)`**: `snapshotInputs` when it is an object. Without one, the **legacy fallback
  rule** (`isLegacyPublished`, code review LEGACY-1): only a report **published** before snapshots
  (taken down included) reads the old way. Its current settings stand in, because its rows were built
  from them: pins mode, small, no coordinators, the map on unless switched off, and `mapKeysFor` with
  the dependencies of **every survey its answers can have come from** (`legacyTemplatesFor`: every
  survey with a response in the campaign, plus its current one, united by `questionDepsOf`). It fails
  closed: a map question that is no question of any of those surveys has unknowable dependencies and is
  never served, the result is closed under the dependencies again so a follow-up never outlives a parent
  dropped there, and with no survey at all no map question is. A report read without its `status` field
  (a caller's narrow projection) takes the same fallback, so a check scanning other reports can never
  miss one's served map. **Any other report without `snapshotInputs` has nothing live**: a draft whose
  first build hasn't committed, or a draft from before the upgrade, gets `showMap: false` and no map
  keys, so its preview map answers `404 MAP_NOT_SHARED` and its old rows, if any, are never served.
- **`mapContextFor(report)`** ([clientReportMap.js](../server/src/services/reports/clientReportMap.js))
  is how routes read it: `{ inputs, served, keys }`, loading `legacyTemplatesFor` only for a legacy
  published report. The survey ids are memoized per campaign for 5 minutes (at most 500 campaigns):
  those reports' periods are over, so a survey first answered since can't have given their answers.
  The admin `GET /:id`, PATCH, Refresh, the preview and the public routes all go through it.

**Follow-up dependencies.** `ruleIsDependency(rule, parent)`: a `visibleIf` rule makes its question
depend on the parent unless it accepts **every** pick the parent can record (its live options, plus
Other when on), which carries nothing about the answer; this keeps script-flow surveys, whose later
blocks formally depend on every branch, mappable. A text parent always counts, so a follow-up of a
written question can never be mapped; an unknown parent counts (fail closed). `questionDepsOf(template)`
is the transitive closure of today's `visibleIf` united with `depsEver`, frozen into each build's
`inputs.questionDeps` as `[[key, [deps…]], …]`. `depsEver` is a monotone edge list: survey create
writes today's edges, every questions PATCH `$addToSet`s the edges of the version it replaces and of
the one it stores, and Duplicate copies the union
([routes/admin/surveys.js](../server/src/routes/admin/surveys.js)), so a condition edited away
mid-campaign still keeps its follow-up off a client's map. Given several surveys (the legacy fallback
above), `questionDepsOf` unites each survey's own edges. Map and cell answers built since the upgrade
come only from responses to the campaign's own survey (`surveyTemplateId`), so a duplicated or swapped
survey can't bring old answers onto the map.

**What the record can't know.** `depsEver` starts at `depsEverFromVersion` (§B). A survey edited
before the upgrade may have had a condition nobody stored: if that condition was removed before the
deploy and answers were given under the older version, a map question that was then a follow-up of a
hidden question could hint at the hidden answer. That case can't be closed in code. The migration
lists every survey with answers older than its record (§R), and *Before you publish* warns with
`checks.conditionsUnknown` (`conditionsUnknownFor` in clientReportChecks.js): true when the map is
served, at least one frozen breakdown question is hidden, and a response in the campaign submitted
before the report's end has a `surveyTemplateVersion` below `depsEverFromVersion ?? version ?? 1` of
its survey. The surveys checked are the campaign's current one for a report with `snapshotInputs`, and
`legacyTemplatesFor` otherwise (or when the campaign has no survey now). It is computed for every
report and replaces `multipleSurveyVersions`, which missed a single old version and was never computed
for a report without a snapshot (code review contract C3). It is campaign-wide (any response in the
campaign before the report's end, not only the report's walk list or team), which can over-warn, the
safe direction. *Before you publish* shows it on a draft with numbers (before that it says "These
checks appear once the numbers are built"), and since code review round 2 (P-2) a published report's
builder shows it too, in **Worth a look** (`PublishedChecks`, §Q), so a report published before the
upgrade gets the warning on screen as well as in the migration's step-0 list.

**The one removal path** (PATCH, drafts and published reports alike). Removals are turning the map
off, dropping a map question, hiding a chart, and dropping a question a mapped follow-up depends on.
The PATCH computes the allowed map keys (the visible keys ∩ the question universe, closed under the
snapshot's frozen dependencies united with the survey's current ones; the universe is the frozen
breakdowns on a published report, and any choice question plus the frozen breakdowns on a draft),
writes them to `mapAnswerKeys` (when the request sent no map keys, by filtering out only what it
prunes, below), and in the same request prunes `snapshotInputs` and any live or ready
`build.inputs` (`showMap` and `mapKeys`, as a pipeline update) and the stored rows of every snapshot of
the report: all rows deleted when the map goes off, otherwise `$pull` of answers outside the allowed
keys. A build that is running when the map goes off keeps going and commits without a map (its commit
re-reads the pruned inputs, §E). The live inputs come from `mapContextFor`, so a legacy published
report is pruned against every survey its answers can have come from. Refinements from code review
rounds 1 and 2:

- **Stale keys** (LEGACY-2, narrowed by VERIFY-1): on a published report whose map is **served**
  (`live.showMap` and the report's own switch), a map question the stored `mapAnswerKeys` names that
  the live snapshot doesn't serve (hidden when an old report was frozen, or no question of its
  surveys) is treated as already gone: narrowed silently, as the migration's step 4 does, and never
  read as an addition, so it can't trip `NEEDS_REFRESH`. While the map is off nothing is narrowed: the
  live snapshot serves no question then, and the stored list is the operator's picks for when the map
  comes back (round 1's version wiped them on any unrelated edit). Sent map keys on a map-off
  published report may include those kept picks, which reach no map until Refresh numbers checks
  them.
- **Only the keys sent** (CONCUR-3): the write sets only the `visibility` keys the request sent, never
  all seven from its own read, so a key written back from a stale read can't undo a write that landed
  since (another editor's tick, an Apply turning the map on, a remap's commit). Map questions are
  written as sent (closed under their dependencies) when sent; otherwise only what this edit's
  pruning takes out (a hidden chart takes its map question with it) is removed, with a `$filter` over
  the list as it stands at the write, so a question added there meanwhile stays.
- **A pending Refresh's additions are not removals** (STATE-2): map questions a ready or running
  Refresh would add stay on its `build.inputs` and in its snapshot's rows unless the edit hides their
  chart or drops a question they depend on. The build's inputs and rows are pruned by a drop list
  (every key removed or hidden, everything depending on one, to a fixpoint) rather than a keep list,
  and `build.inputs.showMap` goes false only on a real map-off, so an unrelated edit that leaves the
  map off while a Refresh turns it on keeps that Refresh's map.
- **One status per edit** (contract C5, ADMINUX-2): the body may carry `ifStatus` (`draft` or
  `published`), the status the builder edited. A mismatch answers `409 STATUS_CHANGED { error, code,
  status, takenDown }`, and the update's filter always pins the status the request read, so the check
  is atomic with the write: a draft's auto-save arriving after someone published it can never put
  half-written text in front of the client.
- **One version per edit** (contract C8, code review round 2: PRIV-1, CONCUR-1, VERIFY-UI-1): the body
  may carry `ifEditVersion`, the `editVersion` the builder's screen was built on. It is checked after
  the status (`409 STATUS_CHANGED` first) and before anything is claimed, then pinned in the same
  `findOneAndUpdate` filter as the status (`{ $in: [0, null] }` for 0, so a report from before the
  field matches). A mismatch answers `409 CHANGED_ELSEWHERE { error: "This report was changed
  somewhere else — this page now shows the latest version.", code, editVersion, report }`, with the
  report as `GET /:id` returns it, and nothing is written. Before this, a save from a page that hadn't
  re-read wrote its lists and sections whole: a chart one editor hid came back when another ticked
  something else and pressed Update, and a deleted observation section came back with it. If a write
  that lost this race had claimed a switch to areas, that remap is parked as a failed build
  (`ENQUEUE_FAILED`, "Couldn't start — try again."), so Retry stays on offer and nothing starts. A
  request without `ifEditVersion` is still accepted (lead decision: the builder is the only caller and
  always sends it, and a builder page opened before the deploy keeps working as it did); its lost race
  answers `STATUS_CHANGED` as before.

Free-text questions can never be map keys (`400 MAP_ANSWER_KEYS_NOT_CHOICE`), and every point answer
passes through `publicPointAnswer` (a write-in is the word "Other", never the typed text).

**Charts are the operator's choice**, follow-ups included. *Before you publish* flags a shown chart whose
parent is hidden (`checks.hiddenParentCharts`: `{ key, label, parents: [{ key, label, type }] }`, labels
and types read from the frozen breakdowns, else the survey, `type: null` for a question the survey no
longer has), so the builder can word a written-question parent as "a written answer to “…”" rather than
show a key; and a shown voter group carried by an option of a hidden question or its follow-up
(`hiddenTagSources`).

## D. The numbers

`buildReportSnapshot()` replaced `computeBothWindows` and `buildFrozenMapPoints`, which loaded every
in-scope household, knock and survey into memory inside one web request.

- **The walk.** One aggregation cursor over `CanvassActivity` (`{ organizationId, campaignId,
  timestamp < rangeEndUtc }` + the fence, `$group` by `householdId`, `$sort`, `allowDiskUse`) yields
  every household with activity before the period's end, in batches of `CLIENT_REPORT_BATCH` (default
  2,000). A build's memory is one batch.
- **Per batch**, indexed finds: the scope's knock rows (`KNOCK_ACTIONS`, the walk list's `effortId`,
  the team clause plus `NOT_BULK` on a team report), the map's status rows, the households
  (`isActive`, with coordinates, the walk list's current `effortId`), and the latest map answers.
- **One fold.** Scope rows are grouped into (household, round) groups keyed on `String(passId)` (a
  missing and a null round stay apart, as `$group` keeps them), and every window (cumulative, period,
  and the compared report's cut-off, §I) counts from the same groups: `doorsKnocked` (one per group),
  the surveyed, lit, refused, not-target and contact flags, one resolved outcome per group via
  `resolveStatus(campaignType, acts)`, and `homesKnocked` (distinct households; households are unique
  to a batch, so per-batch counts add up).
- **The fence.** Every ledger read adds `createdAt: { $not: { $gt: fenceAt } }`, which keeps rows with
  no `createdAt`.
- **Invariants** (`assertInvariants`): in each window Σ `contactBreakdown` === `doorsKnocked`, and
  period doors ≤ cumulative doors. They hold by construction; a failure fails the build loudly with
  `INVARIANT` and never commits.
- **Survey numbers** stay server-side aggregations with the fence and the scope: `surveysTaken`
  (`countDocuments`), `surveyedVoters` (`$match voterId ≠ null` + `$group` + `$count`, never
  `distinct()`), `computeSurveyBreakdowns` (per-question option counts, each write-in folded into one "Other";
  options sorted by count descending, ties in the survey's own order with "Other" after them; the
  client derives percentages that total exactly 100 per question), `computeTagBreakdowns`, and the
  internal `provenance` (`deskEnteredResponses`, `editedResponses`, `totalResponses`).

What the cards mean is unchanged ([METRICS.md](METRICS.md)): **cumulative** is everything before
`rangeEndUtc`, **period** is `[rangeStartUtc, rangeEndUtc)`. The breakdown is a **door-outcome**
breakdown, one resolved outcome per (household, round), so it sums to Doors knocked, and its
"Surveyed" can sit below Surveys taken (a home with two voters surveyed in one visit is one surveyed
door but two surveys). A door two canvassers knocked in one round is one knock with one outcome. The
`refused` row is "Declined to participate": a knock and a contact, never a survey. The client labels
live in [reportDerive.js](../client/src/lib/reportDerive.js) (`CONTACT_LABELS`).

**The `not_target` row.** `emptyEvents()` seeds `not_target: 0`, so those doors stay in the bar (a
status missing from the literal would drop doors, and the invariant check would catch it).
`contactOrderFor('survey')` and the null-type list slot it after `refused`; the lit-drop list leaves it
out. `deriveReportSections` drops it when its cumulative count is 0, so reports without such doors
render as before. Two units, as with refused: the breakdown resolves one status per (door, round),
while `totals.notTargetKnocks` is the per-group flag; in an overlap where one canvasser recorded Not a
target voter and a teammate later recorded Not home, the flag counts it and the breakdown reads
"Didn't answer". `totals` (including `refusedKnocks`, `notTargetKnocks`, `contactRate`) rides the
client payload whole; no client renderer shows those three.

**Tags** are window-local: `computeTagBreakdowns` freezes identified and current voters per window via
`currentVoterSetsByTag` ([SURVEYS.md](SURVEYS.md) §I), and the shaper filters them to the ticked tags.

**Goal** (`goalSnapshotFor`): `{ target, deadline, done, remaining, percent, asOf }` from the
campaign's `doorGoal` and `deadlineFor(campaign)`, with `done` = the report's own cumulative
`doorsKnocked` (so the bar counts what the card above it counts). A walk-list or team report never
gets one. Ticking the goal on a report with no frozen goal is `400 NO_GOAL_SNAPSHOT` for a walk-list
or team report or a campaign without a door goal, and `400 GOAL_AFTER_BUILD` when the campaign has a
goal but the report's numbers were built before it (it has a snapshot, or is published): "Your door
goal was set after these numbers were built. Recompute them — or Refresh numbers, on a published
report — to show it." (code review NUM-5, contract C6). A draft with no numbers yet takes the tick, and
its first build freezes the goal. Progress only: no pace, verdict or projection is ever stored.

**Provenance** rides the internal preview and *Before you publish* only; `shapeWindow` is a strict
whitelist, so it can't reach the client.

**Parity.** clientReportBuild.int.test.js pins the build against `computeWindowStats` and
`buildFrozenMapPoints` at the default batch and at `CLIENT_REPORT_BATCH=2`;
clientReportTeamParity.int.test.js pins team numbers against the dashboards (§H).

### The map rows

- **Status rows** (the door's status as of the period's end, `resolveStatus` over every status row
  before `rangeEndUtc`): campaign-wide `STATUS_ROW_MATCH` rows for whole-campaign and walk-list reports,
  so a door's status reflects knocks stamped before it joined the walk list; on a team report, the
  team's own rows (`NOT_BULK`) plus every `restricted` row on the door.
- **Households:** walk-list reports narrow the household set by the household's current `effortId`;
  team reports keep only doors the team knocked. Doors that resolve to `unknocked` are skipped.
- **Answers:** the latest response per household carrying a map answer (ascending `submittedAt`, `_id`
  descending as the tie-break, so the last write wins), from the campaign's survey, before
  `rangeEndUtc`; on a team report, the team's own responses. Only `build.inputs.mapKeys`, each through
  `publicPointAnswer`.
- **Pins** are inserted per batch (`ordered: false`) with a running `seq`; `extent` grows from them.
  **Cells** accumulate in memory and are written once at the end (§G); `extent` is then the cells'
  outlines.

## E. Snapshots and the build state machine

A **snapshot** is one build's frozen output: the numbers on the report and the map rows tagged with
its `snapshotId`. A build never writes over a live snapshot; it writes a new one, and one atomic update
swaps it in. Builds run on the worker in their own queue, `QUEUE_NAMES.CLIENT_REPORT`
(`client-report-queue`).

**Kinds.** `recompute` (a draft: Create, Next, Recompute, Retry), `refresh` (a published report: its
result waits for Apply) and `remap` (a published report switching to areas). **Statuses:** `queued`,
`waiting`, `running`, `ready` (refresh only), `failed`, `idle`; `buildView` shows a running build whose
heartbeat is 5 minutes old as `stalled`.

**`build`** holds `{ kind, status, jobId, inputs, snapshotId, snapshotKey, fenceAt, fenceSeen,
startedAt, beatAt, waitingSince, waitingFor, rebuilds, progress, error: { code, message, … }, result,
requestedBy, finishedAt, readyAt, cancelledAt/By, discardedAt/By, appliedAt }`. **`build.inputs` is the
build's target**: `{ showMap, mapMode, areaSize, mapKeys, questionDeps, coordinatorIds }`, frozen at the
claim by `inputsFromSettings`, pruned by removals while the build is live, and written by the commit or
Apply as-is (nothing intersects it with the report's other settings).

**Liveness** (`buildIsLive`, one helper for every gate): `queued` and `waiting` are live while the
queue reports the job `waiting`, `delayed`, `active`, `prioritized` or `waiting-children` and the claim
is under two hours old; `running` is live while `beatAt` is under 5 minutes old. Anything else is dead,
and the next claim, Publish or Take down replaces it in its own CAS.

**Claim** (`claimBuild`, web): refused with `409 REVIEW_PENDING` over a `ready` result (apply or
discard it first) and `409 REPORT_BUSY` over a live build (worded by state); otherwise one
`findOneAndUpdate` on `{ _id, organizationId, status, 'build.jobId': <the one observed>, 'build.status'
≠ ready }` sets a fresh `build` with a new hex `jobId`. A status that moved meanwhile is `409
STATUS_CHANGED`. The pre-image's rows go through the discard helper. **Enqueue** (`enqueueBuild`):
`attempts: 1`, `removeOnComplete` after 24 hours or 500 jobs, `removeOnFail` after 7 days, under a
timeout (`CLIENT_REPORT_QUEUE_TIMEOUT_MS`, else `QUEUE_ENQUEUE_TIMEOUT_MS`, else 5 s); if the queue
can't take it, a CAS on its own `jobId` marks it `failed` with `ENQUEUE_FAILED` ("Couldn't start — try
again").

**Cancel** (`cancelBuild`) replaces the whole object (`{ status: 'idle', cancelledAt, cancelledBy }`)
and removes the queued job. Every worker write matches on `build.jobId` and `build.snapshotId`, which
the replacement removes, so a cancelled build's heartbeat, commit and failure writes all miss.

**The one discard helper** (`discardBuildRows`): Cancel, Take down, Publish's replacement of `build`,
a dead build's reset and Discard all hand it the pre-image of their write, and it deletes the build's
rows only when the pre-image's `build.snapshotId` is an ObjectId different from the live `snapshotId`.
Otherwise it deletes nothing and the nightly sweep handles leftovers, so a legacy report's live rows
(`snapshotId: null`) can never be deleted by a cancel.

**Each attempt** (`processClientReportJob`, inside `sweptAfter`):

1. **Own the attempt**: a CAS on `{ _id, 'build.jobId', 'build.status' ∈ queued|waiting|running, status:
   <draft for recompute, published otherwise> }` sets `running` and a **fresh** `snapshotId` and
   `snapshotKey`, then hands the previous attempt's rows (a stall or a delayed redelivery) to the
   discard helper.
2. **Deletion**: a campaign or organization whose deletion was requested stops the build for good
   (`UnrecoverableError`), checked again before every batch.
3. **Wait outside the slot** (not for a remap): if `otherChangeRunning(campaignId)` reports an answer
   edit, survey conversion, unknock or re-cut, the attempt deletes its rows, marks the build `waiting`
   with `waitingFor` ("for the answer edit on this campaign to finish") and `waitingSince`, moves the
   job back to the delayed set (`CLIENT_REPORT_WAIT_RETRY_MS`, default 30 s) and throws `DelayedError`,
   which frees the worker slot and isn't an attempt. After `CLIENT_REPORT_BLOCKED_AFTER_MS` (default 30
   minutes) of waiting it fails `BLOCKED`, naming what is running (and "press Stop on Door Outcomes"
   for an answer edit).
4. **The team check** (team `recompute` only): every coordinator in the team must still run a crew on
   the campaign and no past one may run one again (`teamChangedFor`), else it fails `TEAM_CHANGED`,
   carrying `seriesId`, `departed` and `returned`, and the builder shows the team-changed card instead
   of Retry (§H). Refreshes and remaps skip it.
5. **Fence**: `fenceAt = now`, written in the same CAS as `fenceSeen` (each change source's rows within
   60 seconds of the fence, by id and version) and `running`; `waitingSince` is unset.
6. **Heartbeat**: a 30-second timer (`CLIENT_REPORT_BEAT_MS`), plus a beat per batch, CASes `beatAt`
   and `progress` on `{ jobId, snapshotId }`. Progress is households done ÷ the households the walk
   visits, which `buildReportSnapshot` counts with one aggregation before it starts and hands over with
   each batch (code review STATE-4; the old denominator, the campaign's households, left the bar short
   of the end), capped at 99 until the commit (a ready Refresh reads 100); a remap counts the live
   snapshot's pins. A miss means the build was cancelled or replaced, and the next batch stops it, but
   a miss counts only once a re-read confirms it: the job id changed, or the build's snapshot is neither
   the one the beat matched on nor the attempt's current one (STATE-1: a beat sent just before a
   rebuild moved the snapshot used to read as "superseded", which completed the job and left the report
   reading running for good).
7. **Build** (§D), or for a remap the cells from the live pins (§G).
8. **Changed during the build?** A change still in flight sends it back to step 3. Otherwise, any
   `AnswerEditRun`, `SurveyConversionRun`, `UnknockRun` or `ReclassifyRun`, any knock-clearing
   `TurfSnapshot` created or restored, or on a team report any `CoordinatorChange`, that is new or
   changed since `fenceSeen`, or any ledger row of the campaign created before the fence and updated
   after it, makes it rebuild **once** under a new snapshot and fence (`build.rebuilds`, kept on the
   document so a redelivery remembers); a second fails `CHANGED_DURING_BUILD`. The attempt follows the
   move to the new snapshot at once, before the first build's rows are deleted, so a beat during that
   delete matches the new snapshot (STATE-1).
9. **Arrivals**: knocks in the report's scope with `createdAt > fenceAt` and `timestamp <
   rangeEndUtc` become `arrivedDuringBuild`.
10. **Commit** (`commitBuild`): re-read `build.inputs` after the last row write, prune this snapshot's
    rows to them (no rows at all when the map is off), then one CAS on `{ _id, 'build.jobId',
    'build.snapshotId', status, 'build.inputs.showMap', 'build.inputs.mapKeys' (pinned with $all +
    $size) }`, a pipeline update that reads `$build.inputs` inside the write, retried up to five times
    if a removal moved the inputs. A `recompute` swaps in the numbers, `snapshotId`, `snapshotKey`,
    `snapshotInputs`, `statsComputedAt: fenceAt`, then deletes exactly the previous live snapshot's
    rows; a `refresh` sets `ready` with `build.result` (which also carries `areaWithoutAnswers`: the
    single-choice map questions an area snapshot shows no answers by area for, `[{ key, label }]`,
    code review WALK-7); a `remap` is §G. A commit that misses marks the build `failed` with
    `SUPERSEDED` and deletes its rows only after re-reading that they aren't live.

The worker registers the queue at **concurrency 2** (`CLIENT_REPORT_JOB_CONCURRENCY`) with
`maxStalledCount: 2`; a stall redelivery writes under its own snapshot. Its `failed` listener
(`reconcileFailedClientReportJob`) CASes only a build still queued, waiting or running under that job,
never a `ready` one, to `failed` with `DELETING` or a generic `FAILED`, leaving the rows to the sweep.
The builder shows "Queued (2 ahead)" from the queue's waiting list (`queuePositionOf`).

**Build error codes** (on `build.error.code`): `ENQUEUE_FAILED`, `BLOCKED`, `TEAM_CHANGED`,
`CHANGED_DURING_BUILD`, `SUPERSEDED`, `INVARIANT`, `DELETING`, `FAILED`. Retry is offered for all but
`DELETING` and `TEAM_CHANGED`.

**Known limits.** After a worker crash, BullMQ redelivers the build in about 30 seconds (its default
lock and stall timers, which the worker doesn't change), and the report reads "running" until the
redelivered attempt takes over; a build whose heartbeat stops for 5 minutes reads "stalled", with
Retry. The `BLOCKED` message says "30 minutes" in words, which assumes the default:
`CLIENT_REPORT_BLOCKED_AFTER_MS`, like `CLIENT_REPORT_WAIT_RETRY_MS` and `CLIENT_REPORT_BEAT_MS`, is a
test override, not a production setting.

**The nightly sweep** (`client-report-row-sweep`, 05:31 UTC, `CLIENT_REPORT_SWEEP_CRON`, in
`MAINTENANCE_JOBS`): reads at `sweepStart`, and every delete also requires the row's `snapshotId` to
have been minted before that instant (`ObjectId.createFromTime` takes seconds) or to be null, so a
build that starts after the read is never touched. It deletes rows whose report is gone; rows of
reports whose map is off, which includes any report with nothing live under the legacy fallback rule
(§C: an old draft, or a draft before its first commit), so old drafts' never-served rows go too
(sparing a live or ready build's snapshot); legacy rows (`snapshotId: null`) of
reports that now have a snapshot; and rows whose snapshot is neither the live one nor a live or ready
build's and was minted more than 24 hours ago. It logs `[maintenance] client-report-row-sweep: N orphan,
N map-off, N legacy, N stale row(s) over N report(s)`. Before that, since 2026-10-25, the job calls
`ensureReportPeriodGuard('maintenance')`, which re-checks the duplicate guard's index and heals or builds
it when it's missing (§B; silent when it exists).

## F. Lifecycle

**Create** (`POST /admin/client-reports`) resolves the series (§H), inserts the draft with explicit
visibility and a `recompute` already claimed, enqueues it and answers `201 { report, build, warnings
}`, where `warnings` is `['STARTS_AFTER_TODAY']` when the period starts after today in the campaign's
zone, as Next's does (the list page then opens the builder with `?ahead=1`, "This period hasn't
started yet."), else `[]`. The period is any `weekStart ≤ weekEnd`; the dates New report suggests
come from the week math below. Since 2026-10-25 it guards against accidental doubles (*No accidental
doubles*, below); its race answer carries no `warnings`.

**Edit** (`PATCH /:id`) writes only the fields sent (of `visibility`, only the keys sent: §C), with a
targeted pipeline `$set` and `editVersion + 1`; a build never blocks it. Every removal goes through
§C's path. On a **published** report (shown
or taken down) it accepts the title, observations, headline, visible questions and tags, the goal
tick, `copiedNotesReviewed`, and the removals; it stamps `contentEditedAt/By` and writes an `edited`
History row from the write's own pre-image. Anything that adds to the map is `400 NEEDS_REFRESH` with
`reasons` (`map_on`, `map_questions`, `back_to_exact_doors`, `area_size`). On a published report the
on-screen `mapMode` and `areaSize` always follow the live snapshot; areas on a pins report claims a
`remap` **before** the write, so a refusal (another build live, a review pending) refuses the whole
edit. On a draft, mode and size are ordinary settings that take effect at the next Recompute.
`ifStatus` makes an edit refuse with `409 STATUS_CHANGED` instead of landing on a report whose status
moved, and the write's filter always pins the status the request read (§C). `ifEditVersion` makes it
refuse with `409 CHANGED_ELSEWHERE` (and the report as it stands) instead of landing on a version the
screen never saw (§C, contract C8). The builder sends `ifStatus: 'draft'` with every draft auto-save
and the unmount keepalive, `'published'` with Update and the remap retry, and `ifEditVersion` with all
four: a draft's, the version its screen reflects; an open edit's, the version at Edit or at its last
merge (§Q). A goal tick on numbers built before the campaign's goal is `400 GOAL_AFTER_BUILD` (§D).

**Recompute** (`POST /:id/recompute`, drafts only, else `400 NOT_DRAFT`) claims a `recompute` from the
on-screen settings and the team's current crew keys: `202 { build }`.

**Publish** (`POST /:id/publish { snapshotId, editVersion }`) is not a build. Refused with `409
ALREADY_PUBLISHED` on a published report; `409 RECOMPUTE_NEEDED` with `reasons` when there is no
snapshot (`no_snapshot`) or the on-screen settings add to `snapshotInputs` (`map_on`,
`map_questions`, `map_mode`, `area_size`, or on a team report `crews` when the team's crew keys
differ from the snapshot's). Then one CAS on `{ status: draft, snapshotId: <previewed>, editVersion:
<previewed> ($in [0, null] when 0) }` sets `published`, `publishedAt/By`, `openMockFlagsAtPublish`
(scoped to the report's walk list or team) and replaces `build` with idle, cancelling any recompute
still queued or running (its job is removed, its rows discarded). A miss is `409 SNAPSHOT_CHANGED` (a
recompute landed since the preview) or `409 SAVING` (an edit landed). Without previewed ids it freezes
whatever is live. The builder always sends them, after flushing pending saves, and the `editVersion` it
sends is the one its screen reflects (the seed's, then each of its own saves that landed alone), never
one learned from a later re-read, so Publish can't freeze text or settings the operator never saw (code
review ADMINUX-1, §Q).

**Refresh** (`POST /:id/refresh { map? }`, published only, else `400 NOT_PUBLISHED`): the base is the
report's current settings, plus the additions (`showMap: true`, `mapKeys`, `mapMode`, `areaSize`). A
map key that isn't a choice question whose chart is shown is `400 MAP_KEYS_NOT_ALLOWED`; one whose
dependencies aren't all on the map is `400 MAP_KEYS_NEED_PARENTS` (with each key's parents). The map
questions it builds are the **final list** (code review VERIFY-2): on a served map, what the live
snapshot serves plus the request's keys; turning the map on, exactly the request's keys (the dialog
offers the picks the report kept while its map was off, ticked, and sends what is still ticked; before
this they all went on the client's map, unseen and shown unticked); a refresh that leaves the map off
builds no map and keeps the stored picks. A team report rebuilds with `snapshotInputs.coordinatorIds`,
its frozen crews. **Apply** (`POST /:id/refresh/apply { snapshotId }`) is a CAS on `{ status:
published, 'build.status': ready, 'build.snapshotId': <reviewed> }`, a pipeline that swaps in
`build.result`, `snapshotId`, `snapshotKey`, `snapshotInputs` and `visibility.{showMap, mapMode,
areaSize}` from `build.inputs`, and `visibility.mapAnswerKeys` from `build.inputs.mapKeys` only when the
build's map is on (a refresh that leaves the map off keeps the stored picks, VERIFY-1); it bumps
`editVersion` (contract
C8: an edit opened before the Apply merges onto it), stamps `numbersRefreshedAt/By`, then deletes the
previous live rows and writes a History row with the before-and-after doors, surveys, voters and lit
drops. **Discard** CASes `ready → idle`
and deletes that result's rows only when the CAS matched. Miss: `409 NOTHING_TO_APPLY` /
`NOTHING_TO_DISCARD`.

**Remap** (Switch to areas) is §G. **Cancel** (`POST /:id/build/cancel`): `409 NOTHING_TO_CANCEL`
when nothing is live.

**Take down** (`POST /:id/take-down`; the old `/unpublish` is now an alias of it) sets
`takenDownAt/By` on a shown published report and replaces `build` with idle (cancelling any live build
or ready result); already down is a no-op; not published is `409 NOT_PUBLISHED`. **Put back up**
clears `takenDownAt`, keeps `publishedAt`, and is instant. Every public route filters `takenDownAt:
null`. There is no path from published back to draft.

**Delete** (`DELETE /:id`) deletes the report, clears any `nextReportId` pointing at it, deletes every
map row with its id, writes a `deleted` History row, and with `?eraseHistory=1` (admins) erases its
earlier text (§M). A live build's heartbeat misses and it stops; the sweep catches anything left.
Since 2026-10-25 it also deletes the report's one-report links (`ReportShareLink` with `reportId` =
the report), each with a `reportLink.deleted` History row whose `toValue` is `{ label, reportDeleted:
true }` (a flag inside `toValue`, as the legacy sweep's: `CampaignChange` has no `via`), shown as
"Board · Link deleted" with "Deleted with its report" under it (§M). They go AFTER the report, so a
link being made at the same moment is either seen here or finds the report gone and deletes itself
(§K). A holder of a deleted link gets `loadShare`'s `404 SHARE_NOT_FOUND`, "This link isn't
available. It may have been replaced or switched off — ask the person who sent it." (and the device
forgets its session); the hub's `gone` and "This report was taken down or removed…" cover a deleted
report only until its links are gone (later in the same request). Drafts can't have links, so ending a
team and Next's losing request need nothing.

**Next** (`POST /:id/next`): if the source's `nextReportId` still exists, that draft comes back
(`200 { report, build, existing: true }`). Otherwise the series is re-validated (ensured for a report
from before series, `409 SERIES_ENDED` when ended, `400 TEAM_ATTRIBUTION_NOT_READY`). The campaign
zone, today in it and the organization's week are worked out **first**, then the period is
`nextPeriod(source, weekStartsOn, today)` (below), in the source's frozen zone, and must start exactly
at the source's `rangeEndUtc` (`409 NEXT_PERIOD_MISMATCH`; every rule starts the day after the source,
so it never fires). ONE read of the series' later reports then decides: one for exactly the next
period is answered `200 { report, build, existing: true }` (a double click's second request, or the
same dates made in New report); any other later report is `409 NOT_LATEST_REPORT`. (Two reads, the
exact one then "any later", let a sibling click's draft land between them and answer
`NOT_LATEST_REPORT`.) A catch-up that New report's own rule would replace with last week (longer than
14 days, `CATCH_UP_MAX_DAYS`) is refused `409 NEXT_GAP_TOO_LONG { error, catchUp: { weekStart,
weekEnd }, suggested: { weekStart, weekEnd } }`, "More than two weeks have passed since this report.
Choose the next report's dates in New report.", and the row opens New report with `suggested` picked
and that `error` sentence at the top of its dates (`initial.notice`; since the simplify build's code
review round 2, FRESH-3, before which the sentence was dropped). The draft is inserted first with a
pre-generated `_id`, `dupGuard: true` and a claimed recompute; a
duplicate-key error on `report_period_guard` answers the draft that got in (`existing: true`), or, if
that one was deleted in between, inserts once more. Then the source is CASed `{ nextReportId: null or a
deleted id } → <this _id>`; the loser deletes its own draft and returns the winner (`409 NEXT_RACE` if
the winner vanished). It copies the observations (`copiedFrom`, `copiedNotesReviewed: false`), the
visibility, tags, goal tick and headline, not the title, and answers `201` with `warnings:
['STARTS_AFTER_TODAY']` when the period starts after today in the campaign's zone. Next never answers
`REPORT_EXISTS`.

**Dates.** "Period not over" is `now < rangeEndUtc`; numbers are "stale" after an hour
(`clientReportChecks.js`). `periodPhrase` in reportDerive.js counts civil days (a DST week is 7) and
routes every formerly weekly string: the KPI pills and help, the quiet-period banner, the map's empty
line, the hub heading ("Weekly reports", "Daily reports", "Reports"), and the PDF's title, quiet line
and filename.

### Report weeks and the next period

Built 2026-10-25 ([PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md](PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md) §C).

**The organization's week.** `Organization.reportWeekStartsOn` (§B), Monday unless an admin changes
it. [routes/admin/clientReportSettings.js](../server/src/routes/admin/clientReportSettings.js),
mounted at `/admin/client-reports/settings` ahead of the reports router (as `/shares` is, so `/:id`
never reads `settings`): `GET` → `{ weekStartsOn }` for admins and leads; `PATCH { weekStartsOn: 0..6 }`
→ `{ weekStartsOn }`, admins only (`403 FORBIDDEN_ROLE` for a lead, as the logo), anything else `400
INVALID_WEEK_START` ("Choose the day of the week your report weeks start on."). It always reads the
active organization (`X-Org-Id`): one you aren't in answers `403 ORG_CONTEXT`, a missing or deleting
one `404` (`orgContext`). Reports already made keep their dates; only what is suggested next changes.
Other pages' This week and Last week presets stay Monday-based (`client/src/lib/datePresets.js`). The
series picker (`GET /series`) also returns `weekStartsOn`, `today` (the campaign zone's civil day) and
`knockedBeforeThisWeek` (one `CanvassActivity.exists` for a knock action before this week's midnight
in the campaign's zone; the planner takes the single-field `{ campaignId }` index and stops at the
first earlier knock, one row for a campaign that has knocked before, all of a new campaign's rows
when none is an earlier knock: about 25 ms for 20,505 restrictions and notes, as measured in code
review), so New report needs no other request. New report reads it **again every time it opens**
(code review WEEK-1): a page's copy can be from yesterday, or from before an admin changed the week,
and its dates would then disagree with Next's (§Q).

**One definition, two copies, one fixture table.** The week math lives in
[services/reports/reportPeriods.js](../server/src/services/reports/reportPeriods.js) (Next, the picker,
`report:tab-weeks`) and in [reportDates.js](../client/src/components/clientReports/reportDates.js) (New
report), the same function bodies: pure functions on civil `YYYY-MM-DD` days in the campaign's zone,
the weekday from `Date.UTC`, so no clock or zone is read and a DST week is seven days like any other.
[test/fixtures/reportPeriods.json](../server/test/fixtures/reportPeriods.json) (499 cases, each with a
note, their expectations from an independent brute-force reference) is run by
[test/reportPeriods.test.js](../server/test/reportPeriods.test.js) and
[reportPeriods.parity.test.js](../client/src/lib/reportPeriods.parity.test.js): a change to one copy
fails the other's test until both say the same thing (the `bookStatusFilter.js` pattern). `s` is the
week start, 0–6.

- `weekStartOf(day, s)`, `weekEndOf(day, s)`; `lastWeek(today, s)`, the most recent full week;
  `thisWeek(today, s)`, the whole current week; `wholeMonthsOf(start, end)`, N ≥ 1 when the range is N
  whole calendar months, else 0.
- **`nextPeriod(last, s, today)`**, with `S` the day after `last`. Every rule starts at `S`, so Next's
  contiguity check holds:
  1. N whole calendar months → `S` to the end of the Nth month (a month → the next month, a quarter →
     the next quarter). Checked first, so a February that is also four aligned weeks stays monthly.
     Kind `months`.
  2. A whole number of weeks, on any weekday → the same length again (a Sunday-to-Saturday tab carries
     on Sunday-to-Saturday). Kind `weeks`.
  3. Any other length: (a) if it ended on a report week's last day (`S` starts a week) → one week,
     kind `weeks`; without this a catch-up made a week late came out 14 days and rule 2 repeated 14
     days for ever. (b) Otherwise `catchUpPeriod`: `S` to the end of the last complete report week, or,
     when that is before `S`, to the end of the week `S` falls in; kind `catch_up`, branch `last_week`
     or `this_week`. It always starts mid-week, so it is never whole weeks.
- **`suggestPeriod({ last, s, today, knockedBeforeThisWeek })`**, New report's first choice: no last
  report → `lastWeek` (kind `last_week`), or `thisWeek` (kind `this_week`) when
  `knockedBeforeThisWeek === false`; otherwise `nextPeriod`, then the long-gap rule on the series' own
  cadence, a run being complete when its last day is before today. Weeks and months: the grid is the
  series' runs continued (every 7·N days, or every N months, from the next period); when at least one
  more complete run lies on it after the next period, the most recent complete run, with `skipped`
  naming the days before it. A catch-up longer than `CATCH_UP_MAX_DAYS` (14) → last week, with
  `skipped`. A first choice that ends after today is kept (the old cap at yesterday is gone). Returns
  `{ weekStart, weekEnd, kind, weeks?, months?, branch?, longGap, skipped, equalsLastWeek }`.
- Server only: `reportWeekStartsOnOf(org)`.

The old client `defaultPeriod` (the last report's length again, from the next day, capped at
yesterday) and Next's same-length rule are gone: copying the last report's length is what kept making
odd periods like "Oct 14 – Oct 26" (one 13-day report made every report after it 13 days, and the cap
at yesterday made more odd lengths).

**New report's choices** ([newReportChoices.js](../client/src/components/clientReports/newReportChoices.js),
pure, tested without React): `dateChoices` puts `suggestPeriod`'s choice first, labelled by kind and
branch (`choiceLabel`; the words are quoted in Part 1), then Last week and This week, not over yet,
each unless it repeats the first; the dialog adds Pick dates. A long-gap choice has no "after your
last report" and carries `skipped` ("No report covers …"). `weekNudge` returns the nudge only when the
tab's last report runs whole weeks by rule 2 and its next run starts on another weekday than `s` (a
rule-3a week always starts on `s`, and a February month is kind `months`); its **Move this tab** choice
is `catchUpPeriod`, or last week with `skipped` when that catch-up runs past 14 days.
`duplicateText` words `REPORT_EXISTS`. The dialog opened with dates (`NEXT_GAP_TOO_LONG`'s `suggested`,
the list page's `?new=1&seriesId=&weekStart=&weekEnd=` link, a Continue hand-back) selects the choice
with those dates, else Pick dates with them. Admins' **Change** is an inline panel in the dialog
(`PATCH …/settings`, after which the dates are suggested again).

### No accidental doubles

Built 2026-10-25 (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §E). A tab is its `seriesId`.

- **Look first.** `POST /admin/client-reports` finds the reports with the same `organizationId`,
  `campaignId`, `seriesId`, `weekStart` and `weekEnd` (the organization and campaign keep the query on
  the campaign index; `{ seriesId, … }` alone was a collection scan) and answers `409 { code:
  'REPORT_EXISTS', error, reportId, status, takenDown, weekStart, weekEnd, scopeLabel }`, naming the one
  most worth opening (a draft, then one the client sees, then one taken down, the newest of each;
  `scopeLabel` is the tab's current name), unless the body has `allowDuplicate: true` (**Make a second
  one**). `error`: "You already have a draft {tab} report for {period}." / "You already published
  a(n) {tab} report for {period}. To bring its numbers up to date, open it and press Refresh numbers."
  / "…, taken down."
- **The race** is closed by the database, not by comparing ids (round 1 of the plan's review showed id
  order isn't arrival order): every create without `allowDuplicate`, and Next's insert, sets
  `dupGuard: true`, and `report_period_guard` (§B) lets one guarded report per tab and period in. A
  create that loses there (`isReportPeriodGuardError`: `E11000` naming the index, or its key pattern)
  answers `200 { report, build, existing: true, createdByName }`, the winner and its creator's first and
  last name; if the winner was deleted in between, it inserts once more. The guarded insert comes
  before `enqueueBuild` and `writeReportHistory`, so a loser leaves no job and no "created" row.
- Reports made before the field, and deliberate second ones, are outside the guard. Deleting a report
  frees its key. Next never answers `REPORT_EXISTS`: an exact later report is `existing: true` (above).

## G. Area view

[areaCells.js](../server/src/services/reports/areaCells.js). `visibility.mapMode: 'area'` with
`areaSize` small or large maps to H3 resolution 9 (about 1,100–1,400 ft across, 23–30 acres) or 8 (about
0.55–0.7 mi across), via `h3-js` (`latLngToCell`, `cellToBoundary(h, true)`). Fixed hexagons, the same at
every zoom: not clustering.

- **Cells** bin the build's would-be pins in memory (`createCellBin`): `doors`, `byStatus`, and for
  each **single-choice** map question `{ n, options }`. A multiple-choice answer never bins. They are
  inserted once at the end of the build.
- **The rule, all or nothing per question** (owner ruling 2026-10-24, `areaAnswerKeys`): a candidate
  shows area answers only when it has an answer somewhere and **every** cell with an answering home has
  `n ≥ 5` (`MIN_AREA_ANSWERS`). A follow-up shows them only when every question it depends on shows its
  own, to a fixpoint, so a follow-up of a multiple-choice question never does. The decision reads counts
  only, never answers. `applyAreaRule` strips every other answer, so a cell where a question isn't shown
  carries one state: no answers to show. The rule runs when the cells are written and **again when they
  are read** (`areasPayload`, over the served questions), so a parent dropped after the build takes its
  follow-ups' area answers with it.
- `doors` and `byStatus` show for every cell, even a one-home one.
- **Remap** (Switch to areas on a published pins report): claimed by the PATCH with `build.inputs` =
  the live inputs with areas and the size (minus that edit's removals). It doesn't wait for other
  changes, skips the team check and has no fence: it bins the **live snapshot's pins** (their stored
  answers, single-choice decided from the frozen breakdown types) under a new snapshot, and its commit
  sets, in one update, `snapshotId`, `snapshotKey`, `snapshotInputs`, `visibility.mapMode`,
  `visibility.areaSize`, `areaCellCount`, `mapPointCount: 0`, `extent` from the cells,
  `contentEditedAt/By` and `editVersion + 1` (the map view is a setting the builder edits, so an edit
  opened before the switch merges onto it instead of writing over it, contract C8), leaving `build` as
  `{ kind: 'remap', status: 'idle', finishedAt, areaWithoutAnswers }`; then it deletes the pins and
  writes a `remapped` History row. The numbers don't change. Until it commits the client keeps seeing
  pins; if it fails or is cancelled, nothing changed.
- **Which questions show no answers by area** (`areaWithoutAnswers`): *Before you publish* lists them
  on a draft, and since code review round 2 (WALK-7) a published report learns them too. A refresh's
  ready result and a finished remap carry them (`areaWithoutAnswersOf` at the commit: on the map the
  commit pins, chart shown and parents mapped, but not among the questions the area rule let through),
  `GET /:id/build` returns them top-level, the Refresh review and **Worth a look** name them, and the
  switch's confirm warns before it starts. *Before you publish* also names, per question, the other
  shown reports of the campaign that map it (door by door or by area) or chart it for a narrower scope
  (`areaNarrowedBy`), since a link to all your reports shows them all. A link to one report shows only
  that report, but one person can hold several links, so every shown report still counts (the
  `areaNarrowing` comment in clientReportChecks.js says the same).

## H. Series and team reports

**`ensureSeries`** is the one idempotent find-or-create of a `campaign`, `walk_list` or
`team_walk_list` series: an upsert on the partial index's identity, shared by Create, Next and the
migration, which also stamps that scope's legacy reports (no `seriesId`) with the series and a frozen
scope (a walk-list report keeps its own frozen `effortName` as its label). Teams are created by
`createTeamSeries`.

**The five indexes**, all partial on `endedAt: null`, with fixed names that duplicate-key errors map
from:

| Name | Keys | Partial filter |
|---|---|---|
| `series_label_unique` | `{ campaignId, labelKey }` | `kind ∈ campaign, walk_list, team` |
| `series_campaign_unique` | `{ campaignId, kind }` | `kind: 'campaign'` |
| `series_walk_list_unique` | `{ campaignId, effortId }` | `kind: 'walk_list'` |
| `series_crew_unique` | `{ campaignId, crewKeys }` (multikey) | `kind: 'team'`, `crewKeys.0` exists |
| `series_team_walk_list_unique` | `{ campaignId, teamSeriesId, effortId }` | `kind: 'team_walk_list'` |

So a crew is in at most one active team, current or past; two teams that both lost every crew coexist;
a team on a walk list derives its name ("Volunteer team · North") and follows its parent's renames,
crews and end. Duplicate-key errors become `409 TEAM_LABEL_TAKEN` or `409 CREW_IN_OTHER_TEAM`, naming
the other series. Repeated walk-list names get " (2)", " (3)" against the campaign's active label keys.

**Labels and the name check.** Operator-typed labels are 1-60 characters (`400 SERIES_LABEL_INVALID`).
`namesInLabel` finds, as whole words of three or more letters (accents folded), the first or last
names of the campaign's crew members and coordinators (`CampaignAssignment` rows). A team label that
contains one is `400 TEAM_LABEL_HAS_NAME`; a new walk-list series label, a combined team-and-walk-list
label, or a walk-list Rename that matches is `400 WALK_LIST_LABEL_HAS_NAME` with `names` and
`confirmable: true`, accepted on resend with `confirmLabel`. Next doesn't re-check names. A name
matching an ended series with published reports is `409 SERIES_NAME_ENDED` (with `canContinue`); the
campaign and team-on-walk-list labels can't be renamed (`400 SERIES_LABEL_FIXED`).

**Crews.** `runningCrews(campaignId, organizationId)` = coordinators with `CampaignAssignment` rows
here. A team needs at least one (`400 TEAM_NEEDS_CREW`), each running here (`400
TEAM_CREW_NOT_RUNNING`). `editSeries` (one CAS on `updatedAt`, else `409 SERIES_CHANGED`) handles
rename, `coordinatorIds`, `keepPast` (move to past: still counted, exempt from the crew check),
`removePast`, `makeCurrent` (a past coordinator running a crew again), `end` (with `deleteOpenDrafts`
from the route) and `continue` on an ended team, which re-validates the crews the way Change crews does:
the picked crews become the current ones, a current crew left unticked (one now in another team
included) leaves the team rather than being kept as past, and a past crew picked again leaves the past
list. The builder sends a departed lead's keep-or-remove choice in a first PATCH, before the continue.
The route writes History rows for what changed, naming the team as it reads after the change
(`seriesLabelOf`): `renamed`, `crewsChanged`, `ended`, and since code review round 2 `continued` (§M).
Team reports need team attribution: an organization without `teamAttributionReadyAt` gets `400
TEAM_ATTRIBUTION_NOT_READY`.

**Org scoping** (code review SEC-1). `GET /series` and `GET /series/affected` load the campaign in the
active organization (`loadCampaignInOrg`, `404` otherwise) before anything else: `manages()` alone is
not org scoping, because `canManageCampaign` says yes to any org admin for any campaign id, and an
admin of one organization could read another organization's crew names through the picker. Every read
behind the picker (`runningCrews`, `CampaignAssignment`, `Effort`, the report counts) and behind
`validateCrews`, `makeCurrent` and the team-changed card carries `organizationId` too.

**Ending a team** with `deleteOpenDrafts` (code review STATE-3) cancels each open draft's build, then
deletes only what is **still** a draft (`findOneAndDelete` with `status: 'draft'`), so a draft published
since it was listed keeps its map. For each draft actually deleted, as `DELETE /:id` does, it clears any
`nextReportId` pointing at it, deletes that report's map rows and writes a `deleted` History row.

**The team-changed card** reads `GET /series/:seriesId/team-changed?reportId=`: each departed
coordinator's name, crew size (canvassers whose doors carry her stamp), how many now have no crew and
which crews the rest joined, and `removeDoors`, what "Remove them" takes out of the team's totals: the
team's door count with her crew minus without it, both counted the way the build counts doors (one per
household and round, `knocksPipeline` with `NOT_BULK`, the report's walk list) and both up to the
report's `rangeEndUtc` (code review NUM-4; the old figure counted every door her crew ever knocked,
including doors another crew of the team knocked that round and knocks after the period). The card
sends `reportId` (`400` when invalid, `404 REPORT_NOT_FOUND` when it isn't one of the team's reports);
without it the route reads the team's newest draft whose build stopped on `TEAM_CHANGED`, else its
newest report. Continue PATCHes the choice and claims a recompute. On an ended team the card offers no
End, and Change crews opens the Continue dialog.

**Team numbers.** The team clause is `crewsMatch(coordinatorIds ∪ pastCoordinatorIds)` in
[aggregations.js](../server/src/services/reports/aggregations.js): each coordinator's `teamMatch` (her
crew's stamped rows plus her own unstamped ones), OR'd; no crews matches nothing. Doors add `NOT_BULK`.
A home or voter both teams reached counts for both. Pinned by clientReportTeamParity.int.test.js: doors
match `/team-breakdown` except in a window where only the lead knocked (that route folds a lead's own
doors only when the crew also knocked); surveys, voters and tags match the crew-filtered
`/campaign-rollup` and `/survey-results`. Mock-GPS counts follow the scope (`countOpenMockFlags` gains
`effortId` and `coordinatorIds`).

**Team figures in *Before you publish*** (`checks.team`, `teamPeriodFigures` in clientReportChecks.js,
code review contract C1; computed once the report has a snapshot): `{ canvassers, teams: [{ seriesId,
label, doorVisits, isThis }], teamsTotal, scopeDoorVisits, multiTeamDoorVisits, noTeamDoorVisits,
scopeLabel }`. `teams` is this report's team first (its **frozen** crews, so its figure equals the
report's own period doors knocked), then every other active team of the campaign by label (its series'
crews now), each tested on its own rather than as a first match, since a report's frozen crews can still
name a crew that has since moved to another team. `teamsTotal` is the sum of those rows, so a visit two
teams made counts twice in it. `scopeDoorVisits` is the period's door visits in the base scope (the
whole campaign, or this report's walk list; `scopeLabel` names it), every row a whole-campaign or
walk-list report counts, bulk entries included; `multiTeamDoorVisits` counts those made by two or more
teams (each team's report counts them, owner ruling 10-24); `noTeamDoorVisits` those no team made
(canvassers with no crew in a team, or entered in bulk, since bulk rows belong to no team). One
aggregation, grouped by door and round with the set of teams that made each visit, counted the way
the build counts doors: knock actions, the period, rows with a household, the report's numbers'
cut-off (`numbersCutOff`). `canvassers` (the period's canvassers for the team, bulk excluded) is
unchanged. The old figure counted crews and "No team" rather than teams (code review NUM-2).

## I. Earlier totals

Each build of a report with a comparison report recounts that report's cards up to its cut-off. The
comparison report (`comparedReportFor`) is the same series' published, shown report with the latest
`rangeEndUtc` on or before this report's `rangeStartUtc` (tie-break `publishedAt` descending, then
`_id`); a report from before series matches `seriesId: null` and the same `effortId`. The build freezes
`earlierTotals` (`doorsKnocked`, `homesKnocked`, `litKnocks`, `surveysTaken`, `surveyedVoters`),
`comparedReportId` and `comparedSnapshotId` (that report's live `snapshotId` at the build, `null` for
a report from before snapshots).

**The recount** ([buildReportSnapshot.js](../server/src/services/reports/buildReportSnapshot.js),
code review NUM-3) mirrors what the earlier report froze: rows timed before its `rangeEndUtc` that it
had received by its cut-off (`numbersCutOff(prev)`; a row with no `createdAt` counts as received in
time), plus rows timed before the cut-off that arrived after it (late syncs, the corrections the line
is for). A row timed and received after the cut-off is left out: it is only the rest of a period whose
numbers stopped early. Surveys follow the same rule on `submittedAt`. A cut-off at or after the
period's end changes nothing. (The old rule counted "timed before the cut-off", which read a phone
clock a few minutes fast as a door taken away.)

**The line is computed when shown** (`earlierTotalsLine`): it compares the frozen recount with what
that report froze **now**, for the visible cards (survey campaigns: doors knocked, surveys taken,
voters surveyed; lit drop: doors knocked, lit dropped, homes knocked), keeping only cards that moved.
If the compared report was deleted or is no longer published, the line is dropped. It is also dropped
when the compared report's numbers were refreshed after this build recounted them
(`comparedSnapshotMoved`: its live `snapshotId` is no longer `comparedSnapshotId`; two nulls match, so
a report from before snapshots keeps its line until a refresh gives it one), because the recount says
nothing about what it shows now: read against new numbers, a refresh that added a week's doors would
tell the client totals went down (code review NUM-1). Any new live snapshot of the earlier report,
a remap included, hides the line, which is the safe direction. If it was taken down, or is no longer
the series' latest shown report ending on or before this one's start, only the "since …" clause is
dropped. The builder's version (`earlierTotalsCheck`) adds, per card, what it sent and what it reads
now, and a reason chosen by cause: on a team report, crews that differ from the compared report's
frozen crews (`crews_changed`), or a `CoordinatorChange` touching the team's crews between the two
cut-offs (`canvassers_changed_teams`); otherwise `records_changed`. When the line is hidden because the
earlier report moved, the check returns `earlierReportRefreshed: { weekStart, weekEnd }` instead, and
*Before you publish* names that report on a draft, with Recompute; on a published report, **Worth a
look** names it ("… Refresh numbers to compare again.") with Refresh numbers (code review round 2,
P-2; round 1 computed it there but never showed it).

**On a link to one report** (§K) the line names no other report: `earlierTotalsLine(report, {
oneReport: true })` returns the same `changes` with `since: null` and `before: <this report's
weekStart>`, and reportDerive.js words it "Totals from before Oct 19 were updated by −120 doors after
they were first reported." (the same nouns as the usual line), on the page and in the PDF (which
prints what reportDerive returns, folding − to -).

## J. The client's payload and the map readers

**Shaping** ([clientReportView.js](../server/src/services/reports/clientReportView.js)), used by the
public routes and the admin preview alike, so the preview is what the client gets:

- `shapeReportForClient`: `id`, `campaignType`, `title`, `effortName`, `scope: { kind, label,
  seriesKey, seriesLabel }`, `weekStart`, `weekEnd`, `timeZone`, `status`, the dates (`publishedOn`,
  `editedOn`, `refreshedOn`, and `numbersThrough` only when the cut-off is before `rangeEndUtc`, all
  civil dates in the report's zone), `observations`, `supportQuestionKey` (only when that question is
  visible), `stats.{cumulative, period}` through `shapeWindow` (`totals`, `contactBreakdown`, the
  visible `surveyBreakdowns`, the ticked `tagBreakdowns`; no `coverage`, no `provenance`), `goal` (only
  when ticked and frozen), `visibility: { showMap, mapMode, areaSize, mapVersion }` (never
  `mapAnswerKeys`), `mapPointCount`, `areaCellCount`, `earlierTotals` and `nav: { olderId, newerId }`.
  **No instants.** The report id is an ObjectId whose time is the draft's creation, not the numbers'
  cut-off.
- `mapVersion` (`mapVersionOf`, code review contract C7): an opaque key of the live snapshot's key,
  the mode, the area size and the served map questions, so it changes whenever what the map endpoints
  serve changes, a question taken off included (a removal keeps the snapshot key); `null` when the map
  isn't served. The page keys its map data and door lookups on it, so a re-read report re-reads its map
  at once. The admin preview shapes the on-screen overlay but passes `mapSource: report`, so its version
  is the saved report's, which is what its map endpoints read.
- `nav` (`seriesNav`, clientReportRead.js): the older and newer shown report of the same series,
  ordered the way the hub lists them (`rangeStartUtc`, then `publishedAt`, then `_id`) and compared on
  that whole tuple, so two reports starting the same day each get an arrow to the other (code review
  PUBUX-6; a comparison on the start alone gave both none). A draft in the preview reads as published
  now, where it will sit once published. On a link to one report, `nav` is `null` (§K).
- `GET /share/:token/reports/:id` answers `{ report, survey, single }`: `single` is true on a link to one
  report, which also gets `nav: null` and the earlier-totals line's `before` form (§I).
- `shapeReportListRow` (the hub): id, title, period, `campaignType` (null on a report from before that
  field; when no report in a tab has one, the hub judges lit drop from the totals, `hubShowsLit`),
  `effortName`, scope, the dates, map mode and count, and the headline totals. No `campaignId`, no
  breakdowns.
- `mapFilterSurvey`: the served map questions with their options and counts (the filter legend).

**The map readers** ([clientReportMap.js](../server/src/services/reports/clientReportMap.js)) read the
live snapshot only, `{ clientReportId, snapshotId: report.snapshotId ?? null }`, so an unapplied
refresh, a remap's leftover pins or a dead attempt's rows are never served. `checkMapRequest` runs, in
order: map served (else `404 MAP_NOT_SHARED`), the requested `snapshotKey` (else `409 MAP_UPDATED`),
then the live snapshot's mode (a pins request on an area report, or `/areas` on a pins report, is the
same `409 MAP_UPDATED`: the page is out of date).

- **`GET …/map`** (pins): `{ mode, snapshotKey, count, statusKeys, lng, lat, status, questions,
  answers: { <key>: [optionIndex | [optionIndex…] | null] }, extent }`, columnar arrays whose positions
  are the rows' `seq`, coordinates rounded to six decimal places, answers stripped to the served
  questions. No address, no id of any kind.
- **`GET …/map/doors?snapshotKey=&rows=`**: at most 200 positions (`400 TOO_MANY_ROWS`,
  `ROWS_REQUIRED`, `ROWS_INVALID`; `snapshotKey` required, `400 SNAPSHOT_KEY_REQUIRED`), returning each
  position's `addressLine1`, `city`, `state`, `status` and answers as `{ question: <label>, answer }`.
  Positions mean nothing outside the live snapshot, so nothing can be enumerated across reports;
  within a report a link holder can page through every address, as the full point list allowed before.
- **`GET …/areas`**: every cell with its `boundary`, `doors`, `byStatus` and the answers §G allows, the
  question legend, `areaSize` and `extent`.
- **Old reports**: their rows get `seq` (rank by `_id`) and the report its `extent` lazily on the
  first map read (`backfillLegacyRows`, idempotent, the same order the migration uses).

**Served once, gzipped, cached** (`sendMapPayload`, code review PUBUX-4). The pins rows are streamed
through a cursor (`batchSize` 2,000, only the fields the payload needs, sorted `seq` then `_id`) into
the columnar arrays, never loaded whole; the JSON is byte-identical to what loading them all produced.
One open of a 250,000-door report used to hold every row in memory on the one web dyno every customer
shares. A snapshot is frozen, so a payload's bytes are fixed by the report, its snapshot key, the
mode, the area size and the served questions (`mapPayloadKey`); the public link and the admin preview
build the same bytes from them. The pins and areas payloads are kept gzipped in a small in-process
LRU held to a byte budget (`CLIENT_REPORT_MAP_CACHE_MB`, default 64; `0` turns it off; an entry larger
than the budget isn't kept). Concurrent first opens of one payload wait on one build, and an entry is
served for at most 15 minutes after it was built, so a one-off script that rewrites frozen rows from
another process is served within that bound. A sweep every minute drops expired entries, asked for
again or not, so nothing is held much past 16 minutes after it was built (code review P-1: round 1's
expiry was checked only on a lookup, so an entry nobody asked for again stayed in memory until the
budget pushed it out or the process restarted). The sweep runs only while the cache holds something
and is `unref`'d, so it never keeps the process alive. It is never served after a take-down, a
deletion, a map switched off or a question taken off, because those reads are refused before the
cache is asked, or ask for a different key. `CLIENT_REPORT_MAP_CACHE_TTL_MS` (15 minutes) and
`CLIENT_REPORT_MAP_CACHE_SWEEP_MS` (60 seconds) shorten both times for tests. The response carries `Vary: Accept-Encoding`, the ETag Express would have given the
JSON (and its `304`), and `Content-Encoding: gzip` only when the request accepts it (the compression
middleware leaves an encoded body alone); otherwise the same JSON is sent decoded. Every header the
route set stays (`Cache-Control: no-store` and `X-Robots-Tag` on the public routes). Every read still
passes the link's access middleware (`loadShare`, `requireShareAccess`, `loadReport`) or the admin
route's org and role checks, then `checkMapRequest`, before the cache is asked, so a cached payload is
served only after the same checks as a fresh one. The `…/map/doors` lookups are not cached.

The client filters and counts over the arrays in the browser
([reportMapData.js](../client/src/lib/reportMapData.js)), draws doors as zoom-aware circles (doors at
one coordinate are one spot, never merged with a neighbour), and pages a spot's doors 200 at a time.
The admin preview reads the same payload through `/admin/client-reports/:id/preview/map`,
`/preview/map/doors` and `/preview/areas`.

## K. Share links

**Tokens and passwords.** `newShareToken()` is 24 random bytes, base64url. Every new link gets a bcrypt
password: the operator's (at least `SHARE_PASSWORD_MIN` = 12 characters on create and PATCH, `400
SHARE_PASSWORD_TOO_SHORT`) or a generated 12-character one from a 56-character alphabet without
look-alike glyphs, returned once as `generatedPassword`. A password can't be removed (`400
SHARE_PASSWORD_REQUIRED`). `passwordMeetsRule` is set true on every compliant or generated password;
for an older link it stays `null` until the next successful unlock, which records whether the entered
password's length meets the rule (`notePasswordRule`, a CAS pinned to the hash it was checked against;
the password is never stored). The panel flags only `false`.

**Credential version.** `credentialVersion` (missing = 0) is bumped in the same atomic write by a
password change (a legacy open link's first password included), rotate, renew, disable and the
revoke-legacy sweep. The share JWT ([tokens.js](../server/src/services/auth/tokens.js)) is `{ kind:
'share', link, cv, iat, exp }`, where `link` is `shareLinkKey(shareId)`, an HMAC-SHA256 of the link's
id under the server's secret. A JWT's payload is readable by whoever holds it, so since code review
round 2 (PRIV-2) it carries no ObjectId (each carried a creation time to the second) and no campaign
id (a link belongs to one campaign for life). `requireShareAccess` checks `shareTokenNamesLink(payload,
share)` and requires `(payload.cv ?? 0) === credentialVersionOf(share)`, so any of those signs every
device out at once. A token issued before PRIV-2 (`{ kind: 'share', shareId, campaignId, cv }`) is
honoured on exactly the old check until it expires (24 hours, or 30 days with Keep me signed in), so
nobody signed in is signed out by the deploy; for up to 30 days after it a device signed in earlier
can still hold one.

**The failure budget (rolling).** `failedUnlockAt` holds the last 24 hours' reservations, at most
`FAILURE_BUDGET` = 50. Every unlock attempt on a password link first **reserves** a slot
(`reserveUnlockSlot`): one pipeline `findOneAndUpdate` on `{ _id, token, isActive: true }` drops entries
older than 24 hours and pushes `{ at: now, id: <random> }` only if fewer than 50 remain. No slot → `429
SHARE_LOCKED` with **no bcrypt compare**, so however many guesses arrive at once, no link checks more
than 50 wrong passwords in any 24 hours. The password is compared with the post-image's hash, and a
token is signed with the post-image's `credentialVersion`. A correct password takes back its own entry
by id. A wrong one (`recordWrongPassword`) increments `failedUnlocksTotal` and today's `failedByDay`
(UTC days, last 7 kept), writes a `reportLink.wrongPasswords` History row when a day reaches 10, and,
when it took the 50th slot, stamps `lockedUntil` (the oldest entry + 24 hours) and `lastLockedAt` in a
CAS on its own entry (so an Unlock now or rotate that landed mid-compare isn't undone) and writes a
`reportLink.locked` row. Whether a link is locked now is read from the entries (`lockOf`), never from
the stored stamp. **A lock never ends a session already open**: `requireShareAccess` doesn't read it.

**What clears what.** Unlock now clears the 24-hour budget only (`CLEARED_BUDGET`: the entries and
`lockedUntil`). Rotate and Renew also clear the week's `failedByDay`, since the advice to rotate is about
the address that drew the guesses (`CLEARED_FOR_NEW_ADDRESS`). A password change or disable clears
neither. `failedUnlocksTotal` is never cleared. The panel's `rotateAdvice` is true on a lock or when
the last 7 days hold 50 or more.

**Expiry and the one-year life.** `expiresAt` may never pass `lifetimeStart(link) + 365 days`
(`lifetimeStartAt ?? createdAt`). Create takes `expiresInDays` (the picker offers 30, 90, 180 or 365;
the API accepts 1-365; default `SHARE_LINK_DEFAULT_DAYS`, 90, which must stay 90 while the Privacy Policy
says "90 days by default"). **Extend** sets `expiresAt = max(current, min(now + days, lifetime end))`
inside the write, so it never shortens a link or passes its life; on a link that never expires it sets
the first expiry and starts the life (`lifetimeStartAt = now`); on an expired link it is `409
SHARE_NEEDS_RENEW`; a race is `409 SHARE_CHANGED`. **Renew** (expired links only, else `409
SHARE_NOT_EXPIRED`) is a rotate: a new token, a new life, `expiresAt = now + days`, `cv` bumped, the
budget and week cleared, the password kept. **Rotate** is a new token, `cv` bumped, budget and week
cleared, expiry and life unchanged.

**Legacy links** (`isLegacyOpen`: no password or no expiry) keep working. Adding a password also sets
an expiry (the default life from now) and `lifetimeStartAt`, so the link leaves `isLegacyOpen`. `POST
/shares/revoke-legacy` (admins only; it is org-wide) is a dry run unless `{ confirm: true }`, then
disables every active legacy link in the organization and bumps their `cv`.

**Unlock and keep signed in.** `POST /share/:token/unlock { password, remember }` returns a share JWT for
24 hours, or **30 days** when `remember === true` ("Keep me signed in on this device"). The page keeps
it in `sessionStorage` (this tab) or, remembered, `localStorage`, one copy only
([shareAccess.js](../client/src/lib/shareAccess.js)), and drops it on a 401, a 410, or a 404 with
`SHARE_NOT_FOUND` ([shareSession.js](../client/src/lib/shareSession.js)); a remembered sign-out in one
tab follows to the others. A legacy open link is unlocked without a password so every read works the
same way.

**Nothing before the password.** `GET /share/:token` returns `{ requiresPassword }` only. The campaign
name, organization name and `hasLogo` ride `GET /share/:token/reports`, behind access; the link's label
is never sent.

**Links to one report** (2026-10-25, PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D). A link with a `reportId`
(§B) opens that report and nothing else; one without opens every published report of the campaign,
as before (byte for byte: the client pages are pinned by
[publicReportAllLinks.snapshot.json](../client/src/lib/publicReportAllLinks.snapshot.json)).

- **Made** by `POST /admin/client-reports/shares` with `reportId`: a valid id (else `400 Invalid
  reportId`) of a report in this organization and campaign (else `404 REPORT_NOT_FOUND`, "Report not
  found") that the client can see now, published and not taken down, else `409 REPORT_NOT_SHOWN {
  error, code, status, takenDown }`: "This report isn't published yet. Publish it, then make its link."
  or "This report is taken down. Put it back up, then make its link." (a taken-down report is still
  `status: 'published'`, and a link to it would only ever say "taken down"). Never changed after. If
  the report is deleted while its link is being made, the new link deletes itself, with a "deleted
  with its report" History row, and the request answers `404`: Delete takes the report's links after
  the report, so one of the two always sees the other.
- **Every share row** (the list and every link action's answer) adds `reportId` (a string, or `null`
  on a link to all the reports) and `report: { id, weekStart, weekEnd, scopeLabel, takenDown }` (its
  tab's current name; `takenDown`, `!!takenDownAt`, since the simplify build's code review round 2,
  FRESH-6, so the links panel can say the link reads "taken down"), or `null` beside a `reportId` when
  that report was deleted mid-race. The rows are staff-only (`requireOrgRole('admin', 'lead')` and
  `canManageCampaign`), and `takenDown` is the report's own state, which the same readers already see
  on the reports list (`takenDownAt` on each row).
- **Public routes.** `reportScope(req)` stays the campaign's shown reports and never carries an `_id`:
  spread beside the URL's own `_id` in `loadReport`, it would be overwritten by it or overwrite it
  (both happened in the plan's review). Instead `loadReport` checks first, for every route behind it
  (the report, its map, doors, areas and the opened ping): on a one-report link, another report's id
  answers `404 REPORT_NOT_FOUND`, "This report was taken down or removed.", exactly as a taken-down one
  does. The hub queries `{ ...reportScope(req), $and: [{ _id: <its report> }] }` (no key of the scope
  can be overwritten) and answers `single: true`, `reportId` and `gone` (true when that report isn't
  shown: taken down, unpublished or deleted; put back up, it is there again); the report route answers
  `single` with `nav: null` and the earlier-totals line's `before` form (§I). Meta, unlock and the logo
  read no report. Share tokens, Keep me signed in, the credential version and the open counts were
  already per link.
- **The client pages.** On `single`, PublicReportListPage `Navigate replace`s to the report (Back leaves
  instead of landing on a hub), or shows "This report was taken down or removed. Ask the person who
  sent it." when `gone` or there is no row; PublicReportDetailPage hides "‹ All reports" and Older/Newer,
  puts "This link opens this report only." under the heading, and shows the same taken-down sentence
  with no "see all reports" (a moment's "Loading…" while the hub hasn't answered, rather than a guess).
  The browser tab title reads "{Campaign} · Report" on a one-report link (`hub.single`; "· Reports"
  on a link to all reports, as before).
- **Which links can open a report.** `linkState` in clientReportChecks.js (`checks.links`) counts only
  `reportId: { $in: [null, report._id] }` (which matches a link without the field too). With none
  usable, the reason comes from THOSE links first, since each names a fix for this report: `disabled`
  (none active), `locked` (an active, unexpired one), else `expired`. Only when no link of any state
  opens this report: `other_reports` if the campaign has other links (each a link to one other report),
  `no_link` if it has none. (Before code review round 1 of the simplify build, LINK-2, `other_reports`
  won whenever a link to another report was usable, so an expired link to all the reports read "your
  links open other reports" rather than "renew it".) The client does the same through `linksFor` (§Q).
- **Deleted with its report** (`DELETE /:id`, §F). The demo reset deletes the demo campaign's
  one-report links, and both `ensureShareLink` queries in
  [seedDemoOrg.js](../server/src/services/platform/seedDemoOrg.js) add `reportId: null`, so the demo link
  is never a one-report link. Campaign and organization deletion already delete every link.

**"Last opened"** (`stampLinkAccess`) is stamped only when access is granted (a correct password, a
valid share token, a legacy open link), at most once a minute per link, never by the password screen
or a wrong guess.

**Rate limiting.** Beside the per-link budget, the per-IP limiter stays: 10 failed attempts per 15
minutes per IP + token (`429` with code `rate-limited`).

**Headers and indexing.** Every `/share` response carries `Cache-Control: no-store` and `X-Robots-Tag:
noindex, nofollow`; the `/r/` HTML gets `X-Robots-Tag: noindex, nofollow` from the SPA fallback in
[app.js](../server/src/app.js), the only place that HTML is served; the page also injects a robots meta.
[robots.txt](../client/public/robots.txt) no longer disallows `/r/`: a crawler kept out by robots.txt
never sees a noindex, and can still list a forwarded link's bare URL. `/api` stays disallowed.

**Billing.** `loadShare` answers `410 SHARE_UNAVAILABLE` when the organization's access is suspended
or canceled (`shareLinksBlocked`); links survive `past_due`.

## L. Opens

No new collection: counts live on the report in `views`. The report page sends `POST
/share/:token/reports/:id/opened` (behind `requireShareAccess`) once per report per browser per day,
marked in `localStorage` under one key per link holding the day and the report ids, so the panel says
"about". The route answers `204` first. Only afterwards does `recordReportOpen` look at an
`Authorization: Bearer` session token, which the page sends when this browser is signed in to Doorline
(`identifyIfSignedIn` on `api()`, which keeps the call out of the session-ended handling).
`resolveSessionUser` runs `requireAuth`'s checks (ended sessions, password changed, deleted or inactive
account, expiry, the 90-day cap) without responding or stamping last-seen; resolveSessionUser.int.test.js
runs both over the same token matrix. A super admin counts under `members.staff`; an active member of
the link's organization under `members.admins`, `members.leads` or `members.others` by role (a lead
who is the client shows under leads); anyone else, including an ended or stale session or another
organization's member, under the link. It never grants or refuses anything. The write is one pipeline
update with `$min`/`$max` dates and null-safe counters, with timestamps off. No IP address, no device.
It no longer touches the report's old `viewCount` and `lastViewedAt` (code review ADMINUX-12): they are
frozen at what they were before per-link counts, so the panel's "N views before per-link counts"
(`linkState.js`) is a before-the-upgrade number.

## M. History

Rows ride `CampaignChange` with `source: 'client_report'`
([clientReportHistory.js](../server/src/services/reports/clientReportHistory.js)):

- `clientReport.created | published | edited | numbersRefreshed | refreshDiscarded | takenDown |
  putBackUp | deleted | remapped` (with `clientReportId`, `seriesId` and `periodLabel`: other rows name
  the report's period, never its title);
- `clientReportSeries.created | renamed | crewsChanged | ended | continued` (`continued` since code
  review round 2, WALK-3: written when a PATCH ends an ended team's `endedAt`, holding `{ label,
  coordinatorIds }` in `toValue`, the team's name and its coordinators' user ids, like the created and
  crews-changed rows; the ended and crews-changed rows now carry `label` in `toValue` too);
- `reportLink.created | passwordChanged | rotated | renewed | extended | disabled | enabled |
  wrongPasswords | locked | unlocked | deleted` (with `shareLinkId`; never the URL token, a password or
  its hash, and no IP or user agent; values are filtered once more for any key that looks like a
  credential). A one-report link deleted with its report (§F) writes `deleted` with `toValue: { label,
  reportDeleted: true }`, which the drawer shows as "Board · Link deleted" with "Deleted with its
  report" under it (`clientReportHistoryLine` in campaignHistory.js: the subject, then the headline,
  then the `detail` line).

An `edited` row (published reports only) keeps only the **earlier** text, in `fromValue`, taken from
the write's own pre-image; `toValue` stays null because the current text lives on the report, so each
version is kept in exactly one row. `numbersRefreshed` keeps the before-and-after totals. A `deleted`
row is written by `DELETE /:id` and, since code review round 1 (STATE-3), once for each draft that
ending a team with `deleteOpenDrafts` actually deletes (§H).

**Kept out of the general feed.** `GET /admin/campaigns/:campaignId/history` adds `source: { $ne:
'client_report' }` by default, so the web campaign History and the phone (which calls it unfiltered)
see what they saw before, 200-row cap included. With `?include=client_reports` it returns only these
rows, newest first, capped at 200, with the actor's and eraser's names. Web labels are in
[campaignHistory.js](../client/src/lib/campaignHistory.js): a report row's subject is its period and
its tab, read from the campaign's series list by the row's `seriesId` (`reportRowName`: "Oct 13 – Oct
19, 2026 · Paid team report"; the period alone with no tab), and a team row's is the `label` it was
written with, else the team's current name, else "A team" (WALK-3).

**Restore** (`POST /admin/campaigns/:campaignId/history/:rowId/restore`, anyone who manages the
campaign) applies an `edited` row's earlier text as a normal edit: it reads the report's `eraseEpoch`
first and the row after, and the write requires the epoch unchanged, so an Erase landing mid-restore
wins (`409 HISTORY_ERASED`). **Erase** (admins: `POST …/history/:rowId/erase`, or `POST …/history/erase
{ clientReportId }` for every edit row of a report, beyond the drawer's page and after the report is
deleted) sets `fromValue: null`, `erasedAt`, `erasedBy`, then bumps `eraseEpoch`. `dryRun` returns the
row count, whether the text is the report's current text (Erase never touches the report itself), and
the later drafts Next copied it into, by period; `alsoDrafts` removes those sections there and resets
their `copiedNotesReviewed`. Other codes: `400 INVALID_ID`, `404 HISTORY_NOT_FOUND`, `400
NOT_RESTORABLE`, `400 NOT_ERASABLE`.

Leads read this history on their campaigns, and a lead can be the client, so it is customer-facing
([PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 38(g)).

## N. Branding

**In the browser** ([logoImage.js](../client/src/components/clientReports/logoImage.js)): the chosen
image (PNG, JPEG or SVG; an SVG is sized from its attributes or `viewBox`) is drawn onto a canvas no
larger than 800 × 320 and exported as PNG, shrinking until it fits 256 KB; a canvas `SecurityError`
shows a plain message.

**On the server** ([png.js](../server/src/services/branding/png.js)): PNG only (`400 LOGO_NOT_PNG`),
checked strictly (`400 LOGO_INVALID`): the signature; exactly one `IHDR`, first, 13 bytes; every chunk's
CRC; 1 to 2,000 pixels a side and at most 4 megapixels; bit depth 8; colour type 2 or 6; compression,
filter and interlace bytes 0; one run of `IDAT`s inflating, bounded by `maxOutputLength`, to exactly
`height × (1 + width × bytesPerPixel)` bytes with nothing after the zlib stream; every row's filter
byte ≤ 4; `tRNS` only on colour type 2, 6 bytes, before the image data; `PLTE` and ancillary chunks
dropped, an unknown critical chunk refused; nothing after `IEND`. It then **writes a fresh PNG** from
the validated fields (`IHDR`, `tRNS` for type 2 when present, one `IDAT` of its own deflate, `IEND`), so
none of the uploaded chunk bytes is stored; over 256 KB after re-encoding is `413 LOGO_TOO_LARGE`.
Both zlib steps are asynchronous, on libuv's threadpool, never on the event loop, and the re-encode
deflates at level 6 (code review SEC-2): this runs inside `PUT /admin/branding/logo` on the one web
dyno every customer shares, and a crafted 255 KB upload (2,000 × 2,000, low-entropy rows) held the loop
about 4 seconds in a level-9 `deflateSync`, so six at once stalled every other request for 16 seconds.
The inflate keeps its exact `maxOutputLength` bound. One behaviour change follows: the 256 KB limit is
checked on the fresh level-6 PNG, so an upload whose own compression was tighter than level 6 can now be
refused with `LOGO_TOO_LARGE`.
multer memory storage with `{ fileSize: 256 KB, files: 1, fields: 0 }`; a multer refusal is `413
LOGO_TOO_LARGE` or `413 LOGO_UPLOAD_REFUSED`; no file is `400 LOGO_REQUIRED`. Saved by an upsert on
`organizationId` (a racing insert retries as an update).

**Routes:** `GET /admin/branding` and `GET /admin/branding/logo` (admins and leads), `PUT` and `DELETE
/admin/branding/logo` (admins). The public `GET /share/:token/logo` is behind `requireShareAccess`
(`204` when there's none, `no-store`); the page fetches it with `X-Share-Token` and shows a blob URL,
revoked on unmount. The PDF draws it with jsPDF's `addImage` inside a try/catch, so a bad logo never
breaks a PDF, and prints "Powered by Doorline" in the footer. The logo is printed at most 150 × 42 pt;
[reportPdf.js](../client/src/lib/reportPdf.js) first redraws a larger one on a canvas at about 3 pixels
per printed point (`LOGO_PX_PER_PT`) and embeds it deflated (`'MEDIUM'`), because a 2,000 × 2,000 logo
embedded raw made a 16 MB PDF (code review PUBUX-2).

## O. Endpoints

**Admin reports**, `/admin/client-reports`, gated `requireOrgRole('admin', 'lead')`, every handler
scoped to the active organization (the campaign, report or series is loaded in it, or the query filters
on it) and authorizing the campaign with `canManageCampaign`, which on its own says yes to any org admin
for any campaign id (§H):

| Endpoint | Does |
|---|---|
| `GET /series?campaignId=` | Every series with its current label and crews, the crew picker (free, in a team, past in a team), former crews, canvassers with no crew, `teamsReady`; since 2026-10-25 also `weekStartsOn`, `today` and `knockedBeforeThisWeek` (§F) |
| `GET /settings` · `PATCH /settings` | The organization's report week, `{ weekStartsOn }` (its own router, mounted ahead of this one; PATCH admins only, §F) |
| `POST /series` | New team `{ campaignId, label, coordinatorIds }` |
| `PATCH /series/:seriesId` | `{ label?, confirmLabel?, coordinatorIds?, keepPast?, removePast?, makeCurrent?, end?, continue?, deleteOpenDrafts? }` |
| `GET /series/:seriesId/team-changed?reportId=` | The team-changed card's data, counted against that report (optional; §H) |
| `GET /series/affected?campaignId=&coordinatorIds=` | The campaign's active teams with a report whose crews (current or past) include those coordinators, as `{ teams: [{ seriesId, label }] }`: labels only. The coordinator-change confirm on the Team tab ([CoordinatorConfirm.jsx](../client/src/components/CoordinatorConfirm.jsx)) names them: "This also changes the numbers in the Paid team client report." |
| `POST /` | Create a draft `{ campaignId, weekStart, weekEnd, title?, seriesId?, effortId?, teamSeriesId?, seriesLabel?, confirmLabel?, allowDuplicate? }` and claim its first build: `201 { report, build, warnings }` (`['STARTS_AFTER_TODAY']` when it starts after today in the campaign's zone, else `[]`); `409 REPORT_EXISTS` when the tab has a report for those dates (unless `allowDuplicate`), `200 { report, build, existing: true, createdByName }` when a simultaneous create got in first (§F) |
| `GET /?campaignId=&seriesId=` | The list (no breakdowns, no build result), with each row's series key, current series label, `campaignType` (null on a report from before the field), build view, views and dates |
| `GET /:id` | The report, campaign and org names, current series label, scoped `openMockFlags`, the build (with `live` and `queuePosition`), `checks` (*Before you publish*) and `liveInputs: { showMap, mapMode, areaSize, mapKeys, questionDeps }`, what the live snapshot was built with as the server reads it (`mapContextFor`, so a legacy published report's comes through every survey its answers can have come from; code review contract C4). The builder's question table, map ticks, Refresh dialog and preview map follow it instead of guessing from the stored settings |
| `PATCH /:id` | Edit (§F), with optional `ifStatus` (`409 STATUS_CHANGED` on a mismatch) and `ifEditVersion` (`409 CHANGED_ELSEWHERE` with `{ editVersion, report }` on a mismatch; contract C8) |
| `POST /:id/recompute` · `POST /:id/refresh` | Claim a build: `202 { build }` |
| `GET /:id/build` | Status, progress, why it waits, its error, its place in the queue; a ready refresh's `result` (with `mapKeys`, what the map will carry once applied) and a top-level `areaWithoutAnswers` (a ready refresh's, or a switch to areas that just finished) |
| `POST /:id/refresh/apply` · `/refresh/discard` | `{ snapshotId }` of the reviewed result |
| `POST /:id/build/cancel` | Cancel a live build |
| `POST /:id/publish` | `{ snapshotId, editVersion }` previewed |
| `POST /:id/take-down` (alias `/unpublish`) · `/put-back-up` | |
| `GET /:id/preview` · `POST /:id/preview` | The client payload; POST overlays the on-screen settings; plus internal `provenance` |
| `GET /:id/preview/map` · `/preview/map/doors` · `/preview/areas` | The live snapshot's map, as the client reads it |
| `POST /:id/next` | The next period's draft (`nextPeriod`, §F), idempotent: `201 { report, build, warnings? }` new; `200 { …, existing: true }` for the draft it already made, an exact later report or a lost race; `409 NEXT_GAP_TOO_LONG { catchUp, suggested }`, `409 NOT_LATEST_REPORT` |
| `DELETE /:id` | Delete; `?eraseHistory=1` (admins) erases its earlier text |

**Admin links**, `/admin/client-reports/shares`, the same gate:

| Endpoint | Does |
|---|---|
| `GET /?campaignId=` | Rows: token, label, password and expiry flags, `lifetimeEndsAt`, `passwordMeetsRule`, `lock`, `failures { last24h, since, last7d, total }`, `rotateAdvice`, `lastAccessedAt`, and what the link opens, `reportId` and `report: { id, weekStart, weekEnd, scopeLabel, takenDown } \| null` (§K). Never the password or its hash. |
| `POST /` | `{ campaignId, label?, password?, expiresInDays?, reportId? }`; `generatedPassword` once when generated. With `reportId`, a link to that one report: `409 REPORT_NOT_SHOWN` unless it's published and not taken down, `404 REPORT_NOT_FOUND` (§K) |
| `PATCH /:id` | `{ label?, password?, isActive? }` |
| `POST /:id/extend` · `/renew` | `{ expiresInDays }` |
| `POST /:id/rotate` · `/unlock` | |
| `DELETE /:id` | |
| `POST /revoke-legacy` | Admins only; dry run unless `{ confirm: true }` |

**Branding** and **History**: §N and §M.

**Public**, `/share`, no login:

| Endpoint | Does |
|---|---|
| `GET /:token` | `{ requiresPassword }` |
| `POST /:token/unlock` | `{ password, remember }` → `{ accessToken }` (rate-limited per IP + token, budgeted per link) |
| `GET /:token/reports` | `{ campaignName, orgName, hasLogo, reports, single }`: published, not taken down, newest first; on a one-report link that report alone, plus `reportId` and `gone` (§K) |
| `GET /:token/reports/:id` | `{ report, survey, single }`; a one-report link answers another report's id `404 REPORT_NOT_FOUND` (§K) |
| `GET /:token/reports/:id/map` · `/map/doors` · `/areas` | §J |
| `POST /:token/reports/:id/opened` | `204` (§L) |
| `GET /:token/logo` | PNG, or `204` |
| `GET /:token/mapbox-token` | The public `pk.` token |
| anything else | `404 NOT_FOUND` |

All but the first two run `loadShare` then `requireShareAccess` (a valid `X-Share-Token` for this link at
its current `cv`, else `401 password-required`; legacy open links pass), and report routes `loadReport`
(the link's campaign, published, not taken down).

## P. Error codes

| Code | Status | Where |
|---|---|---|
| `SHARE_NOT_FOUND` | 404 | No active link with that token (public); no link with that id (admin) |
| `SHARE_EXPIRED` | 410 | Past `expiresAt` |
| `SHARE_UNAVAILABLE` | 410 | The organization's access is suspended or canceled |
| `password-required` | 401 | No valid share token for this link and `cv` |
| `SHARE_PASSWORD_WRONG` · `SHARE_PASSWORD_MISSING` | 401 · 400 | Unlock |
| `SHARE_LOCKED` · `rate-limited` | 429 | The link's budget is full · the per-IP limiter |
| `REPORT_NOT_FOUND` | 404 | Taken down, deleted or never published, or another report on a one-report link (public); not found (admin, link create with `reportId` included) |
| `INVALID_ID` | 400 | A malformed report id |
| `MAP_NOT_SHARED` · `MAP_UPDATED` | 404 · 409 | Map readers (§J) |
| `SNAPSHOT_KEY_REQUIRED`, `ROWS_REQUIRED`, `TOO_MANY_ROWS`, `ROWS_INVALID` | 400 | `…/map/doors` |
| `NOT_FOUND` | 404 | Any other `/share` path |
| `SHARE_PASSWORD_TOO_SHORT` · `SHARE_PASSWORD_REQUIRED` | 400 | Admin link create or PATCH |
| `SHARE_NEEDS_RENEW` · `SHARE_NOT_EXPIRED` · `SHARE_CHANGED` | 409 | Extend an expired link · Renew a live one · a racing change |
| `REPORT_NOT_SHOWN` | 409 | A link to one report made for a report that isn't published, or is taken down (`{ status, takenDown }`) |
| `INVALID_WEEK_START` · `FORBIDDEN_ROLE` | 400 · 403 | `PATCH /admin/client-reports/settings`: not a weekday 0–6 · a lead |
| `REPORT_EXISTS` | 409 | Create, when the tab already has a report for those dates (`{ reportId, status, takenDown, weekStart, weekEnd, scopeLabel }`) |
| `TEAM_ATTRIBUTION_NOT_READY` | 400 | Teams without team attribution |
| `WALK_LIST_LABEL_HAS_NAME` | 400 | Confirmable (`confirmLabel`) |
| `TEAM_LABEL_HAS_NAME`, `SERIES_LABEL_INVALID`, `SERIES_LABEL_FIXED`, `TEAM_NEEDS_CREW`, `TEAM_CREW_INVALID`, `TEAM_CREW_NOT_RUNNING`, `NOT_A_TEAM` | 400 | Series |
| `SERIES_ENDED`, `SERIES_NAME_ENDED`, `TEAM_LABEL_TAKEN`, `CREW_IN_OTHER_TEAM`, `SERIES_CHANGED` | 409 | Series |
| `SERIES_NOT_FOUND` | 404 / 400 | A series id not in the org / not on the campaign |
| `MAP_ANSWER_KEYS_NOT_CHOICE`, `NO_GOAL_SNAPSHOT`, `GOAL_AFTER_BUILD`, `NEEDS_REFRESH`, `NOT_DRAFT`, `NOT_PUBLISHED`, `MAP_KEYS_NOT_ALLOWED`, `MAP_KEYS_NEED_PARENTS` | 400 | Edit, Recompute, Refresh |
| `STATUS_CHANGED` | 409 | Edit sent with an `ifStatus` the report no longer has, or a report whose status moved while the edit ran (`{ status, takenDown }`) |
| `CHANGED_ELSEWHERE` | 409 | Edit sent with an `ifEditVersion` the report no longer has, checked before the write and pinned in it (`{ editVersion, report }`; nothing written) |
| `REVIEW_PENDING`, `REPORT_BUSY`, `STATUS_CHANGED`, `NOTHING_TO_CANCEL` | 409 | Claims and Cancel |
| `ALREADY_PUBLISHED`, `RECOMPUTE_NEEDED`, `SNAPSHOT_CHANGED`, `SAVING` | 409 | Publish |
| `NOTHING_TO_APPLY`, `NOTHING_TO_DISCARD`, `NOT_PUBLISHED` | 409 | Apply, Discard, Take down, Put back up |
| `NEXT_PERIOD_MISMATCH`, `NOT_LATEST_REPORT`, `NEXT_RACE`, `NEXT_GAP_TOO_LONG` | 409 | Next (`NEXT_GAP_TOO_LONG` carries `{ catchUp, suggested }`) |
| `HISTORY_NOT_FOUND` · `NOT_RESTORABLE` · `NOT_ERASABLE` · `HISTORY_ERASED` | 404 · 400 · 400 · 409 | History |
| `LOGO_REQUIRED`, `LOGO_NOT_PNG`, `LOGO_INVALID` · `LOGO_TOO_LARGE`, `LOGO_UPLOAD_REFUSED` | 400 · 413 | Branding |

Build failures carry their own codes on `build.error` (§E).

## Q. Frontend

- **Admin tab:** [ClientReportsPage.jsx](../client/src/pages/ClientReportsPage.jsx) (`/campaigns/:campaignId/reports`:
  the intro line and its **How it works** link, tabs per series, rows, gap lines between reports of a
  series, links and branding beside), with
  [components/clientReports/](../client/src/components/clientReports/): `HowItWorks` (+
  `howItWorksCopy.js`, below), `ReportRow`, `NewReportDialog` (+ `newReportChoices.js`, §F),
  `TeamDialog`, `TeamChangedCard`, `ClientLinksPanel` (+ `linkState.js`: usable, badges, failures line,
  extend choices, opens line, and which links open a report, below), `ShareDialog` (+ `copyMessage.js`),
  `BrandingCard` (+ `logoImage.js`), `HistoryDrawer`, `buildState.js` (the build states' words) and `hooks.js`
  (`useBuildPoll`, shared by the builder and the list rows: every 3 s while queued or running, 15 s
  while waiting; since code review ADMINUX-7 a `404` or `403` stops it and re-reads the report and the
  lists, so a deleted report reads "Report not found" instead of "Queued" forever, and any other failure
  backs off to 6, 12, 24, 48, then 60 s until a poll answers again).
- **The intro and the guide** (2026-10-25, PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §B): the header line,
  the guide's title, steps, phone lines, "More in the Help Center →" (`/help/client-reports`) and "Got
  it" all come from ONE module,
  [howItWorksCopy.js](../client/src/components/clientReports/howItWorksCopy.js) (`INTRO`, `STEPS`,
  `PHONE_STEPS`, …), which the Help Center's client-reports articles quote word for word: change the
  words there and in the Help together. [HowItWorks.jsx](../client/src/components/clientReports/HowItWorks.jsx)
  is a light card at the top of the reports card, above the tabs (on an empty page, in place of "No
  reports yet"); phones below 640 px get the short lines and no Help line. **Got it** is a per-viewer
  flag in the operator's own browser, `localStorage['doorline.clientReports.howItWorks.<userId>'] =
  '1'`, every read and write in try/catch (a private window or blocked storage simply shows the guide
  again); **How it works** clears it and brings the guide into view. Pressing Got it moves keyboard focus
  to the How it works link (`dismissGuide` in ClientReportsPage.jsx; the simplify build's code review
  round 2, FRESH-4), where it used to fall to `<body>` as the card unmounted.
- **New report and teams:** the date choices, the report week line and its inline Change panel, and the
  week nudge come from `newReportChoices.js` and the week math in
  [reportDates.js](../client/src/components/clientReports/reportDates.js) (§F); the duplicate prompt
  and the "<name> made the <tab> report for <dates> a moment ago" note answer `REPORT_EXISTS` and
  `existing: true` (§F). Since code review round 1 of the simplify build:
  - **Fresh dates** (WEEK-1): the dialog's own `useQuery` on the series picker's key with
    `refetchOnMount: 'always'`, and only an answer that arrived after the dialog opened counts (it lands
    in the page's cache entry, so the tabs follow it too). Until then the dates read "Loading the
    dates…" (Create held, the Title box's placeholder blank); a failed read says "Couldn't load the
    dates." with the error and **Try again**; a once-a-minute check (cleared with the dialog) reads
    them again when the campaign zone's day has moved past the answer's `today`.
  - **Frozen while it answers** (WEEK-2): the request body is built when Create is pressed, and the
    dates' facts are kept with the duplicate prompt and the race note, so the list gaining that very
    report can't move the choices on; the form is disabled while the race note shows (and, since round
    2, while Create is on its way: below).
  - **Not started yet** (WEEK-3): a picked period that starts after the campaign's today gets "Starts
    Oct 26 — its numbers stay empty until then." (with the year when different) under the choice;
    "This period isn't over yet — …" sits under the picked choice or the Pick dates boxes; the page
    opens the builder with `?ahead=1` when POST / warns `STARTS_AFTER_TODAY`.
  - **Focus** (WEEK-4): Change moves focus to the weekday select; Save, Cancel and the nudge's
    organization-wide button return it to Change.
  - The tab's last report is the newest by `weekEnd`, then `createdAt`, then `_id` (the admin list rows
    carry `createdAt` for it), as `report:tab-weeks` picks it; the team and walk-list picks fall back to
    the first of the lists as they are now.
  Since code review round 2 of the simplify build:
  - **Still while Create is on its way** (VER-1): `<fieldset disabled={!!joined || busy}>`, so the
    dates, the tab and the title can't change mid-flight. The request built at the click is kept
    (`pressedBody`), and **Make a second one** sends `{ ...pressedBody, allowDuplicate: true }`, never
    the form as it stands (it used to rebuild the body from the current form, so a change made
    mid-flight went out with `allowDuplicate`, outside the guard). The race note names the report's
    own tab, `report.scope.label` from the answer, not the form's. Under the duplicate prompt the form is
    live again; editing the title or the Pick dates boxes clears the prompt (`editAfterPrompt`), as
    changing the date choice or the tab does, so an edit is never silently dropped by Make a second one.
  - **Answers under the dates** (FRESH-1): the walk-list-name, team-ended, duplicate and race-note boxes
    and the generic "Couldn't create the draft." render right after the Dates fieldset, above Title
    (under Title the duplicate prompt opened out of view and focus fell to `<body>`). The first three are
    `role="alert"`, the race note `role="status"` (`ErrorBanner` is `role="alert"` already). When one
    appears (`focusTo`) it is scrolled into view (`block: 'nearest'`) and its first enabled button or
    input takes focus, when it has one; the race note has none, so the footer's **Open it**
    (`autoFocus`) takes it, and the error's wrapper (`tabIndex={-1}`) takes it itself.
  - **Next's sentence** (FRESH-3): `initial.notice`, the `NEXT_GAP_TOO_LONG` answer's `error`, shows in
    an info box at the top of Dates, above the choices (and above "Loading the dates…").
  - **A taken-down duplicate** (FRESH-5): when `REPORT_EXISTS` names a taken-down report (`takenDown`),
    the prompt's last line is "Your client sees only the new one; the taken-down one stays hidden unless
    you put it back up." instead of "Your client sees both once both are published."
  A row's Next refused `NEXT_GAP_TOO_LONG` opens New report with `suggested` picked and its sentence as
  `initial.notice` (FRESH-3, above); a link to the page carrying `?new=1&seriesId=&weekStart=&weekEnd=`
  opens it with those dates picked (the page then drops those params; nothing in the app sends that
  link yet). An ended team's tab offers "Continue this team"
  instead of End and Edit team (ADMINUX-10); `NewReportDialog` shows an ended team as "(ended)",
  keeps Create draft disabled while it is picked and offers Continue the team, and after Continue it
  reopens on the team with the dates and title kept. `TeamDialog`'s Continue settles a departed lead's past doors in a first PATCH (kept or
  removed), then sends `{ continue: true, coordinatorIds }` with any rename and the past doors that must
  leave; on `TEAM_CREW_NOT_RUNNING`, `CREW_IN_OTHER_TEAM`, `TEAM_NEEDS_CREW` or `SERIES_CHANGED` it
  re-reads the picker. `TeamChangedCard` sends `?reportId=`. Link confirms (`ClientLinksPanel`) offer an
  expired link only Renew (ADMINUX-8), and the History drawer's Restore confirm branches on
  `takenDownAt` (ADMINUX-9).
- **Builder:** [ClientReportBuilderPage.jsx](../client/src/pages/ClientReportBuilderPage.jsx)
  (`/campaigns/:campaignId/reports/:id`) with `ReportSettings`, `QuestionTable` (+ `questionRules.js`,
  the server's map rules on screen), `BeforePublish`, `PublishDialog`, `RefreshDialog`, and
  `autoSave.js` (800 ms targeted PATCHes, a `keepalive` flush on unmount, a `beforeunload` guard while a
  save is pending or failed, and the three-way merge below). A change that hasn't reached the report is
  kept in `localStorage` (below) and offered back. Its preview map is the client's `ClientReportMap` with the report's own empty-map line (the
  period's words, from `deriveReportSections`), keyed on the preview's `mapVersion`, and it reloads the
  report on a `409 MAP_UPDATED` (new numbers applied, or a switch to areas committed). The question
  table, map ticks and Refresh dialog read the server's `liveInputs` (§O), falling back to the report's
  own fields only for an answer without them.
- **The builder shows one version, and every save is pinned to it** (code review round 1, ADMINUX-1 to
  ADMINUX-6 and ADMINUX-11; round 2, contract C8):
  - The screen is seeded only from a copy fetched after the page opened (a placeholder shows until
    then), so it can't show a cached copy older than the operator's own last save on the way out.
  - It tracks the `editVersion` it reflects (`screen.current`: the seed's, then each of its own saves),
    and Publish sends that one. Every PATCH carries `ifEditVersion`: the draft auto-save and the unmount
    keepalive (`useAutoSave`, `keepalivePatch` in hooks.js) send the screen's; Update sends the open
    edit's (`editVer`: the version at Edit, or at its last merge); the remap retry sends the version the
    page shows.
  - A draft save refused `409 CHANGED_ELSEWHERE` is not a failure: `createAutoSaver` parks, the page
    puts the returned report in the query cache, and `flush()` (Publish…, Recompute, ‹ All reports)
    waits for the merge instead of failing. An Update refused the same way (`afterMerge`) is merged and
    sent again with only the operator's changes ("Picked up changes made elsewhere. {What} changed
    there first; your update went on top, so both are kept."), or, with nothing left to send, closes
    ("Your change had already been made there, so there was nothing more to update.").
  - The report query re-reads on window focus, and every re-read (a save's answer, the tab regaining
    focus, a refusal) is compared with what the screen was built on. With nothing unsaved, the screen
    catches up ("Picked up changes made elsewhere. … This screen now shows the latest saved version.").
    Otherwise it merges three ways, `mergeSettings(base, theirs, mine)` in autoSave.js, then `tidy`
    (map ticks closed under their dependencies, unless the latest version itself wasn't tidy):
    - key lists (`visibleQuestionKeys`, `visibleTags`, `mapAnswerKeys`) member by member, `theirs ∪
      (mine − base) − (base − mine)` (`mergeList`), never a conflict, so a removal made elsewhere
      stands unless this operator re-adds that very member and Keep mine can never resurrect what they
      didn't touch;
    - scalars (`title`, `supportQuestionKey`, `copiedNotesReviewed`, `showMap`, `showGoal`, `mapMode`,
      `areaSize`): only mine changed, mine; only theirs, theirs; both, differently, a conflict;
    - observations by section (`mergeSections`; sections have no ids): matched first by identical
      content (a section moved), then by heading (its text edited), then by text (its heading renamed),
      in theirs' order; a section either side added is kept (when both add at the same spot, mine go
      first); a base section I deleted goes; a section both changed differently, or one deleted while
      the other edited it, is a conflict.
    With no conflict both sides are kept and only the operator's changes go again ("…your changes are
    kept on top"). With one, the operator's screen stays as typed, auto-save holds, settings go
    read-only, Publish… and Update are disabled, leaving asks first, and the banner names only the
    conflicting items and what Keep mine replaces (`conflictWords`): "You both changed the title and
    the “North side” section …: Keep mine (it replaces their title “Week 3 final” and their version of
    “North side”) or Use theirs." Keep mine and Use theirs re-run the merge with `prefer`.
  - Draft saves also carry `ifStatus: 'draft'`. If someone publishes the draft meanwhile, a pending
    change goes through the same merge and becomes an unsent edit, kept on the device ("Someone
    published this report while you were editing…"); with nothing pending the page reads "Published
    elsewhere".
  - Refusals that mean the report moved (`REREAD_CODES` in parts.jsx: `SAVING`, `SNAPSHOT_CHANGED`,
    `ALREADY_PUBLISHED`, `STATUS_CHANGED`, `CHANGED_ELSEWHERE`, `NOTHING_TO_APPLY`,
    `NOTHING_TO_DISCARD` and the rest of that set, plus any `404`) re-read the report, its build and its
    preview, and say so instead of "try again".
  - The first build starts automatically only for a draft first seen with no numbers and an idle
    build, judged once per report, so a build finishing while the page is open never claims a second.
  - A report whose `campaignId` isn't the URL's campaign (the sidebar's switcher keeps the rest of the
    path) redirects to that campaign's Client Reports list.
  - Retry on a failed or stalled switch to areas is its own request (`remapRetryM`), so an open edit and
    its device copy survive it.
  - Publish… flushes until nothing is pending; only a refused save reads "Your latest change didn't
    save", otherwise "Still saving your latest change".
- **Kept on this device** (`readUnsent`/`writeUnsent` in hooks.js, one `localStorage` entry per report,
  `doorline.clientReport.unsentEdit.<id>`: `{ settings, base, version, at }`, so restoring runs the
  same three-way merge and puts back only the operator's own changes; a newer copy replaces an older
  one):
  - **An open edit of a published report** (code review CONCUR-2): written only once the edit has a
    change, deleted by Update, Cancel edit, Discard it, or undoing every change. **Edit** opens a kept
    copy ("Your unsent edit is open. From {time}, kept on this device. Update report sends it; Cancel
    edit throws it away.") instead of wiping it, as round 1's Edit did; Cancel edit with changes
    confirms first ("Throw away your edit?" / "Nothing you changed reaches your client, and the copy
    kept on this device is deleted." [Cancel] [Throw it away]).
  - **A draft change on the way out** (P-3): the saver's `onDetach` writes the copy before the
    keepalive leaves, so a keepalive refused (published or changed elsewhere meanwhile) comes back:
    as "A change you made didn't save before you left. From {time}, kept on this device. Restore it or
    discard it." on a draft (Restore disabled while a change is saving; `restoreDraftCopy` rebases the
    saver onto it), or as "You have an unsent edit." with **Restore your unsent edit** if the report was
    published. A copy is cleared on its own once a copy of the report at least as new as the one it was
    made against shows every change landed (`storedLanded`).
- **Worth a look** (`PublishedChecks` in BeforePublish.jsx, code review P-2 and WALK-7): on a published
  report's builder, `checks.areaWithoutAnswers`, `checks.conditionsUnknown` and
  `checks.earlierReportRefreshed` (with **Refresh numbers**, unless an edit is open), in their published
  wording; nothing shown when none applies.
- **Refresh numbers** (`RefreshDialog`): `initialMapPicks` pre-ticks the kept picks while the map is
  off (a shown choice question, with the questions it depends on, never one that follows a written
  answer), `refreshMapBody` sends the final list (VERIFY-2), the ready review names the map questions
  from `result.mapKeys` and lists `areaWithoutAnswers`, and the expanded outcome rows use the client's
  labels (`contactLabel`, WALK-6). The switch-to-areas confirm names the single-choice map questions
  that may show no answers by area, and an Update that only switches drops the "right away" sentence
  (WALK-7, WALK-8). With no link that opens this report, publishing reads "Published — create a link so
  your client can open it." (WALK-5), since 2026-10-25 with **Share**, which makes one; with one, the
  "Published." banner's **Copy the message for your client** opens Share too.
- **Share and links to one report** (2026-10-25, PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D):
  [ShareDialog.jsx](../client/src/components/clientReports/ShareDialog.jsx) replaces the deleted
  `CopyMessageDialog`, on every shown report's row and in the builder's header (never on a draft or a
  taken-down report; disabled while an edit is open, "Finish or cancel the edit first.", and while the
  links list loads). It lists the usable links that open this report, all-reports links first, picks
  one, builds the message with `copyMessageFor({ report, link, origin, justMade })` (its ending by link:
  all reports, this report only, or made just now), and offers **Make a link** (`POST …/shares`, with
  `reportId` for Just this report; the password is always generated there, and shown once with Copy
  password). `linkMessageFor` (Link ready) says "to this report" for a one-report link, "to our
  reports" otherwise. Since the simplify build's code review round 2: every link made in one Share
  stays in `made` with its own line until Done, "Password for {label}: … Copy password — shown once.
  Send it separately from the message. Lost it? Change password on the link." (FRESH-7: a second link
  used to replace the first one's password, with no way back); Make a link moves focus to the panel's
  first radio and Create link to the newest Copy password (FRESH-4: focus fell to `<body>`); and
  "Couldn't load the links." has **Try again** (`refetchQueries` on the links key), opening Share
  while the list has failed reads it again once, and "Loading links…" shows while a read is on its way
  (`useIsFetching`) (VER-2: a dead end, with no retry and no request on reopening).
- **Which links open a report** (contract K8): every place that asks filters the campaign's links
  through `linksFor(shares, reportId)` (all-reports links plus this report's own) FIRST, then the
  existing helpers (`usableLinks`, `noUsableLinkReason`, `linksLine`). They all live in
  [linkState.js](../client/src/components/clientReports/linkState.js) (`linksFor`, `singleLinksOf`,
  `linkOpens`, `linkName`, `deleteLinksText`, and, since code review round 1, `reportLinkReason`,
  `reportLinksLine`, `takeDownLinksText` and one shared `andList`, moved out of parts.jsx): the report
  row, the builder and its post-publish banner, *Before you publish*, the Publish confirm, the Take down
  and Delete confirms, and Share. `reportLinkReason` mirrors the server's rule: when any link opens this
  report, those links decide the reason (renew, unlock or rotate, enable); only when none does, the
  `other_reports` words if the campaign has other links ("No link opens this report — your links open
  other reports. Share makes one." / on a draft "No link opens this report yet. After you publish,
  Share makes one."), else "No link yet — create one." on a published report and, since the simplify
  build's code review round 2 (FRESH-8), "No link yet — after you publish, Share makes one." on a
  draft (`NO_LINK_DRAFT`: *Before you publish* and the Publish confirm offer no way to make a link,
  and "create one" sent a brand-new admin looking for one); before the links list loads, the server's
  `checks.links` decides (its `no_link` worded the same way). "Opened via …" on a row still names any
  of the campaign's links, and waits for the links list (it read "a deleted link" while the list
  loaded). The links panel lists all-reports links first and folds the rest under "Links to one report
  (N)"; a row whose `report.takenDown` is true adds "Its report is taken down — the link shows “taken
  down” until you put it back up." under what it opens (round 2, FRESH-6: it read only "Active · Opens
  only the … report"); the panel's own "Couldn't load the links." has **Try again** (`q.refetch()`,
  round 2, VER-2). New link offers "Opens: All your reports / One report only" over the shown reports
  (`shownReportsOf`). Since code review round 1 (LINK-1) the report it sends is the one its box shows
  (`chosen`, worked out from the list as it is now), Create link waits while there is none, and while
  the reports load the choice reads "— loading your reports…": opened before the list arrived, it used
  to send no `reportId` and make a link to every report. Since round 2 (VER-2) a failed reports list
  reads "Couldn't load your reports." with **Try again** (`refetchQueries` on the reports key; opening
  New link while it has failed reads it again once), where "— loading your reports…" stayed forever;
  that line now shows only while the list is being read (the first read, or a Try again). Share waits
  for the links list too (LINK-3): it gets `null` while the list loads and shows "Loading links…" (no
  Make a link, Copy message off) or "Couldn't load the links." with the error (and, since round 2,
  **Try again**: above), where it used to offer to make an all-reports link the campaign already had.
- **Smaller round-2 changes (the upgrade's code review):** the link row prints `failureLine` whenever a
  count is above zero, the warning badge only for the last 24 hours on an unlocked, unexpired link
  (WALK-2); History subjects name the tab and team (`reportRowName`, WALK-3); matched canvasser names
  show as written (the server returns them so, and `asName`/`quotedNames` in TeamDialog.jsx capitalise
  an older server's answer, WALK-9).
- **Known limit.** Closing the tab, or a Back that leaves the app, doesn't save a pending change: the
  `beforeunload` guard only prompts. (Round 1's other limit, a keepalive refused in the last 800 ms and
  lost, is closed by the copy above.)
- **Client pages** (outside `ProtectedRoute` in [App.jsx](../client/src/App.jsx), pinned to the light
  theme): [PublicReportLayout.jsx](../client/src/components/PublicReportLayout.jsx) (the gate, the
  logo, Sign out on this device, "Powered by Doorline"), [PublicReportListPage.jsx](../client/src/pages/PublicReportListPage.jsx)
  (the hub: every whole-campaign report in one tab, a tab per other series, the trend chart),
  [PublicReportDetailPage.jsx](../client/src/pages/PublicReportDetailPage.jsx) (a report, Older/Newer,
  the opened ping, the PDF), [shareSession.js](../client/src/lib/shareSession.js) and
  [shareErrors.js](../client/src/lib/shareErrors.js) (the one error handler and its copy;
  `reportGoneSingle` is the one-report link's taken-down sentence). On a one-report link the list page
  hands over to the report and the detail page drops every way to another report (§K). The detail
  page re-reads the report on window focus and when revisited after a minute, and passes
  `visibility.mapVersion` to the map (code review PUBUX-1), so new numbers, pins switched to areas, a
  new area size, or a map question added or taken off reload the map at once; a filter or area shade
  the new payload no longer offers is cleared (`liveFilters`, `liveShade` in reportMapData.js), and the
  view fits once per extent, so a reader zoomed in keeps the view when the doors didn't move. "This
  report was just updated — reload." now shows only when a door is tapped before the page re-read the
  report. A tap that catches several spots reads "N doors near here — zoom in to pick one"; "N doors at
  one spot" is kept for one spot holding several doors (PUBUX-5).
- **The map from the keyboard** (`ClientReportMap`, code review WALK-10; the client page and the
  builder preview): the canvas is focusable (Mapbox's own `tabindex`), and Mapbox's arrow keys and +/−
  move and zoom it. While it has `:focus-visible` (not after a click) a red ring (`border-brand-600`,
  24 px) marks the centre; **Enter** opens what a tap inside the ring would (`queryRenderedFeatures` over
  `CENTRE_MARK_RADIUS` 12 px: the doors of every spot there, "near here" for several) or the area
  under the centre; **Escape** closes an open card from the map or from inside the card and returns
  focus to the canvas. The canvas is described by a hint ("Use the arrow keys to move the map, and plus
  or minus to zoom. Press Enter to show the doors at the centre of the map, and Escape to close them.";
  areas: "…the area at the centre of the map, and Escape to close it."), and a polite live line says
  what happened ("Showing the door at the centre of the map. Press Escape to close.", "Showing 3 doors
  …", "Showing the area at the centre of the map: 64 doors reached. Press Escape to close it.", "No
  doors at the centre of the map. Move the map with the arrow keys, then press Enter.", "No area at
  the centre of the map. …", "Closed.").
- **The area legend matches the map** (WALK-1): hexagons are filled at `AREA_FILL_OPACITY` 0.62 so
  streets show, and each legend swatch is `seenOver(colour, ground)`, the class colour blended over the
  map's ground at that opacity (reportMapData.js), the ground read from the basemap's own background at
  the current zoom; Satellite and Hybrid use a mid-tone stand-in (`#5f625a`), and the fallbacks
  `#f2f2f2` (light) and `#202124` (dark) are chosen values (`MAP_GROUNDS`). The "No answers to show"
  hatch is drawn over the same ground. Before, a full-strength swatch made a darker class read like a
  lighter one.
- **Shared:** [ClientReportView.jsx](../client/src/components/ClientReportView.jsx), [reportDerive.js](../client/src/lib/reportDerive.js)
  (`deriveReportSections`, `periodPhrase`, the earlier-totals line, the team note, the dates line, the
  hub grouping), [ClientReportMap.jsx](../client/src/components/ClientReportMap.jsx) with
  [reportMapData.js](../client/src/lib/reportMapData.js), [reportPdf.js](../client/src/lib/reportPdf.js)
  (jsPDF, lazy-loaded; every string folded to printable characters through
  [pdfText.js](../client/src/lib/pdfText.js), which also fixed a dropped en dash; the file named for the
  campaign, the scope and both dates). Since code review PUBUX-3 long text wraps to the content width
  (the campaign and organization names, the header line, the dates, the quiet-period line, chart titles
  and subtitles, options, voter groups, observation headings and the "What these numbers mean" terms),
  and a question taller than a page keeps its heading and first three rows together (`keepTogether`).
  The logo is redrawn and compressed (§N). Since code review WALK-11 the PDF's brand colour is the web's
  red (`PDF_BRAND` `#dc2626`, the light theme's `--brand` and Tailwind's `brand-600`) on Doors knocked,
  the door-goal bar and any bar without its own colour; it was indigo. In `ClientReportView` the
  headline cards are a container query: two across, four across only at `lg` (1024 px) **and** when the
  report section itself is at least 720 px wide (`lg:[@container(min-width:720px)]:grid-cols-4`), so the
  builder's preview at 1280 px shows two and no card's "(i)" is clipped.
- **The share map's Not a target voter chip** is gated on presence: offered only when a loaded point
  carries that status (the public wire carries no campaign settings), pinned by
  [clientReportMapRender.smoke.test.js](../client/src/lib/clientReportMapRender.smoke.test.js).

## R. Migration, deploy and old documents

**The deploy comes before the migration**, and the new code works on every unmigrated document:
missing fields read through fallbacks (§B), legacy map rows get positions lazily (§J), every new
query filter tolerates absence (`{ field: null }` matches a missing field), and every counter is
written with `$ifNull` (since `$inc` on an explicit null throws).

**`npm run migrate:client-report-visibility`** ([clientReportVisibility.js](../server/src/migrations/clientReportVisibility.js);
dry run unless `-- --apply`; proxied in the root `package.json`, so it runs from the Run console).
Every write selects only what is still missing, so a second run, or one over documents the new code
wrote between deploy and migration, changes nothing. Steps:

0. Seed `depsEver` on every survey that lacks it, from today's conditions, and `depsEverFromVersion`
   (the survey's current `version`) where that is missing; a survey edited since the deploy already has
   both. Then one aggregation over the responses of every campaign with client reports lists each
   survey with answers given under a version older than its record starts at, as
   `olderVersionTemplates: [{ templateId, from, versions }]` (renamed from `multiVersionTemplates`,
   which listed only surveys whose answers spanned two or more versions). Those versions' conditions
   can't be known; the builder warns (`conditionsUnknown`, §C). Every later step reads an old report's
   dependencies the way the deployed code does: from every survey its answers can have come from
   (`legacyTemplatesFor`, once per campaign, after this seeding), failing closed.
1. List legacy reports whose operator unticked every question (empty used to mean all). By default
   they keep none; `--keep-legacy-all` first writes their charts' keys, and a dry run with the flag
   counts steps 3 to 5 as the flag would leave them. Decide before step 4: a published report already
   through steps 3 to 5 of an earlier `--apply` logs "charts only: its map answers were already
   discarded", never "KEPT", because the flag brings back its charts but not its map answers (code
   review LEGACY-3).
2. Series: one whole-campaign series per campaign and one per walk list with reports, through
   `ensureSeries`; walk-list labels that contain a canvasser's name are listed, never refused.
3. Backfill: `editVersion: 0`; `statsComputedAt = publishedAt` on published reports; `snapshotInputs`
   on legacy reports, exactly what `liveInputs` reads today, frozen: a published report's current
   settings through every survey, and a legacy **draft**'s nothing-live inputs (no map, no map
   questions until its first build); legacy rows' `seq` and the report's `extent`.
4. **Discards information:** each legacy **published** report's `mapAnswerKeys` narrows to what may
   reach the map. Drafts keep their settings: a draft's first build maps only what its current survey
   allows.
5. **Irreversible:** legacy rows of map-off reports (drafts included) are deleted, and answers outside
   the served map questions are pulled from the rest, so an old draft's rows, never served, keep no
   answers (the nightly sweep then deletes them, §E).
6. Links: `credentialVersion: 0`, the budget fields, and `lifetimeStartAt` (= `createdAt`) on links
   that expire. `passwordMeetsRule` is never written here.

It also lists open drafts with no snapshot (they recompute when opened).

**Deploy steps**, in order (the owner runs them; see [OPERATIONS.md](OPERATIONS.md) → *Release:
client reports upgrade*):

1. Before committing: `npm run audit:mobile-api` (the history route changed; the phone's response is
   unchanged).
2. Deploy server and web from `main`. No OTA, no client-version bump. The web and the worker build the
   three new collections' indexes at boot; the worker starts the new queue and the nightly sweep.
3. Heroku dashboard → **More → Run console**: `npm run migrate:build-indexes` (dry run; it should list
   `ClientReportMapPoint { clientReportId, snapshotId, seq }` and `CampaignChange { campaignId,
   clientReportId }`), then `npm run migrate:build-indexes -- --apply`.
4. Same console: `npm run migrate:client-report-visibility` (dry run). Decide on the reports step 1
   lists and glance at step 2's labels, then `npm run migrate:client-report-visibility -- --apply`
   (adding `--keep-legacy-all` to keep those charts).

**The 2026-10-25 follow-up** (the guide, report weeks, links to one report, no accidental doubles) has
**no migration and no console step**: every new field reads as its default when missing
(`reportWeekStartsOn ?? 1`, `reportId` null, `dupGuard` absent), and the guard index builds at boot
(§B). `npm run audit:mobile-api` finds no phone call on the changed routers (the phone calls no
client-report, share or branding endpoint), so there is no client-version gate; deploy server and
web. Optional, read-only, before or after: **`npm run report:tab-weeks`**
([reportTabWeeks.js](../server/src/migrations/reportTabWeeks.js); proxied in the root
`package.json` with the trailing `--`, so it runs from Heroku dashboard → **More → Run console**) prints,
per organization, how many open tabs' latest report runs whole weeks on another weekday than the
organization's week, the tabs whose New report will show the nudge, for example:

```
Acme — report weeks Monday – Sunday
  6 open tab(s) with reports · 2 will show the week nudge
    their weeks: Sunday – Saturday: 1 · Wednesday – Tuesday: 1
  (2 ended tab(s) not counted)
```

It writes nothing (it connects with `autoIndex` and `autoCreate` off), names no report, campaign or
person, refuses unknown arguments, and ends with "Nothing was changed." It reads each organization's
week the way the app does (through the schema's cast, so a week stored as the string "3" is Wednesday
there too) and a tab's latest report as New report does: newest `weekEnd`, then `createdAt`, then
`_id`.

**Config** (all optional; none is needed to deploy): `CLIENT_REPORT_JOB_CONCURRENCY` (2),
`CLIENT_REPORT_BATCH` (2,000), `CLIENT_REPORT_SWEEP_CRON` (`31 5 * * *`),
`CLIENT_REPORT_QUEUE_TIMEOUT_MS`, `CLIENT_REPORT_MAP_CACHE_MB` (64; the web process's map payload
cache budget in megabytes, `0` turns the cache off, §J), `SHARE_LINK_DEFAULT_DAYS` (90; keep it there). Test overrides only,
left unset in production: `CLIENT_REPORT_WAIT_RETRY_MS` (30 s), `CLIENT_REPORT_BLOCKED_AFTER_MS` (30
minutes; the `BLOCKED` message's wording assumes it), `CLIENT_REPORT_BEAT_MS` (30 s), and the map
cache's `CLIENT_REPORT_MAP_CACHE_TTL_MS` (15 minutes) and `CLIENT_REPORT_MAP_CACHE_SWEEP_MS` (60 s).
`MAPBOX_PUBLIC_TOKEN` and `JWT_SECRET` (which also salts the opaque series keys and the share token's
link key) already exist.

**Older history.** There are no client login accounts:
[cleanupClientRole.js](../server/src/migrations/cleanupClientRole.js) removed the old `role:'client'`
memberships long ago. A report frozen before the `not_target` row (2026-10-02) or before `provenance`
was stored (fixed 2026-10-19) renders as it always did; their next build fills them in.

## S. Tests

Server (`npm run test:int`): [reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js)
(the audit's defects flipped to assert the fixes, headers, codes),
[clientReportBuild.int.test.js](../server/test/clientReportBuild.int.test.js) (parity, fence, arrivals,
liveness, cancel, commit misses, deletion mid-build, changes mid-build, sweep, publish, take down,
refresh, remap, removals), [clientReportTeamParity.int.test.js](../server/test/clientReportTeamParity.int.test.js),
[clientReportSeries.int.test.js](../server/test/clientReportSeries.int.test.js),
[clientReportChecks.int.test.js](../server/test/clientReportChecks.int.test.js),
[clientReportMigration.int.test.js](../server/test/clientReportMigration.int.test.js) (legacy documents
through every route, the migration's order and idempotence),
[clientReportEdits.int.test.js](../server/test/clientReportEdits.int.test.js) (code review round 1:
`liveInputs` on `GET /:id`, `ifStatus` and `STATUS_CHANGED`, `GOAL_AFTER_BUILD`, a pending Refresh's
additions surviving an edit, the legacy fallback rule across a survey swap, stale keys, the migration's
"charts only" verdict),
[clientReportMapPayload.int.test.js](../server/test/clientReportMapPayload.int.test.js) (the streamed
pins payload byte-identical to the old build, the cache and its coalescing, gzip only when accepted,
headers, `mapVersion`),
[shareLinks.int.test.js](../server/test/shareLinks.int.test.js) (the budget under concurrency, `cv`,
expiry, renew),
[clientReportOpens.int.test.js](../server/test/clientReportOpens.int.test.js),
[resolveSessionUser.int.test.js](../server/test/resolveSessionUser.int.test.js),
[clientReportBranding.int.test.js](../server/test/clientReportBranding.int.test.js) (good and malformed
PNGs, the cascade), and [staticPages.int.test.js](../server/test/staticPages.int.test.js) (`X-Robots-Tag`
on `/r/`). For the 2026-10-25 follow-up: [reportPeriods.test.js](../server/test/reportPeriods.test.js)
(unit, no database: the fixture table against the server copy, with coverage checks),
[clientReportWeeks.int.test.js](../server/test/clientReportWeeks.int.test.js) (the settings API, the
series picker's week facts, Next on the organization's week, `NEXT_GAP_TOO_LONG`, a double click),
[clientReportSingleLinks.int.test.js](../server/test/clientReportSingleLinks.int.test.js) (a link made
only for a shown report, every public route refusing another report's id, the hub's `single` and
`gone`, `nav` and the earlier-totals form, the delete cascade and its History rows, the demo reset)
and [clientReportDuplicates.int.test.js](../server/test/clientReportDuplicates.int.test.js) (the guard
index's name and filter, `REPORT_EXISTS` and `allowDuplicate`, concurrent creates making exactly one
report with no orphan job or History row).

Client (`npm --prefix client test`): `reportDerivePeriod.test.js`, `reportMapData.test.js`,
`reportPdf.test.js`, `shareSession.test.js`, `apiIdentify.test.js`, `clientReportsLogic.test.js`,
`clientReportAutoSave.test.js`, and the render and effects smoke tests
(`clientReportsRender`, `clientReportBuilderEffects`, `clientReportIntegration`,
`clientReportRefreshDialog`, `publicReportRender`, `publicReportEffects`, `clientReportMapRender`) in
[client/src/lib/](../client/src/lib/). For the 2026-10-25 follow-up: `reportPeriods.parity.test.js`
(the same fixture table against the client copy), `clientReportsSimplify.smoke.test.js` (the guide, the
date choices, the week setting and nudge, the duplicate prompt, Share, the links panel, the list page's
wiring), `clientReportBuilderLinks.smoke.test.js` (the builder's link lines) and
`reportPdfSingleLink.test.js` (the one-report earlier-totals line in a real PDF); a link to all your
reports renders byte for byte as before, pinned by `publicReportAllLinks.snapshot.json` (regenerate
only on purpose: `UPDATE_PUBLIC_REPORT_SNAPSHOT=1 node --test src/lib/publicReportRender.smoke.test.js`).
