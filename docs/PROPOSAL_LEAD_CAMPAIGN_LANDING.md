# Proposal: A team lead with one campaign opens straight into it

> **Status: PLAN v6, after five review rounds, 2026-10-08. Awaiting the owner's approval; nothing is
> built.** Line references are to HEAD `b1e0b0d`. One server change (an added field on the sign-in
> responses), the web console, and a phone update over the air (no new build). Not
> privacy-affecting, and three existing exposures get smaller on the way (§J). Review history in §N.

Related: [ROLES.md](ROLES.md) (*Where a team lead works*), [ADMIN_APP.md](ADMIN_APP.md) (the phone's
admin Overview and campaign screen), [CAMPAIGNS.md](CAMPAIGNS.md) (the campaign drill-in, its
switcher and setup progress).

# Part 1 — For everyone

## What changes for a team lead with one campaign

A team lead who runs exactly **one active campaign** no longer starts on a list with one card in it.

- **Web console.** Signing in opens that campaign's **Home**, with the campaign's tabs in the
  sidebar.
  - The full list is still one click away: **‹ Campaigns** at the top of the sidebar, a
    **Campaigns** icon at the top of the collapsed icon rail, or **More → ‹ All campaigns** in a
    narrow window.
  - The list is where a campaign's **Edit** (name, survey, door goal) and **Assignments** live, and
    where archived campaigns are.
- **Phone.** The **Overview** tab *is* that campaign's screen, headed by the campaign's name: the
  same screen tapping the campaign's row used to open. Its numbers update themselves every 30
  seconds while you're looking at it, and you can pull down to refresh them. Archived campaigns, if
  you have any, are near the bottom under **Archived**.
- **On the campaign Home, leads no longer see the organization's Doorline billing notes**: "Not
  billing yet — setup is free until the first knock" and the after-Election-Day reminder to archive.
  Both are about the organization's subscription, and only an admin can act on them; the Campaigns
  page already kept the reminder for admins.
- **The setup checklist's "No canvassers in this org yet" link** takes a lead to the campaign's
  **Team** page ("add on Team →"), where they can add canvassers. It used to send them to the
  organization's Users page, which they can't open.

| A lead with… | Web console opens on | Phone Overview shows |
|---|---|---|
| One active campaign (any number archived) | That campaign's Home | That campaign |
| Two or more active campaigns | Campaigns (as today) | The list, as today |
| No active campaigns | Campaigns (as today) | The list, as today |

Archived campaigns don't count: they're finished work, read-only, and you can still open them.
Admins and super admins don't get this: their home is the organization Overview (the Control Room
for a super admin outside an organization), which carries the organization-wide pages (Surveys,
Users, Billing) a lead doesn't have.

**When it happens.**
- **Web.** Whenever the console sends you "home":
  - signing in, picking or switching organization, or finishing a password change;
  - **Go to dashboard** on the Doorline website;
  - the button on a page you can't open, or on a "Campaign not found" page. It now reads **Go to
    your campaign** (or **Go to Campaigns** when it's your own campaign that's gone).

  Typing `/campaigns` or using **‹ Campaigns** always shows the list.
- **Phone.** Whenever the admin side opens: signing in, **Admin dashboard** from canvass mode, or
  tapping the **Overview** tab.
- **If your campaigns change while you're signed in:**
  - The phone catches up when you come back to Overview after more than half a minute away, or
    straight away when you pull down.
  - The web console catches up the next time you sign in. Reloading the page doesn't move you, but
    from then on **Go to …** buttons and organization switches take the change into account, and
    **‹ Campaigns** always shows everything you have.

## What changes for everyone

Small fixes that come with this change and apply to every role:

- **Signing out of the web console** always leaves you on a plain sign-in page.
  - Before, the console remembered the page you were on and sent whoever signed in next straight
    back to it, even someone else. The next person could also glimpse the previous person's campaign
    list for a moment. Both are gone.
  - On the phone, tapping **Sign out** on most screens already wiped the numbers and lists the app
    was holding. Now signing in wipes them too, which covers the other ways out, including the times
    the app signed you out by itself. Saved and queued doors are never touched.
- **The campaign box in the web sidebar.**
  - Inside a campaign, the box under **‹ Campaigns** is a dropdown for jumping to another campaign.
    When there's nowhere else to jump, it shows the campaign's name as plain text instead of a
    dropdown with one item.
  - While the list is loading, it shows a grey placeholder bar instead of the word "Campaign".
  - The collapsed icon rail gains a **Campaigns** icon at the top, so the list is always reachable.
- **Archived campaigns say who can reactivate them.** Everywhere the console and the phone say a
  campaign is archived, the second sentence now reads *An org admin can reactivate it from
  Campaigns* (on the phone: *…from Campaigns on the web*). Before, it told everyone to reactivate it
  themselves, which only an org admin can do.
- **The page-you-can't-open button** names where it goes: **Go to Campaigns**, **Go to your
  campaign**, **Go to Control Room**, **Choose an organization**, or **Go to Overview**. The note
  above it for a team lead now reads *Team leads work inside the campaigns they run*.
- **The phone's campaign screen** (for admins too):
  - you can pull down to refresh;
  - coming back to it after half a minute, or coming back to the app, refreshes the numbers all
    together;
  - **Today** moves to the new day at midnight instead of quietly stretching over two days;
  - on a weak signal, sections keep their last numbers. The **By pass** breakdown adds a note that it
    couldn't refresh, instead of swapping to an error;
  - the walk-list, crew and pass choices you made on one campaign no longer carry over to the next
    campaign you open. Before, a campaign could show zeros because of a walk list picked on another.

  The phone's **Overview** totals get the same midnight fix, and a team lead's Overview is captioned
  **Team Lead** (as the phone's other admin screens already say) instead of **Admin**.

Nobody can see or do anything new. Nothing to set up, nothing to turn on.

# Part 2 — Technical reference

## A. What the design rests on (checked at `b1e0b0d`)

1. **Web landing has one owner,
   [client/src/lib/homePath.js](../client/src/lib/homePath.js)**: `ROLE_HOME = { admin: '/admin', lead:
   '/campaigns' }` (:14), `homePathForRole` (:16), `consoleHomePath` (:27, inside an org),
   `resolveHomePath` (:41, right after auth), `postAuthPath` (:65). Its consumers:
   - `AuthContext.homePath` ([AuthContext.jsx:161-166](../client/src/auth/AuthContext.jsx)), read by
     `Forbidden`, `CampaignMissing`, `useAuthCta` and `ChangePasswordPage`'s effect;
   - `LoginPage.onSubmit` (:32-41) and its already-signed-in redirect (:60);
   - `ChangePasswordPage.routeOnward` (:42);
   - `SelectOrgPage.pick` (:52-61, plus the one-org auto-enter at :70-75);
   - `OrgSwitcher.pick` (:50-63).

   A grep at `b1e0b0d`, re-run in rounds 4 and 5, finds no other consumer. The only string
   comparisons against a home path are LoginPage:40, Forbidden:27 and CampaignGate:38.
2. **The client's lead scope is the raw grant list.** `loadMembershipsForUser`
   ([server/src/routes/auth.js:50-88](../server/src/routes/auth.js)) ships `managedCampaignIds` =
   every `CampaignManager` grant in the org, archived and mid-delete campaigns included, keyed and
   emitted as strings (:62-69, :83). "Exactly one active campaign" can't be read from it. auth.js
   imports neither `Campaign` nor `NOT_DELETING` today (:1-18).
3. **Every auth response builds memberships the same way.** `/login` (:117), `GET /me` (:206),
   `/change-password` (:245) and `PATCH /me` (:265) all call `loadMembershipsForUser`. The web client
   sets `memberships` from those four and nowhere else. `acknowledgeMembership` spreads the row, so
   added fields survive.
4. **What a lead's campaign list holds.** `GET /admin/campaigns`
   ([routes/admin/campaigns.js:265-318](../server/src/routes/admin/campaigns.js)) returns campaigns in
   the active org whose `_id` is among the lead's grants
   ([campaignManagement.js:27-37](../server/src/services/authz/campaignManagement.js)).
   - Mid-delete rows split out into `deletingCampaigns`; archived rows stay in `campaigns` with
     `isActive: false`.
   - There is no other filter: a deleted or inactive org is walled before the route and dropped from
     memberships, and entitlement lets reads through.
   - "Active" is spelled three ways in the codebase:
     - `=== false` / `!== false` on the phone and in the web sidebar (campaignSelection.js:15,
       Layout.jsx:120-122);
     - truthy on the web Campaigns page (CampaignsPage.jsx:211, :226, :230);
     - `isActive: true` in the server's rollup scopes (reports.js:588-589).

     They differ only for a campaign with no `isActive` field, which can't exist: the field has been
     in the model with `default: true` since the model's first commit (`f74f678`). This plan uses
     `!== false` / `{ $ne: false }` and leaves the others alone.
5. **The campaign list must stay reachable.** Edit (`CampaignFormDrawer`) and Assignments
   (`CampaignAssignmentsModal`) have no caller other than
   [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) (:244-253). History is on both the list
   and the campaign Home (GoalStrip, [DashboardPage.jsx:470](../client/src/pages/DashboardPage.jsx)).
   So the rule is a *landing* rule, never a redirect on `/campaigns` or `/campaigns/:id`. A redirect
   would bounce **‹ Campaigns** ([Layout.jsx:269](../client/src/components/Layout.jsx)) and
   BottomNav's **‹ All campaigns** (BottomNav.jsx:150-154) straight back. Reloading a page never
   re-lands anyone (AuthContext.jsx:20-37 only re-reads `/auth/me`).
6. **Three places assume a lead's home is literally `/campaigns`.**
   - [LoginPage.jsx:40](../client/src/pages/LoginPage.jsx) restores a deep link only when
     `dest === '/admin' || dest === '/campaigns'`.
   - [Forbidden.jsx:27](../client/src/components/Forbidden.jsx) and
     [CampaignGate.jsx:38](../client/src/components/campaigns/CampaignGate.jsx) pick their button
     label by comparing `homePath` to `'/campaigns'`.
7. **Web sign-out and org switching.**
   - **Sign out buttons.** Three of them only call `logout()`:
     [AccountMenu.jsx:161-164](../client/src/components/AccountMenu.jsx),
     [BottomNav.jsx:223-227](../client/src/components/BottomNav.jsx) and
     [ProfilePage.jsx:191](../client/src/pages/ProfilePage.jsx). Two already navigate away
     themselves (Forbidden.jsx:57-58, SelectOrgPage.jsx:205-206).
     - `ProtectedRoute` redirects to `/login` with `state: { from: location }`
       ([ProtectedRoute.jsx:41-43](../client/src/components/ProtectedRoute.jsx)), and `LoginPage`
       restores it for whoever signs in next.
     - ResetPasswordPage.jsx:60-61 signs out and navigates with its own `resetSuccess` state.
   - **The query cache.** It is never cleared on sign-out or sign-in.
     - The client is created once ([main.jsx:21](../client/src/main.jsx)), and `['admin','campaigns']`
       carries no user or org in its key.
     - `<BrowserRouter>` has no transition flag (main.jsx:30), so `logout()` plus `navigate()` land
       as one render that unmounts Layout.
   - **Org switching.** `AuthContext.switchOrg` (:71-74) only sets the active org. Its callers:
     - OrgSwitcher `pick` and `pickPlatform` (:51, :66), which then call their own
       `resetOrgScopedCache` (:44-48);
     - SelectOrgPage `pick` and `pickPlatform` (:53, :64), which reset nothing;
     - `SupportAccessGate.decline` (:60), which repeats the same predicate by hand (:61-65);
     - SuperAdminHomePage `pickOrg` (:152), which then clears the whole cache.
8. **Phone landing.** [app/index.jsx:90-93](../mobile/app/index.jsx) sends every console role to
   `/(app)/admin`, the **Overview** tab ([admin/index.jsx](../mobile/app/(app)/admin/index.jsx)):
   - org totals from `campaign-rollup?scope=active`, polled every 30 s and paused when covered
     (:131-144);
   - pull-to-refresh (:152-155);
   - campaign rows that push `/(app)/admin/campaign/:id` (:343, :371);
   - an Archived block with its own toggle and query (:100, :146-150, :350-375);
   - a header captioned from `loadCurrentUser()` only (:99, :119, :233).

   Every hook in `AdminOverview` runs before its JSX, down to `useState(sheet)` (:160).
9. **The phone's campaign screen**
   ([admin/campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx)):
   - It is a hidden tab ([_layout.jsx:103](../mobile/app/(app)/admin/_layout.jsx)) whose
     **‹ Overview** is `router.back()` (:491, :510).
   - Its only route-specific APIs are `useLocalSearchParams` (campaignId, :51) and that `router.back()`.
   - It has no pull-to-refresh and no polling, and imports no `useFocusedPoll`.
   - **It does not remount per campaign**, despite its comments (:103-107, :112). expo-router turns a
     push into a navigate when the navigator isn't a stack, and a tab route keeps its key without
     `getId`. So the walk-list, crew and survey-pass chips and a touched date range carry from one
     campaign to the next. Round 1 simulated this against the installed router. Campaign B is queried
     with campaign A's walk list and reads zero; with one walk list the chip is hidden, so nothing
     visible clears it. An existing bug.
10. **Its sections must agree.**
    - "Passes add up to the {rangeKnocks} above" (:716-719) takes `rangeKnocks` from the rollup and
      the rows from knocks-by-pass. The survey results' count is read against Activity's.
    - The door goal rides the rollup (:187), and Coverage comes from `/admin/reports/overview`
      (reports.js:394-570, the heaviest request). Both are all-time door figures on the same screen.
    - So the five report queries (overview, rollup, knocks-by-pass, canvassers, survey results) must
      refresh together.
11. **The web campaign Home polls its sections** with one shared option, `HOME_POLL =
    livePollOptions(true, true, 30_000)`, on six queries (DashboardPage.jsx:98-101, :131-268). They
    pause in a background tab.
    - Per-query intervals don't stay in step: every update clears and restarts that query's timer
      (query-core queryObserver.js:208-223, :424-428). So each one counts from when its own fetch
      finished, and a range change restarts some timers and not others.
    - That's acceptable on the web Home, which makes no "adds up" promise across sections; the phone
      screen does (item 10).
12. **"Today" doesn't roll over at midnight** on the campaign screen or the Overview.
    - `rangeFor('today')` is `{ from: today, to: null }` ([dateRanges.js:43-45](../mobile/lib/dateRanges.js)).
    - The campaign screen seeds it once (:67-72) and re-derives it only when `[tz, campaign]` change
      (:82-87). The Overview re-derives it only on `[tz]` (:118-129).
    - So a screen left open past midnight queries yesterday plus today under a "Today" label.
    - The Timeline pins `from` to the current day on every render while the preset is `today`
      ([timeline.jsx:184-192](../mobile/app/(app)/admin/timeline.jsx)). That works there only because
      it reads `isFetching`/`dataUpdatedAt` (:598-599), so every poll re-renders it.
    - The campaign screen and the Overview read neither, and react-query re-renders only for fields a
      component reads. So a poll returning the same data, the normal case overnight, causes no
      re-render.
13. **The phone's other admin tabs** default to the first active campaign through `CampaignChip` →
    `resolveChipSelection` ([campaignSelection.js:46-52](../mobile/lib/campaignSelection.js)). They
    keep any *valid* saved pick, archived ones included, and the chip always names the campaign it's
    on.
14. **The phone's session.**
    - **Role.** `useConsoleRole()` ([mobile/lib/useConsoleRole.js:24-38](../mobile/lib/useConsoleRole.js))
      returns `undefined`, then `'lead'`, `'admin'` or `'super'`, read once from the cached session
      on mount. The admin tab gate reads the role once on mount too
      ([admin/_layout.jsx:17-28](../mobile/app/(app)/admin/_layout.jsx)).
    - **Session refresh.** `refreshSession` re-pulls `/auth/me` at most once a minute, at:
      - `(app)` mount: [(app)/_layout.jsx:18-20](../mobile/app/(app)/_layout.jsx);
      - return to the foreground: [_layout.jsx:132-135](../mobile/app/_layout.jsx);
      - throttled by session.js:14-18.

      Memberships are also re-saved at sign-in (login.jsx:58), on an org pick (select-org.jsx:45) and
      after a profile or password save.
    - **Cache clears.**
      - The main **Sign out** buttons call `queryClient.clear()`: admin/more.jsx:89,
        CanvasserDrawer.jsx:145, super-admin/more.jsx:41 and map.jsx:752.
      - So does every org switch, which also unmounts the admin tabs (for example admin/more.jsx:94,
        select-org.jsx:88).
      - The exits that don't clear: a revoked session (_layout.jsx:107), change-password.jsx:70, the
        update wall's Sign out (update-required.jsx:43) and DeleteAccountSheet.jsx:86.
    - **Sign-in screen.** [app/login.jsx](../mobile/app/login.jsx) never clears. It imports no
      react-query (:1-30). Its hooks sit at :33-39, above an early `if (token) return <Redirect/>`
      (:41), and `signIn` is at :64.
15. **Library facts relied on** (react-query 5.100.6 on both clients; @react-navigation/core 7.17.2;
    react-router 6.30.3):
    - **Refetching:**
      - `refetch()` ignores `enabled`;
      - it defaults to `cancelRefetch: true`, which cancels a fetch in flight; the screen's queryFns
        pass no abort signal, so the cancelled request still runs on the server;
      - with `cancelRefetch: false` it joins the fetch in flight;
      - `result.refetch` is bound to its observer and always fetches the current key.
    - **Failures:** after a failed refetch with cached data, `isSuccess`/`isError` flip while `data`
      stays. `errorUpdatedAt` is set at the final failure; `dataUpdatedAt` doesn't change.
    - **Disabled queries:** a disabled observer still returns whatever is cached under its key, and
      `enabled: undefined` counts as enabled.
    - **Focus and subscription:**
      - `subscribed: false` (what `useFocusedPoll` sets when covered) stops notifications; an
        unsubscribed observer isn't "active" to the query client;
      - `useFocusEffect` runs its callback inside the navigation focus listener, before the
        re-render that re-subscribes the observers, so `queryClient.refetchQueries({ type: 'active'
        })` at that moment would refetch nothing;
      - `useFocusEffect` re-runs whenever its callback's identity changes while focused, and
        react-query hands back a new result object every render.
    - **App focus:** `focusManager.subscribe` calls its listener with `focused` on every change, in
      both directions. An interval stops while the app is in the background (focusManager,
      _layout.jsx:128-131). `refetchOnWindowFocus` is off app-wide (_layout.jsx:116-122).
    - **Cache clear:** `QueryCache.clear()` removes queries without notifying observers.
    - **Navigation:** in react-router 6.30.3, `useNavigate` reads the location, so a component that
      calls it re-renders on every navigation.
16. **What a lead meets on the campaign Home and elsewhere that only an admin can act on.**
    - **Billing hint.** "Not billing yet — setup is free until the first knock"
      (DashboardPage.jsx:420-425), shown only while the campaign has no knocks (:353-354).
    - **Archive reminder.** The after-Election-Day `ArchiveNudge` (:554).
      - For a lead it has no `onArchive`, so its button is **Go to Campaigns** (ArchiveNudge.jsx:49-52),
        to a list with no Archive item for them.
      - The Campaigns page already keeps the nudge for org admins: "they're the only ones who can act
        on it" (CampaignsPage.jsx:365-372).
    - **Archived notices.** They tell everyone to reactivate, though only org admins can, in four
      places:
      - web: DashboardPage.jsx:516-521 and MapPage.jsx:1960 (`readOnlyReason`);
      - phone: the shared `ArchivedCampaignBanner` (ArchivedCampaignBanner.jsx:25, on 11 admin
        screens), and the campaign screen's own copy ([campaignId].jsx:516-522).

      The banner's comment asks for the same sentence wherever you meet it (:22-23). The
      duplicate-surveys line (duplicate-surveys.jsx:309) shows only to admins and stays.
    - **Setup checklist.** The "Canvassers assigned" step warns "No canvassers in this org yet" with
      **add on Users →** (server setupSteps.js:86-87, SetupProgress.jsx:157-167). `/users` sits behind
      the orgAdmin RoleGate (App.jsx:203-205), so a lead gets "Admin access required". A lead can add
      people on the campaign Team page.
    - **RoleGate hint.** The `orgAdmin` hint, which only leads ever see, says "Team leads work from
      Campaigns" (RoleGate.jsx:24).
17. **The phone's By pass section checks `error` before its data** ([campaignId].jsx:676-688). A
    failed refetch with rows already loaded swaps them for "Couldn't load passes — …". With data but
    no rows it says "No passes yet." (:689). Activity and Survey results keep their data on error.
18. **The canvasser drill's target screen** (canvasser/[id]/index.jsx:76-93) sets its range only in
    its `useState` initializer and a `[tz]` effect, and as a hidden tab doesn't remount per canvasser.
    This is the same class of bug as item 9. It is noted, and out of scope.
19. **The collapsed web sidebar hides ‹ Campaigns and the campaign box.** Both sit inside
    `!collapsed &&` (Layout.jsx:267). The collapsed setting is saved per browser, not per user
    (`localStorage 'sidebarCollapsed'`, :181-191). Rail items use `RailTip` and an `aria-label`
    (:36-58). The Campaigns icon is `navIcon('/campaigns')` (IconFlag, navIcons.jsx:395).

## B. The rule

A lead's **home campaign** in an organization is the one campaign they hold a grant for there that is
**active** (`isActive !== false`) and **not being deleted** (`deletion.requestedAt` null), when there
is exactly one such campaign. Otherwise they have none. Admins and super admins never have one.

It is written in two places, with the same cases tested on both sides and a server test that checks
they agree (§H):

- **Server** (§C), for the web console. The web needs the answer *synchronously at sign-in*, before
  any campaign list has been fetched, because every landing in §A.1 is a synchronous path computation.
  A redirecting `/home` route would flash the wrong sidebar and make Forbidden's label wait on a
  fetch.
- **Phone** (§E.6), over the lead's `/admin/campaigns` list.
  - The Overview needs that fresh list anyway to draw the campaign, and the list *is* the server's
    predicate already applied (§A.4). So filtering it to `isActive !== false` and counting gives the
    same answer.
  - The phone's cached copy of the server field is refreshed only at sign-in, on app open or return
    (at most once a minute), and after a profile or password save (§A.14). It could name a campaign
    the list no longer has, so it would still need the list to check it.

## C. Server: `homeCampaignId` on lead memberships

In `loadMembershipsForUser` ([auth.js:50-88](../server/src/routes/auth.js)), with `Campaign` (from
`../models/Campaign.js`) and `NOT_DELETING` (from `../services/campaigns/deletionState.js`) imported.
Inside the existing "has a lead membership" branch, after the grant query:

```js
// campaign id → its org, for the granted campaigns that are live (strings throughout)
const live = grants.length
  ? await Campaign.find({
      _id: { $in: grants.map((g) => g.campaignId) },
      isActive: { $ne: false },
      ...NOT_DELETING,
    })
      .select('organizationId')
      .lean()
  : [];
liveOrgOf = new Map(live.map((c) => [String(c._id), String(c.organizationId)]));
```

`liveOrgOf` is declared beside `grantsByOrg` (:62), as an empty `Map`, so it exists for the return
map. In the `active.map` return (:72-87), every `lead` row carries, beside `managedCampaignIds`, a key
that is **always present**:

```js
const orgKey = String(m.organizationId._id);
const liveIds = (grantsByOrg.get(orgKey) || []).filter((id) => liveOrgOf.get(id) === orgKey);
// …
homeCampaignId: liveIds.length === 1 ? liveIds[0] : null,
```

- This states the campaign list's own filter directly: granted in this org, and the campaign lives
  in this org. Grants are unique on `{campaignId, userId}` (CampaignManager.js:34), so there are no
  duplicates.
- Strings throughout. `lean()` returns ObjectIds, and `===` between ObjectIds is always false, which
  would quietly make every value `null`.
- `isActive: { $ne: false }` mirrors the phone's `!== false` (§A.4). `NOT_DELETING` matches a missing
  or null `deletion.requestedAt`.
- One `_id` lookup, only for users with a lead membership, on the four auth routes. No new index.
- Additive. Admin and canvasser rows don't get the key, matching how `managedCampaignIds` is shipped.

## D. Web

New helpers and components are arrow functions; existing `function` declarations are converted only
where they are being edited anyway. All styling uses the existing semantic tokens.

1. **[homePath.js](../client/src/lib/homePath.js)**
   - `consoleHomePath({ isSuperAdmin, role, hasActiveOrg, homeCampaignId })`: super admins
     unchanged; `role === 'lead'` with a `homeCampaignId` → `/campaigns/${homeCampaignId}`; otherwise
     `homePathForRole(role)`.
   - `homePathForRole` is unchanged. It stays the role-level home.
   - `resolveHomePath`: both returns that today call `homePathForRole(x.role)` (:52, :54) become
     `consoleHomePath({ role: x.role, homeCampaignId: x.homeCampaignId })`, for the active
     membership and for the only console membership.
   - New `isConsoleHomePath(path)`: true for `/admin`, `/campaigns`, and `/campaigns/<id>` with
     nothing after the id. False for anything else, including non-strings.
   - New `homeLinkLabel(path)`, total over any input:

     | Path | Label |
     |---|---|
     | `/campaigns` | Go to Campaigns |
     | `/campaigns/<id>` | Go to your campaign |
     | `/super-admin` | Go to Control Room |
     | `/select-org` | Choose an organization |
     | anything else, `undefined` included | Go to Overview (today's fallback) |
2. **[AuthContext.jsx](../client/src/auth/AuthContext.jsx)**. It exports `AuthProvider` (:14),
   `useAuth` (:202) and `useOrgTimeZone` (:210) today.
   - `homePath` passes `activeMembership?.homeCampaignId`. The comment block at :151-160 is updated.
   - **Cache clears.** `login()` and `logout()` call `queryClient.clear()` (`useQueryClient()`; the
     provider sits inside `QueryClientProvider`, main.jsx:29-31).
   - **`switchOrg(orgId)` resets the org-scoped cache when the org actually changes**: `if (orgId !==
     activeOrgId) qc.removeQueries({ predicate })`. The predicate keeps the platform org list
     (`['super-admin','organizations']`), as OrgSwitcher's does today (:44-48).
     - Every caller in §A.7 then gets the reset, so none can forget it.
     - This includes SelectOrgPage. Without it, a lead arriving with another org's list cached would
       resolve their home campaign against the wrong list and land on "Campaign not found".
   - **`useSignOut()`.** A new hook exported beside `useAuth`. It returns
     `() => { logout(); navigate('/login', { replace: true }); }` and is the one way a button signs
     you out.
     - It's a hook rather than a context value because `useNavigate()` inside the provider would
       re-render it, and every `useAuth()` consumer, on every navigation (§A.15).
3. **Sign out buttons** call the function from `useSignOut()`:
   - [AccountMenu.jsx:161-164](../client/src/components/AccountMenu.jsx);
   - [BottomNav.jsx:223-227](../client/src/components/BottomNav.jsx);
   - [ProfilePage.jsx:191](../client/src/pages/ProfilePage.jsx);
   - [Forbidden.jsx:56-59](../client/src/components/Forbidden.jsx) and
     [SelectOrgPage.jsx:204-207](../client/src/pages/SelectOrgPage.jsx), which already behave this
     way and switch so the five can't drift.

   `logout()` and `navigate()` land as one render (§A.7), so `ProtectedRoute` never stashes a `from`.
   ResetPasswordPage keeps `logout()` plus its own navigate, because it carries `resetSuccess`.
   Sessions that end on their own are unchanged:
   - a token found dead at page load fails AuthContext's `/auth/me` check, and `ProtectedRoute` still
     stashes the page, so it is restored after sign-in;
   - a revoked session reloads to `/login` (`client.js:115-128`).
4. **[LoginPage.jsx:40](../client/src/pages/LoginPage.jsx)**:
   `const restore = from && isConsoleHomePath(dest);`, so a one-campaign lead still gets a real deep
   link back.
5. **[Forbidden.jsx](../client/src/components/Forbidden.jsx)**
   - The primary button's label is `homeLinkLabel(homePath)`. It still navigates to `homePath`.
   - The secondary **Switch organization** button is hidden when `homePath` is `/select-org`, where
     the primary button already goes to the picker.
   - [RoleGate.jsx:24](../client/src/components/RoleGate.jsx), the `orgAdmin` hint shown above it,
     becomes: *This page is part of organization administration. Team leads work inside the campaigns
     they run.*
6. **[CampaignGate.jsx](../client/src/components/campaigns/CampaignGate.jsx) `CampaignMissing`**
   - It reads the missing id with `useParams()`. The target is `homePath === \`/campaigns/${campaignId}\`
     ? '/campaigns' : homePath`, and the label is `homeLinkLabel(target)`.
     - Only a lead has a campaign home, and a lead's role home is always `/campaigns`, so no second
       context value is needed.
     - A lead whose own home is the missing campaign (grant revoked or deleted since sign-in) gets
       **Go to Campaigns**. One following an old link to some other deleted campaign gets **Go to
       your campaign**.
   - All nine callers sit under `:campaignId` routes (App.jsx:152-183). Without a param, the rule
     falls back to `homePath`.
   - Every other not-found bounce goes to `/campaigns` and stops, so there is no loop:
     CampaignSurveyPage:149, CampaignSurveyBuilderPage:156, ClientReportsPage:346,
     EarlyVotingPage:105 and CampaignTeamPage:1050.
7. **Org pickers.**
   - [SelectOrgPage.jsx](../client/src/pages/SelectOrgPage.jsx): `consoleItems` (:35-47) carries
     `homeCampaignId`; `pick` takes the item and passes it to `consoleHomePath` (:57), at both call
     sites (:73, :156).
   - [OrgSwitcher.jsx](../client/src/components/OrgSwitcher.jsx): the same in `pick` (:50-63, called
     at :117). Its non-super list items are the raw memberships (:37), so they already carry the
     field; super-admin rows have none, which is correct.
   - The local reset copies go, since `switchOrg` now does it: OrgSwitcher's `resetOrgScopedCache`
     (:44-48) and its calls (:53, :68), and SupportAccessGate's hand copy (:61-65).
     SuperAdminHomePage keeps its full `qc.clear()`.
8. **Sidebar.**
   - **Campaign box.** The `<select>` ([Layout.jsx:272-287](../client/src/components/Layout.jsx))
     moves into a new `client/src/components/campaigns/CampaignSwitcher.jsx`. Its props are
     `campaignId`, `currentSlug`, `campaigns` (Layout's `pickerCampaigns`), `currentName`
     (`currentCampaign?.name`) and `loaded`. The **‹ Campaigns** link, the wrapper and the
     `!collapsed &&` check stay in Layout. Three states:
     - **Not loaded** (`loaded = !!campaignsQ.data || campaignsQ.isError` is false): the existing
       `Skeleton` (`components/ui`) as `mt-1 h-[34px] w-full`, the select's height. Not the word
       "Campaign": the cache is cleared at every sign-in (§D.2), so this is what a lead sees first.
     - **Loaded, somewhere else to go**
       (`campaigns.some((c) => String(c._id) !== String(campaignId))`): the `<select>`, as today,
       with `aria-label="Switch campaign"` added. `loaded` is tested on `data`, not `isSuccess`, which
       a failed background refetch turns false. The "somewhere else" test keeps today's escape when
       the current campaign is missing from a list with one other campaign.
     - **Loaded, nowhere else to go** (or the list failed): the name as plain text, with no visible
       box, so it doesn't read as a disabled input. Classes: `mt-1 truncate border border-transparent
       px-2 py-1.5 text-sm font-semibold text-fg`, the transparent border keeping the select's
       height. `title` holds the full name; the text is `currentName || 'Campaign'`, plus today's
       ` · Archived` suffix when archived.
     - Navigation on change is unchanged. It keeps the current page's whole path, so on a page with
       its own id (a walk list's passes, a voter, a report) switching carries that id into the other
       campaign, as it does today. Not in scope. BottomNav has no campaign switcher.
   - **Collapsed rail.** When `collapsed` and in a campaign, the campaign nav starts with one more
     rail item: a `NavLink` to `/campaigns` with `navIcon('/campaigns')`, `RailTip` "All campaigns"
     and `aria-label="All campaigns"`, in the same classes as the other rail items. Before, a
     collapsed sidebar had no way to the list, and a one-campaign lead now starts inside a campaign
     (§A.19).
9. **Comments only**: [useAuthCta.js:4](../client/src/marketing/useAuthCta.js) ("/campaigns for a
   lead") and the `ROLE_HOME` comment in homePath.js.
10. **No change** to ChangePasswordPage. `routeOnward` already calls `resolveHomePath` with the
    change-password response's memberships, which carry the field. Its effect's `homePath` dependency
    is a string, so membership refreshes don't re-fire it.
11. **What a lead meets that only an admin can act on (§A.16)**
    - **[DashboardPage.jsx](../client/src/pages/DashboardPage.jsx)** (add `useAuth` to the import at
      :25):
      - the billing hint (:420-425) and the `ArchiveNudge` (:554) render only when `isOrgAdmin`, the
        Campaigns page's rule. `isOrgAdmin` is true for super admins;
      - the archived notice (:516-521) becomes, for everyone: *This campaign is archived — data is
        read-only. An org admin can reactivate it from Campaigns.*
    - **[MapPage.jsx:1960](../client/src/pages/MapPage.jsx)**: `readOnlyReason` becomes *This
      campaign is archived — an org admin can reactivate it to mark doors.*
    - **[SetupProgress.jsx](../client/src/components/SetupProgress.jsx) (:157-167)**: for a viewer who
      isn't an org admin (`useAuth().isOrgAdmin` false), a warn link whose `warnRoute` is `/users`
      goes to `/campaigns/${campaignId}/team` with the same `?return=`, labelled **add on Team →**.
      Admins keep **add on Users →**. The server's step list is unchanged.

## E. Phone

New modules, hooks and components are arrow functions. That covers the decider, `ArchivedGroup`,
`AdminHeaderRow`, `CampaignHome`'s outer component and the route wrapper. Moved bodies keep their
inner `function` declarations untouched.

**Anything a unit test imports stays free of npm packages.** CI runs `npm run test:mobile` with no
mobile install, and its comment says a React or React Native import in any module a test loads fails
the step (`.github/workflows/tests.yml:60-64`). So each new hook keeps its testable rule in a plain
module, the `restrictBooks.js` / `restrictBooksConfirm.js` split.

1. **Move the campaign screen's body into `mobile/components/CampaignHome.jsx`** (beside the other
   shared components, outside `app/` so it isn't a route), as
   `CampaignHome({ campaignId, embedded = false, caption = null, footer = null })`, default export.
   - The route file becomes a short wrapper: read `campaignId` from the params, render
     `<CampaignHome key={cId} campaignId={cId} />`. The **`key` fixes §A.9's carry-over bug**.
   - Nothing imports the route file. The comment at `answer-voters.jsx:206` that points at it is
     updated.
   - **What changes in the moved code; everything else moves verbatim:**
     - import paths, and the param becomes a prop;
     - the stale remount comments at :103-107 and :112 are corrected;
     - the header (item 2), freshness and the midnight rule (item 3);
     - `campaignsQ` gains `staleTime: 30_000`;
     - **By pass on a failed refresh** (:676-725):
       - the error row shows only when there's nothing to show: `roundsQ.error && rounds.length ===
         0`;
       - with rows, they stay. When `roundsQ.error || rollupQ.error`, the footer reads *Each row is
         one walk-list pass. Couldn't refresh just now, so these may be behind the numbers above.*
         Otherwise it reads as today: *Each row is one walk-list pass. Passes add up to the
         {rangeKnocks} above — a home knocked again in a later pass counts again.*
       - That keeps both of the screen's promises: never an authoritative zero (:683-684), and never
         a false "adds up". Activity and Survey results already keep their data on error.
     - **The archived banner** (:516-522) and the shared
       [ArchivedCampaignBanner.jsx:25](../mobile/components/ArchivedCampaignBanner.jsx) both read:
       *This campaign is archived — data is read-only. An org admin can reactivate it from Campaigns
       on the web.* One sentence for every role, so all twelve phone screens agree, as the banner's
       comment asks.
     - the campaign name (both modes) gets `accessibilityRole="header"`;
     - `footer` renders inside the padded content `View`, between Quick actions (closing :922) and
       **Switch to canvass mode** (:924-928), in a wrapper with `marginBottom: spacing.lg`. The
       full-width canvass button stays the page's last action.
2. **Header and caption.**
   - The Overview's header row (logo left, caption right; `header` and `headerLabel` in
     admin/index.jsx makeStyles, :393-401) becomes a small shared
     `mobile/components/AdminHeaderRow.jsx`. It has a `caption` prop (no caption → logo only), and
     needs `import Logo from './Logo'` and a module-level `makeStyles` for `useThemedStyles`.
     `type.caption` and `textSecondary` exist in both palettes.
   - It's used by `OrgOverview`, the decider's undecided view, and `CampaignHome` when embedded.
   - Pushed: unchanged, **‹ Overview** and the name.
   - Embedded: `<AdminHeaderRow caption={caption} />` renders **above** the screen's `header` View.
     Both pad `spacing.lg`, so nesting would double the inset. The `header` View then holds only the
     name, in its existing `headerTitle` style (:954). No back link, because there is nowhere to go
     back to.
   - The not-found branch (:487-500) drops its back link when embedded too.
3. **Keeping it fresh** (§A.10-A.12).
   - **The five report queries are one group**: overview (Coverage), rollup, knocks-by-pass,
     canvassers and survey results.
     - They gain `...useFocusedPoll()` (import from `../lib/useFocusedPoll`), so they stop notifying
       while covered.
     - They're refreshed together by a new hook, `useRefreshGroup(results, { maxAgeMs: 30_000,
       pollMs })` in `mobile/lib/useRefreshGroup.js`, sketched below.
     - The hook's rules live in a plain module, `mobile/lib/refreshGroup.js` (no imports).

     ```js
     // mobile/lib/refreshGroup.js — no imports, unit-tested
     // A section whose fetch keeps failing counts as fresh from its last attempt, so it can't
     // keep the whole group "stale" (a failed refetch leaves dataUpdatedAt unchanged).
     export const groupNeedsRefresh = (results, maxAgeMs, now) =>
       results.some((r) => r.isEnabled !== false &&
         now - Math.max(r.dataUpdatedAt || 0, r.errorUpdatedAt || 0) > maxAgeMs);
     // refetch() ignores `enabled` and, by default, cancels a fetch in flight.
     export const refetchEnabled = (results) =>
       Promise.all(results.filter((r) => r.isEnabled !== false)
         .map((r) => r.refetch({ cancelRefetch: false })));

     // mobile/lib/useRefreshGroup.js
     export const useRefreshGroup = (results, { maxAgeMs, pollMs }) => {
       const ref = useRef(results);
       useEffect(() => { ref.current = results; }); // committed results, never written in render
       useFocusEffect(useCallback(() => {           // stable: runs on focus, not every render
         const refreshIfStale = () => {
           if (groupNeedsRefresh(ref.current, maxAgeMs, Date.now())) refetchEnabled(ref.current);
         };
         refreshIfStale();
         const unsub = focusManager.subscribe((focused) => { if (focused) refreshIfStale(); });
         const id = pollMs
           ? setInterval(() => { if (focusManager.isFocused()) refetchEnabled(ref.current); }, pollMs)
           : null;
         return () => { unsub(); if (id) clearInterval(id); };
       }, [maxAgeMs, pollMs]));
     };
     ```

   - **Why it's built this way** (each line answers a round's finding, §N):
     - **One timer** for the group; per-query intervals drift apart (§A.11).
     - **Ticks refetch unconditionally.** A tick gated on a 30 s age would skip every other tick,
       halving the rate.
     - **The focus run and the return-from-background run are gated** on staleness.
     - **The ref is fed from an effect** declared before `useFocusEffect` (passive effects run in
       declaration order), and the callback is stable. A callback keyed on the results re-ran on
       every render; round 3 measured 44 fetches in 3 s for one offline query.
     - **`focusManager` is the instance `_layout.jsx:128-131` drives.** Navigation focus doesn't fire
       when the app comes back from the background.
     - **Not `queryClient.refetchQueries`**, which would miss the not-yet-resubscribed observers on
       focus (§A.15).
   - **Embedded:** `pollMs: 30_000`, the web Home's rate. **Pushed:** no `pollMs`. It refreshes on
     return and on coming back to the app; nothing polls in the background.
   - **The lookups** (campaigns, efforts, assignments) keep today's behaviour, plus
     `campaignsQ.staleTime: 30_000`, so the embedded home doesn't refetch the list the decider just
     fetched.
   - **Pull-to-refresh in both modes**, through `useRefresh`, over every enabled query: the five
     above and the three lookups. Survey results join only on a survey campaign. The campaigns lookup
     shares its key with the decider's query, so pulling the embedded home re-decides it with one
     request.
   - **Midnight.**
     - The plain module [dateRanges.js](../mobile/lib/dateRanges.js) (no imports) gains an injectable
       clock, `todayInTz(tz, now = new Date())` (the default keeps every caller unchanged), and
       `effectiveRange(range, today)`. For preset `today` it returns `{ ...range, from: today }`;
       otherwise the range unchanged.
     - A new `useTodayInTz(tz)` hook (`mobile/lib/useTodayInTz.js`) returns `todayInTz(tz)` computed
       at render, so a time-zone change (device zone → campaign zone, :67) applies at once. Its 60 s
       `setInterval` calls `setSeen(todayInTz(tz))` on a `useState`. React skips the re-render when
       the string is unchanged, and re-renders at the day change. The interval is cleared on unmount
       and restarted when `tz` changes.
     - **Wiring, in both `CampaignHome` and `OrgOverview`:** the range state is renamed
       `const [pickedRange, setRange] = useState(…)`. Directly below `tz` comes
       `const range = effectiveRange(pickedRange, useTodayInTz(tz));`.
       - Every existing reader of `range` then gets the effective range with no edits:
         - `rangeParams` and the four range keys;
         - the three drill hand-offs (`goVoters` :399-400, `goTagVoters` :419-420, the canvasser
           drill :776-778), so a drill still sums to the count tapped;
         - FilterBar and the Activity label;
         - in the Overview, its key, params, seam check and DateRangeBar.
       - The setters (`onRangeChange` and the tz-refine effects) only write, so they're unaffected.
         FilterBar and DateRangeBar read only `preset`, plus `from`/`to` for a custom range, and never
         spread the value.
     - **Known and out of scope:** the canvasser drill's target screen doesn't remount per canvasser
       (§A.18), so a second drill into a different canvasser keeps the first drill's dates.
   - Every new hook sits above the screen's not-found early return (:487).
4. **Overview ([admin/index.jsx](../mobile/app/(app)/admin/index.jsx)) is split in two**, so no early
   return can change the hook order.
   - **`AdminOverview` (the tab's default export) is a thin decider.**
     - **Role.** `const role = useConsoleRole()` (§A.14), the same once-per-mount read the admin tab
       gate uses. Every org switch and sign-out unmounts the admin tabs, so it can't go stale across
       organizations.
     - **Caption.** `{ lead: 'Team Lead', admin: 'Admin', super: 'Admin · super' }[role]`.
       - **Team Lead** is what `useConsoleRoleLabel` already shows in the back link of seven admin
         screens (useConsoleRole.js:14).
       - **Admin · super** is today's Overview text (:233).
     - **List.** `['admin','campaigns']` with `enabled: role === 'lead'`, never a bare flag: an
       undefined `enabled` counts as on, so it would fetch before the role is read. It also spreads
       `useFocusedPoll()`, so the decision catches up on return in either direction.
     - **The choice comes from a plain function, `overviewChoice({ role, campaigns, listLoading })`,**
       in campaignSelection.js. It returns:
       - `null` (undecided) while the role isn't read yet;
       - `'org'` for anyone who isn't a lead, even with a one-campaign list in the cache (a disabled
         query still returns cached data, and admins fill that cache from other screens);
       - for a lead with list data, a decision from the data whatever the error flags say:
         `'sole:<id>'` when `soleActiveCampaign` finds one, otherwise `'org'`;
       - for a lead without data, `null` while the list is loading, otherwise `'org'`.

       Called with `campaigns: campaignsQ.data?.campaigns` and `listLoading: campaignsQ.isLoading`.
     - **Last decision.** It's kept in state (`if (choice && choice !== last) setLast(choice)` during
       render; React re-runs the render once, with no warning for a component updating itself), and
       the screen shows `choice ?? last`. So "undecided" happens only before the first decision.
       Coming back after the list has aged out of the cache (30 min) doesn't unmount `OrgOverview` or
       reset its range and Archived toggle.
   - **What it renders:**
     - **Undecided:** `AdminHeaderRow` (with the caption once the role is known) and a spinner where
       the content starts, so nothing jumps. A lead never sees org totals flash first; an admin sees
       this only for the moment the role is read from the device.
     - **`'sole:<id>'`:** `<CampaignHome key={id} campaignId={id} embedded caption={caption}
       footer={hasArchived ? <ArchivedGroup /> : null} />` as the screen's root. `hasArchived` is
       `campaignsQ.data?.campaigns?.some(isArchivedCampaign)`. The embedded home gets no
       `extraRefetch`, because its own pull already refreshes the shared list key.
     - **`'org'`:** `<OrgOverview caption={caption} extraRefetch={role === 'lead' ? campaignsQ.refetch
       : null} />`.
   - **`OrgOverview` is today's body, moved into a function in the same file**, with these changes:
     - a `caption` prop, rendered through `AdminHeaderRow`, replaces its own `loadCurrentUser()`
       caption;
     - an `extraRefetch` prop joins its pull, so pulling a lead's list can also turn it into the
       embedded home;
     - the midnight wiring from item 3;
     - `<ArchivedGroup />` in place of its inline block (item 5).

     Because `OrgOverview` doesn't mount when embedded, its org-totals poll doesn't run behind the
     embedded home.
   - **Known and accepted:**
     - on a weak signal, the embedded home starts one round trip later than the pushed screen,
       because it waits for the list;
     - with no network and no cached list, the lead gets `OrgOverview`'s error rows until a pull or a
       return to the tab;
     - if a grant is revoked while the lead watches, the polled sections show their load errors until
       the lead leaves and returns, when the decision re-runs;
     - a role change while the admin tabs stay mounted shows up at the next sign-in, org switch or app
       restart, as for the admin tab gate itself.
5. **`ArchivedGroup` owns its toggle and query**: today's block (:146-150, :350-375) moved into a
   component in the same file. It holds `useState(false)` and the `['admin','reports',
   'campaign-rollup','archived']` query, enabled while open.
   - `OrgOverview`'s pull still refreshes it when open, through
     `() => qc.refetchQueries({ queryKey: ARCHIVED_KEY, type: 'active' })` (with `useQueryClient`).
     - That matches today's `archivedOpen ? archivedQ.refetch : null`: a closed group's query is
       disabled, so it's skipped.
     - It's safe here because the archived query isn't focus-gated, and a pull only happens while the
       screen is focused.
   - The embedded pull leaves the footer alone: it is all-time historical data. The footer resets per
     campaign through `key={id}`.
   - Its visibility test (`isActive === false` in the lead's list) matches what
     `campaign-rollup?scope=archived` returns for a lead.
   - Its rows push the pushed campaign screen, whose **‹ Overview** returns to the embedded home
     (`backBehavior="history"`, confirmed in round 1).
6. **[campaignSelection.js](../mobile/lib/campaignSelection.js)** (plain, no imports) gains:
   - `soleActiveCampaign(campaigns)`: the single campaign with `isActive !== false`, else `null`, and
     `null` for anything that isn't an array;
   - `overviewChoice({ role, campaigns, listLoading })`, as in item 4.
7. **Phone sign-in clears the query cache.** In [app/login.jsx](../mobile/app/login.jsx):
   - `import { useQueryClient } from '@tanstack/react-query';`;
   - `const qc = useQueryClient();` goes with the other hooks (:33-39), **above the early return at
     :41**;
   - `qc.clear()` runs in `onSubmit` after the `/auth/login` response and before `signIn` (:64), the
     pattern admin/more.jsx:89 already uses.

   A hook call inside `onSubmit`, or one placed below :41, would break every sign-in, and a missing
   import would crash the screen. Neither the bundle nor the unit tests catch those, so the placement
   is part of the spec, and the staging sign-in (§H) covers it.
   - **Why:** most sign-outs already clear, but the exits in §A.14 don't. Without this, the previous
     user's `['admin','campaigns']` could decide the next user's home on the same phone.
   - **What it clears:** react-query only, including UpdateGate's `['build-status']`, which fails open
     and refetches as it already does after a sign-out clear. The stored identity, the offline knock
     queue and the bootstrap file aren't react-query. `flushQueue` runs after `signIn`, and `(app)`'s
     `refreshSession` only mounts after it.
8. **No change** to `app/index.jsx`, the admin `_layout.jsx`, `CampaignChip`, or `CanvasserDrawer`.
   Its **Admin dashboard** row already replaces to the Overview tab, so it gets the new home for free.

## F. Design

Web, a one-campaign lead right after signing in:

```
┌ Sidebar ─────────────────┐  ┌ Main ─────────────────────────────────┐
│ Doorline                 │  │ Springfield Council 2026              │
│ Fox Bryant ▾             │  │ Survey · TX                           │
│ ‹ Campaigns              │  │ (no billing note for a lead)          │
│ Springfield Council 2026 │  │ (the campaign Home, otherwise as      │
│   (plain text: no box,   │  │  today)                               │
│    no ▾)                 │  │                                       │
│ Home                     │  │                                       │
│ SETUP  Survey · Import … │  │                                       │
│ FIELD  Team · Timeline … │  │                                       │
└──────────────────────────┘  └───────────────────────────────────────┘
```

- While the campaign list loads, the plain-text line is a grey placeholder bar of the same height.
- With the sidebar collapsed to icons, the first icon is **Campaigns** (tooltip "All campaigns").
- A page a lead can't open (for example `/surveys`) shows **Admin access required**, then *This page
  is part of organization administration. Team leads work inside the campaigns they run.*, then
  **[Go to your campaign]** · Sign out.

Phone, a one-campaign lead's Overview tab:

```
┌───────────────────────────────────┐
│ Doorline                Team Lead │  ← AdminHeaderRow, caption by role
│ Springfield Council 2026          │  ← campaign name (a heading), two lines max
│ [Election Day in 26 days]         │
│ Goal ▓▓▓▓░░░░ 42%  4,200 / 10,000 │
│ [Today ▾] [Walk list ▾] [Crew ▾]  │
│ … the campaign screen as today …  │
│ QUICK ACTIONS  (tiles)            │
│ ARCHIVED   (only if there is one) │
│ Show archived campaigns           │
│ [   Switch to canvass mode    ]   │
└───────────────────────────────────┘
  Overview  Timeline  Map  Books  More
```

The tab keeps the name **Overview**: renaming it would change the admin tab layout and every
"‹ Overview" back link, and a lead's overview of their one campaign is a fair reading.

## G. Edge cases

| Case | Web | Phone |
|---|---|---|
| One active campaign and one being deleted | The active one | The active one (deleting rows aren't in `campaigns`) |
| Second campaign granted while signed in | Stays on the first. The box becomes a dropdown once the shared list refetches (a reload, or a campaign page opened after 60 s). The next sign-in lands on the list | Overview turns into the list when you next come back after 30 s or more, or pull |
| One of two campaigns archived while signed in | List until the next sign-in | Overview turns into the embedded home when you next come back after 30 s or more, or pull |
| Home campaign archived while signed in | Still in the lead's list, so it opens read-only with the archived notice; next sign-in → the list | Overview turns back into the list |
| Grant revoked or campaign deleted while signed in | "Campaign not found" → **Go to Campaigns** (§D.6) | Section errors until you leave and return; then the list |
| A one-campaign lead opens an old link to some other deleted campaign | "Campaign not found" → **Go to your campaign** (§D.6) | n/a |
| A never-knocked campaign past Election Day | A lead sees neither the billing note nor the archive reminder (§D.11); an admin sees each when it applies | n/a (the phone shows neither today) |
| A new campaign in an org with no canvassers | A lead's setup link reads **add on Team →**; an admin's **add on Users →** | n/a |
| Sidebar collapsed to icons | The first rail icon opens Campaigns | n/a |
| Lead in two organizations | Decided per organization | Decided per organization |
| A lead who is also a super admin | Super admin wins | Super admin wins (role `'super'`) |
| An admin with one active campaign | Org Overview, as today; inside the campaign the box is plain text | Org Overview, as today, even with the list cached by another screen (§E.4) |
| Signed out, then followed a deep link | Restored after sign-in (§D.4) | n/a |
| Signed out with a Sign out button | Plain sign-in, nothing remembered, cache cleared (§D.2-D.3) | Most Sign out buttons already clear; every sign-in clears too (§E.7) |
| Lead in canvass mode taps **Admin dashboard** | n/a | The embedded home |
| Opens an archived campaign from the embedded home, then a tile | n/a | The tile seats the archived campaign, so Timeline/Map/Books open on it, named on the chip, with the same archived sentence (today's behaviour, §A.13) |
| Screen left open past midnight on **Today** | n/a (web unchanged) | Rolls to the new day within a minute, or at once on return (§E.3) |
| App backgrounded, then reopened | n/a | Stale sections refresh on return (§E.3) |
| Weak signal while polling | n/a | Sections keep their last numbers; By pass says it couldn't refresh (§E.1) |
| Promoted from lead to admin, or the reverse | Next sign-in | Next sign-in, org switch or app restart (§E.4) |

## H. Tests and verification

**Server.** A new `server/test/leadHomeCampaign.int.test.js`, one `before()`, over the real app and a
throwaway mongod.
- **Setup.** Sign in with `User.hashPassword` (hash once, reuse), via `POST /api/auth/login`, as
  `multiOrgRoles.int.test.js` does. The login limiter counts failures only.
- **Cases.** Each one checks `homeCampaignId` on both `/api/auth/login` and `GET /api/auth/me`:
  - one active grant → its id;
  - one active + one archived → the active id;
  - two active → `null`;
  - no grants → `null` (key present);
  - only archived → `null`;
  - one active + one mid-delete → the active id;
  - a lead in two orgs (one campaign in A, two in B) → A's id and `null`;
  - a grant pointing at another org's campaign → ignored. The grant is on a campaign the lead holds no
    other grant for, set up so that counting by the campaign's org would change the answer.
  - a user who is admin in one org and lead in another → the admin row has no key, the lead row does.
- **Agreement check.** For every lead fixture, `GET /api/admin/campaigns` with `X-Org-Id`. Assert
  that the single `isActive !== false` row equals `homeCampaignId`, or that there isn't exactly one
  and it's `null`. This guards §B directly.
- **Re-run the suites that assert auth responses**, in one call from the repo root:

  ```
  npm --prefix server run test:int -- test/leadHomeCampaign.int.test.js test/multiOrgRoles.int.test.js test/orgDeleteJob.int.test.js test/leadWalkthrough.int.test.js test/sessionInvalidation.int.test.js test/accountDeletion.int.test.js test/mailFlow.int.test.js
  ```

**Web**
- **Unit tests** ([homePath.test.js](../client/src/lib/homePath.test.js)):
  - a lead with a home → `/campaigns/<id>`; without one → `/campaigns`;
  - an admin with a stray `homeCampaignId` → `/admin`; a super admin ignores it;
  - `resolveHomePath` with the active membership and with the only console org;
  - `isConsoleHomePath`: true for the three homes; false for `/campaigns/x/map`, `/select-org`,
    `/change-password`, `/super-admin` and `undefined`;
  - `homeLinkLabel`: every row of its table, plus `undefined`.
- **Render tests** in a new `client/src/lib/landingRender.smoke.test.js` (the `*.smoke.test.js`
  recipe: `renderToString`, no backticks in the generated entry). It builds its own entry, because
  the existing template only reaches `../pages/`. Its auth stub exports `useAuth` and `useSignOut`,
  since esbuild fails on a missing named import. It covers:
  - `CampaignMissing`, mounted under `<Route path="/campaigns/:campaignId">` in a `MemoryRouter`:
    - `homePath` is that campaign → links to `/campaigns`, "Go to Campaigns";
    - `homePath` is another campaign → links to it, "Go to your campaign";
  - `Forbidden`, with a stub of two console memberships and `isSuperAdmin: false`:
    - "Go to your campaign" at `homePath` `/campaigns/<id>`, with **Switch organization** present;
    - **Switch organization** absent at `homePath` `/select-org`;
  - `CampaignSwitcher`:
    - a skeleton before the list loads;
    - plain text with one campaign, with ` · Archived` when archived, and with `'Campaign'` when the
      list failed and the current campaign isn't in it;
    - a `<select>` with `aria-label="Switch campaign"` with two;
    - a `<select>` when the current id is missing and one other exists.
- No existing smoke-tested page imports Forbidden, CampaignSwitcher or a Sign out component
  (checked), so no existing stub changes.
- `npm --prefix client test` and `npm --prefix client run build`.

**Phone**
- **Unit tests**, run with `npm run test:mobile` from the repo root. **They import only plain
  modules with no imports** (§E's rule; CI installs nothing for mobile).
  - [campaignSelection.test.js](../mobile/lib/campaignSelection.test.js):
    - `soleActiveCampaign`: cases mirroring the server's;
    - `overviewChoice`:
      - an admin with a cached one-campaign list → `'org'` (the round-3 trap);
      - a lead with data and a failed refetch → decided from the data;
      - a lead whose list is loading → `null`;
      - a lead with an error and no data → `'org'`;
      - an unread role → `null`.
  - A new `mobile/lib/refreshGroup.test.js`:
    - `groupNeedsRefresh`: all fresh → false; one older than the limit → true; a disabled one
      ignored; a query that just failed (recent `errorUpdatedAt`, old `dataUpdatedAt`) → not stale; a
      first mount (both times 0) → true;
    - `refetchEnabled`: skips disabled results, and passes `{ cancelRefetch: false }` to the rest.
  - A new `mobile/lib/dateRanges.test.js`:
    - `todayInTz` with an injected clock: the day flips at the zone's midnight, not the device's, and
      two zones on either side of midnight give two different days;
    - `effectiveRange`: `today` pinned to the given day; every other preset and a custom range
      returned unchanged.
- **Metro bundle**, so a broken import fails before any OTA. Nothing is published:
  `cd mobile && npx expo export --platform ios --output-dir <session scratchpad>/expo-ios`, then the
  same with `android`. It doesn't catch hook placement or an undeclared name; the staging sign-in
  does (owner check 1).

**Mobile API.** `npm run audit:mobile-api` from the repo root, **before the commit** (it reads
uncommitted changes). It will flag `auth.js`; the diff only adds a field.

**Owner checks, web, after deploy**, with a test lead. Use a fresh private window first.
1. **One campaign, signing in:**
   - lands in it;
   - the sidebar shows the campaign's name as plain text, after a grey bar for a moment;
   - **‹ Campaigns** shows the list with Edit;
   - collapse the sidebar → the first icon opens Campaigns.
2. **A page the lead can't open:** type `/surveys` → *Team leads work inside the campaigns they run*
   and **Go to your campaign**.
3. **A second campaign:** grant one, reload → still on the campaign, now with a dropdown. Sign out
   and in → the list.
4. **A lead in two organizations** (one campaign in org A, two in B):
   - sign in → the picker;
   - A → its campaign; switch to B → the list; back to A → the campaign;
   - also through a forbidden page's **Switch organization**.
5. **Shared computer:** sign out, then sign in as your own account → your usual landing (Overview or
   Control Room), not the lead's page. Open Campaigns and a campaign → no trace of the lead's
   campaigns, even for a moment.
6. **Deep link:** as the lead, from a signed-out tab, open a campaign page link → after sign-in, that
   page.
7. **Support access:** as a super admin, enter a customer org and decline the support prompt → the
   Control Room, and the org switcher keeps its list.
8. **Billing notes and archived wording** (a never-knocked campaign with Election Day in the past):
   - the lead's Home shows neither the billing note nor the archive reminder;
   - as an admin, both show;
   - archive it → Home and Map both say an org admin can reactivate it.
9. **Setup link:** a new campaign in an org with no canvassers → the lead's checklist says **add on
   Team →** and opens the Team page; an admin's says **add on Users →**.

**Owner checks, phone, on staging**
1. **A one-campaign lead** (this sign-in also proves §E.7's placement):
   - Overview is the campaign, captioned **Team Lead**;
   - its numbers change on their own while a canvasser knocks: Top canvassers reorders, and the goal
     and Coverage move together;
   - pull-to-refresh works;
   - **Archived** appears only with an archived campaign, above **Switch to canvass mode**, and its
     rows come back with **‹ Overview**;
   - an archived campaign's notice, and Timeline on it, say an org admin can reactivate it.
2. **A second campaign:** grant one → leave Overview for over 30 s and come back (or pull) → the
   list, captioned **Team Lead**. Archive one of the two → pull on Overview → the campaign.
3. **Carry-over:** open campaign A, pick a walk list, go back, open campaign B → B shows all walk
   lists.
4. **An admin in an org with exactly one active campaign:**
   - open Timeline (it has the campaign chip), then come back to Overview → the usual org Overview,
     **Admin** caption;
   - the campaign screen gains pull-to-refresh and refreshes on return.
5. **Canvass mode** → **Admin dashboard** → the campaign.
6. **Shared phone:** sign out, sign in as an admin on the same phone → the admin's Overview, nothing
   of the lead's.
7. **Weak signal:** on the embedded home, turn on airplane mode for a minute → the sections keep their
   numbers and By pass says it couldn't refresh. Turn it off → everything refreshes within 30 s.

## I. Docs and Help Center

**Docs (Part 1 and Part 2)**
- [ROLES.md](ROLES.md):
  - *Where a team lead works* (:146-160; also fix "Insights" → "Timeline" at :150);
  - org switching (:178), the landing-path section (:547-560), and the non-null `homePath` contract
    (:588-589, adding `useSignOut` as the one way to sign out and `switchOrg`'s cache reset);
  - the lead line (:619), OrgSwitcher's "role home" (:645), the route-file link (:664);
  - the console-access unit-test paragraph (:700-706, adding the home-campaign and label cases) and
    the integration list that starts at :708 (adding `leadHomeCampaign.int.test.js`);
  - the admin-only billing notes, and the setup link for leads.
- [USERS.md](USERS.md):
  - Part 1, *Signing in with mixed roles* (:37-52): signing out of the web console always lands on a
    plain sign-in page and remembers nothing;
  - Part 2, *Auth & the forced-password-change flow* (:559 on): `useSignOut`, the cache cleared on
    login and logout, and the reset in `switchOrg`.
- [CAMPAIGNS.md](CAMPAIGNS.md):
  - the switcher in Part 1 (:200-204, :212-215) and Part 2 (:1129-1138): three states, plain text
    when there's nowhere else to go, the collapsed rail's Campaigns icon;
  - the Home's billing hint and archive reminder being admin-only, and the archived sentence;
  - setup progress (:1110): the lead's **add on Team →** link;
  - its route-file citations.
- [ADMIN_APP.md](ADMIN_APP.md):
  - the Overview entries (:31, :154) and the embedded home;
  - for everyone:
    - the campaign screen's group refresh, pull-to-refresh, the midnight rule, By pass keeping its
      rows, and the fresh screen per campaign;
    - the one archived sentence;
    - the role caption;
  - the file-table rows that name `admin/campaign/[campaignId].jsx` → the component plus the wrapper.
- Other docs:
  - [METRICS.md](METRICS.md) (:1596, the `index.jsx` row, and route-file citations);
  - [DATE_FILTERS.md](DATE_FILTERS.md) (:179, :244, plus the midnight rule and `effectiveRange`);
  - [NOTES.md](NOTES.md) and [SURVEYS.md](SURVEYS.md): route-file citations;
  - [GETTING_STARTED.md](GETTING_STARTED.md) (:104, setup progress): the lead's Team link;
  - [PERFORMANCE.md](PERFORMANCE.md) (:90): the campaign screen's focus-gated group and its embedded
    30 s poll;
  - [CANVASSER_APP.md](CANVASSER_APP.md) (:92): **Admin dashboard** shows for admins *and* team
    leads. That line is already wrong today.
- Proposals keep their historical paths.

**Help Center** (Part 1 is the source). Draft wording; final copy is written at build time against
Part 1:
- [lead-getting-started.md](../server/src/content/help/getting-started/lead-getting-started.md):
  - *Your day to day* (:54-55):
    - "Sign in to the console. If you run one active campaign, you go straight to its **Home**. If you
      run more than one, or none yet, you land on **Campaigns**, showing only the campaigns you
      manage — pick one to open its tabs."
    - "**‹ Campaigns**, at the top of the sidebar, always opens the full list. That's where your
      campaign's **Edit** (name, survey, door goal) and **Assignments** are, and any archived
      campaigns. With the sidebar collapsed it's the first icon; in a narrow browser window it's
      **More → ‹ All campaigns**."
    - the phone line below.
  - Also fix the stale "insights" at :29.
- [faq/team-lead-vs-admin.md](../server/src/content/help/faq/team-lead-vs-admin.md) (:25, audience
  all): "**Where a lead lands in the console:** a lead has no organization Overview. With one active
  campaign, they open straight into it; with more than one, or none yet, on **Campaigns**.
  **‹ Campaigns** at the top of the sidebar always opens the list." The rest of :25 stays.
- [faq/why-cant-i-see-my-other-org.md](../server/src/content/help/faq/why-cant-i-see-my-other-org.md)
  (:24): "Use **Go to Overview**, **Go to Campaigns** or **Go to your campaign** (whichever you see),
  or **Switch organization**."
- [faq/campaign-not-found-after-creating.md](../server/src/content/help/faq/campaign-not-found-after-creating.md)
  (:27): "Use the button on that screen (**Go to Campaigns**, **Go to Overview** or **Go to your
  campaign**) to get back to a campaign you can open."
- [guides/roles-and-team.md](../server/src/content/help/guides/roles-and-team.md) (audience admin):
  - :30: "…Overview for an admin; for a team lead, their campaign if they run just one active
    campaign there, otherwise Campaigns."
  - :58-59: "In the console they sign in the same way you do: with one active campaign they land in
    it, otherwise on **Campaigns**… In the mobile app they get the same admin view, scoped to their
    campaigns; with one active campaign, **Overview** is that campaign's screen."
- [guides/campaigns-manage.md](../server/src/content/help/guides/campaigns-manage.md) (:142): "…open
  one and it reads normally. To get back, use **‹ Campaigns** at the top of the sidebar, or the
  switcher when you have another active campaign."
- [pages/campaign-home.md](../server/src/content/help/pages/campaign-home.md) (:12): "…the first
  screen when you open a campaign. If you're a team lead who runs just one active campaign, it's also
  where you land when you sign in."
- [faq/archive-vs-delete-campaign.md](../server/src/content/help/faq/archive-vs-delete-campaign.md)
  (:19): "On your phone, tap **Show archived campaigns** on the admin **Overview** (if you run just
  one active campaign, it's near the bottom of that campaign's screen, above **Switch to canvass
  mode**), or open the campaign chip…"
- No article describes web sign-out, the phone campaign screen's refreshing, the archived banner's
  sentence or the setup link, so nothing there becomes false and nothing is added. A recurring
  question goes to `faq/_INBOX.md`.
- A final sweep of `server/src/content/help/` for "land on Campaigns", "Go to Campaigns",
  "Go to Overview", "switcher", "Reactivate", the phone Overview, and Today.

**Timing and the phone line.**
- Help ships with the server deploy. The phone change may arrive later: after staging checks, and
  only on app builds that can take this update (not the retired `com.canvassapp.mobile` fleet).
- So the phone line uses the Help Center's "if you don't see it" pattern and the update banner's
  exact words (app-asks-to-restart.md), and stays true before and after:

  *"On your phone, the **Overview** tab works the same way: with one active campaign, it is that
  campaign's screen, and its numbers refresh on their own while you watch. Pull down to refresh them.
  If you still see a list with just your one campaign in it, your app hasn't picked up this change
  yet: when it says **A new version of Doorline is ready**, tap **Restart** (or, if it asks you to
  update from the App Store or Google Play, do that)."*
- Web lines need no condition; they ship with the deploy that makes them true.

**Index.** A [docs/README.md](README.md) row for this proposal; this file gets an **As built**
section after the build.

## J. Privacy, mobile API, version gate

- **Not privacy-affecting.** No new data is collected, kept, shown to anyone new, or sent anywhere.
  `homeCampaignId` is derived from the lead's own grants, which `/auth/me` already returns as
  `managedCampaignIds`; archived and deleting state is already in their `/admin/campaigns`.
  - **Said out loud, per CLAUDE.md: three changes reduce exposure.**
    - The web sign-out changes (§D.2-D.3) and the phone sign-in clear (§E.7): the next person on the
      same browser tab or phone no longer gets the previous person's page or a glimpse of their cached
      campaign list.
    - The campaign Home no longer shows a team lead notes about how the organization's Doorline
      subscription bills (§D.11). A lead can be the paying client. Their billable-door figures and
      exports are unchanged; only the subscription notes go.
  - [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) makes no claim about web sign-out, cached
    pages, or what the Home shows a lead. Its sign-out claims are about the phone's stored files,
    item 11 (:79-80), which is unchanged. So no published sentence becomes false and the record isn't
    touched.
- **Mobile API.** `POST /auth/login`, `GET` and `PATCH /auth/me`, and `POST /auth/change-password`
  are on the mobile surface; each gains one field. Adding is always safe, so no `CLIENT_API_VERSION` /
  `MIN_CLIENT_API_VERSION` bump.
- No migration, no index build, no config var, no native build.

## K. Release

1. **Hand-off and commit.**
   - Before handing over, I run the §H test commands and `npm run audit:mobile-api` from the repo
     root, and they all pass.
   - Right before handing over, I re-run `git status --short` and `git diff` on every file this work
     touches.
   - Today the tree also holds another session's unfinished work: a GPS after-check line in
     `docs/PRIVACY_VERIFICATION.md` and the untracked `docs/PROPOSAL_FBTIME_DOOR_COUNTS.md`. That plan
     also intends to edit `docs/README.md` and `docs/METRICS.md`.
   - **If no file this work touches has another session's hunks:**
     - The hand-off is the exact list of paths, this proposal included, **each in single quotes**.
       The owner's shell is zsh, which treats `(app)` and `[campaignId]` as patterns, for example
       `'mobile/app/(app)/admin/campaign/[campaignId].jsx'`.
     - The owner runs `git add <those paths>` (**not** `git add -A`, which would sweep in the other
       session's files), then the commit message and `git push origin main`.
   - **If one does:** the hand-off is one frozen patch in the session scratchpad. The owner runs
     `git apply --cached <patch>`, checks with `git diff --cached --stat`, commits and pushes, and does
     not run `git add -A` afterwards.
2. **Deploy** server and web together from the Heroku dashboard: Deploy → Manual deploy → `main`.
   Then the web owner checks (§H).
3. **Phone, staging.** From `mobile/`:
   - `git status --short -- ':/mobile'` must print nothing. The `:/` makes it look at the repo's
     `mobile/` folder from any directory; a plain `mobile/` from inside `mobile/` would check a folder
     that doesn't exist and pass falsely. `eas update` bundles the working tree, not the commit. If it
     prints anything, stop and tell me.
   - Check what else ships:
     - on expo.dev → Updates → production, note the latest update's commit;
     - `git log --oneline <that commit>..HEAD -- ':/mobile'` lists every mobile change going out with
       this one;
     - anything unshipped is checked on staging too.
   - `npm run ota:staging`, then the phone owner checks on TestFlight / Play internal (§H).
4. **Phone, production.** From `mobile/`, the same clean check, then `npm run ota:production` on
   `main`.

Staging is published from `main` after the commit, not from a feature branch. CLAUDE.md says staging
"normally" comes from a feature branch, but this change is JavaScript only, and the owner's routine
ships from `main`, so staging gets exactly the tree production will.

The phone change doesn't depend on the server field (§B), so steps 2 and 3-4 can happen in either
order. The web change and the server field ship in the same deploy. Help wording holds whatever the
order (§I).

**Rollback.**
1. `git revert --no-edit <sha>`, then `git push origin main`.
2. Heroku dashboard: Deploy → Manual deploy → `main`.
3. From `mobile/`: the clean check, `npm run ota:staging`, then `npm run ota:production`, which
   publishes the reverted code.

Nothing new persists: no web storage keys, no persisted query cache, and old phone bundles ignore the
extra cached field. Because the commit holds only this work (step 1), reverting it touches nothing of
the other session's. It can conflict only if that session has since committed nearby edits to
README or METRICS.

## L. Files

| Area | File | Change |
|---|---|---|
| Server | `server/src/routes/auth.js` | Imports; `homeCampaignId` in `loadMembershipsForUser` |
| Server | `server/test/leadHomeCampaign.int.test.js` | New |
| Web | `client/src/lib/homePath.js` (+ `.test.js`) | Home campaign, `isConsoleHomePath`, `homeLinkLabel` |
| Web | `client/src/auth/AuthContext.jsx` | `homePath` with the home campaign; cache cleared on login and logout; reset in `switchOrg`; `useSignOut` |
| Web | `client/src/components/AccountMenu.jsx`, `client/src/components/BottomNav.jsx`, `client/src/pages/ProfilePage.jsx` | Sign out through `useSignOut()` |
| Web | `client/src/pages/LoginPage.jsx` | Deep-link restore |
| Web | `client/src/components/Forbidden.jsx` | Label; secondary button rule; `useSignOut()` |
| Web | `client/src/components/RoleGate.jsx` | The `orgAdmin` hint |
| Web | `client/src/components/campaigns/CampaignGate.jsx` | Target and label |
| Web | `client/src/pages/SelectOrgPage.jsx` | Home campaign in `pick`; `useSignOut()` |
| Web | `client/src/components/OrgSwitcher.jsx` | Home campaign in `pick`; local reset removed |
| Web | `client/src/components/SupportAccessGate.jsx` | Local reset copy removed |
| Web | `client/src/components/campaigns/CampaignSwitcher.jsx` | New: the campaign box |
| Web | `client/src/components/Layout.jsx` | Uses `CampaignSwitcher`; the collapsed rail's Campaigns item |
| Web | `client/src/pages/DashboardPage.jsx` | Billing hint and archive reminder admin-only; archived sentence |
| Web | `client/src/pages/MapPage.jsx` | Archived `readOnlyReason` |
| Web | `client/src/components/SetupProgress.jsx` | The lead's **add on Team →** link |
| Web | `client/src/marketing/useAuthCta.js` | Comment |
| Web | `client/src/lib/landingRender.smoke.test.js` | New render tests |
| Phone | `mobile/components/CampaignHome.jsx` | New (moved body, embedded mode, group refresh, midnight wiring, By pass on error, archived sentence) |
| Phone | `mobile/components/AdminHeaderRow.jsx` | New: the logo-and-caption row |
| Phone | `mobile/components/ArchivedCampaignBanner.jsx` | Archived sentence |
| Phone | `mobile/app/(app)/admin/campaign/[campaignId].jsx` | Wrapper with `key` |
| Phone | `mobile/app/(app)/admin/index.jsx` | Decider, `OrgOverview`, `ArchivedGroup` |
| Phone | `mobile/app/(app)/admin/answer-voters.jsx` | Comment |
| Phone | `mobile/app/login.jsx` | Clear the query cache at sign-in |
| Phone | `mobile/lib/campaignSelection.js` (+ `.test.js`) | `soleActiveCampaign`, `overviewChoice` |
| Phone | `mobile/lib/useRefreshGroup.js`, `mobile/lib/useTodayInTz.js` | New hooks |
| Phone | `mobile/lib/refreshGroup.js` (+ `refreshGroup.test.js`) | New plain module: `groupNeedsRefresh`, `refetchEnabled` |
| Phone | `mobile/lib/dateRanges.js` (+ new `dateRanges.test.js`) | `todayInTz(tz, now)`; `effectiveRange` |
| Docs | ROLES, USERS, CAMPAIGNS, ADMIN_APP, METRICS, DATE_FILTERS, NOTES, SURVEYS, GETTING_STARTED, PERFORMANCE, CANVASSER_APP, README, this proposal | §I |
| Help | lead-getting-started, team-lead-vs-admin, why-cant-i-see-my-other-org, campaign-not-found-after-creating, roles-and-team, campaigns-manage, campaign-home, archive-vs-delete-campaign | §I |

## M. Owner calls (recommended defaults in bold)

1. **Archived campaigns don't count toward "one campaign".** Alternative: count them, so a lead with
   one active and one archived campaign keeps landing on the list.
2. **The campaign box shows plain text for everyone when there's no other campaign to jump to** (in
   practice, one active campaign), admins included. Alternative: leads only, which leaves admins a
   dropdown with one item.
3. **The phone's Overview caption follows the role: "Team Lead" for leads**, the casing the phone's
   other admin screens already use. Today the Overview says "Admin" for leads too.
4. **The embedded phone home polls all five report sections every 30 s while on screen, Coverage
   included, like the web Home**, so the door goal and Coverage never disagree.
   - That's five requests every 30 s per lead phone sitting on Overview, against one today; the web
     Home already makes six.
   - Alternative: skip Coverage, its heaviest request, and accept that the two can differ until the
     next return or pull.
5. **On the campaign Home, leads see neither the Doorline billing note nor the after-Election-Day
   archive reminder.** Alternative: a lead version of the reminder with no button, e.g. *Election Day
   was Nov 3. When you're done, ask an admin in your organization to archive this campaign.*

## N. Review rounds

Five rounds, 2026-10-08, fourteen reviewers in all. Every finding was checked against the code, and
often by experiment against the installed libraries, before it was accepted.

| Round | Lenses |
|---|---|
| 1 | Web landing paths; phone; server, tests, docs and release |
| 2 | v2's new mechanisms; consistency and a fix audit; an end-to-end walkthrough |
| 3 | v3's new mechanisms against the installed libraries; a fresh-eyes implementer |
| 4 | v4's new mechanisms; whole-document coherence; product and user experience |
| 5 | Red-team of v5's changes; a final end-to-end walkthrough; simplicity |

**What each mechanism is there to prevent.** These are the findings that shaped the design; the
many citation and wording corrections are not listed.

| Mechanism | Prevents | Round |
|---|---|---|
| A landing rule, never a redirect on `/campaigns` | **‹ Campaigns** bouncing back; Edit and Assignments unreachable | 1 |
| `homeLinkLabel`, `isConsoleHomePath`; the CampaignMissing target rule | Wrong labels, lost deep links, a "Campaign not found" loop | 1, 4, 5 |
| `useSignOut` and cache clears on sign-in and sign-out | The next person getting the previous person's page or campaign list | 1, 2 |
| The org-cache reset inside `switchOrg` | A lead's home resolved against another org's list | 1, 5 |
| `key={cId}` on the campaign screen | Walk-list and crew choices carrying over between campaigns | 1 |
| Five report queries refreshed as one group | "Passes add up to…" and goal vs Coverage disagreeing | 1, 4 |
| Decider plus `OrgOverview` split | A hook-order crash on every Overview load | 1 |
| `login.jsx` hook placement | Every phone sign-in broken | 2 |
| Part 1 separating leads from everyone | The owner surprised by admin-facing changes | 2 |
| Phone Help line conditioned, in the "if you don't see it" pattern | Help copy false before the phone update, or on old builds | 2, 4 |
| Plain modules for every tested rule | CI's install-free `test:mobile` failing | 3 |
| Stable focus callback reading an effect-fed ref | A refresh storm: 44 fetches in 3 s for one offline query | 3, 4 |
| `overviewChoice` tests `role === 'lead'`, not `enabled` | An admin shown the embedded home from cached data | 3 |
| One unconditional interval; staleness gates only focus and foreground | Drifting timers; a tick gated on age halving the rate (6 fetches against 11) | 3, 4 |
| `refetchEnabled` with `cancelRefetch: false` | The heaviest request sent twice; retries restarted on every tick | 5 |
| `effectiveRange` derived where the range state lives | Today stretching over two days; drills not summing to the count tapped | 2, 3, 5 |
| By pass keeping its rows; the honest footer | An error flickering every 30 s; a false "adds up" | 4, 5 |
| Billing notes admin-only on Home | A client-lead's landing page showing the firm's subscription notes | 4 |
| One archived sentence on every screen | A lead told to do what only an org admin can, on twelve screens | 4, 5 |
| The setup link to Team for leads | A new lead's first click landing on "Admin access required" | 5 |
| The collapsed rail's Campaigns icon | No visible way to the list with the sidebar collapsed | 5 |
| `':/mobile'` in the clean check; quoted paths | A false "clean" before an OTA; a zsh paste failing | 5 |

**Simplifications adopted in round 5:**
- `roleHomePath` dropped;
- the shared org-cache module replaced by the reset inside `switchOrg`;
- `ArchivedGroup` owning its own state;
- the role read with the existing `useConsoleRole`;
- `effectiveRange` applied once where the range state lives;
- the decision as a tested plain function;
- the server sketch reduced to one map.

**Where this leaves it.** Round 5 found no blockers. Its two majors (the archived wording on twelve
screens, the subfolder clean check) are fixed in v6, and the simplifications removed mechanisms
rather than adding them.
