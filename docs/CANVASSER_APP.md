# Canvasser app (the field app's screens, menu, and navigation)

How the mobile field app is laid out for a **canvasser**: the screens they move through to get to
the doors, the slide-out **menu** that holds everything occasional, and the lean per-screen headers
that keep the quick actions one tap away. This is the shell; the things inside it (the map, surveys,
efforts) have their own docs.

- **Part 1 — For everyone** is plain language: the flow from sign-in to the doors, the menu, and
  what each screen's header does.
- **Part 2 — Technical reference** is for developers (and Claude): the navigation tree, the drawer
  overlay, the shared header, the merged map context card, and where effort data comes from.

Related: [MAPS.md](MAPS.md) (the houses map + bottom sheet this flow lands on),
[EFFORTS.md](EFFORTS.md) (efforts a canvasser picks between), [WALKLISTS.md](WALKLISTS.md) and
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (how books get assigned), [THEMING.md](THEMING.md) (the
light/dark tokens every screen here is built from).

---

# Part 1 — For everyone

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
you were working, so a cold start reopens it instead of making you pick again.

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
  badge; tapping it also flushes anything you recorded offline.
- **Switch campaign** — on the book picker, a one-tap way back to the campaign list (next to the
  menu button).

## Picking a campaign (and effort)

On **Pick a campaign**, each campaign shows whether it's a Survey or a Lit drop, its name, and its
state. Most campaigns open straight to the books. A campaign that's split into several **efforts**
(say "North" and "South", or "volunteers" and "paid") instead **expands** when tapped to show its
efforts — pick the one you're working and you land on that effort's books. (Book numbers restart per
effort, so this keeps two different "Book 6"s from colliding.)

## The book picker

A map of your books as colored pins — grey (not started), yellow (in progress), green (done). If
you're in more than one effort, an **effort switcher** sits at the top to flip between them. Tap a
book, then **Enter** to open it on the houses map. The same **bottom-right controls** as the houses
map are here too — Refresh, the terrain / base-map picker, and recenter (follow your location).

## The houses map

The top of the map is intentionally calm — just the logo on the left, the menu on the right, and one
**context card** that tells you where you are:

- The **campaign** name, with a **Switch** link.
- The **book** you're in and its **progress bar** (done / total houses); tap it to jump back to the
  book picker.
- A **Filter** (on the right) to show only certain door statuses on the map.

The **Refresh** button is in the bottom-right control stack (above terrain + recenter); a **pending**
badge appears on it when you have work that hasn't synced yet — tapping Refresh flushes it.

Everything below — the pins, the pull-up sheet with your progress and each house's voters, recenter,
and the base-map picker — is covered in [MAPS.md](MAPS.md).

---

# Part 2 — Technical reference

## Navigation

Expo Router, file-based. The authenticated group is a flat stack with native headers off
(`headerShown: false`) — every screen renders its own header.

- Root redirect: [app/index.jsx](../mobile/app/index.jsx) routes by role/state (no token → login;
  no org → select-org; admin/super → admin/super-admin; canvasser without a campaign → campaigns;
  otherwise → map).
- Group + overlays: [app/(app)/_layout.jsx](../mobile/app/(app)/_layout.jsx).
- Canvasser screens: [select-org.jsx](../mobile/app/(app)/select-org.jsx),
  [campaigns.jsx](../mobile/app/(app)/campaigns.jsx), [books.jsx](../mobile/app/(app)/books.jsx),
  [map.jsx](../mobile/app/(app)/map.jsx).

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
  underneath — the key correctness property. The body reuses the `admin/more.jsx` Row/grouped-card
  pattern and embeds `<ThemeToggle/>`; rows are gated by `loadRoleContext()` (admin/super) and active
  campaign (My stats). Canvassers have **no voter-lookup entry** — they work their assigned doors and
  see each household's voters at the door; the `/(app)/voters` screens + `/mobile/voters*` endpoints
  still exist (unreached) for a possible future admin use.
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

## The profile screen

[app/(app)/profile.jsx](../mobile/app/(app)/profile.jsx) — a self-service account screen, pushed onto
the `(app)` stack (back-button header, no hamburger). Reached from the **account card** at the top of
the canvasser drawer ([CanvasserDrawer.jsx](../mobile/components/CanvasserDrawer.jsx)) and from the
admin **More** tab's account card ([admin/more.jsx](../mobile/app/(app)/admin/more.jsx)) — same screen
for both, since the endpoints are role-agnostic.

- **Edit info:** first name, last name, phone. Saves via `PATCH /auth/me`
  ([server/.../auth.js](../server/src/routes/auth.js)) — a `requireAuth`-only handler (no org context,
  like change-password) validated by `updateProfileSchema`. **Email is read-only** on purpose: it's
  globally unique and shared across a user's orgs, so email changes go through an admin (the existing
  multi-org guard). On success the screen re-caches the user (`saveCurrentUser` / `saveMemberships`) so
  the drawer's account card and greetings refresh.
- **Change password:** current / new / confirm, inline. Posts to the existing
  `POST /auth/change-password` (requires the current password, new ≥ 8 chars) and clears the fields on
  success. There is no email-reset flow — the user is logged in, so it's always a known-password change.

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
  `components/icons/HamburgerIcon.jsx`, `app/(app)/profile.jsx`.
- Changed: `app/(app)/_layout.jsx`, `app/(app)/select-org.jsx`, `app/(app)/campaigns.jsx`,
  `app/(app)/books.jsx`, `app/(app)/map.jsx`, `app/(app)/admin/more.jsx`,
  `app/(app)/stats.jsx` (comprehensive redesign), `app/(app)/stats/[date].jsx` (drop Distance tile),
  `components/EffortPicker.jsx`, `lib/rates.js` (shared `formatPace`),
  `server/src/routes/mobile/bootstrap.js`, `server/src/routes/auth.js` (self-service `PATCH /auth/me`).
