# Surveys

How surveys are built, run at the door, stored, and reported — including conditional questions,
read-aloud option scripts, "Other (specify)", and the (now much more permissive) rules for editing a
survey that's already collecting answers.

- **Part 1 — For everyone** is plain language: what a survey is, how to build one (including
  branching logic, per-option scripts, and **tags** that group answers across questions), and what
  you can safely change once it has answers.
- **Part 2 — Technical reference** is for developers (and Claude): the data model, dual-read
  reporting, the soft-retire reconcile, the shared visibility evaluator, answer normalization, the
  migration, and the **tags** rollup / by-tag walk lists / CSV export.

Related: [METRICS.md](METRICS.md) ("Surveys" and "Surveyed voters" definitions),
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (one survey per voter **per pass**),
[EFFORTS.md](EFFORTS.md) (an **effort can override** the campaign survey — the door's effort survey
wins, falling back to the campaign default),
[VOTERS.md](VOTERS.md) (editing a single response on a voter's profile).

---

# Part 1 — For everyone

## What a survey is

A **survey** is the questionnaire a canvasser runs at the door. One survey (we call it a "survey
template") belongs to your **organization** and can be attached to one or more **campaigns**. It
has:

- an **intro** and a **closing** — short scripts the canvasser reads,
- a list of **questions**, each one of three types:
  - **Single choice** — pick one option,
  - **Multiple choice** — pick any number of options,
  - **Text** — free typing.

Each question can be marked **required** and has an **order** (where it appears in the list).

Survey campaigns use a survey; **lit-drop campaigns** don't — they just record that literature was
dropped. (See [METRICS.md](METRICS.md) for how the two campaign types count.)

## Building a survey (web admin)

On the **Surveys** page you create a template: give it a name, write the intro/closing, then add
questions — set each one's wording, type, options, and whether it's required. You can reorder
questions, add and remove them, and rename anything. When you attach the survey to a campaign,
canvassers on that campaign start seeing it.

The Surveys list also shows, for each survey, **which campaigns use it** and a **response count** —
so you can see at a glance whether a survey is live before you touch it.

Beyond plain questions and options, the builder supports three extras:

### Conditional questions ("Show only if…")

You can make a question appear **only when an earlier answer matches**. On any question (after the
first), open **Show only if…** and add one or more rules. A rule reads:

> *"`<earlier question>` **is / is not / is any of** `<option(s)>`"* — or, for a text question,
> *"is answered / is not answered."*

With multiple rules you choose **Match ALL** (every rule must hold) or **Match ANY** (one is enough).
Rules can reference **only earlier questions** — the builder won't let you point at a later or the
same question — so the survey can never tangle itself into a loop. This one mechanism covers all the
common shapes: **branch** ("show the follow-up only if they picked X"), **skip** ("hide this unless
they're a supporter"), and **skip-to-end** (the last questions simply don't appear).

At the door, hidden questions never show, and **their answers aren't saved** — a question someone
never sees can't accidentally count in your reports.

### Read-aloud option scripts

Any choice option can carry a short **read-aloud script** — a line the canvasser sees the moment
they pick that option. Add it with **+ read-aloud script** under the option. It's perfect for
follow-up prompts ("Great — what would change your mind?") or rebuttals tied to a specific answer.
It's guidance for the canvasser only; nothing about it changes how the answer is stored or counted.

### "Other (specify)"

Turn on **Other (specify)** on a choice question and the door form gains an **Other** choice with a
small free-text box. Whatever the voter says is captured alongside the structured answer, so you keep
the clean option counts *and* the verbatim text.

> **Note — "Refused to answer" is not built yet.** A per-question "Refused" choice is a planned,
> separate **door-outcome** feature; it does not exist today. Don't expect a Refused toggle in the
> builder.

### Tags (group answers across questions)

A **tag** is a short label you stick on an **answer option** — like "Supporter," "Needs follow-up,"
or "Volunteer." The point of a tag is to pull together related answers that live in **different
questions**. Maybe Q1 asks "Who are you voting for?" and Q5 asks "Would you put up a yard sign?" —
tag the "Our candidate" option in Q1 *and* the "Yes" option in Q5 both **"Supporter,"** and the app
can now treat anyone who picked **either** as a supporter, with no double-counting.

**Adding a tag.** In the builder, each answer option has a small **+ tag** link; click it and a
**Tag** box appears. Start typing and it suggests tags you've already used elsewhere in this survey
(so you reuse the exact same one instead of inventing "Supporter" here and "supporters" there) — or
just type a brand-new one. Tags are **not case-sensitive**: "Supporter," "supporter," and
"SUPPORTER" are all the same tag, and when you save, the survey tidies them up to one spelling
everywhere.

> **Tags are an admin-only convenience.** They're metadata you attach for *your* reporting and list-
> building. **Canvassers never see tags** at the door — the mobile survey is unchanged.

Once options are tagged, tags show up in two places:

- **The survey report → "Tags" section.** Open the campaign's survey results and, below the
  per-question charts, you'll find a **Tags** panel: one bar per tag showing **how many distinct
  voters** carry it (counted **once** even if they hit the tag in several questions). Click a tag to
  see exactly which options feed it, and to drill into the **list of voters** reached.
- **Building a list "by tag."** When you create a **saved search** (walk list), the answer-filter
  panel has a **By tag** row of tag chips. Pick "Supporter" and the resulting list is **every
  household with someone who matched that tag in any question** — a cross-question reach that the
  per-question answer filters can't express on their own. From the Saved Searches list you can then
  **Export CSV** to download those voters (name, party, age, phone, precinct, address) for a re-
  canvass, a phone bank, or a mail house.

## The campaign's "Survey" tab (which survey this campaign uses)

Each campaign has its own **Survey** tab (open a campaign, then **Survey** in the sidebar). It shows
**which survey the campaign uses** and a **read-only preview** of it — the intro, the questions and
their options, and the closing — so you can confirm the right questionnaire is attached without
opening the builder. This tab is about **association, not authoring**: surveys stay reusable
**org-level templates**, and you still write and edit the actual questions in the **Surveys
library**.

From here you can:

- **Change survey** — pick a different template from your library for this campaign.
- **Edit in library →** — jump to the Surveys page to edit the attached survey's questions.
- **Create new** — open the builder pre-tagged to this campaign; when you save, the new survey is
  **automatically attached** here and you land back on this tab.

A few rules this tab enforces:

- A **lit-drop campaign** shows a short "surveys aren't used for this campaign" note instead —
  lit-drops record drops, not responses.
- A **survey campaign can't activate a round until a survey is attached** — until then canvassers
  have nothing to fill out.
- **Swapping mid-canvass is allowed.** If you change to a different survey after answers have come
  in, the old responses keep reporting under the old survey and new answers report under the new one
  — nothing is lost or mixed. If the survey you pick **already has responses**, the tab warns you
  that new answers will report **separately** from those.
- There's **no "unlink"** — to stop using a survey you simply **change to a different one**.

## What a canvasser sees (mobile)

At a voter, the canvasser opens the survey, reads the intro, and answers the questions. As they go:

- **Conditional questions appear and disappear live** — answer the parent and any dependent question
  reveals itself (or hides) immediately.
- When they pick an option that has a **read-aloud script**, that line shows up right under the
  choice.
- An **Other** choice pops a "Please specify" box for free text.
- Required questions must be filled — but **only the questions that are actually showing**. A hidden
  question is never required and is never saved.

They can add a free-form note and submit. Surveys submitted while offline are queued and sync later.
**One survey is kept per voter, per pass** — if a canvasser re-submits for the same voter in the
same pass, the new one replaces the old. A house with three voters surveyed in one visit produces
**three survey responses but counts as one knock** (see [METRICS.md](METRICS.md)).

## Editing a survey — what's allowed once it has answers

Before a survey collects any answers, edit it freely. **Once it has responses you can still edit it
almost completely** — the app now protects your reports automatically instead of locking the
controls, so the old "this is blocked" warnings are gone for nearly everything.

Why it's safe: every option has a hidden, **stable id** that never changes, and every stored answer
remembers that id. Reports add up answers by id, so you can **rename** an option or **reword** a
question and the counts follow along untouched. And when you **remove** a question or an option, the
app doesn't delete it — it quietly **retires** it (keeps it, hidden from the field) so the answers
people already gave still appear in your reports under a clearly labeled "retired" bucket.

Once a survey has responses:

- **Safe (do it freely):** rename the survey, edit the **intro/closing**, **reword** a question,
  **rename** an option, toggle **Required**, **reorder** questions, **add** a question or option,
  **remove** a question or option (it's retired, not deleted), and add/edit **conditions**,
  **read-aloud scripts**, or **Other (specify)**.
- **The one blocked change:** changing a question's **answer type** (e.g. single-choice → text). The
  stored answers were recorded in the old shape and can't be re-totaled in the new one, so the type
  control is locked and the server refuses the change.

**Need to change a question's type?** Use **Duplicate** on the Surveys list. It makes a fresh,
fully-editable copy (reset to v1); point your campaign at the copy on the Campaigns page. The
original stays intact so its existing reports keep working. Note: after you repoint a campaign, that
campaign's new answers report under the **copy**, separate from the answers already gathered under
the original — the Campaigns page shows a heads-up when you pick a survey that already has responses.

---

# Part 2 — Technical reference

The implementation lives in
[`server/src/routes/admin/surveys.js`](../server/src/routes/admin/surveys.js) (authoring,
reconcile + rule-graph validation),
[`server/src/routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js) (submission), the
shared [`server/src/services/surveys/`](../server/src/services/surveys/) helpers (visibility,
normalization, dual-read aggregation, edit classification), and the `survey-results` handler in
[`server/src/routes/admin/reports.js`](../server/src/routes/admin/reports.js) (reporting).

## A. Data model

| Model | File | Fields that matter |
|---|---|---|
| `SurveyTemplate` | [models/SurveyTemplate.js](../server/src/models/SurveyTemplate.js) | `organizationId`, `name`, `isActive`, `version` (default 1), `intro`, `closing`, `questions[]`, **`tags: [String]`** (the **tag palette** — display casing for the survey's tags; matching is case-insensitive, see §I), `createdBy`. Org-scoped, **not** campaign-scoped (a campaign points at a template via `Campaign.surveyTemplateId`). |
| `SurveyTemplate.questions[]` | same (`questionSchema`, `{ _id: false }`) | `key` (stable per-survey slug, **the join handle** — never reused once retired), `label`, `type` (`single_choice`/`multiple_choice`/`text`), `options[]`, `required`, `order`, **`retired`** (soft-retire a whole question), **`visibleIf`** (conditional display, default `null`), **`otherOption`** (boolean — adds an "Other: ___" choice), **`refusalOption`** (boolean — reserved for a future door-outcome feature; **no UI, not wired**). |
| `SurveyTemplate…options[]` | same (`optionSchema`, `{ _id: false }`) | **`id`** (stable per-question id — reports/conditions join on this, so `text` is freely editable), `text`, **`tag`** (cross-question group label, default `null`; canonicalized to the palette's casing on save — see §I), **`script`** (per-option read-aloud line), **`retired`** (soft-hide from the field, keep in reports), `order`. |
| `SurveyTemplate…visibleIf` | same (`visibleIfSchema`) | `logic` (`all`/`any`, default `all`) + `rules[]`. Each rule (`ruleSchema`): `questionKey` (an **earlier** question), `op` (`is`/`is_not`/`any_of`/`answered`/`not_answered`), `optionIds[]`. |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `surveyTemplateId`, **`surveyTemplateVersion`** (snapshot at submit), `answers[]`, `voterId`, `householdId`, `userId`, `campaignId`, `organizationId`, `passId`/`turfId`/`effortId` (metadata, nullable), `location`, `submittedAt`, `wasOfflineSubmission`, `editedBy`/`editedAt`. Unique index `{voterId, passId}` (within-pass dedup, DB-enforced); index `{householdId, passId}`. |
| `SurveyResponse.answers[]` | same (`answerSchema`, `{ _id: false }`) | `questionKey` (matches a template question's `key`), `questionLabel` (**snapshot** at submit), **`optionIds[]`** (stable id(s) chosen — the id-native tracking key; single → 1, multi → N, empty for free-text), **`otherText`** (free text typed into the `__other__` option), `answer` (Mixed — string \| string[] \| free text; **kept as a human-readable snapshot AND the legacy reporting fallback** for rows recorded before stable ids existed). |

The `key` is derived in the builder by slugifying the label, with collision suffixes
(`top_issue`, `top_issue_2`, …); option `id`s are derived the same way within a question. Both are
minted once and held immutable so conditions and stored answers keep pointing at the right thing.

## B. Endpoints (authoring)

All under `/admin/surveys`, guarded by `requireAuth, orgContext, requireOrgRole('admin')`.

| Method · path | Purpose |
|---|---|
| `GET /admin/surveys` | List templates; each annotated with `usedByCampaigns: [{id, name, isActive}]` plus **`responseCount`** / **`hasResponses`** (one `SurveyResponse.aggregate` count per template). |
| `POST /admin/surveys` | Create (Zod `upsertSchema`, which accepts an optional `tags: [String]` palette); `assignOptionIds` mints ids for any id-less option, `validateVisibleIfIntegrity` checks the rule graph, then `canonicalizeTags(withIds, data.tags)` collapses the palette + every `option.tag` to one case-insensitive casing (see §I), and sets `version: 1`, `createdBy`. |
| `PATCH /admin/surveys/:surveyId` | Update. When `questions` are present: if the survey **has responses**, `classifyQuestionEdits` blocks **only a question type change** → `409 { code: 'survey-has-responses', reasons }`. Otherwise `reconcileQuestions` (soft-retire absent items, mint ids for new options), `validateVisibleIfIntegrity`, then `canonicalizeTags(reconciled, data.tags ?? existing.tags)` (writes back both `existing.tags` and the canonicalized option tags), apply, and bump `version`. |
| `POST /admin/surveys/:surveyId/duplicate` | Clone into a fresh template (`name: "<name> (Copy)"`, `version: 1`, `isActive: false`, no campaign link, questions copied verbatim). |

> **Soft-retire reconcile (replaces the old "blocked destructive edits" model).** The PATCH route no
> longer deletes anything structural. `reconcileQuestions(existingQuestions, incomingQuestions)`
> (in [surveys.js](../server/src/routes/admin/surveys.js)): matches incoming questions to existing
> ones by `key`, **preserves existing option ids**, mints ids for new (id-less) options, and
> **re-appends as `retired: true`** any existing option a question dropped and any existing question
> the payload dropped — ids and text preserved. So removing/renaming/reordering questions and
> options is non-destructive: history is kept, reports keep counting it.

> **The one hard block.** `classifyQuestionEdits(old, new)`
> ([services/surveys/diffQuestions.js](../server/src/services/surveys/diffQuestions.js)) walks
> still-present questions (matched by `key`) and returns a reason **only** when a question's `type`
> changed — the stored answer shape can no longer be aggregated. That's the lone `409` once responses
> exist; the builder mirrors it by locking the type control and offering **Duplicate**.

> **Rule-graph validation (on save, after reconcile).** `validateVisibleIfIntegrity(questions)`
> enforces, over the **final reconciled** questions, that every rule on a non-retired question:
> references a **strictly earlier non-retired** question (forward/self/dangling → error, which also
> makes cycles impossible); uses an op valid for the referenced type (`text` questions support only
> `answered`/`not_answered`); and (for `is`/`is_not`/`any_of`) names `optionIds` that exist on the
> referenced question (retired-inclusive) or the `'__other__'` sentinel when it allows Other. Any
> violation → `400`. The Zod `ruleSchema` additionally requires exactly one `optionId` for
> `is`/`is_not` and at least one for `any_of`.

## C. Dual-read reporting (stable id, legacy text fallback)

Reporting joins answers to the **current** template by `questionKey`, and joins choice answers to
options by **stable option id with a legacy `answer`-text fallback**. The shared helpers in
[`services/surveys/answerAgg.js`](../server/src/services/surveys/answerAgg.js) are the single source
of that logic:

| Helper | Role |
|---|---|
| `choiceKeyStages(questionKey)` | Aggregation fragment: after the caller's `$match`, `$unwind` answers, match the `questionKey`, then emit one `_answerKeys` row per chosen key — the **`optionIds`** for id-native rows, or the literal **`answer`** text (wrapped to an array) for legacy rows. Works for single + multiple. |
| `mergeOptionRows(question, rows, opts)` | Merge raw `$group` rows (`{ _id, count, responseIds? }`) onto the question's **current options** — matched **by id, then by text**. Leftover values with no current option collapse into a **retired orphan bucket** (`id: null`, `retired: true`, `text` = the raw value). Returns `[{ id, text, retired, count, responseIds }]` sorted by count desc. |
| `voterAnswerClause(questionKey, optionId, optionText)` | "Voters who chose this option" filter: id-native `$elemMatch` on `optionIds` **OR** legacy `$elemMatch` on `answer` text (the latter also matches multi-select arrays containing the text). |
| `answerFilterClause(questionKey, values, texts)` | Saved-Search / targeted-round filter: match any chosen option **id** (`optionIds.$in`) **OR** their texts (`answer.$in`), tolerating legacy saved filters that stored literal text. |
| `answerTagClause(template, tag)` | "Voters who chose ANY option carrying this tag" — a single cross-question `$or` over the tag's `(questionKey, optionId \| legacy text)` members. Resolves the tag's members via `tagOptionMap(template).get(normalizeTag(tag))` (see §I) and **reuses `voterAnswerClause` per member**, flattening their `$or`s. Empty / unknown tag → `{ _id: null }` (matches nothing). |

Consumers:

- `GET /admin/reports/survey-results`
  ([reports.js `survey-results` handler](../server/src/routes/admin/reports.js)) — builds the
  per-question pipelines with `choiceKeyStages` (choice) or a plain text group, then
  `mergeOptionRows` onto the current options. It **also** emits a `tags[]` rollup via
  `answerTagClause` (see §I). `voters-by-answer` uses `voterAnswerClause` for a single option, or
  `answerTagClause` when a `tag` is supplied (see §I).
- `computeSurveyBreakdowns`
  ([services/reports/computeReport.js](../server/src/services/reports/computeReport.js)) — the
  client-report freeze; same `choiceKeyStages` + `mergeOptionRows` math.
- `resolveWalkList` ([services/walklist/resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js))
  and `GET /admin/households` ([routes/admin/households.js](../server/src/routes/admin/households.js))
  — `answerFilterClause` / `voterAnswerClause` for per-question survey-answer targeting, and
  `answerTagClause` for the cross-question **`answerTagFilters`** (see §I).

**Consequences:** renaming an option **keeps its count** (the id is stable); removing one surfaces
its past answers as a **retired** bucket rather than dropping them. Each response still snapshots
`surveyTemplateVersion`, `questionLabel`, and `answer`, so raw data stays recoverable and pre-id
rows keep reporting via the text fallback.

> **Percentages are per-question (share of that question's answers).** Each option's `percent` = its
> `count` ÷ **that question's own answer total** (the Σ of its merged option counts) — *not* the
> global response count. A **single-choice** question's bars sum to ~100% of the people who answered
> it; a **multiple-choice** question's sum to ~100% of all *selections* (one respondent can
> contribute several). Counts are the raw `$group` totals merged onto the current options. The "N
> answered" header ([QuestionResults.jsx](../client/src/components/QuestionResults.jsx)) is the same
> per-question Σ, so bars and header agree. The client report freezes the identical math
> (`computeSurveyBreakdowns`), and the report bars
> ([ReportBreakdown.jsx](../client/src/components/ReportBreakdown.jsx)) re-derive percent from the
> counts they display — so a published snapshot is always self-consistent.

## D. The visibility evaluator (shared, three copies, drift-guarded)

Conditional display is decided by one **pure** evaluator with **no I/O**, so the server, web builder
preview, and mobile field app always agree on which questions show.

- **Canonical:** [`server/src/services/surveys/visibility.js`](../server/src/services/surveys/visibility.js).
- **Mirrors (byte-for-byte below the `// ==== BEGIN MIRRORED BODY ====` marker):**
  [`client/src/lib/surveyVisibility.js`](../client/src/lib/surveyVisibility.js) and
  [`mobile/lib/surveyVisibility.js`](../mobile/lib/surveyVisibility.js).
- **Fixtures:** [`__fixtures__/visibility.fixtures.json`](../server/src/services/surveys/__fixtures__/visibility.fixtures.json).
- **Tests:** [`visibility.test.js`](../server/src/services/surveys/visibility.test.js) (run via
  `npm test` in `server/`) — exercises the fixtures, op semantics, and a **drift guard** that reads
  each file from the marker on and asserts the three bodies are identical.

Exported API:

- `makeCell(type, optionIds, text)` → `{ optionIds, text }`. **Choice questions carry NO text into
  the evaluator** (only `type === 'text'` keeps text); this is the key invariant that keeps server,
  web, and mobile in agreement when a choice answer's `optionIds` is empty.
- `evaluateVisibleIf(visibleIf, answersByKey)` — pure single-question evaluation. Op semantics:
  `is`/`is_not` compare against `optionIds[0]`; `any_of` is set intersection; `answered`/
  `not_answered` test the cell; an **unknown op fails OPEN** (visible) so a future op can't strand a
  question. `null`/empty rules → visible.
- `visibleQuestionKeys(questions, rawAnswersByKey)` — the order-aware driver. Walks **non-retired**
  questions in authoring order, exposing each **visible** question's answer only to questions
  **after** it (a hidden parent's stale answer is withheld from its children). A rule referencing a
  **later or self** active question **fails CLOSED** (the question hides). Returns a `Set` of visible
  keys.

## E. Answer normalization & dropHidden modes

Both write paths funnel through `normalizeAndFilterAnswers(template, rawAnswers, { dropHidden })`
([services/surveys/normalizeAnswers.js](../server/src/services/surveys/normalizeAnswers.js)) so they
**can't drift**. It **never throws / never 400s**:

- Drops rows whose `questionKey` is unknown to the template.
- Computes valid ids = the question's option ids **plus `'__other__'`** when `otherOption` is on;
  **keeps retired ids**, drops ids the template doesn't recognize.
- Phase-1 backfill: a row with no `optionIds` but an `answer` snapshot maps each answer text to an
  option id by exact text match before filtering.
- Stores `otherText` only when `'__other__'` is among the kept ids.
- Builds the evaluator's answer map with `makeCell` and computes `visibleQuestionKeys`; then returns
  **all** rows (`dropHidden:false`) or **only visible** rows (`dropHidden:true`).

| Caller | Mode | Why |
|---|---|---|
| `POST /mobile/voters/:voterId/survey` ([canvass.js](../server/src/routes/mobile/canvass.js)) | `dropHidden: true` (default) | Drop ghost answers to questions the current logic hides — a question the voter never saw can't count. |
| `PATCH /admin/:voterId/surveys/:responseId` ([routes/admin/voters.js](../server/src/routes/admin/voters.js)) | `dropHidden: false` | **Preserve recorded history** — keep answers even if newer `visibleIf` logic would now hide them. (If the template is missing, the edit is stored as-is rather than wiped.) |

### The `'__other__'` sentinel

"Other (specify)" is a per-question `otherOption` toggle, not a real option. On mobile it renders as
a synthetic choice `{ id: '__other__', text: 'Other (specify)' }`; when picked it shows a free-text
box whose value is submitted as `answer.otherText`, with `'__other__'` carried in `optionIds`. The
sentinel is accepted everywhere a real option id is: `normalizeAndFilterAnswers` (valid id set),
`validateVisibleIfIntegrity` / the builder's condition editor (a pickable rule target), and the
visibility evaluator (just another id).

## F. Submission & dedup invariants

`POST /mobile/voters/:voterId/survey` ([canvass.js](../server/src/routes/mobile/canvass.js)):

- Validates the template exists and matches the campaign (resolving a **per-effort survey override**
  — the door's effort survey wins over the campaign default; see [EFFORTS.md](EFFORTS.md)); resolves
  `passId`/`turfId`/`effortId` from the submission timestamp (see [PASSES_AND_TURF.md](PASSES_AND_TURF.md)).
- Runs `normalizeAndFilterAnswers(template, data.answers)` (`dropHidden:true`) before persisting.
- **Atomic upsert keyed on `(voterId, passId)`** (`findOneAndUpdate(..., { upsert: true })`) → at
  most one `SurveyResponse` per voter per pass; a re-submit replaces the prior answers, and a
  double-tap race that hits the unique index (`11000`) falls back to an update of the winner's row.
- Stores `surveyTemplateVersion: template.version || 1` and resets `editedBy`/`editedAt` (a fresh
  canvasser submission clears any prior admin-edit audit).
- Writes a `survey_submitted` `CanvassActivity` (household-scoped dedup → one knock per
  user/house/pass even for a multi-voter house) and updates `Voter.surveyStatus` / household status.

## G. Frontend mapping

| File | Renders |
|---|---|
| [client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) | Surveys list + builder (`SurveyForm`). Derives question `key` (`deriveKey`) and option `id` (`optionId`) by slugify-with-collision-suffix, both minted once and held immutable. Per-option **read-aloud script** field (`OptionRow`), **Other (specify)** toggle, and a **Show only if…** condition editor (`ConditionEditor`) that only lets a rule reference **earlier** questions and restricts text questions to `answered`/`not_answered` (`opsForType`); live `ruleError` validation mirrors the server. On a survey with responses it does **not** lock everything — only the **type** control is disabled (and removals soft-retire with a **Restore** affordance); it surfaces the PATCH `409 reasons`. Shows `usedByCampaigns` + `responseCount`; per-row **Duplicate**. Per option, a **+ tag** affordance reveals a **Tag combobox** (`OptionRow`: a text input + a shared `<datalist id="survey-tags">`), so you pick an existing palette tag or type a new one; `tagPalette` (a `useMemo`) is the case-insensitive union of `initial.tags` + every option's `tag` and is submitted as the survey's `tags`. **Auto-attach return loop**: `?attachTo=<campaignId>` opens the create form pre-tagged, then on save `PATCH /admin/campaigns/:attachTo { surveyTemplateId }` and `navigate('/campaigns/:attachTo/survey')` (cancel/back also returns there). No `refusalOption` UI. |
| [client/src/pages/CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) | In-campaign **Survey** tab (`/campaigns/:campaignId/survey`). Pure **association** UI — no authoring. States: **attached** (header + `SurveyPreview` + **Change survey** / **Edit in library →**), **no survey yet** (Pick / Create new → `?attachTo`), **lit-drop** (surveys-not-used note). Attach/change = `PATCH /admin/campaigns/:id { surveyTemplateId }`; warns when the chosen template has responses. No standalone unlink. |
| [client/src/components/SurveyPreview.jsx](../client/src/components/SurveyPreview.jsx) | Read-only render of a template (intro · questions sorted by `order` · closing); choice options as radio/checkbox glyphs, text as a placeholder. |
| [client/src/lib/surveyVisibility.js](../client/src/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded) — powers the builder's live condition validity and any preview gating. |
| [client/src/pages/CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) | Survey-template dropdown shows a heads-up when the chosen survey already has responses (repointing reports new answers separately). |
| [client/src/components/QuestionResults.jsx](../client/src/components/QuestionResults.jsx) | Per-question result charts from `survey-results` (retired/legacy buckets included). Exports **`TagResults`** — the report's **"Tags"** panel: one `TagRow` per `tags[]` entry (bar scaled to the most-reached tag, **distinct** `voterCount`), expandable to its contributing options and an inline `VoterList` that drills via `voters-by-answer?tag=<tag>&surveyTemplateId=<id>` (see §I). |
| [client/src/pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Renders `<TagResults>` below the per-question charts when `surveyResultsQ.data.tags` is non-empty, passing `surveyTemplateId` for the tag drill. |
| [client/src/components/AnswerFilters.jsx](../client/src/components/AnswerFilters.jsx) | The saved-search / targeted-round answer-filter chips. Beyond per-question `answerFilters`, it renders a **"By tag"** chip row from the `tags` palette prop (falling back to the case-insensitive union of option tags) and emits selected tags to the parent via `onTagChange` as **`answerTagFilters: [{ tag }]`** (case-insensitive, display-cased). |
| [client/src/pages/WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) | Saved-search builder. Wires `AnswerFilters` with `tags={surveyTags}` (from `survey-results` `tags[]`) + `answerTagFilters` into the filter (sent to `resolveWalkList`). Per saved search, **Export CSV** (`exportCsv`) does an **authenticated blob download**: `fetch` the export endpoint with `Authorization: Bearer` + `X-Org-Id` headers, read `res.blob()`, then click a synthetic `<a download>` (filename from `Content-Disposition`). |
| [client/src/components/CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx) | A canvasser's individual responses (shows template `version`). |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | The at-the-door form. Imports `makeCell` + `visibleQuestionKeys` and recomputes `visibleQuestions` live as answers change; renders single/multiple/text, inline **option scripts** on the picked option, the synthetic **`__other__`** choice with a "Please specify" box. Required-validation runs over **visible** questions only. Submits `{ optionIds, answer (snapshot), otherText, questionKey, questionLabel }` per visible answer; offline queue + optimistic recolor via `optimisticSubmit`. |
| [mobile/lib/surveyVisibility.js](../mobile/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded). |

## H. Migration

`npm run migrate:survey-option-ids`
([migrations/migrateSurveyOptionIds.js](../server/src/migrations/migrateSurveyOptionIds.js)) — the
additive, **idempotent**, dry-run-by-default backfill that establishes stable ids. Two steps:

- **A. Templates** — convert each question's plain-string options into `{ id, text, tag, script,
  retired, order }` objects, minting a stable per-question `id` via the same slugify-collision rule
  the builder/route use. Already-object options are left untouched.
- **B. Responses** — enrich each answer with `optionIds[]` by mapping its snapshot `answer` text to
  the template's option ids (exact text match). Nothing is rewritten: the `answer` text stays as the
  legacy/display fallback; unmatched values (renamed/removed options, free text, Other) simply get no
  id and keep reporting via text.

Run `--apply` with/before the deploy that ships dual-read reporting; safe to re-run.

## I. Tags (cross-question rollup, by-tag lists, CSV export)

A **tag** labels a survey **option** and groups options **across questions**, so reports and walk
lists can roll up everyone who picked **any** option carrying that tag. Tags are pure **admin
metadata** — the mobile field app is **unchanged** (canvassers never see them).

**Where tags live.** Each `SurveyTemplate…option.tag` is a `String` (default `null`); the template
also carries a **palette** `SurveyTemplate.tags: [String]` (the distinct display casings). The
builder authors both from one combobox (see §G — `OptionRow` + the shared `<datalist
id="survey-tags">`, fed by `tagPalette`).

**Case-insensitive matching + the save chokepoint.** All grouping/dedup keys off
`normalizeTag(s) = String(s).trim().toLowerCase()`
([services/surveys/tags.js](../server/src/services/surveys/tags.js)). On every save, the authoring
routes (§B) run `canonicalizeTags(questions, declaredTags)` from the same module: it dedups the
palette case-insensitively (**first casing wins** as the display form), rewrites **every**
`option.tag` to that canonical casing, and drops tags that aren't on a real option — so
"Supporter"/"supporter" collapse to **one** tag everywhere. The other two helpers there:

| Helper ([tags.js](../server/src/services/surveys/tags.js)) | Role |
|---|---|
| `tagOptionMap(template)` | `normalizedTag → { display, members: [{ questionKey, optionId, text }] }` over **all** options — **retired included** (their historical answers still count). `display` is the first casing seen. The single source of "which options does this tag cover." |
| `paletteTags(template)` | The distinct display tags **actually applied** to options (the `tagOptionMap` displays), sorted — note this reflects what's on options, which the stored `tags` palette may exceed. |

**The cross-question match clause.** `answerTagClause(template, tag)`
([services/surveys/answerAgg.js](../server/src/services/surveys/answerAgg.js)) looks the tag up in
`tagOptionMap`, then builds **one** `$or` by reusing `voterAnswerClause(questionKey, optionId, text)`
per member and flattening their `$or`s — a **single cross-question predicate** that the per-question
`answerFilters` (one clause per question, AND/OR-combined globally) can't express. Empty/unknown tag
→ `{ _id: null }` (matches nothing). Because it composes `voterAnswerClause`, each member inherits
the **dual-read** behavior (stable id **OR** legacy answer text), so retired/renamed options keep
counting.

**Reporting rollup — distinct voters per tag.** `GET /admin/reports/survey-results`
([reports.js](../server/src/routes/admin/reports.js)) appends a
`tags: [{ tag, voterCount, options: [{ questionKey, optionId, text, count }] }]` array: for each
`tagOptionMap` entry it runs `SurveyResponse.distinct('voterId', { ...match, ...answerTagClause(...) })`
so `voterCount` is **distinct voters** (counted **once** even if they hit the tag in several
questions), pulls the contributing `options` + per-option counts from the per-question breakdown
already built, and sorts by `voterCount` desc. Rendered by `TagResults`
([QuestionResults.jsx](../client/src/components/QuestionResults.jsx)) inside
[DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) (see §G).

**Drill to voters by tag.** `GET /admin/reports/voters-by-answer?tag=<tag>&surveyTemplateId=<id>`
([reports.js](../server/src/routes/admin/reports.js)) — when `tag` is present it requires
`surveyTemplateId`, loads the org-scoped template, and filters with `answerTagClause(template, tag)`
(otherwise it dual-reads a single option via `voterAnswerClause`). The report's `VoterList` opens
this when you expand a tag.

**Collect by tag (walk lists).** The walk-list filter gained `answerTagFilters: [{ tag }]`
([models/WalkList.js](../server/src/models/WalkList.js) `tagFilterSchema`).
`resolveWalkList` ([services/walklist/resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js))
loads `campaign.surveyTemplateId` and, for each tag, turns `answerTagClause(template, tag)` into
**one household predicate** (`SurveyResponse.distinct('householdId', …)`) — a cross-question OR added
to `predicateSets` alongside the per-question `answerFilters`, then AND/OR-combined by the filter's
global `combine`. The UI is the **"By tag"** section of
[AnswerFilters.jsx](../client/src/components/AnswerFilters.jsx), wired from
[WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) (see §G).

**CSV export of a saved search.** `GET /admin/campaigns/:campaignId/walklists/:id/export.csv`
([routes/admin/walklists.js](../server/src/routes/admin/walklists.js)) streams the saved search's
**frozen** `voterIds` (joined to their `Household`) as a CSV attachment — columns **Voter ID, First
Name, Last Name, Party, Age, Phone, Precinct, Address, City, State, ZIP** (`age` derived from
`dateOfBirth`, cells quoted via `csvCell`). It's not tag-specific (any saved search exports), but it
completes the "build a list by tag → take the list elsewhere" loop. The client downloads it as an
**authenticated blob** (`exportCsv` in [WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx)): a
plain `fetch` with `Authorization: Bearer` + `X-Org-Id` headers, `res.blob()`, then a synthetic
`<a download>` click — needed because a bare link can't send the auth headers.
