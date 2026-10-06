# Proposal: Practice the survey — rehearse a campaign's survey on the phone before knocking

> **Status: BUILT 2026-10-06 (uncommitted at time of writing), to this plan.** The owner approved
> building it the same day, skipping a review round, under the recommended name **Practice the
> survey**. Where the build differs from the plan, the code wins: every difference is listed in
> [§M, "As built"](#m-as-built-2026-10-06) at the end, along with what was verified and what still
> needs a phone. Everything else below is the plan as approved, so line references are to HEAD
> `0b5c7da`, before the build. Phone only: no server code change, nothing is sent and nothing is
> stored; the Help Center copy ships with the server.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) (*The menu*, *Taking a survey*),
[SURVEYS.md](SURVEYS.md) §M (the door runner),
[PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) (scripted surveys and the web
**Try it**).

# Part 1 — For everyone

## What it is

A **Practice the survey** row in the phone's menu (☰). Tap it and the survey opens exactly as it
does at a door: the same questions, the same follow-ups, the same read-aloud lines and closings, and
on a script the same one-screen-at-a-time steps. Two things are different:

- **The card at the top says Practice run** and carries a **Practice** tag, where a voter's name and
  the green **At Door** tag normally sit.
- **The last button says Finish practice** instead of **Save Response**. Tapping it shows *Practice
  finished. Nothing was saved.* with **Practice again** (start over) and **Done** (back to where you
  were).

Nothing you tap or type in practice is saved or sent. No door changes color, nothing counts in
anyone's stats, reports or bill, the app never asks for your location, and it works with no signal.

## Who gets it

Anyone working in the field app: canvassers, and admins and team leads after **Switch to canvass
mode**. The row shows on **survey** campaigns once a campaign is open. A lit-drop campaign has no
survey, so it has no row.

## Which survey it opens

The one you will actually get at your doors:

- **Your books all use one survey** (the usual case): the row opens it straight away.
- **Your walk lists use different surveys**: a short list asks which one, named by walk list.
- **You have no books yet**: the campaign's survey.

## Why the menu, and not somewhere else

The menu is where the app keeps the things you do now and then (My stats, Help center), and the
Books screen's header was trimmed on purpose to keep the map clear. It is not on the door screen,
because the point is to rehearse before walking up to a house.

## What happens today

The only way to see a survey on the phone is to open a voter at a door, tap **Take survey**, and
back out without saving. Admins and team leads can click through a survey on the web console
(**Try it** on a campaign's Survey tab), but canvassers cannot sign in to the web console.

# Part 2 — Technical reference

## A. What the design rests on (checked at `0b5c7da`)

1. **The phone already holds every survey a canvasser can meet.** The bootstrap sends `books[]` (the
   user's own books in active rounds, each with `surveyTemplateId` = the effort's override or the
   campaign default; `canvasserBooks`,
   [server/src/routes/mobile/bootstrap.js:169-231](../server/src/routes/mobile/bootstrap.js)),
   `surveys` (every template those books name plus the campaign default, keyed by id; :407-418) and
   `activeSurvey` (the campaign default; :381-386). It is built the same way for admins and leads in
   canvass mode, who are scoped to their own books. The bootstrap's households are scoped to those
   same books, so the books' surveys are exactly the surveys the user's doors use.
2. **The door picks its survey from the door's book**: `surveys[book.surveyTemplateId] ||
   activeSurvey`
   ([mobile/app/(app)/voter/[id]/survey.jsx:255-266](../mobile/app/(app)/voter/[id]/survey.jsx)).
3. **What a survey shows depends only on the answers.** `visibleBlocks(survey, answers)`
   ([mobile/lib/surveyRunner.js:99](../mobile/lib/surveyRunner.js)) reads no voter field, and
   `{{canvasser}}` (the only placeholder) is the canvasser's own first name. So practice shows the
   door's screens for the same taps.
4. **The door screen is one 1,223-line default export** that mixes the voter with the walk. The
   voter's part is the already-surveyed and door-change prompts (:304), the do-not-contact and
   not-found walls (:430, :446), the save through `optimisticSubmit` ending in `router.dismiss(2)`
   (:491-571) and the voter card (:715). The walk is the answer state (:268), the one-block-per-screen
   stepper, scroll-to-reveal, the blocks and the footer (through :887).
5. **The canvasser menu**
   ([mobile/components/CanvasserDrawer.jsx](../mobile/components/CanvasserDrawer.jsx)) exists only in
   the field app: it opens from `CanvasserHeader` (select-org, campaigns, books, map), which no admin
   tab uses. It reloads its data each time it opens (:62-77).
6. **The web Try it**
   ([client/src/components/SurveyPreview.jsx](../client/src/components/SurveyPreview.jsx)) walks the
   same runner, but [client/src/components/ProtectedRoute.jsx:58](../client/src/components/ProtectedRoute.jsx)
   turns canvassers away from the console.

## B. Decisions

- **D1. One survey form, two hosts.** The walk moves out of the door screen into
  `mobile/components/SurveyForm.jsx`. The door screen keeps the voter and the save; the practice
  screen supplies a header and a finish. Rejected: a `practice` flag inside the door screen, which
  would put every practice branch in the door's save path. With the split, the practice screen
  cannot save by mistake, because it never imports `optimisticSubmit`.
- **D2. One resolver.** `mobile/lib/doorSurvey.js` owns "which survey does this book use" (A.2). The
  door and the practice list both call it, so practice can never show a different survey from the
  door.
- **D3. No server, no network, no storage.** Practice answers live in React state and are dropped
  when the screen closes.
- **D4. Practice is unmistakable.** "Practice run" with a **Practice** tag in the info tint
  (`infoBg` / `info` / `infoFg`, already the "for you, not the voter" color of canvasser notes).
  Never green, which means At Door, and never amber, which means read aloud. The button says
  **Finish practice**.
- **D5. The door's rules, unchanged.** Required questions still block finishing; Next, Skip, Back and
  Android's back button behave the same; links open on a tap. Rehearsing those rules is part of the
  point.
- **D6. Available while billing is paused.** Practice records nothing, so the read-only suspension
  has nothing to block.

## C. Files

| File | Change |
|---|---|
| `mobile/components/SurveyForm.jsx` | **New.** Moved from the door screen without edits: `STEP_GUARD_MS` and `justStepped`, `REVEAL_FOLD` and `REVEAL_AT`, `SingleChoice`, `MultipleChoice`, `FreeText`, `StatementBlock`, `QuestionCard`, `makeStyles`. New around them: `SurveyForm` (§D), and `SurveyWall`, the centered message with a Back button that the door's two walls already draw. |
| `mobile/app/(app)/voter/[id]/survey.jsx` | Shrinks to the voter's part: params, bootstrap, voter and household, `surveyForDoor`, the submit latch, the prompts effect, the two walls (now `SurveyWall`), and an `onSave` that calls `optimisticSubmit` with today's body, optimistic patch, reconcile and `dismiss(2)`. Renders `<SurveyForm>` with the voter's name, address and `badge="door"`. |
| `mobile/lib/doorSurvey.js`, `mobile/lib/doorSurvey.test.js` | **New.** `surveyForBook`, `surveyForDoor`, `practiceSurveys` (§E). |
| `mobile/app/(app)/survey-practice/index.jsx` | **New.** The "which survey" list, reached only when there are two or more. |
| `mobile/app/(app)/survey-practice/[surveyId].jsx` | **New.** The practice run (§F). |
| `mobile/app/(app)/_layout.jsx` | Two `Stack.Screen` lines beside `help/index` and `help/[slug]`, the same list-and-detail pattern. |
| `mobile/components/CanvasserDrawer.jsx` | The menu row (§G). |
| Docs and Help Center | §I. |

About 1,000 lines move unchanged; roughly 250 are new, plus the docs and Help Center copy.

## D. The SurveyForm seam

| Prop | Door | Practice |
|---|---|---|
| `survey` | the door's template | the chosen template |
| `canvasserFirstName` | `bootstrap.user.firstName` | the same |
| `title`, `subtitle` | the voter's full name; the two-line address (null without a household) | "Practice run"; "Nothing here is saved" |
| `badge` | `'door'` (green **At Door**) | `'practice'` (info tint) |
| `saveLabel` | "Save Response" | "Finish practice" |
| `isSubmitting` | the door's spinner state | `false` |
| `onSave({ answers, note })` | the submit | the finish alert |

Everything from the answer state (:268) through the JSX (:887) moves unchanged, apart from the voter
pieces in A.4. Only three things change shape:

1. **`formShown` (:340) goes.** SurveyForm mounts only after the door has passed its walls, so
   `stepped` is simply `survey.presentation === 'steps'`. Its hooks stay unconditional; the walls'
   early returns now happen before it mounts.
2. **`onSubmit` (:491) splits at the latch.** The required check and its *Missing answer* alert stay
   first, inside the form, as does the step guard on Save. The form then calls
   `onSave({ answers: buildSubmitRows(visible, answers, otherTexts), note: note.trim() || null })`,
   the same two body fields as today. The door's `onSave` keeps the double-tap latch,
   `optimisticSubmit` and everything after it. The order is unchanged: check, latch, submit.
3. **The voter card (:715) reads `title`, `subtitle` and `badge`.** Its initials come from `title`,
   as they come from `fullName` today.

## E. Which surveys: `mobile/lib/doorSurvey.js`

```js
// The survey a door in this book uses: the book's (the server resolved the effort's override or
// the campaign default) when the phone holds it, else the campaign default.
export const surveyForBook = (bootstrap, book) => {
  const sid = book?.surveyTemplateId;
  return (sid && bootstrap?.surveys?.[String(sid)]) || bootstrap?.activeSurvey || null;
};

export const surveyForDoor = (bootstrap, household) => {
  const book = household?.turfId
    ? (bootstrap?.books || []).find((b) => String(b.id) === String(household.turfId))
    : null;
  return surveyForBook(bootstrap, book);
};
```

`practiceSurveys(bootstrap)` returns one entry per distinct survey (by `_id`) across
`surveyForBook` of each of the user's books, as `{ id, survey, walkLists }`. `walkLists` holds the
names of the efforts whose books use that survey, from `bootstrap.efforts`. With no books, it returns
the campaign default alone. It returns nothing on a campaign whose `type` is not `'survey'`, or when
no survey resolves. Entries are sorted by their label: the walk list names, or "Campaign survey" when
there are none.

Tests (`node --test`, run by `npm run test:mobile`):

- `surveyForDoor`: an override; an override the phone does not hold falls back to the default; no
  book falls back to the default; nothing resolves to `null`.
- `practiceSurveys`: lit drop gives none; no books gives the default; two books sharing a survey give
  one entry naming both walk lists; an override plus the default give two entries; a missing override
  folds into the default's entry; no survey anywhere gives none.

## F. The practice screens

```
 ‹ Back
 ┌─────────────────────────────────────────┐
 │  PR   Practice run          ● Practice  │
 │       Nothing here is saved             │
 └─────────────────────────────────────────┘
 Question 1 of 5                 0% Complete
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GREETING   Hi, I'm Sam with ...
   ... the survey, exactly as at a door ...
 Note (optional)
 [            Finish practice              ]
```

**`survey-practice/[surveyId].jsx`**

- Reads `surveyId` from the route and the bootstrap as a pure reader, as the door screen does. Its
  survey is `practiceSurveys(bootstrap).find((e) => e.id === String(surveyId))`.
- Holds `run` in state and renders `<SurveyForm key={run} …>`. **Practice again** bumps `run`, which
  mounts a fresh form: first screen, no answers.
- When no entry matches (the survey was swapped while the screen was open, or the campaign changed),
  it shows a `SurveyWall`: "This survey isn't available to practice any more." with Back.
- **Finish practice** shows `Alert.alert('Practice finished', 'Nothing was saved. At a real door,
  Save Response records the answers.', [Practice again, Done])`. **Done** is `router.back()`.
- It imports nothing that writes: no `recordAction`, no API client. The verify step greps for this.

**`survey-practice/index.jsx`** has a ‹ Back header, the title "Practice a survey" and the caption
"Nothing here is saved". It shows one `InsetNavRow` per entry (label: the walk lists; sub: the
survey's name), and each row pushes `/(app)/survey-practice/<id>`.

## G. The menu row

- **Data.** In the open effect (:66), after the existing loads, read
  `qc.getQueryData(['bootstrap'])`. Use it only when its `campaign.id` matches the active campaign;
  otherwise the cached bundle belongs to another campaign or none is loaded. Keep
  `practiceSurveys(bootstrap)` in state.
- **Row.** It goes in the Navigate group between My stats and Help center: label **Practice the
  survey**, sub "Rehearse before you knock — nothing is saved", with the same `RowEmoji` treatment as
  its neighbors.
- **Tap.** With one entry it pushes `/(app)/survey-practice/<id>`; with two or more, it pushes
  `/(app)/survey-practice`. With no entries there is no row.

## H. Privacy

This change does not affect privacy. Checked against the five triggers in CLAUDE.md:

- **Collection.** Nothing new is collected: answers live in screen state and are gone when it
  closes.
- **Retention.** Nothing is stored.
- **Access.** No new reader: the same people already see this survey at their doors, and the bundle
  is already on their phone.
- **Sharing.** No third party is involved.
- **Exposure.** Nothing new is put in front of anyone.

Links are drawn by the same tap-only `SurveyNoteAndLinks`, so PRIVACY_VERIFICATION item 26 is
unchanged. That component's "never preview a link" rule is about link unfurling, which practice does
not do. No edit is needed to PRIVACY_VERIFICATION, the Privacy Policy, the ToS or the DPA.

## I. Docs and Help Center (in the same change)

- **CANVASSER_APP.md.** Part 1, *The menu*: add Practice the survey, plus Help center, which is
  missing from that list today. Part 1, *Taking a survey*: a short "Practice first" paragraph.
  Part 2, *The drawer*: the row and its rule. Part 2, *The at-door survey*: the split into
  SurveyForm, the door screen and the practice screens.
- **SURVEYS.md.** §M and the file table: where the door's UI now lives, and that practice walks the
  same runner.
- **EFFORTS.md and LOCK_SCREEN_AND_DIRECTIONS.md.** Repoint their file-table entries at the moved
  code. Dated records (PRIVACY_VERIFICATION and the older PROPOSAL files) stay as written; the
  submit they point at stays in `voter/[id]/survey.jsx` anyway.
- **Help Center.** `guides/canvasser-door-survey.md` gets a "Practice before you knock" section,
  `getting-started/canvasser-first-day.md` gets one line, and a new `faq/practice-the-survey.md` is
  added. Its audience is `canvasser`, so leads and admins see it too.
- **docs/README.md.** This proposal's row, updated as it moves from plan to built.

## J. Verify

- `npm run test:mobile`: the new resolver tests and the existing runner tests.
- A Metro bundle of the app (`npx expo export` in `mobile/`), so a broken import fails before a
  phone sees it.
- A grep showing that the practice screens import neither `recordAction` nor the API client.
- **On a phone (staging OTA), the door path first, since its code moved:**
  - an ordinary survey saved online and offline;
  - a scripted survey: Next, Skip, Back, Android's back button, a fast double tap, *Answer Question N
    to finish*, and the closings;
  - the do-not-contact wall, the already-surveyed prompt and the door-change prompt;
  - Save returning to the map.
- **Then practice:**
  - the row shows on a survey campaign, and not on lit drop or on the campaign picker before a
    campaign is open;
  - one survey opens directly, and two show the list;
  - both presentations work, and a required question blocks Finish;
  - Practice again resets the form, and Done goes back;
  - it works in airplane mode with no location prompt;
  - nothing appears in My stats, Door Outcomes or answers;
  - it works for an admin and for a team lead in canvass mode.

## K. Release

- **Phone JavaScript only.** Nothing in `app.json`, `eas.json` or the native dependencies changes,
  so `ota:check` passes. Publish `npm run ota:staging`, run the phone checks in §J, then
  `npm run ota:production` from `main`.
- **No server code.** That means no `audit:mobile-api` (help copy is not a route), no client-version
  bump, no migration and no index build.
- **Help copy ships with the next server deploy.** Deploy it after the production OTA, so the FAQ
  never describes a row that phones don't have yet.
- **Timing.** This moves the door survey screen's code four weeks before the 2026-11-03 election.
  The move is mechanical, but the door checks in §J must pass before the production OTA.

## L. Question for the owner

1. **The name.** "Practice the survey" (recommended: it says what the canvasser does) or "Preview
   survey"?

## M. As built (2026-10-06)

**The name.** The owner said to build without answering §L, so the build uses the recommended
**Practice the survey**. Renaming it later is a copy change: the menu row, the list screen's title,
the Help Center FAQ and guide, and these docs.

**Where the build differs from the plan.** Every difference is small:

1. **Menu sub-line.** The menu row's second line reads *Rehearse it first · nothing is saved*, shorter
   than the plan's wording so it fits the menu's width.
2. **The list screen's copy.** The screen is titled **Practice the survey** (the plan said "Practice a
   survey"). A *Your walk lists* caption sits above the rows, and a footer below them reads: *Your
   walk lists use different surveys. Pick one to rehearse it exactly as it looks at a door. Nothing
   you enter is saved.* With no entries, the screen shows a wall: *There's no survey to practice on
   this campaign right now.*
3. **A `label` field.** `practiceSurveys` entries also carry `label` (`{ id, survey, walkLists, label }`),
   so the menu, the list and the tests all read one name.
4. **The door's walls.** They are now `SurveyWall({ title, message })`. The do-not-contact title is red
   as before, and the words are unchanged.
5. **One corner case at the door now behaves differently.** Before, the form's state lived in the
   same component as the walls. If the door's voter or survey vanished mid-walk and then came back,
   the answers typed so far reappeared. That could happen when a delta flagged the voter do-not-contact
   and was then reversed, or when the survey was detached and re-attached. Now a wall unmounts the
   form, and those answers are gone once the wall clears. A wall already means "don't survey this
   voter now", so nothing that should have been saved is lost.
6. **Comments only.** The moved comments that cited "PROPOSAL §H2" and "PROPOSAL §H3" now name
   PROPOSAL_SURVEY_SCRIPT_FLOW, since the form also points at this proposal.
7. **One extra doc section.** Besides the §I copy, SURVEYS.md Part 1 has a new *Practicing before
   knocking* section, the plain-English source for the Help Center text. In
   `guides/canvasser-door-survey.md`, the paragraph on what each voter shows now sits under a new
   *At the door* heading, below the new *Practice before you knock* section.

**Files.**

- **New:** `mobile/components/SurveyForm.jsx`, `mobile/lib/doorSurvey.js`,
  `mobile/lib/doorSurvey.test.js`, `mobile/app/(app)/survey-practice/index.jsx`,
  `mobile/app/(app)/survey-practice/[surveyId].jsx`,
  `server/src/content/help/faq/practice-the-survey.md`, and this file.
- **Changed:** `mobile/app/(app)/voter/[id]/survey.jsx` (now the voter's part only),
  `mobile/app/(app)/_layout.jsx`, `mobile/components/CanvasserDrawer.jsx`,
  `server/src/content/help/guides/canvasser-door-survey.md`,
  `server/src/content/help/getting-started/canvasser-first-day.md`, `docs/CANVASSER_APP.md`,
  `docs/SURVEYS.md`, `docs/EFFORTS.md`, `docs/LOCK_SCREEN_AND_DIRECTIONS.md` and `docs/README.md`.

**What was verified.**

- **Mobile unit tests.** `npm run test:mobile` (repo root): 194 pass, 0 fail. That includes 13 new
  tests in `doorSurvey.test.js`, one of which holds the door's old inline rule as an oracle over 378
  combinations of bundle and door.
- **Metro bundle.** `npx expo export --platform ios`, written to a scratch folder with nothing
  published, compiled every route. The new strings are in the bundle.
- **Old versus new door screen.** A scratch harness compared the door screen as it was at `0b5c7da`
  with the door screen now. It used a React 18 test renderer with the native modules stubbed, and
  nothing was added to the repo. Both versions got the same taps in 11 scenarios:
  - a single page: the required check, a follow-up, Other, a note, and Save;
  - a save while an earlier one is still in flight;
  - a script on one block per screen: Next, Skip, header Back, Android back, a link, and Save;
  - a double tap;
  - Back on the first screen;
  - the do-not-contact wall;
  - voter not found;
  - no survey;
  - the teammate re-survey prompt;
  - the door-change prompt;
  - a voter whose household isn't on the phone.

  After every step (47 snapshots), the two versions showed the same screen and the same alerts,
  navigated the same way, opened the same links, and sent the same POST: path, body, optimistic
  patch, pending marker and reconcile. A negative control, the old door screen against the practice
  screen, compared unequal, so the comparison is live.
- **Practice, the list and the menu row**, in the same harness:
  - Practice: the card; the required check; Finish; Practice again resets the form; Done goes back;
    the wall for an unknown survey or a lit-drop campaign; zero submits.
  - The list: rows by walk list, and a tap opens the run.
  - The menu row: one survey opens the run; two open the list; the row is hidden in five cases
    (another campaign cached, no campaign open, nothing cached, lit drop, no survey).
- **Help Center and server.** `server/test/helpLinks.test.js` passes, and the real loader serves the
  new FAQ to canvasser, lead, admin and super. The server unit suite (`npm test` in `server/`): 477
  pass, 0 fail, 1,369 skipped.
- **Audit and grep.** `npm run audit:mobile-api` found no server route or service files changed. A
  grep confirms that the practice screens, the form and the resolver import nothing that writes.

**Not verified: these need a phone.** The harness stubs everything native, so none of this has run
yet:

- the layout and look on iOS and Android (the info-tinted tag, the list screen);
- the real keyboard, scrolling and scroll-to-reveal;
- the hardware back button and the menu's animation;
- the real `optimisticSubmit` on the door path (the GPS gate and the offline queue).

The phone checks in §J gate the production OTA.

**Release, unchanged from §K.** Phone JavaScript only. The owner publishes `npm run ota:staging`
(its `ota:check` step runs first), runs the §J phone checks, then publishes `npm run ota:production`
from `main`. The Help Center copy goes out with the next server deploy, after the production OTA.
There is no migration, no index build and no client-version bump.
