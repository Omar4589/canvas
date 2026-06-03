# Surveys

How surveys are built, run at the door, stored, and reported — and the one thing you must **not**
do to a survey that's already collecting answers.

- **Part 1 — For everyone** is plain language: what a survey is, how to build one, and the safe
  way to change one.
- **Part 2 — Technical reference** is for developers (and Claude): models, endpoints, the
  question/answer join that reporting relies on, and the integrity risk in editing a used survey.

Related: [METRICS.md](METRICS.md) ("Surveys" and "Surveyed voters" definitions),
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (one survey per voter **per pass**),
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

## Editing a survey — read this before you change a live one

You **can** edit any survey at any time — the app won't stop you. That's convenient before a survey
goes out, but **dangerous once responses exist**, because changing the questions can silently
corrupt the reports for answers already collected.

Think of it this way: every answer is filed under a question's short **id** (not its full text).
Reporting reads your **current** questions and pulls answers that match those ids. So:

- **Safe edits at any time** — fixing the **intro** or **closing** text, or correcting a typo that
  doesn't change what a question *means* or change its options.
- **Dangerous once answers exist** — changing a question's **options**, changing its **type**,
  rewording it so it means something different, or **deleting / reordering / replacing** questions.

Why it's dangerous, concretely: say 100 people answered "What's your top issue?" with options
*Economy / Schools / Crime*. You later reuse that question slot for "Most important race?" with
options *Mayor / Council / Judge*. Reporting now mixes the old 100 answers in with the new ones
under the same slot, and any old answer whose option text no longer exists just **disappears from
the charts** — with no warning. The numbers look fine; they're wrong.

**The rule of thumb:** once a survey is attached to a campaign and collecting answers, treat its
questions as frozen. If you need different questions, **create a new survey** and point the campaign
at it, rather than editing the live one. (We may add guardrails so the app enforces this — see the
note at the end of Part 2.)

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
| `GET /admin/surveys` | List templates; each annotated with `usedByCampaigns: [{id, name, isActive}]` ([surveys.js:39](../server/src/routes/admin/surveys.js)). | n/a |
| `POST /admin/surveys` | Create (Zod `upsertSchema`); sets `version: 1`, `createdBy` ([surveys.js:66](../server/src/routes/admin/surveys.js)). | n/a |
| `PATCH /admin/surveys/:surveyId` | Update; `Object.assign(existing, data)`; if `data.questions` present, `version = (version||1) + 1` ([surveys.js:83](../server/src/routes/admin/surveys.js)). | **None.** |

> **There is no edit guard.** `PATCH` does not check `SurveyResponse` count, campaign usage, or any
> lock/`isLocked`/published flag. The admin UI ([client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx))
> displays `usedByCampaigns` but never disables the Edit button and shows no warning. `version` is
> incremented on question changes but is **informational only** — nothing reads it to protect data.

## C. The edit-after-use integrity risk

Reporting (`GET /admin/reports/survey-results`,
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

Because the join is `key`-only against the live questions, editing a used survey produces these
failure modes:

| Edit after responses exist | Effect on reporting |
|---|---|
| **Reword a question** (same `key`) | Old + new answers merge under one question; the chart's title is the new wording but the bars include old-context answers. |
| **Change / rename options** | Old answers whose option text is no longer a current option still appear as their own `_id` bucket in the `$group` — orphan rows that don't line up with the current option set. |
| **Remove an option** | Old answers for it survive as an orphan bucket (count is right, label is "stale"); they're easy to misread or get filtered out downstream. |
| **Change a question's `type`** | e.g. `text` → `single_choice`: the `multiple_choice` `$unwind` / option grouping no longer matches how the old answers were shaped; aggregation is meaningless. |
| **Delete a question** | Its `key` is gone from `sortedQs`, so those answers are **never queried** — they vanish from reports while still sitting in the database. |
| **Reuse a `key` for a different question** | Worst case: two semantically different questions share a `key`; their answers are silently pooled. |

Mitigation that *exists*: every response snapshots `surveyTemplateVersion` and `questionLabel`, so
the raw data is recoverable. Mitigation that is *missing*: nothing in the read path uses those
snapshots, and nothing in the write path blocks the destructive edit.

> **Known gap / potential follow-up (not yet built).** Options, roughly in order of effort:
> (1) UI warning + confirm when editing a survey with `usedByCampaigns` / existing responses;
> (2) block destructive question edits server-side once `SurveyResponse.countDocuments({surveyTemplateId}) > 0` (allow intro/closing/typo-only changes);
> (3) "duplicate as new version" — clone the template, repoint the campaign, leave the old version immutable;
> (4) make `survey-results` version-aware (join answers to the question set of their `surveyTemplateVersion`, which requires storing per-version question snapshots).

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
| [client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) | Surveys list + builder (`SurveyForm`); derives `key` from label with collision suffixes; shows `usedByCampaigns`; Edit always enabled. |
| [client/src/components/QuestionResults.jsx](../client/src/components/QuestionResults.jsx) | Per-question result charts from `survey-results`. |
| [client/src/components/CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx) | A canvasser's individual responses (shows template `version`). |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | The at-the-door survey form (single/multiple/text), required-validation, note, offline queue. |
