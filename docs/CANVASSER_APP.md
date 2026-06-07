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

Every canvasser screen has a **menu button (☰) in the top-left**. Tapping it slides a panel in from
the left with the things you reach for occasionally:

- **My stats** — your shift history and totals.
- **Voters** — the voter directory / lookup.
- **Appearance** — Light / Dark / System.
- **Switch organization** — only if you belong to more than one (or you're a super admin).
- **Admin dashboard** — only if you're an admin (jumps to the admin side).
- **Sign out.**

Close it by tapping the dimmed area, swiping the panel left, or the ✕. The map behind it keeps
working the moment the menu is closed.

The header keeps only the **quick** actions, so the menu isn't in the way of the job:

- **Refresh** (↻) — syncs your work and pulls the latest doors. On the houses map it also flushes
  anything you recorded offline.
- **Switch campaign** — on the book picker, a one-tap way back to the campaign list.

## Picking a campaign (and effort)

On **Pick a campaign**, each campaign shows whether it's a Survey or a Lit drop, its name, and its
state. Most campaigns open straight to the books. A campaign that's split into several **efforts**
(say "North" and "South", or "volunteers" and "paid") instead **expands** when tapped to show its
efforts — pick the one you're working and you land on that effort's books. (Book numbers restart per
effort, so this keeps two different "Book 6"s from colliding.)

## The book picker

A map of your books as colored pins — grey (not started), yellow (in progress), green (done). If
you're in more than one effort, an **effort switcher** sits at the top to flip between them. Tap a
book, then **Enter** to open it on the houses map.

## The houses map

The top of the map is intentionally calm — one **context card** tells you where you are:

- The **campaign** name, with a **Switch** link.
- The **book** you're in and its **progress bar** (done / total houses); tap it to jump back to the
  book picker.
- A **Filter** to show only certain door statuses on the map.
- A **pending** badge appears when you have work that hasn't synced yet (tap Refresh to flush it).

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
  left panel. Closes on backdrop press or a left-swipe `Gesture.Pan` bound **only to the open panel**
  (the map is covered by the backdrop, so the two pans never compete). It **renders `null` while
  closed**, so it never intercepts a touch on the map underneath — the key correctness property. The
  body reuses the `admin/more.jsx` Row/grouped-card pattern and embeds `<ThemeToggle/>`; rows are
  gated by `loadRoleContext()` (admin/super) and active campaign (My stats / Voters).
- Mount: rendered in [_layout.jsx](../mobile/app/(app)/_layout.jsx) as a sibling **after** `<Stack>`
  and `<AddedToOrgBanner/>`, so it paints above the map and the bottom sheet. Inert until a screen's
  header calls `openDrawer()`, so it never shows on admin tab screens.

## The shared header

[components/CanvasserHeader.jsx](../mobile/components/CanvasserHeader.jsx) — one component, two
variants:

- `variant="solid"` — for the card screens (select-org, campaigns): hamburger + wordmark on the
  screen background.
- `variant="floating"` — for the full-bleed map screens (books, map): a translucent `chromeBar`
  rendered inside the screen's own `SafeAreaView` map overlay (it adds no inset itself).

Left is always the hamburger (`openDrawer`). Right holds only injected quick actions: `onRefresh` /
`refreshing`, `onSwitchCampaign`, and a `pendingCount` badge. The refresh handler is injected so each
screen keeps its semantics (books: `refetch()`; map: `onRefresh` which also flushes the offline
queue). The hamburger glyph is a custom SVG, [components/icons/HamburgerIcon.jsx](../mobile/components/icons/HamburgerIcon.jsx)
— no icon library; it matches the `Logo`/`PinIcon` `{ size, color }` convention.

## The map context card

[components/MapContextCard.jsx](../mobile/components/MapContextCard.jsx) merges what used to be
three stacked bars (a top bar + a campaign chip row + a book-progress strip) into the header plus one
card: campaign name + Switch, then the effort · book + progress bar + a Books link. The status filter
chip and its dropdown sit in a `filterRow` below it. All prior behavior is preserved — refresh,
pending badge, filter, switch campaign, books navigation, recenter, base-map picker, and the pull-up
sheet.

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
  `components/MapContextCard.jsx`, `components/icons/HamburgerIcon.jsx`.
- Changed: `app/(app)/_layout.jsx`, `app/(app)/select-org.jsx`, `app/(app)/campaigns.jsx`,
  `app/(app)/books.jsx`, `app/(app)/map.jsx`, `components/EffortPicker.jsx`,
  `server/src/routes/mobile/bootstrap.js`.
