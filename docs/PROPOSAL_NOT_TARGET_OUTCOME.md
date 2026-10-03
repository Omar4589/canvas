# Proposal: "Not a target voter" — an opt-in door outcome

> **Status: BUILT 2026-10-02 (committed in 6d3ca94, then a follow-up commit on top of it — §S items
> 10-14 and the docs and Help Center cascade; not deployed — dormant until `OPT_IN_OUTCOMES` is set) —
> approved by the owner the same day as a PLAN + DESIGN, reviewed three times.** Build notes,
> including the places the build deliberately differs from the text below, the post-build review fixes
> and the owner's later ruling on export copy, are in [§S](#s-build-notes-2026-10-02) at the end.
>
> *As approved:* The owner's decisions are recorded in *Decisions* below and quoted in §R; the design calls
> were approved with the plan. The surface map behind Part 2 came from a read-only sweep of
> the whole repo (seven subsystem readers plus a completeness pass over 188 more files). The plan was
> then reviewed adversarially twice more, every finding re-checked by a second agent trying to refute
> it against the code: first along four lenses — counting and money; mobile, offline and rollout;
> permissions, privacy and docs; completeness — (34 findings: 24 confirmed, 10 confirmed with a
> corrected fix, none refuted), then on the mechanisms that rewrite introduced, the document's own
> consistency, and a pre-mortem (29 findings: 22 confirmed, 5 confirmed with a corrected fix, 2
> refuted). Both rounds are folded in here. Every claim about how something counts today was read in
> the code, and the one pre-existing counting bug this plan fixes (the Contact % double count) was
> reproduced against a throwaway database with the real pipeline.

What this covers: what the button is for and when a canvasser uses it, why it starts off and how it
is released, how it counts, what the client sees, how it is kept honest, the screens (design), and —
in Part 2 — every file that has to change, the order to build it in, the tests, the privacy record,
and the rollout. It also carries two changes that reach **every canvasser on every campaign**, not
only campaigns that use the new button: the app now **asks before a door's result is changed** (and
warns when the change would delete survey answers), and outcome settings — the existing toggles and
the Add-person policy included — **reach phones through the map's existing 30-second update**.

Related: [METRICS.md](METRICS.md) (Refused, No soliciting, and the rates this outcome joins),
[CAMPAIGNS.md](CAMPAIGNS.md) (App Customization and the Door Outcomes desk),
[CANVASSER_APP.md](CANVASSER_APP.md) (the door screen), [VOTERS.md](VOTERS.md) (Add a person at the
door, the flow this backs up), [CLIENT_PORTAL.md](CLIENT_PORTAL.md) (the client's contact breakdown),
[EXPORTS.md](EXPORTS.md), [PASSES_AND_TURF.md](PASSES_AND_TURF.md), [AUDIT.md](AUDIT.md),
[OPERATIONS.md](OPERATIONS.md), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

---

# Part 1 — For everyone

## What it is

A new door button, **Not a target voter**, for the moment a canvasser **talks to someone at the door
who is not one of the voters on the list for that address, and that person won't give their
name**.

Today the canvasser has no honest way to record that visit:

- **＋ Add person** needs a first and last name, and some people won't give one.
- **Refused** counts it as someone declining the survey, which hides that the person wasn't one of
  the campaign's voters at all.
- **Not home** says nobody answered, which is not what happened.

So the conversation disappears into Not home or Refused, and the campaign's numbers can't show
that the crew was actually talking to people.

The rule for a canvasser at the door:

| Who answered | What they'll share | Tap |
|---|---|---|
| A voter on your list | Takes the survey | **Take survey** on their card |
| A voter on your list | Declines | **Refused** |
| Someone not on your list | Gives their name | **＋ Add person**, then survey them |
| Someone not on your list | Won't give their name | **Not a target voter** — if your campaign has it turned on |
| Nobody | — | **Not home** |

On a campaign that doesn't have the button, the canvasser records that door the way they do today
and mentions it to their lead — the pattern the Help Center already uses for optional buttons, in
the wording the owner approved (§R): *"If you don't see **Not a target voter**, record the door as you
do today and mention it to your lead."*

## Why it exists

To explain a low **connection rate** to a client. Connection rate is *surveyed doors ÷ doors
knocked*. When a voter file is out of date — people moved, households changed — a crew can talk to
plenty of people and still survey few *target* voters. Without this outcome, those conversations
are invisible. With it, the client's report shows a line like "Not a target voter: 188" right
beside "Declined to participate" and "Didn't answer", so the gap has a reason attached.

## Why it starts off, and who can turn it on

Because nothing about it can be checked. No name is taken, so a canvasser could tap it to cover for
not surveying. So:

- It is **off on every campaign** — existing and new — until someone turns it on. This is a
  deliberate exception to the rule that every outcome starts on.
- **Only org admins** can turn it on or off. Team leads see the setting and whether it is on, but
  can't change it. (A team lead can be the paying client; this switch is the trust decision, so it
  stays with the org.)
- When it is on, **everyone on that campaign** gets the button — including anyone a team lead adds
  to the crew later, since leads can add canvassers to their campaign. Turn it on only for campaigns
  whose crews you trust.
- It exists on **survey campaigns only**. Lit-drop doors have no voter list on the phone, so there
  is no "target" to compare against. **(design call)**

Turning it on or off is recorded in the campaign's **History**, highlighted, with who did it and
when.

## How it is released

The setting does not appear anywhere on the day the code ships. Doorline releases it in two steps:
first the phone app update goes out, and only once phones have it does Doorline make the setting
available — at which point it shows up on App Customization for org admins. Releasing it in that
order matters: a phone that hasn't updated can't show the button, and it would draw a teammate's
"Not a target voter" door as if nobody had knocked it. A few installed app versions can never take
the update over the air (older store builds and the retired Android app); before releasing, Doorline
points those at the store update with the existing "update available" prompt (§O).

Doorline can also **withdraw it everywhere at once** if something goes wrong: every campaign's button
disappears and new taps are refused, while everything already recorded keeps counting and every
campaign keeps its setting for when it returns. While it is withdrawn, an admin can still see that a
campaign is set on and turn it off. When Doorline releases it again, the button comes back on every
campaign still set on, so Doorline tells org admins before re-releasing.

## How it counts

| | Not a target voter | Same as |
|---|---|---|
| Billable knock | **Yes** | Refused, Not home |
| Connection rate (survey rate) | In the bottom number only — **unchanged** compared with tapping Not home or Refused at that door | Refused |
| Contact % ("someone answered") | **Yes** | Refused |
| Coverage | Its own segment, fuchsia | — |
| The door for this round | Done — it leaves the canvasser's Remaining count | Refused |
| Next round | **Knocked again** like Refused; selectable when targeting or excluding doors by status | Refused |
| Survey answers | Never | — |

Connection rate does not move because of this button: a door where the canvasser spoke to a
non-target person was always a knocked door with no survey. What changes is that the client can now
see *why*. The only design that would have changed the connection rate is "not a knock", which would
have pulled the door out of the bottom number and pushed the rate **up** — exactly the lever someone
misusing the button would want. That design was rejected for that reason.

Within a round the latest tap wins, the same as every other outcome: if the canvasser later surveys
someone at that door, the door becomes Surveyed.

## What the client sees

One new row in the **Voter contact breakdown**, in the same plain words as the button:

- **Not a target voter** — "Doors where someone answered, but it wasn't one of the voters on our
  list for that address and they didn't share their details. We reached a person there, just not a
  voter we could survey."

The row appears **only when the campaign has at least one** — campaigns that never use the button,
and every report already sent, look exactly as they do today. The breakdown still adds up to Doors
knocked. The client's Connection rate card is unchanged, and no new cards are added.

The same words appear in the client files: **Results by voter** prints "Not a target voter" in the
*Address outcome* column (that column describes the door, not the person on the row — EXPORTS.md
already says so for Refused, and will say it for this one too).

## Keeping it honest

Nothing can prove a conversation happened, so the design leans on the evidence that already exists
and makes it easy to look:

1. **Off by default, admin-only switch, recorded in History.**
2. **Every tap is GPS-stamped**, like every door outcome — no location, no record. The GPS audit
   (far from the door, too fast between doors, fake location, one spot) covers it automatically.
3. **Per-canvasser numbers.** On campaigns that use it, the canvasser tables on Home and Timeline get
   a **Not target** column — count and share of that person's doors — so one person at 30% while the
   crew sits near 8% is easy to see. The same figure shows on the Team page's member panel and on the
   phone's canvasser screens. There is deliberately **no automatic flag**: a stale voter file
   produces an honestly high share, and a flag that accuses an honest canvasser is worse than one
   that misses a cheat.
4. **Overlap detection** sees it (it is a knock), so two canvassers both claiming the same door in
   the same round still shows up.
5. **Cleanup tools.** On Door Outcomes an admin can filter to one canvasser's Not-a-target entries,
   change them (to Not home, for example — the preview prices what moves), convert one to Surveyed
   if the answers really were taken, or Unknock them so they stop counting and billing.
6. **Hard to fake from outside the app.** On a campaign that has never had the button on, the
   server refuses it outright — even from the offline queue, because no phone could ever have shown
   the button there.
7. **A Doorline-wide off switch** (see *How it is released*).

## Turning it off

- A phone that is **online** loses the button within about 30 seconds of being on the map, and the
  server refuses any live tap at once — a canvasser who taps it from a door screen in the meantime
  gets "turned off for this campaign".
- A phone that is **offline** when you switch it off (no signal, or airplane mode) still shows the
  button until it reconnects, and what it records offline syncs and counts, like any offline door
  result. Real door work is never thrown away. To review entries made after you switched it off,
  filter Door Outcomes by canvasser and date — entries recorded offline are marked "Offline" there
  (new with this change) — and change or Unknock any you don't accept.
- Everything already recorded keeps its status and keeps counting in every report. Nothing is
  converted automatically.

## Settings reach phones in 30 seconds

Today an outcome toggle or the Add-person policy reaches a phone only when it next reloads the
whole campaign (pull to refresh, restart, switching campaigns, a new round). For this button that
would mean "turned on" doesn't show up until canvassers are told to refresh, and "turned off" lingers
for a shift. The plan makes the map's 30-second update carry the door settings themselves whenever
they have changed; the phone applies them on the spot — no reload, nothing lost. **It adds no new
requests and no battery cost:** the map already asks the server for updates every 30 seconds while it
is on screen (that is how teammates' door results and new rounds arrive) and stops when it isn't; the
settings check rides that same request, and the answer only grows on the rare poll after a setting
changed. A canvasser standing on a door screen picks the change up the moment they are back on the
map. This also makes the existing outcome toggles and the Add-person policy take effect the same way
(owner, 2026-10-02).

## Fixed along the way

These are existing bugs that sit on the exact lines this feature has to edit. Fixing them is part of
the plan; each is called out so nobody is surprised by a changed number.

1. **Contact % can count one door twice — campaign, team and round level only.** When one canvasser
   surveys a voter and another canvasser records Refused at the *same door in the same round*, that
   door counts twice in the contact numerator. Reproduced with the real pipeline: two doors, only one
   of which reached a person, read **100%** instead of 50%; a single such door reads **200%** — while
   METRICS.md promises the rate never exceeds 100%. Adding a third contact outcome would make this
   worse, so "someone answered" becomes **one yes/no per door per round**. Per-canvasser Contact %
   does not change at all (a single canvasser can't overlap with themselves). Campaign, team and
   per-round contact rates can only go **down**, and only where canvassers overlapped. No dashboard
   shows those campaign-level rates; where the corrected, lower number **does** appear is the
   **Contact rate %** column of the per-round invoice files (*knocks by pass* and the Export Center's
   *knocks by round*) and the Door Outcomes price previews. So a re-downloaded per-round file can
   differ from a copy sent to a client earlier — on any campaign where canvassers overlapped, whether
   or not it ever uses the new button.
2. **Timeline's "No solicit" column always shows 0.** The server adds the number up and never sends
   it. The new Not target column takes the same path, so both are sent.
3. **The Books screen's "restrict the remaining doors" prompt under-counts No-soliciting doors**
   (mobile), so it can offer a one-tap restrict of doors the crew already reached, skipping the
   second confirmation that exists to stop that.
4. **Campaign History shows the Add-person policy as raw text** ("Door Add Policy: leads"). Fixed
   while the new History wording is added to the same file.
5. **The Restricted button's label is hard to read in dark mode** (dark text on dark slate, 2.3:1
   contrast). The new button would have the same problem, so both dark buttons get white labels in
   both themes.
6. **The mobile voter profile prints raw outcome keys** ("no_soliciting · Dana · 2h"). It would print
   "not_target"; it now prints the label.
7. **Doc drift** found by the sweep in the sections this plan rewrites (lists that never learned No
   soliciting; the "What's recorded" History FAQ that never listed the outcome settings), corrected
   in the same edits.

## Design

These are text sketches of each screen that changes. Colors: the new outcome is **fuchsia
#A21CAF** — chosen by measurement as the most distinguishable color from every status that can
share a survey campaign's map, including under all three common forms of color blindness. Its
nearest neighbour is the Lit-dropped purple, which never shares a campaign with it; the two can sit
side by side only in an org-wide coverage bar spanning both campaign types, where they are still
clearly different (and labelled).

### 1. Door screen (phone), survey campaign with the outcome on

```
‹ Map
┌──────────────────────────────────────────────┐
│ 1423 Maple Ave                    ● Not home │
│ Decatur, GA 30030                            │
│ Directions                                   │
└──────────────────────────────────────────────┘
VOTERS AT THIS ADDRESS        0/2 surveyed   ＋ Add person
 (JS)  Jane Smith · Dem · 54 · F            Take survey ›
 (RS)  Robert Smith · Dem · 57 · M          Take survey ›

OPTIONAL NOTE
┌──────────────────────────────────────────────┐
│ Anything worth remembering                   │
└──────────────────────────────────────────────┘
[               Not home               ]   blue
[             Wrong address            ]   red
[                Refused               ]   amber
[          Not a target voter          ]   fuchsia, white label   ← new; only when on
[             No soliciting            ]   pink
[           Restricted access          ]   slate, white label (fixed)
```

The button sits right under Refused because they are the two "someone answered, no survey"
outcomes. It is never offered as the door list's one-tap quick action — a canvasser always has to
open the door to record it.

### 2. Add a person sheet — unchanged

No change (owner, 2026-10-02). **＋ Add person** stays the path for someone who gives a name; the
**Not a target voter** button is the one way to record someone who won't. A shortcut link on the sheet
was considered and dropped as a redundant second way in.

### 3. "Change this door's result?" (phone)

Each canvasser keeps one result per door per round, so recording a different one *replaces* the
earlier result — and if they had surveyed someone there, it deletes those survey answers. Today both
happen without a word. From now on, whenever a canvasser is about to **change** a door's result, the
app asks first (owner, 2026-10-02). It asks when the door already shows a result this round — their
own or a teammate's, whatever the door's status pill shows — and they pick a different one:

```
┌──────────────────────────────────────────────┐      ┌──────────────────────────────────────────────┐
│ Change this door's result?                   │      │ This door is marked Not home                 │
│                                              │      │                                              │
│ This door is already marked Not home this    │      │ This door is already marked Not home this    │
│ round. Record Refused instead?               │      │ round. Take a survey instead?                │
│                                              │      │                                              │
│        [ Cancel ]        [ Record ]          │      │        [ Cancel ]       [ Continue ]         │
└──────────────────────────────────────────────┘      └──────────────────────────────────────────────┘
   any outcome button, or a one-tap Not home             opening a survey (Take survey, Re-survey,
                                                          or Add person → Add & take survey)
```

When the change would delete survey answers the canvasser took at this door this round — including a
survey still waiting to upload — the stronger version shows instead:

```
┌──────────────────────────────────────────────┐
│ You surveyed someone here                    │
│                                              │
│ You took 1 survey at this door this round.   │
│ Recording "Not a target voter" replaces your │
│ result for this door and deletes those       │
│ answers. If you surveyed someone, the door   │
│ is already done.                             │
│                                              │
│   [ Keep my survey ]     [ Replace anyway ]  │
└──────────────────────────────────────────────┘
```

It does **not** ask on a fresh door (nothing recorded this round), when re-recording the same result
(Not home again, *Re-record drop*), when surveying another voter at a door already marked Surveyed,
or on a door still showing the office's Restricted mark from the console (that door's card already
says "work it normally; what you record here replaces the mark"). The one exception to all of these:
if a survey the canvasser took at that door is still waiting to upload, the "You surveyed someone
here" warning always shows — a phone can briefly forget a door's status while a survey is queued, and
that is exactly when answers would be lost. So the everyday path — a fresh door, one tap — stays one
tap; only a change costs a second tap. It covers every way a result can be recorded: the
buttons on the door screen, the one-tap **Not home** on each door-list row and on each unit of a
building, and the survey screen.

### 4. App Customization (web), org admin

Once Doorline has made the outcome available, survey campaigns show a new section:

```
Door outcomes
  ● Wrong address      Counts as a knock; flags a bad address.               [x]
  ● Refused            Counts as a knock and a contact — someone answered…    [x]
  ● No soliciting      Counts as a knock, not a contact — a posted sign…      [x]
  ● Restricted access  Not a knock — the home couldn't be reached…           [x]

Off until you turn it on                                  (survey campaigns only)
  These outcomes can't be verified, so they start off on every campaign. When one
  is on, everyone on this campaign gets the button. Only org admins can change this.
  ● Not a target voter                                                       [ ]
    Someone answered who isn't on the list for that address and wouldn't give their
    name. Counts as a knock and a contact — never as a survey.

Always available
  ● Not home   …
  ● Surveyed   …

Adding people at the door
  …
```

Ticking the box opens a confirmation (the shared modal):

```
Turn on "Not a target voter" for Fulton D3?

Everyone canvassing this campaign sees the button once their app is up to date —
including anyone a team lead adds to the crew later.
• It counts as a knock and as reaching a person (Contact %), never as a survey.
  Connection rate is unaffected.
• No name is recorded, so an entry can't be verified. Turn it on only for crews
  you trust.
• Each entry is GPS-stamped and shows on that canvasser's row on Home and Timeline.
• This change is recorded in the campaign's History with your name.

                                        [ Cancel ]  [ Turn on ]
```

Turning it off needs no confirmation (the safe direction); the section shows "Entries already
recorded keep counting. A phone that is offline keeps the button until it reconnects."

A **team lead** sees the same section with the checkbox disabled and the line "Only org admins can
turn this on or off."

The **phone preview** beside the page shows the button exactly as canvassers will see it: present
when on, absent when off.

### 5. App Customization (phone admin)

The same section as an inset switch group under the existing switches: "Off until you turn it on",
one switch "Not a target voter", the same one-line description, the same confirmation (as a system
alert, Cancel first), the same read-only state for leads, and the same rule that it appears only
once Doorline has made the outcome available.

### 6. Campaign History

```
Off-by-default outcomes: none → Not a target voter          Omar Z. · Oct 2, 3:14 PM   (highlighted)
Adding people at the door: Everyone on the campaign → Team leads & admins only   Omar Z. · Oct 2, 3:15 PM   (wording fixed)
```

### 7. Campaign Home (web) and the canvasser tables

On campaigns that have ever had the outcome on, the *Selected range* tiles gain one tile beside
Connection rate, and the canvasser table gains one column after Contact %:

```
 Knocks   Survey doors   Surveys taken   Voters surveyed   Connection rate   Not a target
 1,184    312            371             355               26%               188 · 16% of knocks

 Canvasser     Doors  Survey doors  Surveys taken  Conn %  Contact %  Not target  Doors/hr …
 Maria Lopez     142            31             38     22%        41%    12 · 8%       14.2
 Dev Patel       131            12             13      9%        52%    41 · 31%      15.0
```

The column sorts by share. Campaigns that never turned the outcome on show neither the tile nor the
column. Under the same rule the figure also appears where an admin looks at one person or one round:
the Timeline's canvasser table, the Team page's member panel and the *By pass* table on the web; the
campaign home, the canvasser cards ("41 not target"), the canvasser profile tiles and the Users-hub
member sheet on the phone.

### 8. Client report — Voter contact breakdown

```
Voter contact breakdown            Outcomes across all doors knocked   (i)
 Surveyed                    312   ████████          26%
 Declined to participate     141   ████              12%
 Not a target voter          188   █████             16%     ← new; only when > 0
 Didn't answer               494   ████████████      42%
 No-soliciting sign           31   █                  3%
 Wrong address                18                      1%
                           1,184 = Doors knocked
```

### 9. Maps, coverage, turf cutting

- A fuchsia house pin and legend entry "Not a target voter" (short chip label "Not target") on the
  canvasser map, the admin map (web and phone) and the book map. The admin map's status chip appears
  on campaigns that use the outcome.
- A fuchsia **Not a target** segment in the coverage bars and round progress bars; the full coverage
  legend lists it only when the count is above zero.
- **Turf Cutting** → *Target doors* and *Exclude doors* list "Not a target voter", so a follow-up
  round can go back for the voters who weren't reached — or skip those doors. Saved Searches gets the
  same status.
- Every filter list that offers the status or the outcome — Door Outcomes, Turf Cutting, Saved
  Searches, Exports, the Notes hub, and the phone's export sheet and canvasser activity tabs — offers
  it **only on campaigns that use the outcome**, so customers who never turn it on never see the words.
- The client's **share map** offers a "Not a target voter" filter only when that report actually has
  such a door — the same "only when > 0" rule as the breakdown row — so reports already sent look
  exactly as they do today.
- **Printed packets** show last round's result as a "NOT A TARGET" pill. The paper checkbox list does
  **not** gain the outcome: paper can't know which campaigns turned it on, and nothing on paper is
  ever read back into the app. **(design call)**

---

# Part 2 — Technical reference

## A. Decisions

Owner rulings, 2026-10-02:

| Question | Ruling |
|---|---|
| Counting | Billable knock **and** a contact (joins the Contact % numerator, like `refused`). Connection rate's numerator untouched. |
| Default | **Off** on every campaign, existing and new — the first exception to the 2026-08-16 "new campaigns start all-on" rule. |
| Who gets the button when on | Everyone on the campaign (one switch per campaign; no per-canvasser list, no role tier). |
| Who may flip the switch | **Org admins only** (and super admins). Not lead-editable — unlike `disabledOutcomes` / `doorAddPolicy`. |
| What the canvasser records | One tap. Nothing extra (the existing optional note still rides along, unchanged). |
| Client report | Its own row in the contact breakdown; no new KPI card. |
| Client-facing label | "Not a target voter" (same words as the button, everywhere). |
| Next rounds | Re-knocked like Refused; selectable in target/exclude status pickers. No cut-exclusion toggle. |
| Crew a lead adds later | Gets the button too — intended (confirmed after review). The confirmation and help copy say so. |
| The door note on this outcome | May name or describe the person who answered; that is fine — the client owns the data. No copy telling canvassers otherwise (confirmed after review). |

Design calls made while designing. The owner has ruled on 7, 10 and 11 (quoted in §R); the rest
stand as recommendations the owner approves with the plan:

| # | Call | Why |
|---|---|---|
| 1 | Survey campaigns only — enforced on the route, the setting, the shared helper and the desk. | Lit-drop phones carry no voter list; on a lit-drop door the tap would REPLACE the canvasser's own `lit_dropped` (REPLACEABLE_ACTIONS), removing the completion. |
| 2 | Key `not_target` (actionType = status = icon id); route slug `not-target`. | Optimistic recolor writes the action key as the door status (`mobile/lib/recordAction.js:431,436`), so the two must be one string. |
| 3 | Color `#A21CAF` (fuchsia-700). | Worst-case ΔE76 22.6 against every survey-map status under normal, deuteran, protan and tritan simulation (next best mid-tone 14.9); white label 6.3:1. Nearest color is `lit_dropped` (ΔE2000 15), which never shares a campaign with it — only an org-wide coverage bar can put the two side by side, labelled. |
| 4 | Opt-in stored as a separate allow-list, `Campaign.enabledOutcomes`, set **only** by the audited PATCH. | §B. |
| 5 | **Release gate and kill switch:** a Heroku config var `OPT_IN_OUTCOMES` decides which opt-in outcomes exist at all. | The web console ships in the same slug as the server (`package.json:16` heroku-postbuild; `server/src/app.js:121-129`), so without it every customer org's admins could switch the outcome on before the OTA exists. §B.2. |
| 6 | Offline replays: refused only on a campaign that has **never** enabled the outcome. | §C.3. |
| 7 | Door settings ride `/mobile/changes` and are merged into the cached bootstrap — no refetch, no new request. **Approved by the owner 2026-10-02**, for the existing toggles too. | §C.5. |
| 8 | Contact counted once per (door, round). | §E.2. Pre-existing bug, reproduced. |
| 9 | **Customers who never turn it on never see the words.** Everything visible that exists only for this outcome is gated on `outcomeInUse` (web: the full campaign document; phone: `useOutcomeInUse`): the per-canvasser columns, tiles and figures, the admin and canvasser map chips, and every filter list — Door Outcomes chips, Turf Cutting target/exclude, Saved Searches statuses, Exports outcome chips and round statuses, the Notes hub chips, the phone's export sheet and canvasser activity tabs. The full coverage legends skip the entry at zero (which also covers the org-wide Overview bar). The client share map offers its chip only when the report has such a door (§G). Label, color and icon maps exist everywhere, but render only when there is data. Files: `canvassers.csv` and `outcome-entries.csv` each gain one **always-present** column (each file's own shape rule — §G, §H); the per-round files gain a conditional column; and their **Contact rate %** values change wherever canvassers overlapped (call 8), outcome used or not. | The outcome is opt-in; a customer who never enables it should not have to ask what it is. |
| 10 | **Change confirmation** on every recording path: asks whenever a canvasser is about to change a door's result for the round, with a stronger warning when their survey answers would be deleted (queued ones included). **Owner's ruling 2026-10-02, broadened from the original survey-only guard.** It reaches every canvasser on every campaign with the app update. | Part 1 design §3; §D. |
| 11 | ~~Add-person sheet link~~ — **dropped by the owner 2026-10-02**: the button is the one way to record someone who won't give a name. | Part 1 design §2. |
| 12 | No packet checkbox; packet pill only. | Part 1 design §9. |
| 13 | No automatic over-use flag. | `feedback_false_positives_worse_than_misses`: an honest crew on a stale file has a high share. Evidence (count + share) only. |
| 14 | Desk: listable, filterable, changeable (priced), convertible to Surveyed, unknockable. Never in RATE_NEUTRAL. | §H. |
| 15 | Fanned in "one row per voter" exports, like refused, with a stronger caveat in the docs. | Consistency with every other voter-less door row; the column is documented as a door fact. |
| 16 | New Campaign.stats counters **without** a version gate; the one-time recompute is a required post-deploy step. | §F. |
| 17 | Door Outcomes rows show whether an entry was recorded offline. | The offline residual (§C.3) has no other review surface on the web; §H. |

## B. Storage: the opt-in class

### B.1 Why not `disabledOutcomes`

It is a deny-list — empty or missing means everything on
([`models/Campaign.js`](../server/src/models/Campaign.js) 37-51) — and every campaign created since
the toggles shipped stores `[]` explicitly ([`routes/admin/campaigns.js`](../server/src/routes/admin/campaigns.js)
439). Joining it would switch the outcome ON everywhere. A schema default can't fix that (verified on
mongoose 8.23.1: lean reads see the stored `[]`, non-lean reads see the default — a split brain — and
an unrelated PATCH then persists the default with no History row). A lost update on a whole-array
PATCH would also fail OPEN, and the field is lead-editable by ruling.

### B.2 The class, the release gate and the helpers

In [`services/canvass/outcomeToggles.js`](../server/src/services/canvass/outcomeToggles.js), mirrored
in `client/src/lib/outcomeToggles.js` and `mobile/lib/outcomeToggles.js`:

```js
export const TOGGLEABLE_OUTCOMES = Object.freeze(['restricted', 'refused', 'wrong_address', 'no_soliciting']);
export const ALWAYS_ON_OUTCOMES = Object.freeze(['not_home', 'survey_submitted', 'lit_dropped']);
// Off until an org admin turns them on (Campaign.enabledOutcomes — an ALLOW-list: missing/empty = off).
// Survey campaigns only: each names a voter-list fact a lit-drop door doesn't have.
export const OPT_IN_OUTCOMES = Object.freeze(['not_target']);
```

Server-only, the release gate — read at call time, so changing the config var in the Heroku dashboard
(which restarts the dynos) takes effect with no deploy:

```js
// Which opt-in outcomes Doorline has released (OPT_IN_OUTCOMES config var, comma-separated). Unset =
// none: the setting appears nowhere, the PATCH refuses it, and phones see no button. Unsetting it
// later is the Doorline-wide off switch — campaigns keep enabledOutcomes for when it returns.
export const availableOptInOutcomes = () =>
  (process.env.OPT_IN_OUTCOMES || '').split(',').map((s) => s.trim()).filter((k) => OPT_IN_OUTCOMES.includes(k));
```

The helpers (the server versions read `availableOptInOutcomes()`; the client mirrors take the list as
an argument, from the campaigns response or the bootstrap — §B.4, §C.4):

```js
// The one answer to "may this outcome be recorded on this campaign right now?" Every reader that
// used to test `disabledOutcomes.includes(k)` goes through this instead.
export const isOutcomeEnabled = (campaign, key, available = availableOptInOutcomes()) => {
  if (OPT_IN_OUTCOMES.includes(key)) {
    return campaign?.type === 'survey' && available.includes(key) && (campaign?.enabledOutcomes || []).includes(key);
  }
  if (TOGGLEABLE_OUTCOMES.includes(key)) return !(campaign?.disabledOutcomes || []).includes(key);
  return true;
};

// Has a phone EVER been able to show this outcome's button for this campaign? Toggleable and
// always-on outcomes: yes. Opt-in: only once it has been on at least once. Deliberately ignores
// release state — a tap recorded while it was released and on is honored after a withdrawal.
export const outcomeEverEnabled = (campaign, key) =>
  !OPT_IN_OUTCOMES.includes(key) ||
  (campaign?.everEnabledOutcomes || []).includes(key) ||
  (campaign?.enabledOutcomes || []).includes(key);

// "Does this campaign use the outcome?" — the ONE predicate behind every conditional column, tile,
// chip and per-round CSV column (§G, §J, §K). Rows of an opt-in outcome can only exist once it has
// been on. Never reads release state: history stays visible after a withdrawal.
export const outcomeInUse = (campaign, key) => outcomeEverEnabled(campaign, key);

// The list a phone may act on: stored setting ∩ released ∩ survey campaign. Shipped on both wires.
export const effectiveEnabledOutcomes = (campaign, available = availableOptInOutcomes()) =>
  OPT_IN_OUTCOMES.filter((k) => isOutcomeEnabled(campaign, k, available));

// Stable fingerprint of the campaign's door-screen settings (§C.5). Same function on both wires.
export const doorConfigStamp = (campaign, available = availableOptInOutcomes()) =>
  [
    [...(campaign?.disabledOutcomes || [])].sort().join(','),
    effectiveEnabledOutcomes(campaign, available).join(','),
    campaign?.doorAddPolicy || 'all',
  ].join('|');
```

`OUTCOME_HINTS` gains `not_target` on both clients (identical strings).

### B.3 Model

[`models/Campaign.js`](../server/src/models/Campaign.js), beside `disabledOutcomes`:

```js
enabledOutcomes: { type: [{ type: String, enum: OPT_IN_OUTCOMES }], default: [] },
// Server-maintained, never client-set: every opt-in outcome this campaign has EVER had on. Read by
// the replay rule (§C.3) and by outcomeInUse (§G, §J, §K). Invariant: enabledOutcomes ⊆ this.
everEnabledOutcomes: { type: [{ type: String, enum: OPT_IN_OUTCOMES }], default: [] },
```

Missing on legacy documents reads as `[]` = off on both lean and hydrated reads, so **no migration**.

### B.4 Settings API

[`routes/admin/campaigns.js`](../server/src/routes/admin/campaigns.js):

- **Not in `createSchema`.** `updateSchema = createSchema.partial()` (161) becomes
  `createSchema.partial().extend({ enabledOutcomes: z.array(z.enum(OPT_IN_OUTCOMES)).optional() })`.
  POST then strips the key and every campaign is born off; the only way on is the audited PATCH
  behind the confirmation. (Putting it on `createSchema` would let POST create a campaign that is on,
  with no History row and an empty `everEnabledOutcomes` — the next switch-off would then drop
  honest queued taps.)
- **Org-admin-only** (the lockout loop at 473): add `'enabledOutcomes'`. The loop refuses a lead's
  PATCH with a 403 the moment the key is present (`data[field] !== undefined`), before anything is
  written; its message interpolates the raw field name, so give this one words ("Only an org admin can
  turn off-by-default outcomes on or off."). Comment the 2026-10-02 ruling beside the 2026-08-16 lead
  ruling (469-471) so nobody "tidies" it back into the lead-editable class.
- **PATCH (543-549)**, after the campaign loads:
  - a key not in `availableOptInOutcomes()` → 400 `OUTCOME_NOT_AVAILABLE` ("not available yet");
  - a non-empty list while the merged type (`data.type ?? campaign.type`) isn't `survey` → 400
    `OUTCOME_SURVEY_ONLY`;
  - assign the deduped array, and set `everEnabledOutcomes` to the union of its stored value, the
    **stored** `enabledOutcomes` and the new one, so `enabledOutcomes ⊆ everEnabledOutcomes` holds
    whatever wrote the stored value;
  - a PATCH that moves the type away from `survey` clears `enabledOutcomes` (the type lock allows this
    only before canvassing, `campaigns.js:487-494`); the clear is an audited change like any other.
- `AUDITED_FIELDS` (128-145): add `'enabledOutcomes'` (normalizeAudited stores a sorted comma-join;
  empty → null).
- `GET /admin/campaigns` (294) gains a top-level `optInOutcomesAvailable: availableOptInOutcomes()`
  beside the existing org-level `orgBillRestrictedDoors`, and the web Door Outcomes "Change to" list
  passes it to the helper. The rows already carry `enabledOutcomes` / `everEnabledOutcomes` (lean
  spread, 262-265). Both App Customization screens render the section for a survey campaign in one of
  three states:
  - **released** (`optInOutcomesAvailable` lists the key) — the normal switch;
  - **withdrawn but still set on** (not released, yet the row's `enabledOutcomes` lists it) — labelled
    "Paused by Doorline — no phone shows this button", with only the turn-off enabled; the existing
    audited PATCH already accepts `enabledOutcomes: []` (OUTCOME_NOT_AVAILABLE checks only keys being
    set);
  - **not released and not set** — no section at all.
  Re-release restores the button on every campaign still set on, with no admin action; OPERATIONS.md
  and the campaigns-manage help say so, and that Doorline tells org admins before re-releasing.

**History wording** (`client/src/lib/campaignHistory.js` + `mobile/lib/campaignHistory.js`, kept
identical): `FIELD_LABELS.enabledOutcomes = 'Off-by-default outcomes'`; values render as the
outcome labels joined, null → "none"; `isNotable` true. Same edit fixes `doorAddPolicy`
('Adding people at the door': "Everyone on the campaign" / "Team leads & admins only").

**Tests**: [`test/outcomeToggles.test.js`](../server/test/outcomeToggles.test.js) gains: OPT_IN is a
real actionType; the three classes are pairwise disjoint; **every door actionType except
`note_added` is in exactly one class** (today an unclassified outcome passes); both mirrors equal the
server; hints exist for TOGGLEABLE ∪ OPT_IN; `Campaign.enabledOutcomes` and `everEnabledOutcomes`
element enums equal OPT_IN; `disabledOutcomes` enum still equals TOGGLEABLE (so `not_target` can never
be put in the deny-list); `isOutcomeEnabled` is false on a lit-drop campaign and when unreleased.

## C. Recording and enforcement

### C.1 Vocabulary (one deploy — order matters)

- `CanvassActivity.actionType` enum and `Household.status` enum both gain `'not_target'` **in the same
  change**. If only the activity enum has it, `recordHouseholdAction` writes the row, then 500s at
  `household.save()` (canvass.js:420) before the stats bump; if only Household has it, the create 500s
  *after* the deleteMany and SurveyResponse cleanup (canvass.js:382-393) and the offline queue retries
  the 5xx, repeating the deletion. Bulk desk paths write statuses via `bulkWrite`, which runs no enum
  validators, so they would persist an out-of-enum value silently.
- [`utils/statusPrecedence.js`](../server/src/utils/statusPrecedence.js): `ACTION_TO_STATUS.not_target =
  'not_target'` (non-completion, last-write-wins; completion stays sticky); `STATUS_RANK` entry
  (cosmetic, no consumers); `DOOR_STATUS_LABELS.not_target = 'Not a target voter'` (test-gated to
  equal web `STATUS_LABELS`). A missing ACTION_TO_STATUS entry is the single most dangerous miss:
  `resolveStatus` skips the row (keeps the prior status) while every per-round ladder reads
  `unknocked` — the two views disagree and nothing errors.
- [`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js): `REPLACEABLE_ACTIONS` gains
  `not_target` (the deleteMany set, the stats pair read, `supersededByNewer` and the GPS `replaced`
  chain must all see it — the comment at 340 requires the sets to match exactly).
  `utils/reconcileCounts.js:81` mirrors it.
- [`services/passes/passStatus.js`](../server/src/services/passes/passStatus.js) `emptyStatusCounts`
  gains `not_target: 0` — it doubles as a whitelist: `routes/admin/households.js:365` and `:398` drop
  any unseeded status from the map counts and the map status filter.

### C.2 The route

`POST /mobile/households/:householdId/not-target` → `recordHouseholdAction({ actionType:
'not_target', requireCampaignType: 'survey' })`, copied from the refused route (575-593): 201 for a
real write, 200 `superseded` for a stale replay, `LOCATION_REQUIRED` before zod, the unknock tombstone,
the replaced snapshot — all inherited.

### C.3 The gate and the replay rule

The deny-list line at canvass.js:327 becomes:

```js
if (!isOutcomeEnabled(campaign, actionType)) {
  // Toggleable outcomes keep the 2026-08-16 rule: a queued replay was tapped before the phone could
  // learn of the flip, so it is honored. An OPT-IN outcome replay is honored only if this campaign
  // has had it on at some point — otherwise no phone ever showed the button, and the request can
  // only be hand-made.
  const replay = body?.wasOfflineSubmission === true;
  if (!replay || !outcomeEverEnabled(campaign, actionType)) return { error: outcomeDisabled(actionType) };
}
```

`OUTCOME_DISABLED_LABELS.not_target = 'Not a target voter'` (the alert prints the label verbatim; a
miss prints the slug). The check costs nothing — `campaign` is already the unprojected lean doc
loaded at 314.

Residuals, recorded deliberately, on a campaign where it *was* on and is now off (or withdrawn):

- **A phone that was offline at the switch-off** keeps its cached button; every tap it makes is queued
  with `wasOfflineSubmission: true` (`offlineQueue.js:52`) and accepted on sync. No hand-made request
  is needed — airplane mode is enough. Part 1 says so plainly, and points admins at Door Outcomes
  (canvasser + date filter; offline entries marked "Offline", §H) to review entries made after the
  switch.
- **A hand-made request** flagged as a replay is accepted the same way.

Closing either would mean comparing the phone's tap clock with the server's switch-off time, which
`canvass.js:240-244` deliberately avoids, and a refused replay is dropped silently by the queue
(`offlineQueue.js:120-124`) — an honest canvasser's real knock would vanish. The GPS audit and the
per-canvasser column still see these rows.

### C.4 The wires

- `/mobile/bootstrap` campaign block (bootstrap.js:376-398): `enabledOutcomes:
  effectiveEnabledOutcomes(campaign)` (stored ∩ released ∩ survey — the phone never needs the raw
  setting) and `doorConfigStamp: doorConfigStamp(campaign)`. Additive; older bundles ignore both.
- The `/mobile/campaigns` picker is **not** extended: nothing on the phone reads outcome config from
  it (`map.jsx:323-327` says never to), and a copy there would be frozen into the persisted
  active-campaign blob.
- `GET /admin/campaigns` carries the stored fields through its lean spread, plus
  `optInOutcomesAvailable` (§B.4).
- Per-round lanes (bootstrap, `/changes`, `me.js` Remaining, action responses via `toWireHousehold`)
  inherit through `ACTION_TO_STATUS`; no edit.

### C.5 Door settings ride `/mobile/changes`

Rather than refetching the whole bootstrap when settings change — which every knock's
`cancelQueries(['bootstrap'])` (`recordAction.js:348`) can cancel, which a weak signal can fail twice
under `retry: 1`, and which replaces the cached voters wholesale — the 30-second delta carries the
settings themselves:

- **Client** (`map.jsx` changes query, 518-530): the queryFn reads
  `qc.getQueryData(['bootstrap'])?.campaign?.doorConfigStamp` at fetch time (not part of the query
  key) and, only when there is one, appends `&doorConfigStamp=${encodeURIComponent(stamp)}`. The
  encoding is not optional: the stamp contains `|`, which is not a legal URL character. On iOS before
  17, React Native's `RCTConvert NSURL:` fallback then percent-encodes the whole URL and turns the
  already-encoded `since` into `%253A`; the server's `Date.parse` fails and `/changes` answers 400 on
  every poll — teammates' results, round changes and settings all stop, silently (the map reads only
  `changesQ.data`). The binary supports iOS 15.1+. Every other mobile query param is already encoded
  (`stats.jsx:225`, `voters/index.jsx:37`, `UpdateGate.jsx:45`).
- **Server** (`/mobile/changes`, bootstrap.js:416-526; `assertCampaignAccess` already loads the
  unprojected campaign at 107): when the client sent a stamp and it differs from
  `doorConfigStamp(campaign)`, the response gains `doorConfig: { disabledOutcomes, enabledOutcomes
  (effective), doorAddPolicy, canAddVoters, doorConfigStamp }` — the same values the bootstrap
  computes, `canAddVoters` per user exactly as bootstrap.js:395-397 does (one `canManageCampaign`
  call, only on a change). No stamp sent (older bundle) → nothing added.
- **Client merge** (beside the round check, map.jsx:600-607), the same shape as the delta fold above
  it — `saveBootstrap` persists asynchronously and returns a promise, never the data
  (`mobile/lib/cache.js:124`):

  ```js
  if (result.doorConfig) {
    qc.setQueryData(['bootstrap'], (prev) => {
      if (!prev) return prev;
      const next = { ...prev, campaign: { ...prev.campaign, ...result.doorConfig } };
      saveBootstrap(next);
      return next;
    });
  }
  ```

  The door screen, the map's chips and the books re-render from the cache. Nothing is refetched, so
  nothing can be cancelled or fail, optimistic voters survive, and the next poll sends the new stamp.

**No new requests.** This is a query parameter and an optional response block on the poll the map
already makes (`map.jsx:518-530`: `refetchInterval: 30 * 1000`, the same request that carries
teammates' door results and `activePassIds` for round changes). The server work per poll is one string
comparison on the campaign it already loads; `canManageCampaign` runs only on the rare poll after a
setting changed (and costs no query for a plain canvasser). The poll runs only while the map screen is
focused (`useFocusedPoll`, `refetchIntervalInBackground: false`), so "30 seconds" means 30 seconds of a
canvasser being on the map, and nothing polls in the background; the OUTCOME_DISABLED backstop covers
a tap made from a door screen before then. An offline phone gets no delta at all (§C.3 residual).

### C.6 The phone's gate (fail-closed)

`mobile/lib/outcomeToggles.js` exports `isOutcomeOn(campaign, key)`: for an opt-in key,
`campaign?.type === 'survey' && Array.isArray(campaign?.enabledOutcomes) &&
campaign.enabledOutcomes.includes(key)` (the bootstrap list is already effective); toggleable keys
keep the deny-list rule. A bootstrap from an older server (no field) reads OFF. The door screen
renders the button inside the survey branch only when `isOutcomeOn(bootstrap.campaign,
'not_target')`, never through the deny-list `outcomeOn` (which returns true for any unlisted key). New
`mobile/lib/outcomeToggles.test.js` pins: absent field → off; `[]` → off; listed → on; lit-drop → off;
toggleable keys unchanged.

## D. Door semantics

- Door-level, voter-less (`voterId` null), one row per (canvasser, door, round) like every disposition.
- Non-completion, latest-wins inside the round; a later survey by anyone makes the round Surveyed.
- Counts as **done** for the round wherever "done" is `status !== 'unknocked'` (me.js:266-268 Remaining,
  turfs.js:1415 book progress, PassManager, mobile map strip and books) — automatic once mapped.
- Books whose doors are all `not_target` read **Completed**. It must **not** join `OFF_LIMITS_STATUSES`
  (`cutMapDoors.js:42`) or `bookProgressKey`'s off-limits bucket (both `bookStatusFilter.js` mirrors) —
  that would hide real work under the declutter toggle.
- Target voters at the door stay `not_surveyed` (voter-level reach is SurveyResponse-only), so they
  remain re-targetable; the door matches "No response" in walk-list filters automatically.
- Desk "restrict every door not yet done" (`deskRestrict.js:126`) overwrites a `not_target` round
  result, exactly as it overwrites `refused` today. Documented, unchanged.

**The change confirmation** (Part 1 design §3; design call 10) is client-side only — two pure helpers
in a new `mobile/lib/doorChange.js` beside [`mobile/lib/resurvey.js`](../mobile/lib/resurvey.js), with
their own test. The first decides whether to ask, from the door as the cache shows it this round:

```js
const statusOf = (action) => (action === 'survey_submitted' ? 'surveyed' : action);
// null = record without asking. Otherwise which prompt to show. ORDER MATTERS: the erase check runs
// before every exemption, because a survey still waiting to upload can sit behind a door the cache
// briefly shows as fresh (the pending overlay lapses after 5 minutes or on restart, and a full
// bootstrap refetch repaints the server's 'unknocked') or behind a stale desk mark.
export const changePrompt = ({ door, action, ownSurveys = 0 }) => {
  const current = door?.status || 'unknocked';
  const next = statusOf(action);
  if (ownSurveys > 0 && next !== 'surveyed') return { kind: 'erase', count: ownSurveys, to: next };
  if (current === 'unknocked') return null;                                  // fresh door this round
  if (current === 'restricted' && door.restrictedFrom === 'desk') return null; // the office's mark: "work it normally"
  if (next === current) return null;                                         // re-recording the same result
  if (next === 'surveyed') return { kind: 'survey', from: current };          // opening a survey on a marked door
  return { kind: 'change', from: current, to: next };
};
```

`door.status` is the per-round status the phone already holds (bootstrap/delta, with the pending
overlay applied, so a result tapped seconds ago counts). The wording never promises the door
*changes* — "Record Refused instead?" — because completion stays sticky when a teammate's survey or
drop holds the round.

The desk exemption needs a fresh `restrictedFrom`, and today the phone's copy goes stale: the server
sets it only while the round status is `restricted` (`passStatus.js:25-26`), but every optimistic patch
spreads `...h` (`recordAction.js:21-29`, `survey.jsx:330-333`) and the delta fold never copies it
(`map.jsx:570-578`, although `/changes` sends it at `bootstrap.js:467`). So: the delta fold copies
`restrictedFrom: c.restrictedFrom ?? null` (which also makes the existing "Marked restricted by the
office" card appear for desk marks made mid-shift); `setHouseholdStatus` sets it to `'field'` when the
tapped status is `restricted` and `null` otherwise (a canvasser's own tap is never a desk mark); and the
survey screen's optimistic patch sets it to `null`.

The second helper counts the surveys this canvasser holds at the door, for the `erase` case:

```js
// How many surveys THIS canvasser holds at this door this round — cached or still queued.
// `voters` may be the whole bootstrap list; it is scoped to the door here, so no caller can count a
// survey taken at another door.
export const ownSurveysHere = ({ voters, householdId, pending }) => {
  const doorVoters = voters.filter((v) => String(v.householdId) === String(householdId));
  const doorVoterIds = new Set(doorVoters.map((v) => String(v._id)));
  // Walk-up voters whose add is still queued. The queued body is exactly what recordAddVoter sends —
  // { voterId, firstName, lastName, phone, email } (recordAction.js:452-456) — so the client-minted id
  // is body.voterId, never _id.
  for (const p of pending) {
    if (p.path === `/mobile/households/${householdId}/voters` && p.body?.voterId) doorVoterIds.add(String(p.body.voterId));
  }
  const ids = new Set(
    doorVoters.filter((v) => v.surveyStatus === 'surveyed' && v.surveyedByMe === true).map((v) => String(v._id))
  );
  for (const p of pending) {
    const m = /^\/mobile\/voters\/([^/]+)\/survey$/.exec(p.path);
    if (m && doorVoterIds.has(m[1])) ids.add(m[1]);
  }
  return ids.size;
};
```

- The cache half uses the same double key `shouldConfirmResurvey` does, so a stale flag left by a
  delta merge can't fire it. The survey screen writes `{ surveyStatus: 'surveyed', surveyedByMe: true }`
  into the cached voter on submit (`voter/[id]/survey.jsx:326-328`), and the server stamps the flag
  per round on every bootstrap and delta (`bootstrap.js:72-77`).
- The queue half (`getPending()`, `offlineQueue.js:66`) covers what the cache can lose: every full
  bootstrap refetch replaces voters wholesale (`bootstrapQuery.js:21` overlays households only), so a
  survey still queued would otherwise be invisible to the confirmation. Queue items are
  `{ id, path, body: { ...body, wasOfflineSubmission: true }, orgId, enqueuedAt }` (`offlineQueue.js:45-55`),
  with paths stored without the `/api` prefix (`api.js` adds it), so the survey path matches the regex
  as written (`survey.jsx:298`). The test builds its fixtures from the real path/body builders —
  `recordAddVoter`'s and the survey screen's, exported for the purpose — so a fixture cannot drift from
  what production queues.
- **Where it runs — once, inside `recordHouseholdAction`.** The door screen's buttons, the door list's
  one-tap Not home (`map.jsx:783` `onListQuick`) and the building screen's per-unit quick button
  (`building.jsx:43-45`) all record through `recordHouseholdAction` → `optimisticSubmit`, so the check
  lives there, as an opt-in `confirm` step that `recordHouseholdAction` passes:
  - it runs right after `inFlightPaths.add(path)` (`recordAction.js:299-300`) and before the GPS gate,
    so a double tap on either quick button is deduped by the existing per-path lock instead of opening
    two prompts (the quick buttons have no latch of their own, and iOS stacks alerts);
  - it reads the door and its voters from `qc.getQueryData(['bootstrap'])` and the queue with
    `await getPending().catch(() => [])` — a failed AsyncStorage read falls back to the cache half
    instead of leaving a latch stuck;
  - Cancel / **Keep my survey** resolves a non-blocked sentinel, `{ ok: false, queued: false, kept: true }`,
    and drops the path from `inFlightPaths`, so every caller's existing settle path (the household
    screen's `.finally`) releases its latch. The alert passes `{ onDismiss }` resolving the same way:
    on Android a newer alert (say, a hard-fail from the previous door still in flight) dismisses the
    current one with neither button firing (`DialogModule.kt` `dismissExisting`), and without
    `onDismiss` the door buttons would stay dead;
  - the GPS "Try again" re-entry (`recordAction.js:325`) strips `confirm` from the opts it passes, so
    the canvasser is never asked twice;
  - Android button order: Cancel first; the destructive style only on `erase`;
  - a side benefit: `hasInFlightActions()` now covers the open alert, so the OTA restart prompt can't
    reload the app mid-decision.
- **The survey screen** (`voter/[id]/survey.jsx`) keeps its own mount-time check beside the existing
  teammate re-survey confirm (159-174), `action: 'survey_submitted'`, Cancel → `router.back()`. It never
  stacks with that confirm or with the do-not-contact wall: if either shows, this one doesn't. Placing
  it on the survey screen covers every way into a survey — Take survey, Re-survey, and Add person →
  *Add & take survey* — before any answer is entered.
- Known limit, same as the resurvey gate: on a legacy null-pass book the server sends no
  `surveyedByMe`, so only surveys taken (or queued) this session are counted there.

## E. Counting

### E.1 The knock

`KNOCK_ACTIONS` ([`services/reports/aggregations.js`](../server/src/services/reports/aggregations.js):14)
gains `not_target`. Everything that imports it follows: knocks and billable doors, `BILLABLE_WITH_RESTRICTED`
→ `fieldVisitMatch` (the billing clock and the Results-by-voter universe — `fieldVisitPredicate.test.js`
pins the literal and must be updated on purpose), `Campaign.stats.knockCount` via `knockStateOf`,
overlaps (`overlaps.js:120,259`), coverageGained, the lifetime `doorsKnocked` counter (`bumpLive`),
houses knocked (the status is outside `NON_KNOCKED_STATUSES`), `/team-averages`, `/canvassers/:id/daily`
homesKnocked. Billing price is unchanged (flat per campaign-month; `statement.js:94`).

The hand copies that do **not** import it, each needing the key:
`routes/mobile/me.js:20` DOOR_ACTIONS, `routes/admin/memberships.js:100` DOOR_ACTIONS,
`routes/superAdmin/platform.js:19` ACTION_DOOR, `services/voters/voterProfile.js:15` KNOCK_ACTIONS,
web `components/HouseholdDetailPanel.jsx:12` and mobile `admin/map.jsx:81` OVERLAP_KNOCK_ACTIONS.

The per-canvasser **knocks sums** written by hand — `/canvassers` (reports.js:1101), `canvassers.csv`
(3180) and the summary's homesKnocked (3626-3628) — are replaced, on the lines being edited anyway, by
a sum over the per-actionType rows they already read, keyed on `KNOCK_ACTIONS.includes(actionType)`,
so the next outcome cannot repeat this trap.

### E.2 The contact — once per door per round (the double-count fix)

Today `contactRate = (surveyedKnocks + refusedKnocks) / knocks`, where each term is an independent
per-(household, pass) `$max` flag across **all** canvassers' rows. Reproduced on a throwaway mongod
with the shipped `knocksPipeline` + `contactRate`: a door where canvasser A surveyed and canvasser B
refused in the same round yields `knocks 1, surveyedKnocks 1, refusedKnocks 1` → **200%**; add a second
not-home door and it reads 100% instead of 50%.

Fix — one exported set, one fold, one signature:

```js
// Someone answered the door. Membership is the definition.
export const CONTACT_ACTIONS = ['survey_submitted', 'refused', 'not_target'];
// knocksPipeline inner $group:
hasNotTarget: { $max: { $cond: [{ $eq: ['$actionType', 'not_target'] }, 1, 0] } },
hasContact:   { $max: { $cond: [{ $in: ['$actionType', CONTACT_ACTIONS] }, 1, 0] } },
// outer $group:
notTargetKnocks: { $sum: '$hasNotTarget' },
contactKnocks:   { $sum: '$hasContact' },

export function contactRate({ knocks = 0, contactKnocks } = {}) {
  if (!knocks) return 0;
  // A missing contact count on a pipeline-built or hand-built object is a code bug (a caller that
  // never built it) — fail loudly instead of returning a plausible number. The Campaign.stats copies
  // are the exception: there absence IS data until the one-time recompute (§F), so they default with
  // `|| 0` like every neighbouring field and never reach this throw.
  if (!Number.isFinite(contactKnocks)) throw new TypeError('contactRate: contactKnocks is required');
  return Math.round((contactKnocks / knocks) * 100);
}
```

The `buildEntryFilter` throw on an unresolved scope is the precedent for failing loudly on a
programming error. Callers (15 in `server/src`), by kind:

- **Pipeline rows** (fixed by the fold, no arithmetic edit): `passes.js:87`, `computeReport.js:188`,
  `knocksByPass.js:172,197`, `reclassifyOutcomes.js:351`, `unknock.js:64`, `reports.js:2171`
  (team-breakdown campaign row), `reports.js:544` (/overview, live path). `knocksByPass.js`'s
  `shapeRow` (141-176) and totals build explicit fields rather than spreading the pipeline row, so they
  also **emit `contactKnocks`** on rounds, totals and per-canvasser rows — additive, and it makes each
  round's Contact rate % checkable from the same response, as connection rate already is. (The
  existing `knocksByPass.int.test.js:258` calls `contactRate(r2)` on a JSON round row and would
  otherwise throw.)
- **Field-by-field copies** that must carry `contactKnocks` and `notTargetKnocks`: `/campaign-rollup`
  seed (764-768), stats copy (792-799), live copy (811-815), row (853-871), cumulative (879-914);
  `/overview` stats reduce (418-438) and the `k` default (509-512). The two **stats** copies read lean
  documents, which skip schema defaults, so on every campaign not yet recomputed the counters are
  *absent* — written out, exactly like their neighbours:
  `contactKnocks: acc.contactKnocks + (d.stats.contactKnockCount || 0)` and the same for
  `notTargetKnocks` in the `/overview` reduce (seed and accumulator), and
  `c.contactKnocks = s.contactKnockCount || 0; c.notTargetKnocks = s.notTargetKnockCount || 0;` in the
  `/campaign-rollup` stats copy. A bare copy would make `contactRate` throw and turn `/overview` and
  `/campaign-rollup` into a 500 for every org between the deploy and the recompute — the web campaign
  Home and Overview and the phone's admin home and campaign home all read them.
- **Hand-rolled multi-canvasser**: `/team-breakdown` per-team `$group` (2081-2105) gains `hasContact`
  → `contactKnocks` (2151-2155). This is the one hand-rolled caller that can overlap.
- **Per-canvasser** (exact, because REPLACEABLE keeps one disposition per canvasser per door-round):
  `contactKnocks` is derived from `CONTACT_ACTIONS` where each endpoint reads its rows by actionType —
  never a hand sum of named fields: `/canvassers` (the else-if chain 1029-1047 → 1127),
  `/canvassers/:id/summary` (actions seed → 3736), `knocksByPass.js` per-canvasser (its hand-rolled
  `$group` 212-239 gains `hasNotTarget` and `hasContact` → 290), and `/canvasser-timeline` — whose
  per-outcome counts come from its own per-(user, bucket) `$group` at **2421-2429**, which gains
  `notTarget: { $sum: { $cond: [{ $eq: ['$actionType', 'not_target'] }, 1, 0] } }` and
  `contact: { $sum: { $cond: [{ $in: ['$actionType', CONTACT_ACTIONS] }, 1, 0] } }` (without the
  `$sum`, `row.dayNotTarget += r.notTarget` is `NaN`, which serializes as `null`).
- `me.js` reachedHomes is already a Set union (exact); it gains a not-target home set (213, 431).

### E.3 Per-outcome counts

`notTargetKnocks` rides every surface that carries `refusedKnocks` today: `/overview` totals and
events (`events.notTarget`), `/campaign-rollup` rows + cumulative, `passes.js` rows,
`knocksByPass.js` rows/totals/per-canvasser, client-report totals (`computeReport.js:179-189`, frozen).
Per-canvasser tallies follow the `noSoliciting` precedent: `/canvassers` (seed, else-if chain, row),
`/canvasser-timeline` (the `$group` above, seed 2466-2486, accumulator 2517-2524, **row literal
2596-2658 — emit `dayNotTarget` and the missing `dayNoSoliciting`**), `/canvassers/:id/summary`
(actions seed, `kpi.notTarget`).

### E.4 Coverage and the client breakdown

- `/overview` canvass seed (484-496) and `/campaign-rollup` coverage seed (749-760) gain `not_target: 0`
  — the rollup's `if (bucket in c.coverage)` guard (784) drops anything unseeded (the comment at
  916-917 records the identical `restricted` bug).
- `computeReport.js:173` events literal gains `not_target: 0` — the `status in events` guard (176)
  would otherwise drop these doors, the breakdown would stop summing to Doors knocked, and
  `percentsTo100` would inflate every other row. Frozen-map coverage literal (312) seeded too.
- Two units, as for refused: the breakdown resolves ONE status per (door, round) (latest wins), while
  `notTargetKnocks` is a `$max` flag; they can legitimately differ in overlap cases. Only the breakdown
  partitions Doors knocked.

## F. Campaign.stats

- [`services/reports/campaignCounters.js`](../server/src/services/reports/campaignCounters.js):
  `knockStateOf` gains `notTarget` and `contact` flags; `knockStateDelta` gains
  `notTargetKnockCount` and `contactKnockCount`; `computeCampaignStats` maps `k.notTargetKnocks`,
  `k.contactKnocks`; `COUNTER_KEYS` gains both (else drift is never detected).
- [`models/Campaign.js`](../server/src/models/Campaign.js) stats subdocument declares both with
  **default 0** — `stats` is a strict nested path, so an undeclared key is silently stripped from
  `$inc` and from recompute's whole-subdocument `$set` (verified), and a `null` default makes `$inc`
  throw.
- **No version gate (design call 16).** `notTargetKnockCount` is exact from day one (no rows exist
  yet). `contactKnockCount` is new for data that already has contacts, so until a recompute it is
  partial on every existing campaign. A version gate was designed and dropped: the review found three
  ways it fails silently (an undeclared `version` stripped from every write; a numeric default that
  an unrelated PATCH would persist onto unrecomputed campaigns, trusting a partial counter; a reconcile
  CLI and nightly log that know only "drifted" and "unseeded"). Everything it protected is the
  campaign-level `contactRate` on `/overview` and `/campaign-rollup` — which **no screen renders**
  (Contact % is shown only per canvasser, from live per-canvasser endpoints, and in the Door Outcomes
  previews, which run the live pipeline). So instead: the one-time `npm run migrate:campaign-stats --
  --apply` is a **required** step straight after the server deploy (§O step 2), which seeds the new
  counter exactly from the ledger. Until it runs — minutes — that unrendered field reads low, or even
  **negative**: a refused door recorded before the deploy and re-dispositioned after it bumps the
  absent counter by −1 through the guarded `$inc`. The stats copies' `|| 0` (§E.2) is what keeps the
  routes answering in that window. Skipped, the nightly `CAMPAIGN_STATS_JOB` (04:07 UTC, `apply:
  true`) repairs it within a day and logs one night of drift.
- The model comment at `models/Campaign.js:135-137` ("stats are either exact or absent, never
  partial") stops being true for `contactKnockCount` between the deploy and the recompute; the comment
  says so.
- `test/campaignStats.int.test.js:156` hard-codes the compared keys — add both, plus a `not_target`
  route write and an overlap write (A surveys, B refuses) asserting `contactKnockCount` = 1 and parity
  with `computeCampaignStats`. And the legacy state the deploy creates, on the
  `billableRestricted.int.test.js:391-415` recipe: on a trusted campaign with knocks and a refusal,
  `$unset` both counters, then `GET /overview?campaignId=` and `/campaign-rollup?scope=all` must answer
  200 with a finite `contactRate` (no planned fixture reaches that state otherwise — `Campaign.create`
  writes the defaults).

## G. Reports, client report, exports

Server:

- `/canvassers.csv` (3065-3268): the knocks sum per §E.1, and a **"Not a target"** column appended after
  "Hours source", **present for every org** (0 when unused) — the file's own rule at 3171-3174 is that
  "a conditional column is a different file shape". It shows the count only; the file has no contact
  column today and gains none. Appending (never inserting before "Hours source") keeps every existing
  column where saved import scripts expect it. Three things pin "Hours source" as the last column and
  change with it: `reportsHoursSource.int.test.js:185-196` (the header now ends `Hours source,Not a
  target`, the rows `Measured,0` / `Estimated,0`), the code comments at `reports.js:3171-3174` and
  `:3240` ("APPENDED LAST" — now: the new column follows it and no existing position moves), and the
  docs `EXPORTS.md:869` and `FBTIME_INTEGRATION.md:332`.
- `/knocks-by-pass(.csv)` and the Export Center `knocks-by-round` (`exportBuilders.js:1885-1923`, which
  must mirror the CSV column-for-column): a "Not a target" column after "No soliciting" in both header
  sets, every row map and the TOTAL row — only when the campaign uses the outcome. The in-use flag is
  computed **once**, inside `buildKnocksByPassData` beside `billRestricted` (`knocksByPass.js:73`), by
  loading the campaign's `enabledOutcomes` / `everEnabledOutcomes`, and both files consume it — the
  `doorCols` precedent (3345-3350) — so every other campaign's file keeps its shape (same columns). Σ
  rounds === totals still holds. The on-screen *By pass* table on Home (`DashboardPage.jsx:656-748`)
  reads the same endpoint and gets the same column under the same flag. The **Contact rate %** values
  in these files change wherever canvassers overlapped (§E.2) — EXPORTS.md and the invoicing FAQ say so.
- `services/notes/notesQuery.js:18-27` `ACTION_TYPES` gains it. Trap: `picked()` turns a chip list of
  only unknown keys into `null` = **no filter**, so a missing key makes the Notes hub return every note.
- `services/export/exportTypes.js:40` `DOOR_STATUSES` gains it (doors-by-round 400s otherwise);
  BACKUP_NOTES (89-90) and the descriptions at 187 and 300 name the outcome.
- `exportBuilders.js` fan (`fanPlan` 176-198): voter-less, so fanned like refused — no code change;
  docs carry the caveat. Results by voter: `DOOR_STATUS_LABELS` prints "Not a target voter"; it is a
  knock, so its doors are in the universe.
- `services/canvass/scopeSummary.js:15-22` `OUTCOME_LABELS` — frozen onto run documents, so it must
  ship before any run can include the outcome.
- `/overview` events, `/canvassers/:id/daily` optional per-day field.

Web client report ([`client/src/lib/reportDerive.js`](../client/src/lib/reportDerive.js)):
`contactOrderFor('survey')` and the null-type list insert `not_target` after `refused`;
`CONTACT_LABELS.not_target = 'Not a target voter'`; `CONTACT_HELP` as in Part 1; the contact items
**filter out `not_target` when its count is 0** (old frozen reports lack the key and stay unchanged).
`client/src/components/ClientReportMap.jsx:28-36` `visibleStatusesFor` gains it (survey + null), so
the map's `reached` filter (78-80) still draws those doors. But the same list is handed to `MapFilters`
as `statuses` (269), which renders one chip per entry with no count gate — unchanged, every survey
campaign's share map would gain a "Not a target voter" chip on the deploy day, on reports already sent
and on campaigns that never used it (the public share page `PublicReportDetailPage.jsx:64` and the
builder preview `ClientReportBuilderPage.jsx:570` both render the live bundle against frozen points).
So the list `MapFilters` receives is gated on presence, mirroring the breakdown's "only when > 0":

```js
const visibleStatuses = useMemo(() => {
  const base = visibleStatusesFor(campaignType);
  return households.some((h) => h.status === 'not_target') ? base : base.filter((s) => s !== 'not_target');
}, [campaignType, households]);
```

Presence is the only gate available there — the public wire carries no `enabledOutcomes`. The points
load once from a frozen snapshot (`households` is `[]` while loading), so the chip can appear but
never flicker away. The PDF consumes `deriveReportSections`, so it follows.

## H. Door Outcomes desk

[`services/canvass/reclassifyOutcomes.js`](../server/src/services/canvass/reclassifyOutcomes.js):

- `RECLASSIFIABLE_OUTCOMES` (40-46) gains `not_target`; `CONVERTIBLE_SOURCES` and `UNKNOCKABLE_SOURCES`
  derive from it. Without it, fabricated entries cannot be listed, exported (`outcome-entries.csv`) or
  unknocked — the cleanup path for exactly the abuse the owner fears.
- **Not** in `RATE_NEUTRAL_OUTCOMES` (it moves Contact %, so every pair touching it is priced and
  `recomputeCampaignStats` runs). The App Customization fold card therefore never offers it.
- `eligibleSources` / `eligibleTargets` (120-135), `validatePair` (159, TARGET_DISABLED) and
  `surveyConversion.validateConversion` (101) switch to `isOutcomeEnabled`. Because the helper is
  type-scoped and release-aware, `not_target` is never a target on a lit-drop campaign, an unreleased
  outcome, or a campaign that never turned it on. (The desk already allows any priced pair — the
  source need not be switched off, owner ruling 2026-08-16, `validatePair`'s comment — so changing a
  suspect entry to Not home is available.)
- `to_survey` from `not_target` stays allowed (SOURCES_FOR derives from RECLASSIFIABLE): the desk
  composes answers for a listed voter, so it is the remedy when a canvasser tapped the wrong button
  after a real survey. CAMPAIGNS.md records the caveat that the entry itself said a listed voter was
  not reached.
- Client: `DoorOutcomesPage.jsx:46-49` OUTCOMES/SOURCES gain it; the "Change to" filter (1233) uses the
  helper with `optInOutcomesAvailable` from the campaigns response.
- **An "Offline" mark on entries** (design call 17). `listEntries` (`reclassifyOutcomes.js:213-218`, used
  by the JSON route at `campaigns.js:965-990`) adds `wasOfflineSubmission` to its projection and row
  shape (it carries neither today), and the entries table shows a small "Offline" tag beside
  *Recorded*. That is the evidence an admin needs for the §C.3 residual — entries an offline phone
  recorded after the switch-off — and it serves every existing cleanup flow too. Display only: no
  filter, no count changes. The CSV is **not** built from `listEntries`: `GET
  /:campaignId/outcome-entries.csv` (`campaigns.js:1041-1130`) runs its own `CanvassActivity.find` with
  its own projection (1053), header list (1089-1094) and row builder — so that projection gains
  `wasOfflineSubmission: 1`, the header gains an appended **Offline** column, and each row prints
  "Offline" or blank. Without the projection line the column would be silently blank on every row. The
  column is always present (this file's shape changes once, for every org, like `canvassers.csv`), and
  the same flag already ships in the lead-visible canvass-activity export (`exportBuilders.js:572,
  630`), so it is no new disclosure (§M stamps it).

## I. Turf, rounds, walk lists, packets

- `TurfsPage.jsx`: RestrictModal sum list (544) and `REACHED_STATUSES` (915) — always (they count and
  word, they don't display a choice); Target doors (3124) and Exclude doors (3196) lists — offered only
  when `outcomeInUse(current, 'not_target')`, and both switch to `STATUS_LABELS` for labels.
- `WalkListsPage.jsx:13-23` STATUSES / STATUS_LABEL — the status offered only when the campaign uses
  the outcome.
- `generateTurf.js`, `turfs.js`, `turfProcessor.js`: no change (no exclusion toggle).
- `client/src/lib/packet/packetTheme.js:43-60` STATUS_INK / STATUS_LABEL; `packetPdf.js:32` OUTCOMES
  unchanged (design call 12); `docs/WALK_PACKETS.md` and the print help page say so.
- Mobile `lib/restrictBooks.js`: `REACHED` (20), the statusCounts sum (41 — also add the missing
  `no_soliciting`), the prompt copy (84); `restrictBooks.test.js` gains both statuses on the
  statusCounts path.

## J. Web (client/src)

Every in-use gate on the web reads the full campaign document the page already holds
(`useCurrentCampaign` / `selectedCampaign`) through `outcomeInUse` — never a shaped copy.

| File | Change |
|---|---|
| `lib/statusColors.js` | `STATUS_COLORS.not_target '#a21caf'`, `STATUS_LABELS` and `ACTION_LABELS` 'Not a target voter' |
| `lib/outcomeToggles.js` | OPT_IN_OUTCOMES, `isOutcomeEnabled(campaign, key, available)`, `outcomeInUse`, hint |
| `lib/mapRender.js` | house-icon `match` arm (429-440; the icon itself auto-registers from STATUS_COLORS) and ping `match` (543-552) |
| `pages/MapPage.jsx` → `components/MapFilters.jsx` | MapPage (which holds `selectedCampaign`, 296) passes `notTargetInUse` to MapFilters (1545); the chip shows when in use or `byStatus.not_target > 0` |
| `components/CoverageBar.jsx` | segment `bg-fuchsia-700` (the total sums SEGMENTS only — a missing key drops the doors and inflates every %); the full legend (75-86, which lists every segment including zeros) skips `not_target` when its count is 0 — which also covers the org-wide Overview bar, where there is no single campaign to ask |
| `components/PassManager.jsx` | SEG_COLORS + order |
| `components/CanvasserSummaryTable.jsx` | new prop `notTargetInUse`; "Not target" column (count · share, sorts by share), header AND hand-written cell at the same index, survey branch only |
| `pages/DashboardPage.jsx` | row mapping `dayNotTarget`; passes `notTargetInUse`; *Selected range* tile and *By pass* column under the same flag |
| `pages/TimelinePage.jsx` | passes `notTargetInUse={outcomeInUse(current, 'not_target')}` (545-550; `current` is the full doc, 63); rows already carry `dayNotTarget` from the server |
| `pages/CampaignTeamPage.jsx` | per-member panel (694-718, fed by `/canvassers/:userId/summary` at 428): a "Not a target" figure, count · share, in use only — the screen an admin opens to review one person |
| `lib/metricHelp.js` | `contactRate` rewritten (survey, refusal or not-a-target; once per door per round); `notTarget` entry |
| `components/HouseholdDetailPanel.jsx` | OVERLAP_KNOCK_ACTIONS |
| `components/OverlapDoorCard.jsx` | ACTION_STATUS |
| `components/CanvasserPingPanel.jsx`, `CrossOrgActivityFeed.jsx`, `UserProfileModal.jsx` | private color maps (Tailwind classes written out whole) |
| `pages/DoorOutcomesPage.jsx` | OUTCOMES/SOURCES gain it, but the filter chips (609-635) offer it only when `outcomeInUse`; Change-to filter via the helper; the "Offline" tag beside *Recorded* (§H) |
| `pages/AppCustomizationPage.jsx` | "Off until you turn it on" section on survey campaigns in the three states of §B.4 (released; withdrawn but still set on — "Paused by Doorline", turn-off only; otherwise absent); own mutation + optimistic state (the doorAddPolicy pattern); confirm modal on enable; disabled for leads (`useAuth().isOrgAdmin`) |
| `components/outcomes/PhonePreview.jsx` | button after Refused; shown only when enabled (inverse of the deny-list rule) |
| `lib/campaignHistory.js` | label, formatter, notable; doorAddPolicy wording |
| `pages/TurfsPage.jsx`, `pages/WalkListsPage.jsx` | §I |
| `pages/ExportsPage.jsx` | the outcome chips (`OUTCOME_OPTIONS` from ACTION_LABELS, 110) and `ROUND_STATUSES` (118) offer it only when `outcomeInUse`; the per-voter copy (755-763) names it |
| `pages/NotesPage.jsx` | its outcome chips (`OUTCOMES = Object.keys(ACTION_LABELS)`, 26) offer it only when `outcomeInUse` — edited after the Voters-directory release is committed (this file is part of it) |
| `lib/reportDerive.js`, `components/ClientReportMap.jsx` | §G |
| `lib/packet/packetTheme.js` | §I |
| `lib/platformStatsMeta.js` | copy (and the missing no_soliciting) |

`pages/VoterDetailPage.jsx` prints raw action keys at 896/911 — pre-existing, and part of the
uncommitted Voters-directory release; left alone here.

## K. Mobile (mobile/)

**In-use on the phone.** Most phone admin screens hold a *shaped* campaign — `campaignShape()` (five
keys, `campaignSelection.js:20-26`), `useAdminCampaign`'s `shape()` (`useAdminCampaign.js:41`), or
MemberSheet's `{ id, name, type }` (`users.jsx:156-160`) — none of which carries the outcome fields,
and the persisted active-campaign blob must not be widened (`useCampaignArchived.js:5-12` records
why). A new hook `mobile/lib/useOutcomeInUse.js`, built exactly like `useCampaignArchived`, reads the
already-fetched `['admin','campaigns']` cache by campaign id and returns `outcomeInUse(doc,
'not_target')` — false until resolved, so a figure can only appear, never flash and retract.

| File | Change |
|---|---|
| `lib/theme.js` | `status.not_target '#A21CAF'`, `statusLabels`, `ACTION_LABELS` |
| `lib/outcomeToggles.js` (+ new test) | OPT_IN_OUTCOMES, `isOutcomeOn`, `outcomeInUse`, hint |
| `lib/useOutcomeInUse.js` (new) | the hook above |
| `lib/doorChange.js` (new, + test) | `changePrompt` and `ownSurveysHere` (§D) |
| `lib/recordAction.js` | `ACTION_PATHS.not_target = 'not-target'` (a miss throws after the screen latched); the opt-in `confirm` step in `optimisticSubmit` that `recordHouseholdAction` passes (§D — after `inFlightPaths.add`, before the GPS gate; stripped on the GPS retry re-entry); `setHouseholdStatus` sets `restrictedFrom` (`'field'` for an own Restricted tap, else `null`); the walk-up add and survey path/body builders exported so the tests reuse them |
| `app/(app)/household/[id].jsx` | button (survey branch, after Refused, gated by `isOutcomeOn`); every outcome button inherits the change confirmation through `recordHouseholdAction`, and its `.finally` already releases the latch on the `kept` sentinel; private StatusPill tint (warn, like refused); white labels on the two dark buttons through a per-button style with a literal `'#FFFFFF'` (the `DoorListRow.jsx:83` precedent) — never by changing the shared `actionButtonText` or the `textInverse` token, which would put white on Not home, Wrong address and Refused in dark mode |
| `app/(app)/voter/[id]/survey.jsx` | the mount-time change confirmation beside the re-survey confirm (§D); its optimistic household patch sets `restrictedFrom: null` |
| `app/(app)/map.jsx` | SURVEY_FILTER_OPTIONS ('Not target'), SURVEY_LEGEND, STATUS_ORDER, `Mapbox.Images` + `iconImage` match arm, chip/legend shown when enabled OR present; the encoded `/changes` stamp param and the `doorConfig` merge (§C.5); the delta fold copies `restrictedFrom` (§D); `onListQuick` inherits the change confirmation through `recordHouseholdAction` — no edit there |
| `components/StatusPill.jsx` | warn tint for `not_target` |
| `app/(app)/admin/map.jsx` | STATUS_OPTIONS chip (`useOutcomeInUse` or counted), Images + match, ping `circleColor`, OVERLAP_KNOCK_ACTIONS |
| `app/(app)/admin/book/[turfId].jsx` | STATUS_LABEL, Images + match |
| `app/(app)/admin/campaign/[campaignId].jsx` | campaign home: the "Not a target" KPI and By-round column (in use — this screen holds the raw row); `topCanvasserRows` (332-361) maps `dayNotTarget: c.notTarget ?? 0` and passes `notTargetInUse` to CanvasserCard |
| `app/(app)/admin/timeline.jsx` | `useOutcomeInUse` → `notTargetInUse` on its CanvasserCards (830-842) |
| `components/CanvasserCard.jsx` | "N not target" when `notTargetInUse` and N > 0 |
| `app/(app)/admin/canvasser/[id]/index.jsx` | a "Not a target" KPI tile (count · share; no team delta — `/team-averages` carries none) beside "Not home / wrong", via `useOutcomeInUse` |
| `app/(app)/admin/users.jsx` → `components/MemberSheet.jsx` | users.jsx resolves `useOutcomeInUse` and passes it in; the sheet shows the summary's `kpi.notTarget` |
| admin canvasser screens: `activity` (ACTION_TABS — the tab offered only when `useOutcomeInUse`), `map` (ACTION_TABS, likewise / ACTION_PIN **and its separate `circleColor` match, 191-203**), `households` and `notes` (ACTION_PIN), `day/[date]` (ACTION_COLOR **and its separate match, 216-228**); `admin/users/[id].jsx`, `components/ActivityRow.jsx`, `lib/activityFeed.js` | private dot / pin / color maps |
| `components/CoverageBar.jsx` | segment; the full legend (41-47) skips `not_target` at 0, like the web |
| `app/(app)/admin/app-customization.jsx` | the opt-in section (InsetSwitchRow), shown only when the campaigns response's `optInOutcomesAvailable` lists it and the campaign is a survey campaign; admin-only via `loadRoleContext().isOrgAdmin` (default false); confirm alert |
| `lib/campaignHistory.js`, `lib/metricHelp.js`, `lib/platformStatsMeta.js`, `lib/exportTypes.js` (ROUND_STATUSES) | mirrors of the web changes |
| `components/ExportSheet.jsx`, `app/(app)/admin/notes.jsx` | the outcome chips (from ACTION_LABELS, ExportSheet 30, notes 273) and the round-status tabs (ExportSheet 167) offer it only when `useOutcomeInUse`; the fan copy names it |
| `lib/restrictBooks.js` (+ test) | §I |
| `app/(app)/voters/[id].jsx` | `actionLabel()` instead of the raw key (193) |
| `scripts/gen-house-icons.mjs` | add `not_target: '#A21CAF'` and an optional status-name argument so only the named icon is written |
| `assets/icons/house-not_target.png` | generated (128×128) |

**The icon trap.** `gen-house-icons.mjs` rewrites every PNG it knows, and `house-restricted.png`
(committed from a separate recolor) regenerates 98 bytes different — a full run silently restyles
every restricted pin. Generate with `node mobile/scripts/gen-house-icons.mjs not_target` and confirm
`git status` shows only the new file.

**OTA, not a native build.** The PNG is `require()`d, so Metro bundles it into the update; the
fingerprint hashes only `assets/AppIcons/*` (verified with `@expo/fingerprint` 0.15.5 honoring
`mobile/fingerprint.config.js`). No `app.json`, `eas.json` or native dependency changes. `npm run
ota:check` confirms before publishing.

## L. Docs and Help Center cascade

Docs (Part 1 and Part 2 in each): METRICS (new outcome section; Reached-a-person formula and the
once-per-door fold; the four-way knock/contact distinction; enum lists; REPLACEABLE count; §B/§C rows;
§E endpoint table; §F invariants; §G frontend; §H counters and the required recompute; that
`/overview`, `/campaign-rollup`, `/passes` and `/team-breakdown` return a contactRate no screen shows),
CANVASSER_APP (button, decision rule, the change confirmation on all four paths, fail-closed gate;
the settings-in-the-delta behavior at :100), CAMPAIGNS (the off-by-default class, release gate,
admin-only, survey-only, History wording, replay rule and the offline residual, Door Outcomes pricing
and cleanup recipe, "five" → "six" outcomes, conversion caveat), CLIENT_PORTAL (the row, shown only
when > 0, and its share-map chip only when the report has such a door; fix the stale label list),
VOTERS (cross-reference from Add a person), MAPS (legend row, palette, route, icon; the `/changes`
response shape at :532 — the refetch list at :726-727 stays true, since nothing new refetches),
EXPORTS (chip, fan caveat, Address outcome, the always-present canvassers.csv column — :869 no longer
"ends every row with Hours source" — the always-present outcome-entries.csv Offline column, the
conditional per-round column, the corrected Contact rate %; fix the stale knocks-by-round column
list), FBTIME_INTEGRATION (:332, "a trailing Hours source column" — the new column now follows it),
PASSES_AND_TURF (reached-door lists, color key, targeting, not off-limits; and the §G delta contract
at :1070-1073, which says the delta "patches only status + location + archival" — it now also carries
door settings and `restrictedFrom` — plus a Consequences bullet beside :1082-1094; the full-bootstrap
trigger list at :1096-1099 stays true), PASSES (per-round tally), ADMIN_APP (phone App Customization, admin numbers
subsection), NOTES ("eight" → "nine"), WALK_PACKETS (pill yes, checkbox no), AUDIT (covered by GPS
audit; no outcome-mix flag, and why), PLATFORM (ACTION_DOOR), ROLES (enabling it is org-admin-only),
SURVEYS (§K conversion source), OPERATIONS (the `OPT_IN_OUTCOMES` config var as release gate and kill
switch; that re-release restores the button on every campaign still set on, and org admins are told
first; the pre-release build-status check (§O step 4); the required recompute and what its dry run
prints; roll forward only). Plus this proposal's row in [README.md](README.md).

Help Center (`server/src/content/help/`; Part 1 is the source). The link rule `helpLinks.test.js`
enforces: an article may link only to articles every one of its readers can open — `all` and
`canvasser` articles link only to `all`/`canvasser` slugs, and `lead` articles never link `admin`
slugs. Admin-only steps are described in prose, never linked, from a lead article.

- `guides/canvasser-dispositions.md`, `getting-started/canvasser-first-day.md`,
  `guides/canvasser-door-survey.md`, `faq/add-a-person-at-the-door.md` — the button and the decision
  rule, **conditional**: "if your campaign has it turned on", with the owner's approved line for when
  it isn't — "If you don't see **Not a target voter**, record the door as you do today and mention it
  to your lead." (§R) — in the existing "if you don't see the button" pattern (`canvasser-dispositions.md:30`,
  `canvasser-door-survey.md:28`) — help ships with the server, long before any campaign has the button;
  and, for every canvasser on every campaign, "changing a door's result asks first — and warns you if
  it would delete a survey you took there" (canvasser). A short FAQ,
  `faq/why-does-the-app-ask-before-changing.md` (canvasser), answers the question this new prompt will
  raise. Older app versions that can't take the update need the store update, not a refresh.
- `faq/restricted-vs-refused.md` — Refused vs Not a target voter (all; stays link-free).
- `guides/campaigns-manage.md` — the off-by-default class, who can switch it, that **anyone a team
  lead adds to the crew later gets the button too**, the offline residual, the "Paused by Doorline"
  state and that re-release restores the button, History; line 41's "Every campaign starts with the
  full set" becomes false and is rewritten, and line 46's "recorded while offline before the change"
  is corrected the same way (lead).
- `guides/metrics.md` — the outcome, Contact %, and a "why is our connection rate low?" paragraph (lead).
- `guides/client-reports.md` — the new row (lead).
- `pages/page-door-outcomes.md`, `faq/faked-surveys-cleanup.md` — classification and the cleanup recipe (admin).
- `guides/exports.md`, `pages/page-exports.md`, `faq/which-file-to-send-a-client.md`,
  `faq/activity-export-one-row-per-voter.md`, `faq/export-knocks-for-invoicing.md` — lists, the
  door-not-person caveat, and the corrected Contact rate %.
- `guides/maps.md` (color; the live-vs-refresh list at :117), `guides/canvasser-map.md:20`,
  `faq/changes-not-showing-in-field.md` (door settings now reach phones on the map within ~30 seconds;
  offline phones and older app versions need a refresh), `pages/page-turf-cutting.md`,
  `pages/page-print-packets.md`, `pages/campaign-home.md`.
- `faq/team-lead-vs-admin.md` (all; link-free) — enabling it is admin-only, and anyone a team lead adds
  to the crew later gets the button too; `getting-started/lead-getting-started.md` ("What stays with
  admins") and `guides/roles-and-team.md` ("What they can't do") — enabling it is admin-only.
- `faq/who-changed-the-door-goal.md` — "What's recorded" gains Door outcomes, Off-by-default outcomes
  and Adding people at the door (the first and last already are audited and were never listed).
- New FAQ `faq/low-connection-rate.md` (lead): "Our canvassers are talking to people — why is the
  connection rate low?" This is the owner's stated use case.
- `faq/_INBOX.md` — candidate questions for the rest.

## M. Privacy

Walked against the five triggers in CLAUDE.md:

| Trigger | Verdict |
|---|---|
| What we collect | **No new field.** The row carries what every door outcome carries (outcome, time, canvasser, GPS, optional note). It records a new *fact about an address* — someone not on the list answered — and no reason picklist or new free text was added (the owner chose one tap). **But** the existing optional door note on this outcome will often describe exactly that non-listed person who declined to give details ("her ex answered, said Jane moved"), and per item 18 that note is attached to the registered voters at the door in lead-visible exports (Notes with "voters registered at each door"; canvass-activity "one row per voter") — and a lead can be the client. The repo's do-not-knock precedent (PRIVACY_VERIFICATION.md:108-117) treats free text about people outside the voter file as worth recording. **Owner ruling (2026-10-02): acceptable — "it's okay for us to know names", and the client owns the data — so no canvasser copy discourages it.** `privacy.html:90` ("…or a note") already covers it. |
| Retention / deletion | Rides CanvassActivity's existing cascades. The two Campaign fields die with the campaign. Nothing new to purge. |
| Who can access | Unchanged. The switch governs recording only. |
| Sharing / subprocessors | None. **Not a DPA §6 event.** |
| What we expose | **Yes.** A new row on published client reports and the PDF; a new door-status value on the unauthenticated share map's points (`ClientReportMapPoint.status`); "Not a target voter" beside named voters in Results by voter and in fanned activity rows. |

**No published sentence becomes false**: `privacy.html:90` ("a survey response, a door status, or a
note"), `:94` (location at action time; offline door results), `:101` (published reports show door
statuses at the address level), `:105` (reporting to the organization's own clients) all cover it as
written. Record it as `docs/PRIVACY_VERIFICATION.md` **item 25** (v6, walking each trigger with these
citations, including the note sentence above), with `[v6 …]` stamps on item 18 (the fanned voter-less
actions gain one whose attached claim — outcome label **and** note — is true of *none* of the listed
voters), item 22 (the Household.status domain becomes nine values; the label is a door fact) and §D11
(a new status value on public points), and one more on the `outcome-entries.csv` entry
(`PRIVACY_VERIFICATION.md:2326-2331`, which enumerates that file's columns): it gains an Offline column
— org-admin only, and the same flag already ships in the wider-audience canvass-activity export
(`exportBuilders.js:572, 630`), so no policy change. The client share map shows the new status only on
reports that have such a door (§G) — within the published "door statuses" sentence either way. Item 25
records the owner's note ruling above verbatim. The owner confirms the item before the production
deploy, as with items 17-24. No legal page is edited.

## N. Tests

New:

- `server/test/notTarget.int.test.js`, on the `noSoliciting.int.test.js` recipe: vocabulary
  (KNOCK_ACTIONS, CONTACT_ACTIONS, ACTION_TO_STATUS, precedence both ways with surveyed / refused /
  restricted); knocks and billable doors; connectionRate unchanged vs. the same door as not_home;
  contactRate; coverage segment; `computeWindowStats` Σ contactBreakdown === doorsKnocked; per-round Σ
  === totals; the route (201, survey-only 400 on lit-drop, LOCATION_REQUIRED, replaceability, latest
  wins); **exact** per-canvasser values on `/canvassers`, `/canvasser-timeline` (a non-zero
  `dayNotTarget` and a finite contactRate in both range and totals modes, plus `dayNoSoliciting` now
  emitted), the summary, `canvassers.csv` (column always present) and the per-round CSVs (column
  present when in use, absent otherwise); Campaign.stats parity.
- `server/test/optInOutcomes.int.test.js`: unreleased (`OPT_IN_OUTCOMES` unset, set per test at call
  time like the repo's other env-overridable caps) → `optInOutcomesAvailable` empty, PATCH 400
  `OUTCOME_NOT_AVAILABLE`, bootstrap list empty; released: off on a legacy campaign (field absent) and
  a new one; **POST carrying `enabledOutcomes` creates the campaign off**; admin enables → History row
  with actor; **lead PATCH refused**; a lit-drop PATCH refused and a survey→lit-drop type change clears
  it (audited); deny-list still rejects `not_target`; OUTCOME_DISABLED when off; replay on a
  never-enabled campaign **refused**; enable-then-disable keeps `everEnabledOutcomes` and the replay is
  **accepted**; withdrawing the release (unset var) empties the bootstrap list, refuses a fresh tap,
  accepts a replay, and `enabledOutcomes: []` still saves (the paused turn-off); `/changes` returns
  `doorConfig` only when the client's stamp differs, and the bootstrap and `/changes` stamps agree —
  including a stamp containing `,` and `|` sent `encodeURIComponent`'d, which the server must read as
  equal and answer with no `doorConfig` (this Node test proves the encoded form matches; it cannot
  reproduce the iOS 15/16 rejection of a raw `|`).
- `server/test/contactOnce.int.test.js`: the overlap fixture (A surveys, B refuses; C not_target, D
  refuses) → `contactKnocks` counts each door once on every surface that returns a contact rate, each
  ≤ 100%; per-canvasser rates unchanged; `contactRate` throws without `contactKnocks` on a hand-built
  object; stats parity. Together with notTarget.int, every one of the 15 `contactRate` call sites in
  `server/src` is exercised. The Campaign.stats copies are covered separately, by the `$unset`
  legacy-state test in §F: there a missing counter is data until the recompute, and the routes must
  answer 200 with a finite rate.
- `client/src/lib/appCustomizationRender.smoke.test.js` (the doorOutcomesRender recipe — it executes
  the page body): unreleased → no section; unreleased but still set on → "Paused by Doorline" with only
  the turn-off; released + default off → toggle unchecked, preview without the button; enabled →
  button shown; lead → disabled control; lit-drop → no section.
- `client/src/lib/clientReportMapRender.smoke.test.js`: the real `ClientReportMap` with a survey
  report's frozen points — no "Not a target voter" chip when no point has that status, a chip when one
  does, and the door drawn either way.
- `client/src/lib/canvasserTableRender.smoke.test.js`: the table with Timeline-shaped rows and
  `notTargetInUse` renders the column under its header (header/cell alignment); without the flag it is
  absent.
- `client/src/lib/reportDerive.test.js`: every knock status is either in `contactOrderFor` or
  deliberately excluded, every rendered key has a label and help, `not_target` hidden at 0, the items
  sum to doorsKnocked.
- `mobile/lib/outcomeToggles.test.js` (fail-closed, type-scoped gate) and `mobile/lib/doorChange.test.js`:
  `changePrompt` over the full matrix — fresh door, same result, a door still showing the office's
  Restricted mark → no prompt; a desk-marked door since worked (a stale `'desk'` beside another status)
  → `change`, and → `erase` with an own survey; an own **queued** survey on a door that reads
  `unknocked` → `erase`; every non-survey → non-survey change → `change`; opening a survey on a door
  marked with any non-survey result → `survey`; opening a survey on a Surveyed door → none; own surveys
  + any non-survey outcome → `erase`; lit-drop pairs both ways — and `ownSurveysHere`, which counts a
  cached own survey and a queued one (including a queued walk-up voter's, read from `body.voterId`),
  never a teammate's survey, a survey at another door when handed the whole bootstrap list, a stale flag
  on a `not_surveyed` voter, or a missing flag. Queue fixtures are built from the real path/body
  builders (`recordAddVoter`'s and the survey screen's, exported for this), never hand-written.

Extended: `outcomeToggles.test.js` (§B), `actionLabels.test.js` (no edit — fails until labels
exist), `fieldVisitPredicate.test.js` (pinned set), `resolveStatusSummary.test.js` (matrix rows),
`disabledOutcomes.int.test.js` (the bootstrap wire), `campaignStats.int.test.js` (§F),
`campaignHistory.int.test.js` (audited with actor), `reclassifyOutcomes.int.test.js` (TARGET_DISABLED
when off, unreleased, or on a lit-drop campaign; priced not_target→not_home moves Contact %; money
invariant; `listEntries` rows carry `wasOfflineSubmission`), `unknock.int.test.js` (unknock a canvasser's not_target entries, priced, exact revert),
`surveyConversion.int.test.js` (to_survey from not_target; and its outcome-entries.csv test at
1184-1227 asserts the appended Offline column — "Offline" on a row recorded with
`wasOfflineSubmission: true`, blank on a live one), `knocksByPass.int.test.js` (column + Σ rounds;
`:258` keeps calling `contactRate(r2)`, which works because the rows now carry `contactKnocks`),
`reportsHoursSource.int.test.js` (`:185-196` — the header now ends `Hours source,Not a target`, the
rows `Measured,0` / `Estimated,0`), `exportBuilders.int.test.js` (fixture row, Address outcome prose, fan, chips, estimate ==
build, the knocks-by-round column present and absent), `mapCounts.int.test.js` (ZERO literal +
byStatus), `timelineTotals.int.test.js` (FIELDS gains `dayNotTarget` and `dayNoSoliciting`),
`reportSecurity.int.test.js` (public points carry the status, no canvasser text),
`doorOutcomesRender.smoke.test.js` (the chip only when in use; the Offline tag renders for a row the
mocked list marks offline — the server projection itself is asserted in `reclassifyOutcomes.int`, for
both the list route and the CSV), `restrictBooks.test.js`, `packetPdf.test.js`
(STATUS_LABEL covers the Household.status enum).

Run: `npm --prefix server test`, `npm --prefix server run test:int` (throwaway mongod per file; file
args relative to `server/`), `npm --prefix client test`, `npm --prefix client run build`, `npm run
test:mobile` (not in CI — run locally), and a mobile `expo export` to prove the bundle and the new
asset resolve.

## O. Rollout, gates and compatibility

**Before building:** the working tree holds the uncommitted Voters-directory release, which edits
files this plan also edits (`voterProfile.js`, `docs/PRIVACY_VERIFICATION.md`, `CAMPAIGNS.md`,
`ADMIN_APP.md`, `ROLES.md`, `VOTERS.md`, `README.md`, `faq/_INBOX.md`,
`getting-started/lead-getting-started.md`, `guides/roles-and-team.md`). Commit that release first so
the two changes stay separable (`pages/NotesPage.jsx`, which this plan now edits, is also part of
that release). A parallel session is designing scripted surveys
([PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md)), whose §H rewrites the survey door
runner, `mobile/app/(app)/voter/[id]/survey.jsx` — the file where this plan adds the mount-time change
confirmation beside the re-survey confirm that both plans keep. Agree a build order with that work
before either touches `survey.jsx`. (Its current text leaves the door screen, `household/[id].jsx`,
alone.)

**Deploy order:**

1. **Server + web** from `main` (Heroku dashboard → Deploy). The feature ships **dormant**:
   `OPT_IN_OUTCOMES` is unset, so no App Customization screen shows the section, the PATCH refuses it,
   and phones get an empty list. Everything else in this plan — the vocabulary, the counting and the
   Contact % fix, the settings-in-the-delta behavior — is live at once.
2. **Required, right after the deploy:** Heroku dashboard → More → Run console, `npm run
   migrate:campaign-stats` (dry run), then `npm run migrate:campaign-stats -- --apply`. Seeds the new
   `contactKnockCount` exactly on every campaign (§F). **Expect the dry run to list every campaign that
   has any survey or refusal as DRIFTED on `contactKnockCount`, and on nothing else** — that is the new
   counter being seeded, so run `--apply`. A campaign drifted on any *other* key is real drift worth a
   look. (Verify the command from the repo root against a throwaway database before handing it over —
   CLAUDE.md.)
3. **Mobile OTA:** `npm run ota:check`, `npm run ota:staging`, confirm on TestFlight / Play internal,
   then `npm run ota:production` from `main`.
4. **Release:** once the production OTA has been out long enough for the crews' phones to have
   restarted into it (the restart prompt offers it on every foreground), check the builds the OTA can
   **never** reach, however long you wait — `ota:production` publishes only to the current
   fingerprint's `production` branch (`mobile/package.json:12`): builds on an older fingerprint, the
   `playorg` channel, and the retired `com.canvassapp.mobile` app (`mobile/README.md:338-372`). For
   each of those runtime versions, `GET /api/build-status?platform=…&runtimeVersion=…` must read
   `outdated`; if any reads `ok`, narrow `MOBILE_CURRENT_RUNTIME_ANDROID` / `MOBILE_CURRENT_RUNTIME_IOS`
   to the current production and staging fingerprints so those builds get the existing soft "update
   available" nag (set `MOBILE_STORE_URL_ANDROID` before narrowing, per the README; keep
   `MOBILE_UPDATE_MODE` on soft — hard blocks the whole app, and the legacy app's offline queue would be
   lost if people stopped opening it). Then set `OPT_IN_OUTCOMES` to `not_target` in the Heroku
   dashboard → Settings → Config Vars. Heroku restarts the dynos; no deploy. The section now appears for
   org admins in every org. A phone still on an old build draws a not-target door as an unknocked
   (near-black) house and its pill reads "Unknown" — the same way those builds already show No
   soliciting — which is why the release waits and the nag points them at the store.

**Roll forward only, once any campaign has used it.** A server rollback past this release then 404s
`POST /not-target` (the queue drops 4xx — queued taps lost) and fails `save()` on any Household whose
stored status is `not_target` — even an unrelated pin fix, whose 500 then blocks a lead's offline queue
(probed on mongoose 8.23.1). The rollback for this feature is **unsetting `OPT_IN_OUTCOMES`** (the
Doorline-wide off switch) and fixing forward. Re-setting it later restores the button on every campaign
still set on, so org admins are told before a re-release. OPERATIONS.md says all of this.

No `CLIENT_API_VERSION` bump (every change is additive: a new route, new fields, new optional columns,
a new optional response block; the server never reads the client's version), and no status
translation for older bundles. No index build (no new indexes; no partial index filters on
actionType or status). `npm run audit:mobile-api` will flag `canvass.js`, `bootstrap.js`,
`campaigns.js` and `reports.js` — all additive; contact-rate values change only downward in overlap
cases, never shape. Help content ships with the server.

## P. Traps this plan guards against

Each of these fails **silently** — no error, a wrong number or a wrong color:

1. Deny-list fails open (any reader of `disabledOutcomes` treats an unlisted key as on). Every reader goes through `isOutcomeEnabled` / `isOutcomeOn`.
2. `ACTION_TO_STATUS` miss → global and per-round status disagree.
3. `REPLACEABLE_ACTIONS` miss → duplicate rows, inflated per-canvasser doors, wrong stats deltas.
4. Hand-copied knock lists (six) that don't import KNOCK_ACTIONS; hand-written knocks sums (three, now derived).
5. `in`-guarded literals: computeReport events, rollup coverage seed, `emptyStatusCounts`.
6. Field-by-field copies on `/campaign-rollup` (both paths) and `/overview` — and on the two stats copies, a missing `|| 0`, which turns both routes into a 500 between the deploy and the recompute.
7. The timeline's own `$group` (2421-2429) and its row literal that never emitted `dayNoSoliciting`.
8. CoverageBar / PassManager / CanvasserSummaryTable hand-aligned arrays (header and cell at the same index).
9. Mapbox `match` arms that fall back to the unknocked house (three screens on mobile, one layer on web — `mapRender.js:429-440`) and color matches that fall back to gray (the canvasser territory map and day view on mobile, the mobile admin-map ping at `admin/map.jsx:1413-1423`, which falls back to `textSecondary`, and the web ping layer at `mapRender.js:543-552`).
10. `notesQuery` chip filter that becomes "no filter" on an unknown key.
11. `scopeSummary` labels frozen onto run documents.
12. Campaign.stats counters undeclared in the model (stripped from `$inc` and `$set`) or defaulting to null ($inc throws).
13. The icon generator overwriting `house-restricted.png`.
14. Shaped campaign objects on the phone that can't carry the outcome fields — in-use reads go through `useOutcomeInUse`.
15. A create path that could switch the outcome on without History or `everEnabledOutcomes` — closed by keeping it off `createSchema`.
16. `STATUS_COLORS` and the mobile `status`/`statusLabels` maps have no parity test — checked by hand and by the render smoke tests.
17. A raw `|` in the `/changes` query string — on iOS 15/16 every poll 400s and teammates' results, round changes and settings all stop, with no error shown. Always `encodeURIComponent`.
18. A stale cached `restrictedFrom: 'desk'` that exempts a worked door from the change confirmation — the delta fold, `setHouseholdStatus` and the survey patch keep it fresh, and the exemption applies only while the status is still `restricted`.
19. The `outcome-entries.csv` route's own projection — separate from `listEntries` — which would print the Offline column blank on every row.
20. A list handed to a chip renderer with no count gate (the client share map, the full coverage legends, the filter lists) — every customer would see the words on the deploy day.

## Q. Build order and verification

1. **Vocabulary** — enums (both), ACTION_TO_STATUS, labels and colors on all three platforms, the
   opt-in class, the release gate and the helpers with their mirrors; `outcomeToggles.test.js`,
   `actionLabels.test.js`.
2. **Settings** — Campaign fields, the update-only zod extension, admin-only, availability and
   survey-only refusals, the type-change clear, the `everEnabledOutcomes` union, audit, History
   wording, `optInOutcomesAvailable` and the three App Customization states; `optInOutcomes.int`.
3. **Recording** — route, gate + replay rule, REPLACEABLE, emptyStatusCounts, the bootstrap wire, the
   `/changes` door-config block (and `restrictedFrom` already on both wires).
4. **Counting** — KNOCK_ACTIONS, the six hand copies and the three derived sums, CONTACT_ACTIONS and
   the fold, `contactRate` and its 15 callers (the timeline `$group` included; `contactKnocks` emitted
   by `knocksByPass.js`), Campaign.stats counters with the stats copies' `|| 0`; `contactOnce.int`,
   `campaignStats.int` including the `$unset` legacy-state case.
5. **Reports, client report, exports, desk** — §E.3-§H, including the outcome-entries.csv route's own
   projection and the share map's presence-gated chip; `notTarget.int` and the extended suites
   (`reportsHoursSource.int`, `knocksByPass.int:258`, the outcome-entries CSV test).
6. **Web** — §J, every filter list and full coverage legend gated on use, then the smoke tests and
   `npm --prefix client run build`.
7. **Mobile** — the icon (§K trap), the hooks and helpers (`useOutcomeInUse`, `doorChange`), §K:
   the change confirmation as one `confirm` step inside `recordHouseholdAction` plus the survey
   screen's mount check, the fresh `restrictedFrom`, the encoded stamp param and the `doorConfig`
   merge, the gated chips and tabs; `npm run test:mobile`; `expo export`.
8. **Docs, Help Center, privacy record** — §L, §M.
9. **Verify** — every suite above green; run the web app and walk App Customization unreleased,
   paused, released-as-admin and as a lead, a campaign Home and Timeline with and without the outcome,
   Door Outcomes and the filter lists on a campaign that never used it (no trace of the words), and a
   client-report build and share map with and without such a door; an adversarial review pass over the
   diff (counting, mobile/offline, privacy, completeness against this map); `npm run audit:mobile-api`;
   `git status` for stray artifacts; then the commit message.

## R. Open questions for the owner

Answered 2026-10-02, in the owner's words:

1. **Lead-added crew** gets the button with no admin step — "yes, that is intended." Disclosed in the
   confirmation and the help copy (§A, §L).
2. **The door note** may name or describe the person — "no, its okay for us to know names and stuff.
   espeically the client because they own the data and all." No canvasser copy discourages it (§A, §M).
3. **The Add-person sheet link** (design call 11) — "yes, drop the link." Add person is for people who
   give a name; the button is the one way to record someone who won't.
4. **The confirmation** (design call 10) — "yes, lets add that lil warning for confirmation. i think it
   should be shown if any entry is being changed. like if they selected not home and not theyre doing
   a survey or vise versa, etc." Built as the broadened change confirmation (Part 1 design §3, §D).
5. **Settings in the 30-second update** (design call 7) — "yes, lets push the new button to the apps if
   we toggle one on or off.. but maybe not check every 30 seconds? … unless other settings are already
   check during that call, then yeah it makes sense to jst add that extra check." They are: the map's
   existing 30-second request already carries teammates' results and round changes, so the settings
   ride it with no new request (§C.5).

6. **What a canvasser records when their campaign doesn't have the button** (raised by the third
   review) — "yes that wording works": *"If you don't see **Not a target voter**, record the door as
   you do today and mention it to your lead."* Used in every canvasser article (§L).

**Plan approved by the owner, 2026-10-02.** Before the build starts, the uncommitted Voters-directory
release is committed (§O, *Before building*).

## S. Build notes (2026-10-02)

Built in the order of §Q. Where the build differs from the text above, this section governs.

1. **The phone gate test** lives in `server/test/outcomeToggles.test.js` (it loads all three copies of
   the outcome rules and runs in CI), not in a new `mobile/lib/outcomeToggles.test.js` (§C.6, §N).
2. **The queue path/body builders** that `doorChange.test.js` reuses live in a new react-native-free
   module, `mobile/lib/doorPaths.js` (`addVoterPath`, `addVoterBody`, `surveyPath`), used by
   `recordAddVoter`, the survey screen and `ownSurveysHere` alike — `recordAction.js` imports
   react-native, so node tests cannot load builders exported from it (§D, §K).
3. **Withdrawn but still set on, re-saving is accepted.** The PATCH checks the release only for keys
   being turned ON (not already stored on), so a withdrawal never blocks saving the rest of App
   Customization (§B.4).
4. **The per-round CSV in-use flag** is computed inside `buildKnocksByPassData` from the campaign's
   `enabledOutcomes` / `everEnabledOutcomes` and also returned on the JSON as `notTargetInUse`, which
   the web By-pass table reads (§G).
5. **Turf Cutting's Target/Exclude lists** now label statuses from `STATUS_LABELS` ("Not home") instead
   of the slug with CSS capitalize ("Not Home") — the whole list, not only the new entry (§I).
6. **The survey screen's door check** runs exactly once per visit, the first time the door is known, so
   a teammate's delta can never pop it up mid-survey; the re-survey confirm keeps its existing
   behavior (§D).
7. **Phone admin screens** read "in use" through `mobile/lib/useOutcomeInUse.js` everywhere except the
   campaign home, which already holds the full `['admin','campaigns']` row and asks `outcomeInUse`
   directly (§K).
8. **Test-runner trap found on the way:** a fixture with a duplicate unique key (two users sharing an
   email) made `before()` fail, and under `node --test` the runner then spun at 100% CPU forever
   instead of reporting — the integration runner has no per-suite timeout. Fixed in the fixture;
   recorded here because any suite whose setup fails can do the same.
9. **The required recompute was proved from the repo root** against a throwaway database seeded in
   the post-deploy state: the dry run printed `DRIFTED Ops Check — contactKnockCount 0→2` and nothing
   else, `--apply` seeded it, and a re-run printed "All campaign stats match the ledgers" (§O).
10. **Owner ruling, after the build: the Export Center copy names the outcome only where a campaign
    uses it.** This replaces two lines above — §G's "BACKUP_NOTES … and the descriptions at 187 and 300
    name the outcome" and the "One row per voter" hint naming it for everyone. `GET /admin/exports/types`
    now ships `desc`, which never names it, plus `descNotTargetInUse` (the naming form; `null` for a type
    whose copy never names it). Web and phone pick by `outcomeInUse`, the gate every other surface uses,
    so the route stays copy-only, with no campaign lookup and no new access check. An older client reads
    `desc` alone and shows the neutral copy. The two "One row per voter at the door" hints (web dialog,
    phone sheet) name it only in use. A full backup's README.txt and manifest.json notes name it when a
    campaign in that bundle uses it; for the org-wide bundle that means any campaign in the org. The
    neutral forms are the pre-feature strings, character for character. The same rule now covers the
    Contact % help text: `metricHelp.contactRate` never names the outcome, and
    `contactRateNotTargetInUse` does, shown only where the campaign uses it (the web canvasser tables'
    Contact % column, and the Contact % entry in the phone campaign home's Top canvassers column
    explainer). Results by voter's naming form also lost its last
    clause ("…so none of the listed voters was reached"): Address outcome is the door's latest result
    across the rounds in scope, so a listed voter may have been reached earlier. It now says the person
    who answered was not on the list. Unchanged on purpose: the always-present "Not a target" column in
    `canvassers.csv` (the Timeline's download, not an Export Center type; call 9's file-shape rule). It is
    now the only report, file or metric-help text that names the outcome to a customer who never turns it
    on. Two places outside call 9's gate name it for everyone, by design: App Customization's "Off until
    you turn it on" switch, which org admins and team leads see on every survey campaign once Doorline
    releases it, and the Help Center articles, which say "on campaigns that use it".
11. **Review fixes.** (a) A "Not a target voter" filter picked on one campaign survived a switch to a
    campaign that hides the choice: applied, but with nothing on screen to untick. Exports now drops a
    round status the campaign doesn't offer when it queues (the rule its outcome chips already follow);
    the web map, the phone admin map, Turf Cutting and Saved Searches keep a selected or ticked choice
    visible until it is cleared. (b) App Customization told a team lead "You can still turn it off" and
    pointed them at Door Outcomes, which a lead can't open; on web and phone those lines now show only to
    org admins. (c) Two label slips: the Survey Explorer response drawer printed a converted door as
    "recorded as not target" — it now uses the outcome's label, as the voter profile does. The phone
    export sheet's round-status tabs printed slugs ("not target") and now print the status labels the web
    select uses, which also capitalizes the other tabs. (d) The erase warning could fire about answers
    already gone. Recording a result deletes the canvasser's own surveys at the door on the server, but
    the reply carries only the household, so the cached voters kept reading "surveyed by me" and the
    next change warned again ("Keep my survey" then kept nothing). Offline, the same happened through
    the queue: a survey queued before a queued result kept counting. Now the recorder clears the
    canvasser's own survey marks on that door's cached voters the moment it records (`doorChange.js`
    `clearOwnSurveysAtDoor`). That is exact, because a voter holds at most one survey per round, so
    "surveyed by me" means nobody else's survey is involved. If the server REJECTS that result (a
    4xx), the marks come straight back (`restoreOwnSurveys`, through a new `rollbackPatch` option on
    `optimisticSubmit`), so the next tap still warns even when the bootstrap refetch fails too. In
    `ownSurveysHere`, cached own surveys always count, and a QUEUED survey is skipped only when a door
    result at that door was tapped after it — compared by the queued tap time, the way the server's
    `supersededByNewer` compares them, with queue position as the fallback. A first version also
    hid cached surveys whenever any result was queued; review proved that a MISSED warning, end to end
    against the real server: a result stuck in the queue, then a survey sent live (the server keeps it
    and later discards the older replay), then a new result — which really deletes it. A spare warning
    only asks; a missed one loses answers. Two spare warnings remain, both older than this feature: a
    queued survey older than a result that went out live, and a refetch or delta repainting the
    server's pre-result state before the queue flushes. The seven result routes now share one path map
    (`doorPaths.js` `ACTION_PATHS`) between the recorder and the counter. (e) The web voter profile's
    Canvass activity list now includes Not a target voter knocks (`voterProfile.js` KNOCK_ACTIONS) and
    prints every entry with its standard label instead of the slug. (f) App Customization's footer now
    says when its facts apply ("If an org admin turns it off, …" for a lead on the web; "If it is turned
    off, …" on the phone).
12. **Tests the plan listed that the first build missed, now in:** the walk-packet label/ink guard lives
    in `server/test/actionLabels.test.js` beside the other label guards, not in `packetPdf.test.js`,
    because it reads the `Household.status` enum and only the server test tree loads models. Also: the
    `/changes` stamp round trip with both a comma and a pipe (`optInOutcomes.int`), the per-voter fan and
    the outcome chip on a Not-a-target door with estimate == build (`exportBuilders.int`), and three new
    files: `client/src/lib/mapFiltersRender.smoke.test.js`, `client/src/lib/exportsPageRender.smoke.test.js`
    (the type cards, the round-status list, and the options dialog's chips and hint) and
    `mobile/lib/exportTypes.test.js`. A second review then found guards that would have stayed green
    with their fix reverted. Each is now proven by reverting its fix in a scratch copy: `notTarget.int`
    pins canvassers.csv's Knocks and Connection rate % by header, a non-zero Timeline `dayNoSoliciting`,
    and the knock lists hand-copied into `/mobile/me/day`, `/mobile/me/history`, the Users-hub member
    stats, the Control Room and the voter profile. `optInOutcomes.int` pins the survey-only check on a
    campaign switched to lit drop (a queued replay the gate alone would honor), `reclassifyOutcomes.int`
    the run's frozen scope label, `campaignStats.int` drift on `notTargetKnockCount`,
    `server/test/metricHelp.test.js` both Contact % help forms, and `campaignHistory.test.js` (web and
    phone) the History wording.
13. **`outcomeInUse` is false on a lit-drop campaign** for an opt-in key, in all three copies. A survey
    campaign switched to lit drop before canvassing keeps `everEnabledOutcomes` (the type change clears
    only `enabledOutcomes`), so it read as "in use". It then grew an empty "Not a target" column in its
    per-round CSV, and backup notes and chips that name an outcome it can never record. `knocksByPass.js`
    loads the campaign narrowed, so its projection now carries `type` too; without it the per-round
    files never saw the new rule (pinned in `optInOutcomes.int`).
14. **The phone's `/changes` URL has one builder**, `mobile/lib/deltaFold.js` `changesPath`, called by
    `map.jsx`. `server/test/outcomeToggles.test.js` feeds it the server's real stamp and text-checks
    that `map.jsx` uses it. That suite runs in CI, which never runs `test:mobile`.
