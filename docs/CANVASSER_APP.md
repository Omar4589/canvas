# Canvasser app (the field app's screens, menu, and navigation)

How the mobile field app is laid out for a **canvasser**: the screens they move through to get to
the doors, the slide-out **menu** that holds everything occasional, and the lean per-screen headers
that keep the quick actions one tap away. This is the shell; the things inside it (the map, surveys,
efforts) have their own docs.

- **Part 1 — For everyone** is plain language: how to get the app, the flow from sign-in to the
  doors, the menu, and what each screen's header does.
- **Part 2 — Technical reference** is for developers (and Claude): the navigation tree, the drawer
  overlay, the shared header, the merged map context card, and where effort data comes from.

Related: [MAPS.md](MAPS.md) (the houses map + bottom sheet this flow lands on),
[EFFORTS.md](EFFORTS.md) (efforts a canvasser picks between), [WALKLISTS.md](WALKLISTS.md) and
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (how books get assigned), [THEMING.md](THEMING.md) (the
light/dark tokens every screen here is built from), [LOCK_SCREEN_AND_DIRECTIONS.md](LOCK_SCREEN_AND_DIRECTIONS.md) (the **Directions** button — built on the door screen, map sheet, building screen and three lead surfaces — the keep-screen-on setting that was designed but not built, and what a lock-screen feature would cost),
[CAMPAIGNS.md](CAMPAIGNS.md) (App Customization, where a campaign's door-outcome settings live),
[PROPOSAL_NOT_TARGET_OUTCOME.md](PROPOSAL_NOT_TARGET_OUTCOME.md) (the design and owner rulings behind
**Not a target voter**, the "Change this door's result?" confirmation, and door settings on the
30-second update).

---

# Part 1 — For everyone

## Getting the app

Doorline is **free on the App Store (iPhone) and Google Play (Android)** — search for **Doorline**.
There is one app for everybody: a canvasser, a team lead, and an admin all install the same thing,
and what you can do inside it depends on your role, not on which app you downloaded.

A canvasser normally arrives at it one of four ways:

- **The invitation email.** A canvasser's invite carries install links for both platforms, right
  under the set-password button. See [EMAIL.md](EMAIL.md).
- **The web page after setting a password.** The set-password link opens in a browser, which is
  normal — and if canvasser is the only role you hold, that browser lands you on a **Get the app**
  card with the same two links, not on a dashboard. See [ROLES.md](ROLES.md).
- **[doorline.app/app](https://doorline.app/app).** A public page with both store badges and the
  part the store listings can't tell you: that you need an account from your campaign first, and
  that you must not create a new one. It needs no login, so it's the link to send someone who lost
  their invitation email. See [MARKETING_SITE.md](MARKETING_SITE.md).
- **Searching the store directly.** Any of the four gets you the same app.

**Sign in with the account you already have.** Same email, same password as the web — there is no
separate app account to create. If your admin or team lead handed you a temporary password, the app
makes you set your own on that first sign-in (see below). Forgot it later? **Forgot password?** on
the sign-in screen emails you a reset link.

**What it asks for on first run** is location, and it means it — a door can't be recorded without a
GPS stamp, so recording is blocked when location is off. On iPhone, leave **Precise Location** on;
without it the stamp is too coarse to place you at a house. Full detail in
[Location is required](#location-is-required-no-location--no-knock) below.

## The flow to the doors

A canvasser's whole job is to get to a book and start knocking, so the app keeps the path short:

```
Sign in
  └─ Choose organization   (only if you belong to more than one)
       └─ Pick a campaign   (expands to choose an effort, if the campaign has several)
            └─ Pick a book   (a walkable slice of doors)
                 └─ The houses map   (knock, survey, lit-drop)
```

If you only have one organization, you skip that screen. If a campaign has a single effort (the
common case), picking it drops you straight on the book picker. The app also remembers the last book
you were working, so a cold start reopens it instead of making you pick again — **even with no
signal**: the map opens on the houses saved on your phone, with an amber notice showing how old that
saved copy is (it clears on its own once you're back online). If the book you switched to mid-shift
isn't in the saved copy yet, the app says so and offers Retry — it never quietly drops you back into
an older book, and nothing you recorded is lost.

**Your very first sign-in** uses the temporary password your admin or team lead gave you; the app
immediately asks you to choose your own strong password before you can start knocking.

## The menu (the hamburger)

Every canvasser screen has a **menu button (☰) in the top-right**. Tapping it slides a panel in from
the right with the things you reach for occasionally:

- **My stats** — your per-day shift history + all-time totals, connection rate, and a doors-per-day trend.
- **Appearance** — Light / Dark / System.
- **Switch organization** — only if you belong to more than one (or you're a super admin).
- **Admin dashboard** — only if you're an admin (jumps to the admin side).
- **Sign out.**

At the top of the menu, a card shows the **organization you're working in** with your **name + email**;
it's tappable — it opens your **Profile**, where you
can update your name and phone and change your password. (Your email is managed by your admin.)

Close it by tapping the dimmed area, swiping the panel right, or the ✕. The map behind it keeps
working the moment the menu is closed.

The logo + **Doorline** wordmark sit on the **top-left**. The header keeps only the **quick**
actions, so the menu isn't in the way of the job:

- **Refresh** (↻) — syncs your work and pulls the latest doors. On the **book picker** it's in the
  header next to the logo. On the **houses map** it lives in the bottom-right control stack (above
  the terrain + recenter buttons) where your thumb already is, and it carries the offline-pending
  badge; tapping it also flushes anything you recorded offline. **Tap it if a lead reshuffled your
  books mid-shift** — a book being moved, merged, or reassigned only lands on your phone after a full
  refresh (pin fixes, status changes, and your campaign's door settings — which outcome buttons you
  see, and whether you can add a person — arrive on their own ~30s sync while you're on the map). See
  [PASSES_AND_TURF.md → How field phones get these edits](PASSES_AND_TURF.md).
- **Switch campaign** — on the book picker, a one-tap way back to the campaign list (next to the
  menu button).

## Picking a campaign (and effort)

On **Pick a campaign**, each campaign shows whether it's a Survey or a Lit drop, its name, and its
state. Most campaigns open straight to the books. A campaign that's split into several **efforts**
(say "North" and "South", or "volunteers" and "paid") instead **expands** when tapped to show its
efforts — pick the one you're working and you land on that effort's books. (Book numbers restart per
effort, so this keeps two different "Book 6"s from colliding.)

## The book picker

A map of your books as colored pins (the legend at the top says which is which). If you're in more
than one effort, an **effort switcher** sits at the top to flip between them. Tap a book, then
**Enter** to open it on the houses map. The same **bottom-right controls** as the houses
map are here too — Refresh, the terrain / base-map picker, and recenter (follow your location).

The key dates and the pin legend share **one card** at the top. Election Day shows the **actual
date**, with the countdown beside it — "🗳 Election Day · Wed, Nov 4" · *in 12 days* (and *tomorrow*
/ *today* in brand red when it's imminent). Early voting always names **both ends of the window**
("Early voting Oct 20–Nov 1"), because "when does early voting end?" is a question you get at the
door — not just once the window has already opened. Under a divider, the legend shows the same book
pins you see on the map: **Not started · In progress · Done**. A campaign with no key dates set
simply shows the legend.

## Map or list — two ways to work the same doors

A **Map / List** toggle at the top switches between the pin map and a scrollable **list** of the same
doors (same book scope, same status filter). The list is handy on spread-out/rural routes and for
anyone who prefers a checklist. Your choice is remembered per campaign.

Each **list row** shows the address, the door's status, how many voters (and how many surveyed), and
the **distance to you**; tap a row to open the door, or use its inline quick-action (**Not home** /
**Lit dropped**) — which recolors instantly and syncs like everywhere else. (On a door that already
shows a different result this round, the quick-action asks first — see
[Changing a door's result](#changing-a-doors-result-the-app-asks-first).) Apartment buildings show
as one row that opens the building's units. Sort the list by **Nearest to me** (uses your GPS),
**Walk order**, or **Status**. The map stays live underneath, so switching back is instant and the
"nearest" sort keeps updating as you move.

## The houses map

The top of the map is intentionally calm — just the logo on the left, the menu on the right, the
Map/List toggle, and one **context card** that tells you where you are:

- The **campaign** name, with a **Switch** link.
- The **book** you're in and its **progress bar** (done / total houses); tap it to jump back to the
  book picker.
- A **Filter** (on the right) to show only certain door statuses on the map.

The **Refresh** button is in the bottom-right control stack (above terrain + recenter); a **pending**
badge appears on it when you have work that hasn't synced yet — tapping Refresh flushes it.

Everything below — the pins, the pull-up sheet with your progress and each house's voters, recenter,
and the base-map picker — is covered in [MAPS.md](MAPS.md).

## At the door

Tapping a house opens its detail. The header shows the address, when it was last visited, and a
**status pill** (the amber **Refused** pill is new — see below). What you do here depends on the
campaign type:

- On a **Lit drop** campaign, there's a **Lit dropped** button, plus **No soliciting** and
  **Restricted access** (below).
- On a **Survey** campaign, you get the **voters at this address** (each a tappable card → their
  survey) plus three door buttons stacked at the bottom: **Not home**, **Wrong address**, and
  **Refused** — then **No soliciting** and **Restricted access** below them. If your campaign has
  it turned on, **Not a target voter** sits right under **Refused** (see
  [below](#not-a-target-voter-someone-answered-but-theyre-not-on-your-list)).

Each voter reads the same everywhere — on the map's pull-up sheet and here on the door — as
**Party · Age · Gender** (say, "Democratic · 34 yrs · Female"), plus a **✓ Voted** tag and whether
they've been surveyed. Voter files are patchy, so any part that's missing is simply left out: a
voter with no birthdate on file just shows "Democratic · Female", and one with nothing on file shows
only their name. (Precinct isn't shown at a door — it's turf paperwork, not something you'd say on a
porch. It's still on the voter's full profile under **Voters**.)

Any door button recolors the pin and drops you back on the map the instant you tap — you're never
waiting on the network. (If the door already shows a different result this round, the app asks
before changing it — see [Changing a door's result](#changing-a-doors-result-the-app-asks-first).)

**Getting to the house.** Under the address there's a **Directions →** link (it's on the map's
pull-up panel and the building screen too). Tap it and pick your maps app — on iPhone, Apple Maps,
Google Maps or Waze; on Android, Google Maps or whatever else you have — and it opens with walking
directions to the house. It sends the **street address**, not the app's pin, so if the pin is in the
wrong spot the directions still take you to the right house. Nothing is recorded when you tap it,
and if the app you pick isn't installed the directions open in your browser instead.

**Someone answers who isn't on your list?** On survey campaigns there's an **＋ Add person** link
beside the voter list (and on doors that show "No registered voters listed here."). Type their
first and last name — phone and email are optional, only for people who'd like to be contacted
back — and tap **Add & take survey**: they're saved to this address immediately and their survey
opens. It works offline like everything else, and the person stays on the door's list even if the
survey doesn't happen. If the button isn't there, your campaign has limited adding to team leads
and admins (an App Customization setting), or this is a lit-drop campaign. If the person won't give
their name, that's what **Not a target voter** is for — if your campaign has it turned on
([below](#not-a-target-voter-someone-answered-but-theyre-not-on-your-list)).

**Some buttons may be missing on purpose.** Your campaign can turn individual outcomes off (say,
No soliciting) from its App Customization settings — if a button you expect isn't there, that's a
campaign choice, not a bug. **Not home** and the completion action (**Surveyed** / **Lit dropped**)
are always available. **Not a target voter** works the other way round: it stays off unless your
campaign turns it on.

**When your campaign changes these settings** (or who can add a person), your phone picks the
change up on its own **within about 30 seconds while you're on the map** — no refresh needed. If
you're on a door screen at the time, it arrives once you're back on the map. A phone with no signal
keeps the buttons it already has until it's back online; then the first 30-second update that gets
through brings the change, still with no refresh. If your app hasn't taken the latest update yet, a
change to the other buttons, or to who can add a person, shows up only when the app reloads the
campaign — tap **Refresh**, or restart the app. **Not a target voter** itself needs the
update: an older version of the app can't show it at all (see
[When the app asks you to update](#when-the-app-asks-you-to-update)). In the rare race where the
setting changes right as you tap a just-disabled button, the app tells you it's turned off, nothing
is recorded, and the button disappears; a door you recorded **while your phone was offline** still
syncs normally — your work is never thrown away.

### Location is required (no location = no knock)

Every door you record carries a GPS stamp — it's how your work is verified — so **the app won't
record a door without one**. If your phone's location is off, permission is denied, or the app only
has your approximate location (iOS "Precise Location" off), the tap is blocked with a clear message
telling you exactly what to turn on, with a shortcut to Settings and a **Try again** button. Nothing
is recorded until location works — the pin doesn't change, and nothing is saved or queued. A red
notice also appears at the top of the map whenever location is off, so you know before you walk a
block.

**Offline still works exactly as before.** GPS comes from satellites, not cell signal — airplane
mode or a dead zone doesn't stop it, as long as the Location toggle itself is on. Your knocks record
with a real GPS stamp and sync when you're back in signal. The only thing that blocks recording is
location itself being off. If a "can't get your location" message is triggered right as you lock the
phone, it simply waits and shows the moment you're back — so you always find out when a door did
**not** record, even if it happens in your pocket.

Two data-trust notices can appear at the top of the map (same soft-banner family as the location
notice): an **amber offline notice** when the app is showing the saved copy of your houses because
it can't reach the server (with how old that copy is), and a **red storage notice** when your phone
is too full to save map data for offline use — free up space, or the next signal-less cold start
will show older houses than you expect.

**Precise Location has to be on, and this is enforced rather than suggested.** Approximate location
puts your fix kilometres wide, which makes the distance between you and the door meaningless, so
the app refuses the knock rather than recording one that can't be verified. Two things happen:

- **Before you waste a tap**, a red notice appears reading "Precise Location is off for Doorline",
  as soon as the app has seen a sustained run of coarse readings. One accurate reading clears it.
- **If you tap anyway**, the door is not recorded at all. Nothing is saved, nothing is queued for
  later, and nothing changes colour. You get an alert naming the exact setting to turn on, and a
  retry button.

There is no way around it by going offline: the check runs before anything reaches the offline
queue, so a shift walked with Precise off records nothing rather than syncing later. It is also
re-checked at every door, not once when you sign in, so turning it off mid-shift stops you at the
next house.

### Refused (someone answered, but said no)

**Refused** is for when a person comes to the door but declines to participate — different from **Not
home** (nobody answered) and **Wrong address** (the door doesn't belong to your list). It only appears
on **survey** campaigns. It counts as a real knock and as having reached a person, just not a completed
survey, so it gets its own **amber** color everywhere (the pin, the status pill). Like the other door
buttons, it recolors the pin to amber immediately and syncs in the background.

### Not a target voter (someone answered, but they're not on your list)

**Not a target voter** is for the moment you **talk to someone at the door who isn't one of the
voters on your list for that address, and they won't give their name**. Without it there's no
honest way to record that visit: **＋ Add person** needs a first and last name, **Refused** counts it
as someone declining the survey (which hides that the person wasn't one of your voters at all), and
**Not home** says nobody answered. So the conversation disappears, and your campaign's numbers can't
show that you were actually talking to people.

It's **off unless your campaign turns it on** (only an organization admin can, and only once Doorline
has made it available), and only **survey** campaigns can have it — so you may never see it. Doorline
can also pause it for everyone; the button then disappears, and anything you already recorded with it
keeps counting. When it's on, it sits right under **Refused**. The rule at the door:

| Who answered | What they'll share | Tap |
|---|---|---|
| A voter on your list | Takes the survey | **Take survey** on their card |
| A voter on your list | Declines | **Refused** |
| Someone not on your list | Gives their name | **＋ Add person**, then survey them |
| Someone not on your list | Won't give their name | **Not a target voter** — if your campaign has it turned on |
| Nobody | — | **Not home** |

If you don't see **Not a target voter**, record the door as you do today and mention it to your lead.

It's one tap — the optional note works as on any door — and, like every outcome, it needs a GPS
stamp. Like Refused, it counts as a knock and as having reached a person, never as a survey: the door
is done for this round (it leaves your **Remaining** count), and your connection rate reads the same
as if you'd tapped Not home or Refused there — that door was always a knocked door with no survey;
what changes is that your campaign can now see why. The button, its pin, and the dot on its status
pill are **fuchsia** (the button's label is white in light and dark mode alike, like Restricted
access's; the pill itself shares Refused's amber), and its chip in the map's **Filter** reads
**Not target**. It is never the one-tap quick action on the door list or on a building's units — you
always open the door to record it. Within a round your latest tap wins, as with every outcome: if you
later survey someone at that door, it becomes Surveyed. See [METRICS.md](METRICS.md) for exactly how
it counts.

### No soliciting (there's a sign)

**No soliciting** is for a door with a posted sign you decided to honor. It's on **every** campaign
type, and it recolors the pin **pink**. Unlike Restricted access below, this one **is** a knock — you
walked to the door like any other house, and the only difference is why you left — so it counts toward
your knocks, your doors/hour, and "houses knocked". What it is *not* is a contact: nobody came to the
door, so it doesn't lift your connection or "reached a person" rate the way a survey or a Refused does.

Your campaign decides whether to honor these signs at all — most political canvassing is legally
exempt from them — so if you're unsure, ask your organizer. Either way, recording it means your
admins can choose to leave those homes out of the next round.

### Restricted access (you can't get to the door)

**Restricted access** is for a home you **physically can't reach** — a gated community, a locked
building, no legal access. It's the mirror of Refused: same idea of "record what happened," but the
counting is **inverted**. It appears on **every** campaign type (survey *and* lit drop), and it recolors
the pin **slate** (a distinct slate dot on the status pill). Unlike the other door buttons it is **not a
knock** — the home wasn't reachable, so nothing is billed and it doesn't move your knock count,
connection rate, or "houses knocked." It's still recorded and shown: it appears as its own **Restricted**
tally on your stats and as its own slate segment on the coverage bar, and — because you were there —
your restricted marks still count toward your shift's start/end times. Tapped a door by mistake? Just
record the real disposition on it — the app asks you to confirm the change
([Changing a door's result](#changing-a-doors-result-the-app-asks-first)) — and the new one takes over.
See [METRICS.md](METRICS.md) for exactly how restricted homes are (and aren't) counted.

### A pin in the wrong place

Sometimes a door's pin sits in the wrong place — an **"Approximate location"** badge on the door detail
flags the ones most likely to be off, and you'll still see that badge. (Two related badges can appear
instead: **"Pin corrected"** when someone moved the pin to the right spot, and **"Location confirmed"**
when an admin checked the approximate spot and vouched it's right without moving it.)

**Moving a pin is a team lead / admin job**, so there's no "Fix pin location" button on the canvasser
screen any more. Tell your lead which door is wrong and they'll move it; everyone picks up the corrected
spot on their next sync. Knock the door you actually stood at — if the pin was wrong and it made your
entry look suspicious, correcting the pin clears that up afterwards ([AUDIT.md](AUDIT.md) § B.7).

Meanwhile, **Directions →** gets you there regardless: it hands your maps app the street address
rather than the pin, so a misplaced pin doesn't misdirect you. That's the same reason the web Pin
Fixes page sends the address to Google — see
[LOCK_SCREEN_AND_DIRECTIONS.md](LOCK_SCREEN_AND_DIRECTIONS.md).

Leads and admins: the affordance is the same screen, reached through **Switch to canvass mode**, plus
the web Map page's and Turf Cutting page's "Move pin" (the latter from a house or building popup). See
[MAPS.md](MAPS.md) § "Coordinate provenance & pin correction".

### Taking a survey

Tapping a voter opens their survey. A few things make the script feel like a real conversation:

- **Questions appear and disappear as you answer.** A later question can be set up to show only when an
  earlier answer matches (for example, a follow-up that only shows if the person said they're undecided).
  You don't manage any of this — the right questions just show up live as you go, and the progress bar
  and "Question N of M" count only ever reflect the questions actually on screen.
- **Read-aloud prompts.** Some answer choices have a short script attached. Pick that choice and an
  amber **Read aloud** callout appears right under it with the words to say next.
- **Other (specify).** When a question allows it, an **Other (specify)** choice shows at the end of the
  list; choosing it opens a text box to type what the person actually said. (An Other choice doesn't
  count as answered until you've typed something.)
- The **greeting** and **closing** scripts, when the survey has them, sit in the same amber callouts at
  the top and bottom.

**If a teammate already surveyed this voter this round**, the app asks before opening the survey —
a one-time "**Already surveyed this round**" prompt: *"Another canvasser already surveyed this
voter this round. Your answers will replace theirs — the earlier response stays visible to your
campaign admins."* **Cancel** backs out; **Survey anyway** opens the form. Re-opening a voter
**you** surveyed never asks — correcting your own survey stays one tap. The prompt can't always
fire (a phone working offline or on a stale cache may not know a teammate got there first), and
that's fine either way: the server preserves the replaced answers, so nothing is ever lost to the
campaign — admins can see the earlier response and even restore it (see [SURVEYS.md](SURVEYS.md)).

Saving the survey marks that voter surveyed and turns the house green on the map right away, the same
optimistic, never-wait-on-the-network behavior as the door buttons.

### Changing a door's result (the app asks first)

You keep one result per door per round, so recording a different one **replaces** your earlier
result — and if you surveyed someone there, it **deletes those survey answers**. So whenever you're
about to change a door's result, the app asks first. It asks when the door already shows a result
this round — yours or a teammate's, whatever the door's status pill says — and you pick a different
one:

- **"Change this door's result?"** — *"This door is already marked Not home this round. Record
  Refused instead?"* **Cancel** leaves the door as it was; **Record** records the new result.
- **"This door is marked Not home"** — when you open a survey (**Take survey**, **Re-survey**, or
  **＋ Add person** → **Add & take survey**) at a door already marked something else: *"This door is
  already marked Not home this round. Take a survey instead?"* **Cancel** takes you back;
  **Continue** goes on to the survey.
- **"You surveyed someone here"** — the stronger warning, when the change would delete survey answers
  you took at this door this round, including a survey still waiting to upload. It names the result
  you tapped: *"You took 1 survey at this door this round. Recording "Not home" replaces your result
  for this door and deletes those answers. If you surveyed someone, the door is already done."*
  **Keep my survey** backs out and keeps your answers; **Replace anyway** records the new result and
  deletes them.

It does **not** ask on a fresh door (nothing recorded there this round), when you record the same
result again (Not home again, or **Re-record drop**), when you survey another voter at a door already
marked Surveyed, or on a door still showing the office's **Marked restricted by the office** card
(that card already tells you to work the door normally — what you record replaces the mark). The one
exception to all of these: if you took a survey at that door this round, the **"You surveyed someone
here"** warning shows before anything that would delete it — a phone can briefly forget a
door's status while a survey is waiting to upload, and that's exactly when answers would be lost. So
the everyday path — a fresh door, one tap — stays one tap; only a change costs a second tap.

Once you tap **Replace anyway**, those answers are deleted, so the app doesn't warn you about them
again at that door. If the app then tells you the new result **wasn't saved** — say, your campaign
had just turned that outcome off — nothing was deleted: your survey is still there, and the warning
still shows the next time.

It covers every way a result gets recorded: the buttons on the door screen, the one-tap quick-action
(**Not home**, or **Lit dropped** on a lit-drop campaign) on each door-list row and on each unit of a
building, and the survey screen. On the survey screen you only ever get one question per visit — if
**Already surveyed this round** (above) shows, this one doesn't — and a do-not-contact voter gets
neither. It works the same on every campaign, whichever outcomes it uses.

## When the app asks you to update

Most improvements arrive on their own — the app quietly downloads them in the background. When one
is ready, a small banner appears at the top: **"A new version of Doorline is ready."** Tap
**Restart** and the app reloads itself in a few seconds — no store, nothing to install, no signing
back in. Tap **Later** to keep working; the new version simply applies the next time you fully
close and reopen the app. The banner deliberately stays away while you're on a door or in the
middle of a survey — it waits until you're back on your list or map — and before restarting, the
app waits for any save still in progress to finish.

Once in a while, though, a change needs a genuinely new version from the **App Store** or **Google
Play**, and the app will tell you in one of two ways:

- **A banner at the top of the screen** saying a new version is available. It's a heads-up, not a
  stop sign: tap **Update** to go to the store, or **Later** to keep working — it'll remind you again
  next time you open the app.
- **A full "Update Doorline" screen** that won't go away. The version on your phone is too old to
  keep using safely; tap **Get the update**, install it, and reopen the app.

Either way — restart or store update — it never costs you work: every door you've knocked and every
survey you've saved is already on the server (or safely queued on the phone).

---

# Part 2 — Technical reference

## Navigation

Expo Router, file-based. The authenticated group is a flat stack with native headers off
(`headerShown: false`) — every screen renders its own header.

- Root redirect: [app/index.jsx](../mobile/app/index.jsx) routes by role/state (no token → login;
  no org → select-org; console role (`isConsoleRole` — admin **or** lead) or super → admin/super-admin;
  canvasser without a campaign → campaigns; otherwise → map). **Every role has a valid home here**, which
  is why the org picker offers *all* memberships on mobile (unlike the web console, which is admin/lead
  only — see [ROLES.md](ROLES.md)) and why there is no Forbidden screen anywhere in the app: every gate
  is a `<Redirect>` back through this re-router.
- Group + overlays: [app/(app)/_layout.jsx](../mobile/app/(app)/_layout.jsx).
- Canvasser screens: [select-org.jsx](../mobile/app/(app)/select-org.jsx),
  [campaigns.jsx](../mobile/app/(app)/campaigns.jsx), [books.jsx](../mobile/app/(app)/books.jsx),
  [map.jsx](../mobile/app/(app)/map.jsx).

### Session & role recovery

The app used to cache `user` + `memberships` at **login only** and never refetch, so a role changed
server-side mid-session left it rendering screens whose every query 403'd onto a Retry button that could
never succeed. [lib/session.js](../mobile/lib/session.js)'s `refreshSession()` re-pulls `/auth/me` and
re-saves the identity payload. It is throttled (≤1/min), idempotent, and **failure-tolerant** — offline it
keeps the cached copy and tries later, so a canvasser in a dead zone is never logged out. It runs on app
**foreground**, on the authenticated shell **mounting** (cold start), and **before the org picker lists
memberships**, so the root re-router always decides on fresh roles.

Two error codes drive the central recovery in [app/_layout.jsx](../mobile/app/_layout.jsx)'s
`QueryCache.onError` (tagged in [lib/api.js](../mobile/lib/api.js)):

- **`ORG_CONTEXT`** — the active org is invalid (stale id, removed from the org). Clear the org +
  campaign, `queryClient.clear()`, bounce to `/`.
- **`FORBIDDEN_ROLE`** — the org is fine but the role isn't. This is *ambiguous*: it usually means a
  screen called an endpoint above its role (a bug), but it can also mean the user was demoted mid-session.
  So the handler refetches and **re-routes only if the role actually changed** — which is what makes it
  loop-proof rather than an endless bounce through the re-router.

Admins have their own bottom-tab navigator under `app/(app)/admin/` with a "More" tab; the canvasser
drawer below is for the canvasser screens only.

## The drawer

A custom reanimated overlay, **not** the expo-router `Drawer` navigator (which is edge-swipe-driven
and would fight the Mapbox pan gesture). It opens by **tap**.

- State: [lib/DrawerContext.jsx](../mobile/lib/DrawerContext.jsx) — `DrawerProvider` + `useDrawer()`
  expose `{ openDrawer, closeDrawer, isOpen, progress }`. `progress` is a shared value (0 closed → 1
  open) driving the slide + backdrop; `isOpen` (JS state) mounts the overlay only while it's needed.
- Panel: [components/CanvasserDrawer.jsx](../mobile/components/CanvasserDrawer.jsx) — backdrop +
  **right-side** panel (matches the top-right hamburger). Closes on backdrop press or a **right**-swipe
  `Gesture.Pan` bound **only to the open panel** (the map is covered by the backdrop, so the two pans
  never compete). It **renders `null` while closed**, so it never intercepts a touch on the map
  underneath — the key correctness property. The body is the **shared inset-group grammar**
  ([components/InsetGroup.jsx](../mobile/components/InsetGroup.jsx)) in its menu treatment — the same
  vocabulary the two admin **More** tabs render, so the three menus move together
  ([ADMIN_APP.md](ADMIN_APP.md) → *The grammar grew four opt-in members*). It used to hold a
  **verbatim fork** of `admin/more.jsx`'s old local `Row`; both the fork and its ~28 orphaned styles
  are gone, along with the fork's `last` prop (a trailing hairline is not expressible — `InsetGroup`
  interleaves the separators itself). Concretely: an `emphasis="hero"` `InsetNavRow` for the account,
  `emphasis="menu"` rows with `RowEmoji` leading glyphs under `SectionHeader caption` titles, a
  `tone="danger"` `InsetActionRow` for Sign out, and `<ThemeToggle/>` standing **bare** between its
  caption and the next group (nesting a bordered control inside a bordered card bought a second
  outline and no separation). The **org name**, previously a brand micro-line inside the account card,
  is now the caption above it — so the row keeps one job. Rows are gated by `loadRoleContext()`
  (admin/super) and active campaign (My stats). Canvassers have **no voter-lookup entry** — they work
  their assigned doors and see each household's voters at the door; the `/(app)/voters` screens +
  `/mobile/voters*` endpoints still exist (unreached) for a possible future admin use.
- Mount: rendered in [_layout.jsx](../mobile/app/(app)/_layout.jsx) as a sibling **after** `<Stack>`
  and `<AddedToOrgBanner/>`, so it paints above the map and the bottom sheet. Inert until a screen's
  header calls `openDrawer()`, so it never shows on admin tab screens.

## The shared header

[components/CanvasserHeader.jsx](../mobile/components/CanvasserHeader.jsx) — one component, two
variants:

- `variant="solid"` — for the card screens (select-org, campaigns): logo + wordmark on the screen
  background.
- `variant="floating"` — for the full-bleed map screens (books, map): a translucent `chromeBar`
  rendered inside the screen's own `SafeAreaView` map overlay (it adds no inset itself).

Left = the `<Logo>` + "Doorline" wordmark, plus an optional **Refresh** button (`onRefresh` /
`refreshing`) on the card screens. Right = an optional **Switch campaign** link (`onSwitchCampaign`),
then the **hamburger** (always, far right — it opens the right-side drawer). On the two **map**
screens (books + houses), Refresh is not in the header at all — it lives in the bottom-right control
stack (see below), so their top bar is just logo + hamburger (+ Switch campaign on books). The
hamburger glyph is a custom SVG,
[components/icons/HamburgerIcon.jsx](../mobile/components/icons/HamburgerIcon.jsx) — no icon library;
it matches the `Logo`/`PinIcon` `{ size, color }` convention.

## The map control stack

[components/MapControlStack.jsx](../mobile/components/MapControlStack.jsx) — the bottom-right cluster
shared by both map screens: an optional **Refresh** (with the offline-pending badge), the **terrain /
base-map** picker ([MapStyleControl](../mobile/components/MapStyleControl.jsx), menu opens upward), and
a **recenter / follow** toggle. It's presentational (a right-aligned column fragment); the parent owns
positioning:

- **Houses map** ([map.jsx](../mobile/app/(app)/map.jsx)) wraps it in `RecenterButton`, an
  `Animated.View` that rides above the pull-up sheet's top edge, and passes the offline `pendingCount`.
- **Books map** ([books.jsx](../mobile/app/(app)/books.jsx)) pins it to the safe-area bottom, lifting
  it above the "Enter book" button when a book is selected. Follow is wired via the `Camera`'s
  `followUserLocation`, and a real pan/zoom gesture (`onCameraChanged`) drops follow — same as the
  houses map.

## The update surfaces (three surfaces, three different questions)

Three mechanisms steer people to newer versions, and they answer different questions on purpose:

- **The contract gate** — "is this **JS bundle** too old for the API?" `CLIENT_API_VERSION`
  ([lib/config.js](../mobile/lib/config.js)) vs the server's `minClientApiVersion`
  ([server/src/config/clientVersion.js](../server/src/config/clientVersion.js), reported on
  login//auth/me); when behind, [index.jsx](../mobile/app/index.jsx) redirects to
  [update-required.jsx](../mobile/app/update-required.jsx). OTA-fixable; bumping the floor
  requires a server deploy.
- **The build nag** — "is this **native binary** superseded?" An OTA can never fix that: under the
  fingerprint runtimeVersion policy a superseded binary silently stops receiving updates (EAS gives
  it the same "no update" answer a current build gets), so the server must be the one to say so.
  [UpdateGate.jsx](../mobile/components/UpdateGate.jsx), mounted in the root layout above the whole
  `<Stack>` (login included), sends `Updates.runtimeVersion` + platform to the public
  `GET /api/build-status` ([server/src/routes/public/buildStatus.js](../server/src/routes/public/buildStatus.js),
  env-driven — see [mobile/README.md](../mobile/README.md) for the ops runbook). `soft` → dismissible
  banner (session-scoped dismissal); `hard` → an opaque wall drawn **above the navigator**, not a
  route — nothing to navigate around, no redirect loop possible, with an "I've updated — check
  again" refetch as the ops escape valve.
- **The OTA restart offer** — "is a newer **JS bundle** already downloaded and waiting?" Plain
  expo-updates defaults fetch an update at cold start and apply it on the *next* cold start — and
  field phones essentially never cold start, so a published fix could sit unused for days.
  [OtaUpdatePrompt.jsx](../mobile/components/OtaUpdatePrompt.jsx), mounted in the root layout
  beside UpdateGate (before it, so the nag's hard wall paints on top if both ever fire), checks
  and downloads on launch and on every foreground, with `Updates.useUpdates()` driving visibility —
  so it also notices a bundle the native launch check downloaded on its own. It then **offers** a
  restart, never forces one: `reloadAsync()` destroys in-memory state, and survey answers are plain
  component state until Save. Politeness rules: the banner never renders on the canvass-flow
  screens (`/household/*`, `/voter/*`) — the download still happens there, only the offer waits;
  **Restart** waits (bounded) for any in-flight door POST to settle and **refuses to reload while
  one is still unsettled** — or if a canvass screen was opened during the wait — re-offering
  instead (`hasInFlightActions()` in [lib/recordAction.js](../mobile/lib/recordAction.js): an
  action mid-POST is neither confirmed nor queued until the 20 s API timeout fails it into the
  queue, so a reload at that instant would lose the knock);
  **Later** dismisses that update for the session, keyed by `updateId`, so only a newer publish
  re-arms the banner — the dismissed one applies on the next cold start anyway. Needs no server
  and no store: the bundle is already on the phone.

Shared invariants: the two store-pointing surfaces link to the same `STORE_URL` (single copy in
[lib/config.js](../mobile/lib/config.js)) — though the nag prefers a server-supplied
`storeUrl` when the response carries one (`MOBILE_STORE_URL_IOS`/`_ANDROID`; exists because the
baked-in URL is the public store page, which iOS didn't have until the 2026-07-28 App Store
release — so that override is a no-op now — and which on Android still names the fleet's
`com.canvassapp.mobile` rather than the new `com.doorline.app` listing, making `_ANDROID` the lever
that walks stragglers across at the Play cutover); the nag **fails open** on every error path (no
runtimeVersion in dev, timeout, 429, malformed response → render nothing — a wrong wall would lock
the fleet out of a working app), and the restart offer fails quiet the same way (dev, a failed
check, a failed download → nothing); and enforcement is UI-only — no server middleware rejects old
builds, because a 4xx mid-sync is exactly the offline-queue-eating failure the queue was hardened
against.

Note these are the **update** override, for someone who already has the app. Where a NEW canvasser
goes to *install* it is a separate pair — `MOBILE_INSTALL_URL_IOS`/`_ANDROID`, rendered into their
invite email (see [EMAIL.md](EMAIL.md) and `server/src/config/storeLinks.js`).

## The profile screen

[app/(app)/profile.jsx](../mobile/app/(app)/profile.jsx) — a self-service account screen, pushed onto
the `(app)` stack (back-button header, no hamburger). Reached from the **account row** at the top of
the canvasser drawer ([CanvasserDrawer.jsx](../mobile/components/CanvasserDrawer.jsx)) and from the
identical row on the admin ([admin/more.jsx](../mobile/app/(app)/admin/more.jsx)) and super-admin
([super-admin/more.jsx](../mobile/app/(app)/super-admin/more.jsx)) **More** tabs — same screen for all
three, since the endpoints are role-agnostic. All three are one `InsetNavRow` with `emphasis="hero"`
(the standalone account *card* is gone), and all three label it `name || email || 'Your account'` —
**never** the literal `'Account'`, which is what the first frame rendered while the cached `user` was
still `null`.

- **Edit info:** first name, last name, phone. Saves via `PATCH /auth/me`
  ([server/.../auth.js](../server/src/routes/auth.js)) — a `requireAuth`-only handler (no org context,
  like change-password) validated by `updateProfileSchema`. **Email is read-only** on purpose: it's
  globally unique and shared across a user's orgs, so email changes go through an admin (the existing
  multi-org guard). On success the screen re-caches the user (`saveCurrentUser` / `saveMemberships`) so
  the drawer's account row and greetings refresh.
- **Change password:** current / new / confirm, inline. Posts to the existing
  `POST /auth/change-password` (requires the current password; the **new** password must meet the
  strength rules — 8+ with an uppercase, a lowercase, a number, and a special character — shown as a
  **live checklist** under the field as you type, `isStrongPassword` /`PasswordRequirements` from
  [lib/validators.js](../mobile/lib/validators.js)) and clears the fields on success. There is no
  email-reset flow — the user is logged in, so it's always a known-password change.

## The My Stats page

[app/(app)/stats.jsx](../mobile/app/(app)/stats.jsx) — the canvasser's own performance for the active
campaign, reached from the map's "See full shift history" link. Built on `GET /mobile/me/history`
(days[], personalBest, currentStreak) — **no server work**; pace and connection rate are derived
client-side. A [DateRangeBar](../mobile/components/DateRangeBar.jsx) (Today / Yesterday / 7d / 30d /
All time / Custom, default **30d**) scopes the **whole page** to a date range — the endpoint returns
every day, so the range is applied **client-side** (filter `days` by `YYYY-MM-DD`, then sum). This keeps
the list short on months-long campaigns. The range math uses the device tz, matching the history's
phone-local buckets. Sections:

- **Summary strip** — one compact card, four inline stats for the range: Doors · Surveys (or Lit drops)
  · **Connection** (or Lit rate, color-tiered green/amber/red) · Days. A secondary line shows
  `Best NN (date) · N-day streak · N mi` (streak is the live lifetime value).
- **Doors per day** — a small vertical bar trend of the last ≤14 days in range, **with the count above
  each bar** (newest right; 0-door days show a faint stub).
- **Shift history** — one row per day: date (+ Today/Yesterday/Best tags) and a one-line
  `shift range · surveys/lit · connection % · pace`, with the **doors count pulled right** as the
  headline. Tap a row → [stats/[date].jsx](../mobile/app/(app)/stats/[date].jsx): the big doors number,
  then one compact row of Surveys/Lit · Connection (color-tiered), a First/Last/Pace shift card, and top
  answers. Empty states distinguish "no activity yet" from "no activity in this range."

**Counting model (important):** My Stats uses the **personal/raw** model — raw door *events* and
`connection rate = responses ÷ doors` — so the numbers match the map's "Today's Progress" HUD the
canvasser already sees. This is deliberately NOT the admin reports' *billable* model
(distinct-household knocks, surveyed-knocks ÷ knocks); the two answer different questions and would
otherwise show the same person two different "doors." Time buckets stay on the **phone's local time**
(a personal motivation view, per [TIMEZONES.md](TIMEZONES.md)).

`pace`, `connection rate`, and the rate color tiers live in [lib/rates.js](../mobile/lib/rates.js)
(`formatPace`, `getConnectionRate`, `makeRateColors`) and are shared by the map HUD, My Stats, and the
day detail. The map HUD's "Today's shift" shows First / Last / Pace (Distance was removed; the
connection rate stays as the sheet's colored banner).

## The map context card

[components/MapContextCard.jsx](../mobile/components/MapContextCard.jsx) merges what used to be
three stacked bars (a top bar + a campaign chip row + a book-progress strip) into the header plus one
card: campaign name + Switch, then the effort · book + progress bar + a Books link. The status filter
chip and its dropdown sit in a `filterRow` below it, **right-aligned** (the dropdown opens
right-aligned under the chip). All prior behavior is preserved — filter, switch campaign, books
navigation, recenter, base-map picker, the pull-up sheet, and refresh + pending (now in the
bottom-right stack).

## The door screen

[app/(app)/household/[id].jsx](../mobile/app/(app)/household/[id].jsx) — pushed onto the `(app)` stack
from the map's bottom sheet. A pure reader of the `['bootstrap']` cache (`refetchOnMount: false`, same
reason as the map: a stale refetch must not revert an optimistic recolor). Reads `campaign.type` to
branch the action area:

- `lit_drop` → one **Lit dropped** button (`submitAction('lit_dropped')`).
- `survey` → the **voters at this address** list (each `VoterCard` `guardedPush`es to
  `/(app)/voter/:id/survey`) plus three door buttons: **Not home** (`info`), **Wrong address**
  (`danger`), and **Refused** (`colors.status.refused`, amber) — then **Not a target voter**
  (`submitAction('not_target')`, `colors.status.not_target`, fuchsia) right under Refused, rendered
  only when `isOutcomeOn(bootstrap.campaign, 'not_target')` (the opt-in gate below). It exists in
  the survey branch only, and it is never a quick action: the door list's and the building screen's
  one-tap buttons stay `not_home` / `lit_dropped`.
- **Both branches** then render **No soliciting** (`submitAction('no_soliciting')`,
  `colors.status.no_soliciting`, pink) and **Restricted access** (`submitAction('restricted')`,
  `colors.status.restricted`, slate) *outside* the type branch — both are offered on every campaign
  type. The two look alike and count oppositely: `no_soliciting` is in `KNOCK_ACTIONS`, `restricted`
  is not (see [METRICS.md](METRICS.md)).
- **Directions** (`components/DirectionsButton.jsx`) sits under the city line of the address card,
  rendered from `lib/mapsLinks.js`. It opens an `ActionSheetIOS` sheet (Apple Maps / Google Maps /
  Waze) or an Android `Alert` (Google Maps / Another maps app), each row an
  `https:`-or-`geo:` URL carrying the **address**, never `location.coordinates`. Always
  `Linking.openURL(...).catch(fallback)` and **never** `Linking.canOpenURL`, which would need
  native config this build doesn't carry. Same component on the map sheet, the building screen and
  three lead surfaces; full rationale in
  [LOCK_SCREEN_AND_DIRECTIONS.md](LOCK_SCREEN_AND_DIRECTIONS.md) § B.
- The four toggleable buttons (Wrong address, Refused, No soliciting, Restricted) are each gated on
  `outcomeOn(key)` — `bootstrap.campaign.disabledOutcomes` (per-campaign App Customization settings,
  [CAMPAIGNS.md](CAMPAIGNS.md)); a missing field (older server) means all on. Not home and the
  completion actions never gate. A stale bootstrap — say, a phone that hasn't polled since the flip
  because it sat on a door screen or was offline, or a bundle too old to take settings from the
  30-second delta (below) — can still show a just-disabled button: the server refuses it with
  `OUTCOME_DISABLED`, and
  `recordAction`'s hard-fail path alerts ("Outcome turned off"), clears the optimistic pin, puts
  back any survey marks the tap cleared (`rollbackPatch` — see *The change confirmation*), and
  invalidates `['bootstrap']` so the button disappears; a queued offline replay
  (`wasOfflineSubmission`) is accepted instead, so no real knock is dropped by a settings flip. The
  map's filter chips and legend hide a disabled outcome only once no loaded door still carries its
  status — and `not_target` joins that disabled set whenever `isOutcomeOn` says off, so its
  **Not target** chip and legend entry show while it is on, or while a loaded door still wears it.
- **Not a target voter is the opt-in class** (`OPT_IN_OUTCOMES` in
  [lib/outcomeToggles.js](../mobile/lib/outcomeToggles.js), the hand mirror of
  [services/canvass/outcomeToggles.js](../server/src/services/canvass/outcomeToggles.js)) and gates
  the other way round. `isOutcomeOn` reads `bootstrap.campaign.enabledOutcomes`, which the server
  ships already narrowed to what this phone may act on — turned on for the campaign ∩ released by
  Doorline (the `OPT_IN_OUTCOMES` config var) ∩ a survey campaign (`effectiveEnabledOutcomes`) — so
  the phone never sees the raw setting. It **fails closed**: a bootstrap without the field (an older
  server, or a cache saved before the field existed) shows no button, and the key never goes through
  the deny-list `outcomeOn`, which reads any unlisted key as on. Pinned by
  [server/test/outcomeToggles.test.js](../server/test/outcomeToggles.test.js), which loads all three
  copies. The backstop is the same `OUTCOME_DISABLED` refusal (`"Not a target voter" is turned off
  for this campaign, so this door was not recorded. Pick a different outcome.`), narrowed for queued
  replays: one is honored only on a campaign that has had the outcome on at some point
  (`outcomeEverEnabled` — `Campaign.everEnabledOutcomes`), because on any other campaign no phone
  could have shown the button. So a phone that was offline when an admin switched it off keeps its
  cached button until its first successful 30-second poll after it reconnects, and what it records
  while offline syncs and counts — admins review those entries on Door
  Outcomes ([CAMPAIGNS.md](CAMPAIGNS.md)). The route refuses a lit-drop door with a 400 before the
  gate (`requireCampaignType: 'survey'`). An app bundle older than the outcome has no button and
  draws a `not_target` door as an unknocked house with an "Unknown" pill — the reason Doorline
  releases the outcome only after the OTA ([PROPOSAL_NOT_TARGET_OUTCOME.md](PROPOSAL_NOT_TARGET_OUTCOME.md)
  §O). Pinned end to end by [optInOutcomes.int.test.js](../server/test/optInOutcomes.int.test.js).
- **The two dark buttons** — Restricted (slate) and Not a target voter (fuchsia) — take a white label
  in both themes through a per-button `actionButtonTextOnDark` (a literal `'#FFFFFF'`, the
  `DoorListRow.jsx` precedent). The shared `actionButtonText` stays on `textInverse`, which turns dark
  in dark mode — changing it, or the token, would put white on Not home, Wrong address and Refused
  there. (Restricted's dark-mode label read 2.3:1 before this.)

**Add person (walk-up voters)** — on `survey` campaigns the roster header and the empty state
offer **＋ Add person**, gated on `bootstrap.campaign.canAddVoters === true` (a server-computed
per-user flag: `campaign.doorAddPolicy` 'all' | 'leads', additive — an older server/bundle simply
shows nothing) and mounted like `FixPinModal` (gate at the mount, not just the button). The modal
([components/AddPersonModal.jsx](../mobile/components/AddPersonModal.jsx)) collects
first*/last*/phone/email, mints the voter's ObjectId **on the phone**
([lib/objectId.js](../mobile/lib/objectId.js)) and calls `recordAddVoter`
([lib/recordAction.js](../mobile/lib/recordAction.js)) — the standard `optimisticSubmit`
pipeline: GPS-gated, then the wire-shaped voter is appended to `bootstrap.voters`
**synchronously** (which is what lets the survey screen — a scan of that array — open
immediately, even offline), then `POST /mobile/households/:id/voters` submits-or-queues. The
server treats the client id as the real `_id` and is **idempotent** on it, so the FIFO queue's
create-then-survey pair survives any replay; `onAccepted` closes the modal and `guardedPush`es
to `/(app)/voter/<id>/survey` (under the `/voter/` prefix, so the OTA restart shield covers the
flow). A stale-true button is backstopped by `ADD_VOTER_RESTRICTED` — typed alert, optimistic
voter dropped by the `['bootstrap']` invalidate — and since the policy rides the 30-second delta
(below), an online phone on the map holds a stale button only until its next poll. Teammates'
phones learn of the voter through the 30s delta: the fold ([lib/deltaFold.js](../mobile/lib/deltaFold.js))
merges known voters and **appends** unknown ones whose door is in the folded households (before
this, the fold was merge-only and silently discarded new rows).

All route through `submitAction`, which fires `recordHouseholdAction(qc, id, action, …)` —
`firedRef` blocks a double-tap synchronously, `isSubmitting` disables the buttons. Recording is
**location-gated**: `optimisticSubmit` acquires a fresh GPS stamp *before* the optimistic recolor
(no location = no knock — see [AUDIT.md](AUDIT.md) §B.6), so navigation happens via `onAccepted`
(`router.back()` once the gate passes and the pin recolors). **Every settle releases the latch**
(a single `.finally`): a duplicate of an in-flight submit resolves `{duplicate: true}` — never
`null`, which once left the buttons latched forever — and the screen explains it (a typed note
that would silently drop gets an alert; otherwise it just goes back). The at-door survey
(`voter/[id]/survey.jsx`) follows the same pattern with `router.dismiss(2)` in its `onAccepted` —
a pure POP back to the screen the door was opened from (map, or a building's unit list). It is
deliberately **not** `replace` (which stacked a fresh param-less map screen per survey — dozens of
live Mapbox views by end of shift, and stale-book screens reachable by edge-swipe) and **not**
`dismissTo` (StackRouter `POP_TO` without merge rewrites the target's params from the href, wiping
`selectedBooks`). The gate's blocked alert is **deferred to the next foreground**
(`alertWhenActive`): both platforms mishandle `Alert.alert` fired while backgrounded — Android
drops it, iOS builds it on a nil windowScene — which orphaned the promise and froze the buttons
when a canvasser pocketed the phone during the GPS wait. The map mounts a persistent
[LocationBlockedBanner](../mobile/components/LocationBlockedBanner.jsx) (below the entitlement
banner) that warns when services/permission/precise location are off — on iOS, Precise-off is
additionally detected *proactively* by the map's own location feed ([useLocationFeed](../mobile/lib/useLocationFeed.js),
a foreground `expo-location` watcher) streaming fix accuracies through
`reportFixAccuracy` (lib/location.js: >1km sustained across a rolling window, since expo-location
exposes no `accuracyAuthorization`), so the banner lights before the first wasted knock.

### Door settings ride the 30-second delta

What a door screen offers — `disabledOutcomes`, the effective `enabledOutcomes`, `doorAddPolicy` and
the per-user `canAddVoters` — used to change on a phone only when it re-fetched the whole bootstrap
(Refresh, a cold start, switching campaigns, a round change). Those settings now ride the map's
existing `/mobile/changes` poll (owner ruling 2026-10-02):

- **One owner, two wires.** `doorConfigFor(req, campaign)` in
  [routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js) builds the four fields plus
  `doorConfigStamp` for both the bootstrap's campaign block and the delta, reading the release list
  once so the list and the stamp describe the same moment — the two wires can't disagree and flip a
  phone back and forth every poll. The stamp (`doorConfigStamp` in
  [services/canvass/outcomeToggles.js](../server/src/services/canvass/outcomeToggles.js)) is the
  sorted `disabledOutcomes`, the effective `enabledOutcomes` and `doorAddPolicy`, each list
  comma-joined and the three parts joined with `|`.
- **The phone sends its stamp.** The changes query in [map.jsx](../mobile/app/(app)/map.jsx) reads
  `bootstrap.campaign.doorConfigStamp` at fetch time (it is not part of the query key) and builds the
  URL with `changesPath({ campaignId, since, doorConfigStamp })` from
  [lib/deltaFold.js](../mobile/lib/deltaFold.js) — pulled out of map.jsx, which node can't load, so
  the encoding is testable. `since` and the stamp are both `encodeURIComponent`'d, and the stamp
  param is sent only when the bootstrap has one. Always encoded: the stamp holds `|` and `,`, and a
  raw `|` makes iOS 15/16 re-encode the whole URL, turning `since` into something the server 400s on
  every poll — teammates' results, round changes and settings would all stop, silently.
- **The server answers only on a mismatch.** `/changes` compares the sent stamp with
  `doorConfigStamp(campaign)` on the campaign `assertCampaignAccess` already loaded, and adds
  `doorConfig: { disabledOutcomes, enabledOutcomes, doorAddPolicy, canAddVoters, doorConfigStamp }`
  only when they differ — so `canManageCampaign` (for `canAddVoters` under the leads-only policy) runs
  only then. No stamp sent (an older bundle) → nothing added.
- **The phone folds it in.** `result.doorConfig` is spread into `bootstrap.campaign` with
  `setQueryData` + `saveBootstrap` — no refetch, so nothing can be cancelled by a knock's
  `cancelQueries(['bootstrap'])` or fail on a weak signal, optimistic walk-up voters survive (a full
  refetch replaces `voters` wholesale), and the next poll sends the new stamp. The door screen, the
  map's chips and legend, and the Add-person button re-render from the cache.

**No new requests.** It is a query parameter and an optional response block on the poll the map
already makes every 30 s, and that poll runs only while the map is focused (`useFocusedPoll`,
`refetchIntervalInBackground: false`) — so "30 seconds" means 30 seconds on the map, and a canvasser
on a door screen picks the change up on returning to it. A tap in between is still backstopped by
`OUTCOME_DISABLED` / `ADD_VOTER_RESTRICTED`. An offline phone gets no delta until it reconnects; its
polls keep firing on the interval (the 30-second timer does not stop on a network error), so the first
one that succeeds carries the old stamp and brings the block back — no full refresh needed. A bundle
without this change sends no stamp and keeps the full-refetch behavior. Pinned by
[optInOutcomes.int.test.js](../server/test/optInOutcomes.int.test.js) — the bootstrap and `/changes`
stamps agree, an encoded stamp containing `|` and `,` reads back equal, an older bundle gets nothing
new, and a switch-off answers with exactly what a fresh bootstrap would. The phone's half is guarded
in CI by [server/test/outcomeToggles.test.js](../server/test/outcomeToggles.test.js), because CI runs
the server unit suite and never `test:mobile`: it feeds the server's real `doorConfigStamp` to
`changesPath` (no raw `|` or `,` on the wire, and the param decodes back exactly) and text-checks
map.jsx — it must poll through `api(changesPath({` and never hand-build a `/mobile/changes?` URL.
`changesPath`'s own cases (no param without a stamp, `since` encoded too) are in
[deltaFold.test.js](../mobile/lib/deltaFold.test.js).

The delta's household fold, just above it in map.jsx, now also copies `restrictedFrom`
(`c.restrictedFrom ?? null` — `/changes` always sent it), so a desk Restricted mark made mid-shift
shows the **Marked restricted by the office** card without a refresh, and a stale `'desk'` can't
exempt a since-worked door from the change confirmation (see
[The change confirmation](#the-change-confirmation-change-this-doors-result)).

### The voter identity line (one component, both door surfaces)

The door screen and the map's house sheet read the **same** `['bootstrap']` voter object, but each
used to compose its own meta line — the sheet showed `party · gender · age`, the door screen showed
`party · gender · precinct`. Same person, same cache, two different lines.

Both now render [components/VoterMeta.jsx](../mobile/components/VoterMeta.jsx), backed by
[lib/voters.js](../mobile/lib/voters.js):

| Export | Purpose |
|---|---|
| `voterAge(dob)` | Years from `dateOfBirth`; `null` on a missing/unparseable date. (Was private to `map.jsx`.) |
| `voterMetaParts(voter)` | The canonical order — `[party, '34 yrs', gender].filter(Boolean)`. |

`VoterMeta` returns `null` when no part survives, so a sparse import can never render a dangling
`·` or an empty row. **Precinct is deliberately absent** — it's turf metadata, not door-useful. It
survives on the voter profile (`voters/[id].jsx`) and admin response-details, both fed by *other*
endpoints; consequently `precinct` was dropped from the `/mobile/bootstrap` voter projection, where
it had become dead payload shipped for every voter.

> This used to warn against confusing `VoterMeta` with a `components/VoterRow.jsx` — a
> *survey-response* row (`{responseId, submittedAt, voter, household, canvasser}`) used by admin
> screens. That component **no longer exists**: it was retired in `7c6708a` when the admin screens
> converted to the inset-group grammar, so `VoterMeta` is now the only voter row component.

`StatusPill` recognizes a third visual state for `refused` and `not_target` — the two "someone
answered, no survey" outcomes: amber `warnBg`/`warnBorder`/`warnFg` (done statuses stay green
`successBg`, everything else — including `restricted` — neutral chrome). The dot color always comes
from `colors.status[status]`, so a `restricted` pill reads as a **slate dot** on neutral chrome and a
`not_target` one as a **fuchsia dot** on amber; the label from `colors.statusLabels[status]`
(`'Restricted'`, `'Not a target voter'`; a status the bundle doesn't know reads `'Unknown'`). The
shared [components/StatusPill.jsx](../mobile/components/StatusPill.jsx) (the door list and the map
sheet) gives `not_target` the same amber tint.

The **Refused**, **No soliciting**, **Restricted** and **Not a target voter** dispositions are
plumbed through `recordAction.js`, which imports `ACTION_PATHS` from
[lib/doorPaths.js](../mobile/lib/doorPaths.js) (where it is defined, frozen, beside
`doorResultPath`): `ACTION_PATHS.refused = 'refused'`,
`ACTION_PATHS.no_soliciting = 'no-soliciting'`, `ACTION_PATHS.restricted = 'restricted'` and
`ACTION_PATHS.not_target = 'not-target'` map them to `POST /mobile/households/:id/refused` /
`.../no-soliciting` / `.../restricted` / `.../not-target` (a missing key throws in
`recordHouseholdAction` after the door screen has latched its buttons), and all flow through the same
`optimisticSubmit` pipeline (optimistic patch → pending overlay → GPS-stamped background write →
reconcile) as the other door actions, so the recolor is un-clobberable by a racing server fetch. The
tokens are defined in [lib/theme.js](../mobile/lib/theme.js): `status.refused` / `statusLabels.refused`
= `'#F59E0B'` / `'Refused'`, `status.no_soliciting` / `statusLabels.no_soliciting` = `'#DB2777'` /
`'No soliciting'`, `status.restricted` / `statusLabels.restricted` = `'#475569'` / `'Restricted'`, and
`status.not_target` / `statusLabels.not_target` = `'#A21CAF'` (fuchsia-700) / `'Not a target voter'`
(the survey screen's callouts reuse `warn`/`warnBg`/`warnFg`). Note the server
`/restricted` route writes a `restricted` `CanvassActivity` + `Household.status='restricted'` but the
action is **excluded from `KNOCK_ACTIONS`**, so it never bills as a knock (see [METRICS.md](METRICS.md)).
The `/not-target` route is the opposite case — `recordHouseholdAction({ actionType: 'not_target',
requireCampaignType: 'survey' })`, a knock and a contact but never a survey or a connection, in
`REPLACEABLE_ACTIONS` (one per canvasser per door per round), 201 for a real write and 200
`superseded` for a stale replay like its siblings.

## Recording, replacement, and the offline queue's ordering rule

Both mobile write paths (`recordHouseholdAction` and the survey route in
[routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js)) are **replace-then-create**: they
`deleteMany` this canvasser's rows for the `(household, pass)` and insert one. That keeps exactly one
disposition per canvasser per door per round, and it is why a correction "just works" — last arrival
wins. A `replaced` snapshot of the deleted row is stamped onto the new one so the GPS audit doesn't
read an honest correction as a phantom knock (see [AUDIT.md](AUDIT.md)).

**The hazard that creates, and the guard.** The offline queue can deliver an action long after it was
recorded. A `not_home` that times out at 20s is queued (a timeout carries no HTTP status, so
[offlineQueue.js](../mobile/lib/offlineQueue.js) treats it as retryable) — and because
[recordAction.js](../mobile/lib/recordAction.js) fires `flushQueue()` at the tail of **every** submit,
including a successful one, that stale action can replay *milliseconds* after the canvasser corrects
the door to `refused`. Un-guarded, the replay deleted the newer `refused`, reinstated itself, dragged
`household.lastActionAt` **backwards**, and returned **201** — so nothing anywhere reported a problem.

`supersededByNewer` rejects it. Two things already on the wire make it decidable:

| | where it comes from | why it is trustworthy |
|---|---|---|
| `wasOfflineSubmission` | stamped at **enqueue** time, never at record time (`offlineQueue.js`) | marks exactly the replay population — including a replay caused by a timeout *while online* |
| `timestamp` | frozen when the canvasser taps (`recordAction.js`) | reports when the action happened, not when it arrived |

**Scoped to replays on purpose.** A live write is never rejected, so online last-arrival-wins is
untouched and no clock-skewed phone can lock itself out. The comparison is also always against *this
canvasser's own* rows (`mineRows`, mirroring the `deleteMany`'s `userId` scope), so both timestamps
come from one device — cross-device clock skew cannot affect it. That is what makes trusting a client
timestamp defensible here and nowhere else.

**A superseded replay returns `200 { household, superseded: true }`**, not a 4xx. The queue drains on
any 2xx, and the client's optimistic overlay reads `response.household.status`
(`recordAction.js`), so the pin reconciles for free — **no client release was needed,
and phones already in the field are covered.** The `household` here is the minimal **per-round**
wire shape (`_id`, `status`, `lastActionAt` — `toWireHousehold`), not the raw doc: the stored
`Household.status` is completion-sticky across rounds, and echoing it back used to flip a
prior-round-surveyed door to "surveyed" right after a not-home, with the overlay then defending
the wrong color against correct deltas for its whole TTL (fixed 2026-07-31; see
`actionResponsePerRound.int.test.js`). A 409 would have been the repo's usual shape for "your
write lost a race", but `recordAction.js` raises an "Action not saved" alert for unrecognised 4xx
codes, which would have told a canvasser their correctly-superseded write had failed. `201` still
means a real write, so the two remain distinguishable in logs.

In the survey route the guard sits **before the `SurveyResponse` upsert** — that upsert runs ahead of
its own `deleteMany` and is keyed on `(voterId, passId)` alone, not on user or time, so a stale replay
would otherwise overwrite a newer submission's answers and clear its `editedBy`/`editedAt` audit trail.
The disposition path matters just as much: it also deletes this canvasser's `SurveyResponse` rows for
the pair, so an unguarded replayed `not_home` destroyed a newer survey's **answers**, not just a label.

**The cross-canvasser branch (closed 2026-08).** The disposition paths were always
same-canvasser-scoped (`deleteMany` on this `userId`), but the survey write on `(voterId, passId)`
**crossed canvassers** — canvasser B's submit silently replaced canvasser A's answers, a data loss
nothing reported. Two halves fix it: **server-side preservation** (the pre-read row is snapshotted
whole into `SurveyResponseArchive` before the replace whenever the `userId` differs — mechanics in
[SURVEYS.md](SURVEYS.md) §F) and a **door-side smart confirm**. The confirm's decisions live in
[lib/resurvey.js](../mobile/lib/resurvey.js), pinned by
[resurvey.test.js](../mobile/lib/resurvey.test.js) (plain node, no react-native imports):
`shouldConfirmResurvey` fires **only** on `surveyStatus === 'surveyed' && surveyedByMe === false` —
strict `=== false`, so an absent flag (old server, stale disk cache, pre-flag bootstrap) **fails
open** with no prompt, because a possibly-wrong warning at a door is worse than none and the
server-side preservation catches every collision the confirm misses. The survey screen shows it
**once, at mount**; `buildResurveyPrompt` is deliberately nameless and countless (the wire carries
only the boolean, so a stale flag can never make the copy a lie), and the confirm button is not
destructive-styled — proceeding is legitimate. The submit's `optimisticPatch` stamps
`surveyedByMe: true` on the canvasser's own voter, so their own re-survey stays one tap even before
the next sync. `surveyedByMe` rides the per-round voter wire on bootstrap **and** the `/changes`
delta; old app bundles without the confirm keep overwriting silently, which the server-side
preservation covers — every wire change is additive, so no `CLIENT_API_VERSION` bump.

**Doors corrupted before the guard shipped** are findable: a surviving row whose `replaced.timestamp`
is *newer* than its own `timestamp` cannot occur in order. `npm run audit:stale-overwrites`
([auditStaleOverwrites.js](../server/src/migrations/auditStaleOverwrites.js)) reports them and writes
nothing — the snapshot carries no `note`, so restoring is a deliberate decision, not an automatic one.

**Not covered by this guard** (deliberate): the location-correction path
(`/mobile/households/:id/location`) is a coordinate write with no disposition semantics and must stay
replayable verbatim.

### The change confirmation ("Change this door's result?")

Replace-then-create means a new tap **replaces** the canvasser's earlier result for the round and —
through the `SurveyResponse` cleanup above — **deletes** any answers they took at the door. Both used
to happen without a word. Per the owner's ruling of 2026-10-02 the phone now asks first, on every
campaign; it is client-side only, and the server contract is unchanged.

The decisions are pure functions in [lib/doorChange.js](../mobile/lib/doorChange.js) (no react-native
imports — the `resurvey.js` convention), pinned by [doorChange.test.js](../mobile/lib/doorChange.test.js):

- **`changePrompt({ door, action, ownSurveys })`** → `null` (record without asking) or which prompt.
  `door.status` is the per-round status the phone already holds (bootstrap/delta with the pending
  overlay applied, so a result tapped seconds ago counts). **Order matters:** `erase` (`ownSurveys > 0`
  and the new status isn't `surveyed`) is checked before every exemption, because a survey still
  waiting to upload can sit behind a door the cache briefly shows as fresh (the pending overlay lapses
  after 5 minutes or on a restart, and a full bootstrap refetch repaints the server's `unknocked`) or
  behind a stale desk mark. Then the exemptions — `unknocked`, `restricted` with
  `restrictedFrom === 'desk'` (the office's mark, whose card says to work the door normally), and the
  same status again (Not home twice, *Re-record drop*, another voter at a Surveyed door) — then
  `survey` for opening a survey, and `change` for everything else.
- **`ownSurveysHere({ voters, householdId, pending })`** counts the surveys **this** canvasser holds
  at this door this round — cached or still queued, each voter once — that the result being recorded
  would delete (`voters` may be the whole bootstrap list; it is scoped to the door inside). **The
  cache half always counts:** voters with `surveyStatus === 'surveyed' && surveyedByMe === true`
  (`ownSurveyedIds`, keyed on both fields as `shouldConfirmResurvey` is, so a stale flag can't fire
  it). A survey already on the server may have been tapped *after* a result that is still queued —
  the server then keeps it and discards the older replay (`supersededByNewer`) — and the cache can't
  tell it from one the queued result will delete; a missed warning loses answers, a spare one only
  asks. What keeps the usual case quiet is the record-time clear (`clearOwnSurveysAtDoor`, under
  *Where it runs* below). **The queue half** (`getPending()`) covers what the cache can lose — a full
  bootstrap refetch replaces `voters` wholesale ([bootstrapQuery.js](../mobile/lib/bootstrapQuery.js)
  overlays households only). A queued survey submit for one of the door's voters — including a
  walk-up voter whose add is still queued (the queued add's `body.voterId`) — counts unless a door
  result at this door was **tapped after** it: that result deletes it, or, replayed after the result
  landed, the survey is the older replay the server discards. "After" compares the queued bodies' tap
  times (`body.timestamp`, the time the server judges by) rather than queue order, because two failed
  uploads can land in the queue in either order; if either item lacks a parseable `body.timestamp`
  (a defensive fallback — every queued write has always carried one), queue position decides.
  **Known spare warnings**, accepted because each errs toward asking: a queued survey older than a
  result that went out live (a live result never enters the queue, so nothing marks the survey gone;
  the server will discard its replay), and a bootstrap refetch or delta repainting the server's
  pre-result state before the queue flushes. Both ask about answers that are already gone or about
  to be. The paths and bodies come from
  [lib/doorPaths.js](../mobile/lib/doorPaths.js): `ACTION_PATHS` — the seven door-result route
  segments, defined there so the recorder (`recordHouseholdAction`) and this counter share one map —
  and `doorResultPath`, the full door-result URL this counter and the test fixtures build from it
  (`recordHouseholdAction` writes the same `/mobile/households/:id/<segment>` string inline, so that
  template lives in two places); `addVoterPath`, `addVoterBody` and `surveyPath` are one definition
  shared by the writers (`recordAddVoter`, the survey screen) and the test fixtures, so those
  fixtures can't drift from what production queues. It is a separate react-native-free module
  because `recordAction.js` imports react-native and node tests can't load it.
- **`buildChangePrompt(prompt, labels)`** → the title, message and buttons, labelled from
  `statusLabels`. It never promises the door *changes* — "Record Refused instead?" — because
  completion stays sticky when a teammate's survey or drop holds the round. Destructive styling on
  `erase` only.

**Where it runs.** Once, inside `recordHouseholdAction`, which passes
`confirm: () => confirmDoorChange(qc, householdId, action)` to `optimisticSubmit` — so the door
screen's buttons, the door list's quick action (`onListQuick` in map.jsx) and the building screen's
per-unit quick button (`building.jsx`) all inherit it with no edit of their own. `optimisticSubmit`
runs `confirm` right after `inFlightPaths.add(path)` and before the GPS gate: a double tap on a quick
button (which has no latch of its own) is deduped by the per-path lock instead of opening two alerts,
and `hasInFlightActions()` covers the open alert, so the OTA restart prompt can't reload the app
mid-decision. Backing out — Cancel, **Keep my survey**, or `onDismiss` (on Android a newer alert
dismisses the current one with neither button firing) — resolves the non-blocked sentinel
`{ ok: false, queued: false, kept: true }` and releases the path, so the door screen's `.finally`
re-enables its buttons. `confirmDoorChange` reads the queue with `getPending().catch(() => [])`, so a
failed AsyncStorage read falls back to the cache half instead of leaving a latch stuck; the alert goes
through `alertWhenActive` with Cancel first; and the GPS "Try again" re-entry strips `confirm`, so no
one is asked twice for one tap. `recordHouseholdAction`'s optimistic patch also runs
`clearOwnSurveysAtDoor` after `setHouseholdStatus`: every voter at the door this canvasser surveyed
(`surveyStatus === 'surveyed' && surveyedByMe === true`) goes back to the wire's round-fresh shape
(`surveyStatus: 'not_surveyed'`, no `surveyedByMe` key, as
[bootstrap.js](../server/src/routes/mobile/bootstrap.js)'s `stampPerRoundSurvey` ships it),
mirroring the server's `SurveyResponse` cleanup, whose reply carries only the household. It is exact:
a voter holds at most one survey per round (`{voterId, passId}` is unique on `SurveyResponse`), so
the result really does leave each of them round-fresh. A teammate's
survey (`surveyedByMe === false`) and a voter at a legacy null-pass book (no flag) are untouched.
Without this, the cache kept showing those surveys until the 30-second delta or a refresh re-shipped
the door's voters, so a change made in between warned about answers already deleted, and **Keep my
survey** kept nothing.

**A rejected result puts the marks back.** The patch records which voters it cleared
(`ownSurveyedIds`, read before the clear), and `optimisticSubmit`'s opt-in `rollbackPatch` runs
`restoreOwnSurveys(prev, cleared)` the moment the server rejects the write and `submitOrQueue` won't
retry it — a 4xx other than an auth failure (network errors, timeouts, 5xx and auth failures queue
instead). A rejected result deleted nothing (every refusal returns before the route's `deleteMany`),
so without the undo the next tap would skip the erase warning and really delete the answers. It
restores only a voter still in the cleared shape (`'not_surveyed'`, no `surveyedByMe` key); one
that a delta or another survey has since marked surveyed again is newer truth than the undo and is
left alone. A delta that re-ships the voter round-fresh in the meantime leaves the very same shape
(the clear copies the wire's), so that voter is restored anyway — erring toward asking: it reads as
this canvasser's survey, at worst a spare warning, until the refetch below lands. The `['bootstrap']`
invalidate that follows every rejection restores server truth too, but a refetch can fail, and the
marks must not outlive a write that never happened.

**The survey screen** ([voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx)) runs its own
mount-time check with `action: 'survey_submitted'` and no `ownSurveys` (taking a survey never deletes
one), beside the teammate re-survey confirm: one prompt per visit, whichever applies — the re-survey
confirm wins — and neither for a DNC voter (the wall renders instead). It runs exactly once, the first
time the door is known (`doorCheckedRef`), so a teammate's delta can't pop it up mid-survey; Cancel is
`router.back()`. Placed there, it covers Take survey, Re-survey and Add person → *Add & take survey*
before any answer is entered.

**Keeping `restrictedFrom` fresh.** The desk exemption trusts `door.restrictedFrom`, which the server
sets only while the round reads `restricted` ([passStatus.js](../server/src/services/passes/passStatus.js)).
The phone's copy used to go stale — every optimistic patch spread `...h`, and the delta fold never
copied it — so `setHouseholdStatus` now sets it (`'field'` for the canvasser's own Restricted tap,
`null` otherwise), the survey screen's optimistic patch clears it, and the delta fold copies it.

**Known limits.** On a legacy null-pass book the server sends no `surveyedByMe` — the same limit as
the re-survey confirm's — so only surveys still in this phone's cache or queue are counted there. And
the undo covers only a result refused live: a queued result whose replay is refused with a 4xx is dropped by
the flush ([offlineQueue.js](../mobile/lib/offlineQueue.js) `doFlush`) with no `restoreOwnSurveys`,
so the marks it cleared stay cleared until the door's voters are re-shipped (a full bootstrap
refetch, or a delta that carries them).

### The precise-location gate

`lib/location.js` is the wiring and [`lib/locationGate.js`](../mobile/lib/locationGate.js) is the
pure policy, split so `node --test` can exercise the decisions without RN or expo imports (same
pattern as `locationFeed.js`). Two rules, one per platform:

- **Android** reports the grant directly. Android 12+ "Approximate" arrives as a **granted**
  permission whose `android.accuracy` is `coarse`, so anything checking only `status === 'granted'`
  waves it through. `isCoarseGrant` closes that, and it runs in `acquire` **before the first fix is
  even requested**.
- **iOS** exposes no `accuracyAuthorization` in expo-location v19, so reduced accuracy is inferred
  from the fix: worse than `IOS_REDUCED_ACCURACY_MIN_M` (1000 m) is treated as Precise-off, because
  reduced fixes cluster at 2–5 km while a genuine full-accuracy fix never approaches a kilometre
  outdoors. A **null** accuracy is deliberately not treated as reduced — unknown is not bad, and
  blocking it would refuse honest knocks. Replace the heuristic when expo-location exposes the real
  API.

The proactive banner uses `foldCoarseRun`: a run of `PRECISE_OFF_MIN_COUNT` (6) coarse readings
spanning at least `PRECISE_OFF_MIN_SPAN_MS` (15 s), with any gap over `PRECISE_OFF_MAX_GAP_MS`
(30 s) discarding the run. Both floors exist to stop a cold GPS warming up indoors from tripping it,
and the gap rule stops this morning's coarse readings combining with one fix now. `reportFixAccuracy`
delegates to that fold rather than repeating it, so the tested rule is the shipped one.

[`lib/locationGate.test.js`](../mobile/lib/locationGate.test.js) pins all of it, plus three
invariants that live in modules too RN-bound to import: both gates run on the knock path with the
Android check ahead of any fix, all three fix sources pass through `assertPrecise`, and the gate
precedes both the optimistic patch and `submitOrQueue` so a blocked tap leaves **zero trace**.
Those three are structural source checks, weaker than running the code and noted as such in the
file; they were mutation-tested (five deliberate regressions, each caught) so they are not
decorative.

**The server does not check accuracy.** It requires coordinates and rejects a knock without them,
but never inspects how accurate they are, so enforcement is client-side. The compensating control
is the audit: a fix worse than 100 m flags `weak_gps` at medium and worse than 250 m at high
([AUDIT.md](AUDIT.md)), so a coarse stamp from a bypassed client surfaces for review rather than
passing silently.

## The at-door survey

[app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) — resolves the voter,
household, and the **effort-scoped** survey (the door's book → `surveyTemplateId` override, falling back
to `activeSurvey`) from the bootstrap cache. Three field behaviors beyond a flat questionnaire:

- **Conditional visibility.** `visibleQuestions` is recomputed from `answers` every render via the
  shared pure evaluator [lib/surveyVisibility.js](../mobile/lib/surveyVisibility.js)
  (`makeCell` + `visibleQuestionKeys`, mirrored from `services/surveys/visibility.js` on the server and
  the admin client). It normalizes each non-retired question to a cell (choice → optionIds, text →
  text), hides questions whose `visibleIf` fails, and **withholds hidden questions' answers** from the
  rules of later questions. Everything downstream — the progress bar, the "Question N of M" count,
  `validate()` (required only enforced on visible questions), and the submitted `answers` array — keys
  off `visibleQuestions`, so hidden questions never block a save or get sent.
- **Per-option read-aloud scripts.** When a selected option has `opt.script`, an amber `scriptBlock`
  ("Read aloud") renders inline beneath it (in both `SingleChoice` and `MultipleChoice`). The survey's
  `intro` and `closing` render in the same callout at the top/bottom.
- **Other (specify).** When `q.otherOption` is set, a synthetic `{ id: '__other__' }` choice is appended;
  selecting it renders a `FreeText` box stored in `otherTexts[q.key]`. `isAnsweredNow` treats an
  Other-only selection as unanswered until its text is non-empty. On submit, the `__other__` sentinel is
  sent in `optionIds` with the typed value in `otherText` (and snapshotted into the answer's label text,
  fallback `'Other'`).

Submit is optimistic-first like the door buttons: once the GPS gate passes, `optimisticSubmit` to
`surveyPath(id)` (`/mobile/voters/:id/survey`, from [lib/doorPaths.js](../mobile/lib/doorPaths.js))
marks the voter `surveyed` (with `surveyedByMe: true`) + the household `surveyed`/green — clearing its
`restrictedFrom`, so a stale desk mark can't exempt the door from the change confirmation later —
registers the pending overlay, and `onAccepted` pops back with `router.dismiss(2)` (see *The door
screen*) without awaiting the write. Before any answer is entered, the screen's mount-time check may
ask first — the teammate re-survey confirm or the door-change confirmation, never both (see *The
change confirmation* above).

## Effort selection + data

Two entry points, both scoping the book picker to one effort:

- **Expandable campaign card** ([campaigns.jsx](../mobile/app/(app)/campaigns.jsx)): a campaign with
  more than one effort expands instead of navigating; choosing an effort persists it via
  `saveCurrentEffort(campaignId, effortId)` then enters the books. Single-/no-effort campaigns go
  straight in.
- **Books effort switcher** ([components/EffortPicker.jsx](../mobile/components/EffortPicker.jsx)): a
  segmented control for ≤3 efforts, falling back to a chip + dropdown for more; hidden for one
  effort. Selection persists the same way and re-scopes `visibleBooks` in
  [books.jsx](../mobile/app/(app)/books.jsx).

The books screen's resolver reads `loadCurrentEffort(campaignId)` and only resolves once
(`effortResolvedRef`), so a choice made on the campaign card is honored when books opens.

Effort data reaches the picker through an **additive** `efforts: [{ id, name }]` field on
`GET /mobile/campaigns`, computed by `canvasserEffortsForCampaign` in
[server/.../mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js) — a light slice of
`canvasserBooks` (passes/efforts only, no household/voter/survey work) returning the distinct named
efforts the user has assigned books in. Being additive, it needs no client-version bump; older
clients ignore it. The ids match the bootstrap's effort list, so a choice scopes correctly.

## Files

- New: `lib/DrawerContext.jsx`, `components/CanvasserDrawer.jsx`, `components/CanvasserHeader.jsx`,
  `components/MapContextCard.jsx`, `components/MapControlStack.jsx`,
  `components/icons/HamburgerIcon.jsx`, `app/(app)/profile.jsx`, `lib/doorChange.js` (+
  `doorChange.test.js` — the change confirmation's decisions, words, `clearOwnSurveysAtDoor` and
  its undo `restoreOwnSurveys`),
  `lib/doorPaths.js` (`ACTION_PATHS` and `doorResultPath`, plus the shared queue path/body builders),
  `assets/icons/house-not_target.png` (the fuchsia pin).
- Changed: `app/(app)/_layout.jsx`, `app/(app)/select-org.jsx`, `app/(app)/campaigns.jsx`,
  `app/(app)/books.jsx`, `app/(app)/map.jsx` (+ the Not target chip, legend entry and pin; the
  `/changes` URL through `changesPath`, the `doorConfig` fold, and `restrictedFrom` in the delta fold),
  `lib/deltaFold.js` (`changesPath` — the `/changes` URL with `since` and the `doorConfigStamp`
  encoded; + `deltaFold.test.js`, and its CI guard in `server/test/outcomeToggles.test.js`),
  `app/(app)/admin/more.jsx`,
  `app/(app)/stats.jsx` (comprehensive redesign), `app/(app)/stats/[date].jsx` (drop Distance tile),
  `components/EffortPicker.jsx`, `lib/rates.js` (shared `formatPace`),
  `app/(app)/household/[id].jsx` (Refused + No-soliciting + Restricted-access door buttons; amber pill,
  pink `no_soliciting` dot + slate `restricted` dot; the opt-in Not a target voter button and white
  labels on the two dark buttons),
  `app/(app)/voter/[id]/survey.jsx` (conditional questions, per-option scripts, Other specify; the
  mount-time door-change confirmation),
  `lib/recordAction.js` (the dispositions' `ACTION_PATHS`, now imported from `doorPaths.js`; the
  `confirm` step and `confirmDoorChange`; `restrictedFrom` kept fresh; the optimistic
  `clearOwnSurveysAtDoor`, undone through `optimisticSubmit`'s new `rollbackPatch` when the server
  rejects the result), `lib/surveyVisibility.js` (shared visibility evaluator),
  `lib/outcomeToggles.js` (the fail-closed `isOutcomeOn`), `components/StatusPill.jsx` (amber tint
  for `not_target`),
  `lib/theme.js` (`status.refused`/`statusLabels.refused` amber + `status.restricted`/`statusLabels.restricted` slate + `status.not_target`/`statusLabels.not_target` fuchsia tokens),
  `server/src/routes/mobile/bootstrap.js` (+ `doorConfigFor`: `enabledOutcomes` and `doorConfigStamp`
  on the bootstrap, `doorConfig` on `/changes`), `server/src/routes/mobile/canvass.js` (the
  `/not-target` route and the opt-in gate), `server/src/routes/auth.js` (self-service `PATCH /auth/me`).
