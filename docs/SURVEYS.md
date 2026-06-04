# Surveys

How surveys are built, run at the door, stored, and reported — and the one thing you must **not**
do to a survey that's already collecting answers.

- **Part 1 — For everyone** is plain language: what a survey is, how to build one, and the safe
  way to change one.
- **Part 2 — Technical reference** is for developers (and Claude): models, endpoints, the
  question/answer join that reporting relies on, and the integrity risk in editing a used survey.

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
questions and remove them. When you attach the survey to a campaign, canvassers on that campaign
start seeing it.

The Surveys list also shows, for each survey, **which campaigns use it** — so you can see at a
glance whether a survey is live before you touch it.

## What a canvasser sees (mobile)

At a voter, the canvasser opens the survey, reads the intro, answers the questions (required ones
must be filled), can add a free-form note, and submits. Surveys submitted while offline are queued
and sync later. **One survey is kept per voter, per pass** — if a canvasser re-submits for the same
voter in the same pass, the new one replaces the old. A house with three voters surveyed in one
visit produces **three survey responses but counts as one knock** (see [METRICS.md](METRICS.md)).

## Editing a survey — what's allowed once it has answers

Before a survey collects any answers, edit it freely. **Once it has responses, the app protects
your reports**: you can still make safe edits, but the changes that would corrupt past results are
blocked, and the Surveys list shows a response count so you know which surveys are "live."

Why the protection exists: every answer is filed under a question's short **id** (not its full
text), and reporting reads your **current** questions and pulls answers that match those ids. Change
the questions out from under the stored answers and the charts quietly go wrong.

Once a survey has responses:

- **Still allowed (safe):** rename the survey, edit the **intro/closing**, reword a question, toggle
  **Required**, **reorder** questions, **add** a new question, and **add** a new option. These don't
  disturb stored answers.
- **Blocked (would corrupt reports):** **deleting** a question, **changing a question's type**, and
  **removing or renaming** an existing option. The builder locks these controls and the server
  rejects them with a clear reason.

Why those are blocked, concretely: say 100 people answered "What's your top issue?" with options
*Economy / Schools / Crime*. If you renamed *Economy* to *The Economy*, every stored "Economy"
answer would no longer match an option and would **drop off the chart** — silently. So that edit is
refused.

**Need to change the locked parts?** Use **Duplicate** on the Surveys list. It makes a fresh,
fully-editable copy (reset to v1); point your campaign at the copy on the Campaigns page. The
original stays intact so its existing reports keep working. Note: after you repoint a campaign, that
campaign's new answers report under the **copy**, separate from the answers already gathered under
the original — the Campaigns page shows a heads-up when you pick a survey that already has responses.

---

# Part 2 — Technical reference

The implementation lives in
[`server/src/routes/admin/surveys.js`](../server/src/routes/admin/surveys.js) (authoring),
[`server/src/routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js) (submission), and
the `survey-results` handler in
[`server/src/routes/admin/reports.js`](../server/src/routes/admin/reports.js) (reporting).

## A. Data model

| Model | File | Fields that matter |
|---|---|---|
| `SurveyTemplate` | [models/SurveyTemplate.js](../server/src/models/SurveyTemplate.js) | `organizationId`, `name`, `isActive`, `version` (default 1), `intro`, `closing`, `questions[]`, `createdBy`. Org-scoped, **not** campaign-scoped (a campaign points at a template via `Campaign.surveyTemplateId`). |
| `SurveyTemplate.questions[]` | same | Embedded sub-doc **`{ _id: false }`** → questions have **no stable database id**. `key` (string, required), `label`, `type` (`single_choice`/`multiple_choice`/`text`), `options[]`, `required`, `order`. The `key` is the only durable handle on a question. |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `surveyTemplateId`, **`surveyTemplateVersion`** (snapshot at submit), `answers[]`, `voterId`, `householdId`, `userId`, `campaignId`, `organizationId`, `passId`/`turfId` (metadata, nullable), `location`, `submittedAt`, `wasOfflineSubmission`, `editedBy`/`editedAt`. Indexes: `{voterId, passId}` (within-pass dedup), `{householdId, passId}`. |
| `SurveyResponse.answers[]` | same | Embedded `{ _id: false }`: `questionKey` (matches a template question's `key`), `questionLabel` (**snapshot** of the question text at submit time), `answer` (Mixed — string, or string[] for multiple choice, or null). |

The `key` is generated in the builder by slugifying the label, with collision suffixes
(`top_issue`, `top_issue_2`, …). It is the join key between a response and its question.

## B. Endpoints (authoring)

All under `/admin/surveys`, guarded by `requireAuth, orgContext, requireOrgRole('admin')`.

| Method · path | Purpose | Guard on used surveys? |
|---|---|---|
| `GET /admin/surveys` | List templates; each annotated with `usedByCampaigns: [{id, name, isActive}]` plus **`responseCount`** / **`hasResponses`** (one `SurveyResponse.aggregate` count per template). | n/a |
| `POST /admin/surveys` | Create (Zod `upsertSchema`); sets `version: 1`, `createdBy`. | n/a |
| `PATCH /admin/surveys/:surveyId` | Update; if `data.questions` present, diff vs the stored questions and **block destructive edits** when responses exist; else apply and bump `version`. | **Yes** (see below). |
| `POST /admin/surveys/:surveyId/duplicate` | Clone into a fresh template (`name: "<name> (Copy)"`, `version: 1`, `isActive: false`, no campaign link). | n/a |

> **Edit guard (implemented).** When the survey has responses and the PATCH includes `questions`,
> `classifyQuestionEdits(old, new)` ([services/surveys/diffQuestions.js](../server/src/services/surveys/diffQuestions.js))
> flags **destructive** changes — a question removed or its `key` changed, a `type` change, or an
> existing `option` removed/renamed. Any of those → **`409 { code: 'survey-has-responses', reasons }`**.
> Safe changes (name/intro/closing, add question, add option, label/`required`, reorder) pass through
> and still bump `version`. The builder ([client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx))
> mirrors this — it shows the response count, locks the destructive controls on existing questions,
> and offers **Duplicate** — with the server as the source of truth (it surfaces the `409` reasons).

## C. Why those edits are blocked (the integrity risk being guarded)

The guard in §B exists because reporting (`GET /admin/reports/survey-results`,
[reports.js:636](../server/src/routes/admin/reports.js)) joins answers to the **current** template by
`questionKey`, ignoring the stored `surveyTemplateVersion` and `questionLabel` snapshot:

```js
template = await SurveyTemplate.findOne({ _id: surveyTemplateId, organizationId }).lean(); // current
const sortedQs = [...(template.questions || [])].sort((a,b) => (a.order||0) - (b.order||0));
for (const q of sortedQs) {
  const pipeline = [
    { $match: match },                              // all responses for this template
    { $unwind: '$answers' },
    { $match: { 'answers.questionKey': q.key } },    // join by key — NOT by version
    // q.type === 'multiple_choice' ? $unwind '$answers.answer'
    { $group: { _id: '$answers.answer', count: { $sum: 1 }, /* preview ids */ } },
  ];
}
```

Because the join is `key`-only against the live questions, the following edits would corrupt reports
if they were allowed — which is exactly why the PATCH guard refuses them once responses exist:

| Edit after responses exist | Effect on reporting |
|---|---|
| **Reword a question** (same `key`) | Old + new answers merge under one question; the chart's title is the new wording but the bars include old-context answers. |
| **Change / rename options** | Old answers whose option text is no longer a current option still appear as their own `_id` bucket in the `$group` — orphan rows that don't line up with the current option set. |
| **Remove an option** | Old answers for it survive as an orphan bucket (count is right, label is "stale"); they're easy to misread or get filtered out downstream. |
| **Change a question's `type`** | e.g. `text` → `single_choice`: the `multiple_choice` `$unwind` / option grouping no longer matches how the old answers were shaped; aggregation is meaningless. |
| **Delete a question** | Its `key` is gone from `sortedQs`, so those answers are **never queried** — they vanish from reports while still sitting in the database. |
| **Reuse a `key` for a different question** | Worst case: two semantically different questions share a `key`; their answers are silently pooled. |

Each response also snapshots `surveyTemplateVersion` and `questionLabel`, so the raw data is
recoverable even if a destructive change somehow lands (e.g. via a direct DB write).

> **What's implemented vs. still open.** The write path now **blocks** the destructive edits above
> once responses exist (§B), and **Duplicate** is the supported way to evolve a live survey's
> questions. Still *not* done (intentionally, for now): making the **read path version-aware** — the
> report still joins to the current questions by `key`, so it can't render answers from two different
> question-sets of the *same* template side by side. With the write guard + Duplicate in place this
> is largely moot (structural change ⇒ a new template), but a future "duplicate as new version" that
> keeps both under one campaign report would need per-version question snapshots in `survey-results`.

## D. Submission & dedup invariants

`POST /mobile/voters/:voterId/survey` ([canvass.js:218](../server/src/routes/mobile/canvass.js)):

- Validates the template exists and matches the campaign; resolves `passId`/`turfId` from the
  submission timestamp (see [PASSES_AND_TURF.md](PASSES_AND_TURF.md) for pass attribution).
- **Deletes any prior response for the same `(voterId, passId)`** before inserting → at most one
  `SurveyResponse` per voter per pass (mirrors the knock dedup in [METRICS.md](METRICS.md)).
- Stores `surveyTemplateVersion: template.version || 1` and the `answers` array verbatim from the
  client (so `questionKey` + `questionLabel` are snapshotted).
- Writes a `survey_submitted` `CanvassActivity` (household-scoped dedup → one knock per
  user/house/pass even for a multi-voter house) and updates `Voter.surveyStatus` / household status.

## E. Frontend mapping

| File | Renders |
|---|---|
| [client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) | Surveys list + builder (`SurveyForm`); derives `key` from label with collision suffixes; shows `usedByCampaigns` + **response count**; when a survey has responses, locks destructive controls on existing questions and surfaces PATCH `409` reasons; **Duplicate** action per row. |
| [client/src/pages/CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) | Survey-template dropdown shows a heads-up when the chosen survey already has responses (repointing reports new answers separately). |
| [client/src/components/QuestionResults.jsx](../client/src/components/QuestionResults.jsx) | Per-question result charts from `survey-results`. |
| [client/src/components/CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx) | A canvasser's individual responses (shows template `version`). |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | The at-the-door survey form (single/multiple/text), required-validation, note, offline queue. |
