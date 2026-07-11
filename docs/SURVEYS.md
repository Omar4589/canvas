# Surveys

How surveys are built, run at the door, stored, and reported — including conditional questions,
read-aloud option scripts, "Other (specify)", and the (now much more permissive) rules for editing a
survey that's already collecting answers.

- **Part 1 — For everyone** is plain language: what a survey is, how to build one (including
  branching logic, per-option scripts, and **tags** that group answers across questions), and what
  you can safely change once it has answers.
- **Part 2 — Technical reference** is for developers (and Claude): the data model, dual-read
  reporting, the soft-retire reconcile, the shared visibility evaluator, answer normalization, the
  migrations, and the **tags** story — the org-level `Tag` library + management API, the
  cross-question rollup, by-tag walk lists, and CSV export.

Related: [METRICS.md](METRICS.md) ("Surveys" and "Surveyed voters" definitions),
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (one survey per voter **per pass**),
[EFFORTS.md](EFFORTS.md) (a **walk list can override** the campaign survey — the door's walk-list
survey wins, falling back to the campaign default),
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

## The Surveys library page (web admin)

The org **Surveys** page is a proper library now — built to answer "what surveys do we have and how
are they doing?" at a glance, with authoring split out onto its own pages:

- **Stat cards** up top: total surveys, total responses, how many are **in use** (attached to a
  campaign or walk list), and how many are **drafts** (not attached anywhere).
- A **search box** and an **Active / Archived / All** filter over the list.
- One **row per survey**: name + created date, **everywhere it's used** — campaigns *and* walk-list
  overrides (a survey used only on a walk list used to show as unused; it doesn't anymore) — question
  count (what canvassers actually see; retired questions don't inflate it), response count, and a
  version badge.
- **Click a row** to open the **quick view** — a side panel with the survey's dates, everywhere it's
  used (each linking straight to that campaign's results), response totals **per campaign**, and a
  read-only preview of every question. It's the fast way to *see* a survey without opening the
  builder; **View full results →** jumps to the campaign dashboard's Survey-results section.
- **Actions** live on each row (⋮ menu) and in the quick view: **Edit**, **Duplicate**, and
  **Archive** or **Delete** (see below).

**Creating and editing** happen on dedicated pages — **+ New survey** opens `/surveys/new` and
**Edit** opens `/surveys/<id>/edit`, both hosting the full builder; save or cancel returns you to
the library. In the builder you give the survey a name, write the intro/closing, then add questions —
wording, type, options, required. When you attach the survey to a campaign, canvassers on that
campaign start seeing it.

### Archiving and deleting

- **Archive** hides a survey from the Active list and from every survey picker (campaign form,
  Change-survey dialog, walk-list override dropdowns) — **without touching anything**: campaigns
  still using it keep working, responses keep reporting, and wherever it's currently selected it
  stays visible (labeled "archived") so nothing silently resets. **Unarchive** brings it back.
  Archive is for retiring old questionnaires you're done with but whose data you keep.
- **Delete** is only offered for a survey that is truly unused — **zero responses, not any
  campaign's survey, not any walk list's override**. Anything in use shows Archive instead, and the
  server refuses an in-use delete with the specific reasons. Delete is permanent; it exists so an
  abandoned draft doesn't live forever.

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

**Tags are an organization library now.** Instead of being typed fresh into each survey, your tags
live in **one managed list** that belongs to your organization and is shared across **every** survey
and saved search. That single list is the source of truth — so "Supporter" means the same thing
everywhere, and you can't accidentally end up with "Supporter," "supporters," and "Suporter" all
floating around as separate things.

**Adding a tag in the builder.** Each answer option has a small **+ tag** link; click it and a
**pick-or-create** box appears. As you type it filters your organization's existing tags — click one
to use it. If what you typed doesn't match any tag, you get an explicit **"Create '…'"** action; only
then is a brand-new tag added to the library. There's no silent typo that quietly forks the list — you
either pick something that already exists or deliberately create a new one. Matching is **not
case-sensitive**: "Supporter," "supporter," and "SUPPORTER" are all the same tag.

**Managing the library (the Tags page).** A dedicated **Tags** page in the main (organization) nav
lists every tag with a **usage summary** — how many options carry it, across how many surveys, and how
many saved searches filter by it. From there you can:

- **Create** a tag up front (or just let the builder create it the first time you use one).
- **Rename** a tag — the new name is rewritten **everywhere at once**: every survey option, every
  survey's tag list, and every saved-search "by tag" filter. Your reports and lists keep working;
  only the label changes.
- **Merge** two tags into one — pick a target and the source's options, surveys, and saved searches
  all fold into the target, then the duplicate is removed. (If you try to *rename* a tag to a name
  that already exists, the page tells you it would collide and offers to **merge into it** instead.)
- **Delete** a tag — it's removed from the library and **untagged everywhere** it was used (you're
  shown its usage and asked to confirm first).

Rename, merge, and delete all **heal across every survey and saved search** in one move — there's no
hunting through individual surveys to fix a label.

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

## The campaign's "Survey" tab (every survey this campaign uses)

Each campaign has its own **Survey** tab (open a campaign, then **Survey** in the sidebar). It's a
**coverage view**: not just the default survey, but **which survey every set of doors actually
gets** — so a campaign running two surveys at once (see the next section) is fully visible and
manageable from one screen.

- **The main survey card** — the campaign's default template with its **response count for this
  campaign** (Intake doors + every walk list that doesn't override). The full question list is
  tucked behind a **Preview** toggle (collapsed by default) so the card stays short and the walk-list
  section sits above the fold. Surveys stay reusable **org-level templates**, but you don't get
  bounced to the org-wide list to work on one: **creating and editing happen right here in the
  drill-in** — the builder opens in place and returns you to this tab on save.
- **The "Walk list coverage" table** — one row per walk list: its doors, **which survey it runs**
  (a dropdown that reads "Campaign default → *name*" until you override it), and its **response
  count**. Change a walk list's survey right here — this is the same override the Walk Lists page
  edits, shown from the survey's point of view. If responses came in from doors not yet assigned to
  any walk list, an **Intake** row shows them under the default.

**Creating a survey (one top-level "New survey" button):** click **New survey** in the tab header.
If the campaign has **no main survey yet**, the one you build becomes the main survey (used
everywhere). If a main **already exists**, the new survey is **added to your library** (it never
silently replaces the main) and the tab shows *"'X' created — assign it to a walk list below,"* with
the new survey now available in every walk-list dropdown. To run a second survey on specific doors,
you assign it to a walk list — here or on the Walk Lists page.

**Team leads can now author surveys** for a campaign they manage — **New survey** and **Edit survey**
are available to them, not just admins. They stay scoped to their campaign: the server only lets a
lead edit a survey they **authored** or one **attached to a campaign they manage**, and leads never
see the org-wide Surveys library (which lists every campaign's surveys). Leads can pick from existing
tags but can't create new ones (tag creation stays admin-only). Archiving/deleting templates stays
admin-only too.

From the main card you can:

- **Change survey** — pick a different template from your library for this campaign.
- **Edit survey** — open the builder **right here in the campaign** to edit the attached survey's
  questions; saving returns you to this tab. If that survey is **shared by other campaigns**, the
  builder warns you that edits apply to all of them and offers a one-click **Duplicate** so you can
  edit just this campaign's own copy.

A few rules this tab enforces:

- A **lit-drop campaign** shows a short "surveys aren't used for this campaign" note instead —
  lit-drops record drops, not responses.
- A **survey campaign can't activate a round until a survey is attached** — until then canvassers
  have nothing to fill out. If walk lists have overrides but **no default is attached**, the tab
  warns you: override lists keep working, but Intake doors and non-override lists have no survey.
- **Swapping mid-canvass is allowed.** If you change to a different survey after answers have come
  in, the old responses keep reporting under the old survey and new answers report under the new one
  — nothing is lost or mixed. If the survey you pick **already has responses**, the tab warns you
  that new answers will report **separately** from those.
- There's **no "unlink"** — to stop using a survey you simply **change to a different one**.

## Different surveys for different walk lists

Most campaigns use one survey for everyone — but sometimes different groups need **different
questions** (say a persuasion script for swing doors and a volunteer-recruitment script for your
base). You don't need separate campaigns for that: a **walk list can override the campaign's default
survey with its own**.

- The campaign's **Survey** tab sets the **default** — the survey every door uses unless its walk
  list says otherwise.
- The override can be set in **either place**: the Survey tab's **Walk list coverage** table (the
  survey-centric view, with per-walk-list response counts) or the **Walk Lists** page's **Survey
  override** dropdown (defaults to "Campaign default"). They edit the same setting. Point one walk
  list at "GOTV" and leave another on the default, and each group gets its own questionnaire.
- In the field the app resolves the survey **per door** (household → its book → its walk list's
  override, else the campaign default), so a canvasser working doors from two walk lists sees a
  walk-list switcher and always gets the right questions for the door in front of them. The server
  rejects a submission that doesn't match the door's survey, so the wrong one can't be recorded.
- **Reporting keeps them separate.** Every response is stamped with both the survey it used and the
  walk list it came from, so answers never bleed across surveys and you can filter any report to a
  single walk list. (See the next section, and [EFFORTS.md](EFFORTS.md) for the mechanics — internally
  the override lives on the walk list's `Effort.surveyTemplateId`.)

## Reading results when a campaign used more than one survey

Because a swapped-out survey keeps its own responses, a campaign can end up with answers under **two
or more** surveys over its life. The campaign **dashboard's "Survey results"** section handles this
with a **survey switcher**: when the campaign has answers under a survey other than the one currently
attached, a dropdown appears in the section header. It defaults to the **current** survey (labeled
"current") and lets you jump to any **past** survey's results in one click — so nothing a campaign
collected is ever hidden. A campaign that has only ever used one survey shows no switcher.

How the counts split, so you can trust the numbers:

- **Per-answer breakdowns and tag rollups are per (campaign + survey).** Each response is stamped with
  both its `campaignId` and the `surveyTemplateId` that was attached when it was recorded, so
  "Support: 40" always means *40 for the survey you're looking at* — surveys never bleed into each
  other.
- **The gross "surveys submitted" tally is per-campaign** and sums across every survey the campaign
  used (it counts responses, not a particular answer).
- **Tags do not roll up across different surveys.** A "Supporter" tag on survey A and a "Supporter"
  tag on survey B are counted independently. If you want one combined supporter universe, **evolve a
  single survey by editing it** (add the new question — see "Editing a survey…" below) rather than
  standing up a second survey for the same question.

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
| `SurveyTemplate` | [models/SurveyTemplate.js](../server/src/models/SurveyTemplate.js) | `organizationId`, `name`, `isActive`, `version` (default 1), `intro`, `closing`, `questions[]`, **`tags: [String]`** (a per-survey **palette** — the distinct display casings of the tags its options use; **derived/kept-in-sync on save**, no longer the source of truth — the org-level **`Tag`** library is, see §I), **`archivedAt`** (`Date \| null`, indexed — soft-archive; hides the template from the Active list + all pickers unless currently selected, touches nothing else; no migration needed, existing docs default `null`), `createdBy`. Org-scoped, **not** campaign-scoped (a campaign points at a template via `Campaign.surveyTemplateId`). |
| `Tag` | [models/Tag.js](../server/src/models/Tag.js) | The **org-level managed tag library** (Phase 3.1): `organizationId`, `name` (canonical display), **`normalizedName`** (trim+lowercase dedupe key), `color` (reserved for a future colored-chip UI, default `null`), `createdBy`, timestamps. **Unique index `{ organizationId, normalizedName }`** makes duplicate tags structurally impossible. Survey options still reference a tag by its display `name` **as a string** (`option.tag`); this collection is the picklist + the target of rename/merge/delete (see §I). |
| `SurveyTemplate.questions[]` | same (`questionSchema`, `{ _id: false }`) | `key` (stable per-survey slug, **the join handle** — never reused once retired), `label`, `type` (`single_choice`/`multiple_choice`/`text`), `options[]`, `required`, `order`, **`retired`** (soft-retire a whole question), **`visibleIf`** (conditional display, default `null`), **`otherOption`** (boolean — adds an "Other: ___" choice), **`refusalOption`** (boolean — reserved for a future door-outcome feature; **no UI, not wired**). |
| `SurveyTemplate…options[]` | same (`optionSchema`, `{ _id: false }`) | **`id`** (stable per-question id — reports/conditions join on this, so `text` is freely editable), `text`, **`tag`** (cross-question group label, default `null`; canonicalized to the palette's casing on save — see §I), **`script`** (per-option read-aloud line), **`retired`** (soft-hide from the field, keep in reports), `order`. |
| `SurveyTemplate…visibleIf` | same (`visibleIfSchema`) | `logic` (`all`/`any`, default `all`) + `rules[]`. Each rule (`ruleSchema`): `questionKey` (an **earlier** question), `op` (`is`/`is_not`/`any_of`/`answered`/`not_answered`), `optionIds[]`. |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `surveyTemplateId`, **`surveyTemplateVersion`** (snapshot at submit), `answers[]`, `voterId`, `householdId`, `userId`, `campaignId`, `organizationId`, `passId`/`turfId`/`effortId` (metadata, nullable), `location`, `submittedAt`, `wasOfflineSubmission`, `editedBy`/`editedAt`. Unique index `{voterId, passId}` (within-pass dedup, DB-enforced); index `{householdId, passId}`. |
| `SurveyResponse.answers[]` | same (`answerSchema`, `{ _id: false }`) | `questionKey` (matches a template question's `key`), `questionLabel` (**snapshot** at submit), **`optionIds[]`** (stable id(s) chosen — the id-native tracking key; single → 1, multi → N, empty for free-text), **`otherText`** (free text typed into the `__other__` option), `answer` (Mixed — string \| string[] \| free text; **kept as a human-readable snapshot AND the legacy reporting fallback** for rows recorded before stable ids existed). |

The `key` is derived in the builder by slugifying the label, with collision suffixes
(`top_issue`, `top_issue_2`, …); option `id`s are derived the same way within a question. Both are
minted once and held immutable so conditions and stored answers keep pointing at the right thing.

## B. Endpoints (authoring)

All under `/admin/surveys`. The router mounts `requireAuth, orgContext, requireOrgRole('admin','lead')`
— that gates the **role**. Create/edit/duplicate are open to **leads** so they can author within
their campaign; **scope** is enforced per-survey by `canManageSurvey(req, survey)`
([services/authz/campaignManagement.js](../server/src/services/authz/campaignManagement.js)): admins →
any; a lead → only a survey they **authored** (`createdBy`, checked first so the create-then-edit-
before-attach case works) **or** one attached to a campaign in their `managedCampaignIds` (as the
campaign default **or** any `Effort` walk-list override). Archive/unarchive/delete stay
**`requireOrgRole('admin')`** (library lifecycle).

| Method · path | Purpose |
|---|---|
| `GET /admin/surveys` | List templates; each annotated with `usedByCampaigns: [{id, name, isActive}]` (campaign **defaults**), **`usedByWalkLists: [{campaignId, campaignName, effortId, effortName}]`** (every `Effort` whose `surveyTemplateId` points here — a survey used *only* as a walk-list override previously showed no usage at all), **`responseCount`** / **`hasResponses`** (org-wide `SurveyResponse.aggregate`), and **`responseCountByCampaign: [{campaignId, campaignName, count}]`** (a second aggregate grouped by `{surveyTemplateId, campaignId}`; a legacy null-`campaignId` bucket is labeled "No campaign"). `archivedAt` flows through — **archived templates are still returned**; Active/Archived filtering is client-side so one `['surveys']` cache serves the list and every picker. |
| `POST /admin/surveys` | Create (admin **or lead** — no per-survey scope needed; nothing is attached yet, `createdBy` is stamped as the caller, and the follow-on campaign/effort attach is separately campaign-manager-scoped). Zod `upsertSchema` (optional `tags: [String]` palette); `assignOptionIds` mints ids for any id-less option, `validateVisibleIfIntegrity` checks the rule graph, then `canonicalizeTags(withIds, data.tags)` collapses the palette + every `option.tag` to one case-insensitive casing (see §I), and sets `version: 1`, `createdBy`. **Then `ensureTags(orgId, tags, userId)`** auto-upserts org `Tag` docs (see §I). |
| `PATCH /admin/surveys/:surveyId` | Update (admin, or a **lead** who passes `canManageSurvey` → else `403`). When `questions` are present: if the survey **has responses**, `classifyQuestionEdits` blocks **only a question type change** → `409 { code: 'survey-has-responses', reasons }`. Otherwise `reconcileQuestions` (soft-retire absent items, mint ids for new options), `validateVisibleIfIntegrity`, then `canonicalizeTags(reconciled, data.tags ?? existing.tags)`, apply, and bump `version`. After save, **`ensureTags`** auto-upserts the library (see §I). |
| `POST /admin/surveys/:surveyId/duplicate` | Clone into a fresh template (`name: "<name> (Copy)"`, `version: 1`, `isActive: false`, no campaign link, questions copied verbatim, `createdBy` = caller so a lead can then edit their copy). Admin, or a **lead** who passes `canManageSurvey` → else `403` (the answer-type-change escape hatch must work for leads on their campaign's surveys). |
| `POST /admin/surveys/:surveyId/archive` · `POST /admin/surveys/:surveyId/unarchive` | Set/clear `archivedAt`. **Idempotent** (re-archiving keeps the original timestamp). Deliberately separate POSTs — not a PATCH flag — so the upsert/reconcile/version-bump path never sees archive state. Attaching an archived survey is only blocked in the UI (pickers hide it); the API still allows it, keeping unarchive-then-attach trivial. |
| `DELETE /admin/surveys/:surveyId` | Hard-delete, **only when truly unused**. Guard = `SurveyResponse.exists` ∨ `Campaign.exists({surveyTemplateId})` ∨ `Effort.exists({surveyTemplateId})` → `409 { code: 'survey-in-use', reasons: [...] }` naming each reference; otherwise `200 { ok: true }`. Wrong-org / missing id → `404`. |

> **Per-walk-list response counts** live on the efforts endpoint, not here:
> `GET /admin/campaigns/:campaignId/efforts` ([routes/admin/efforts.js](../server/src/routes/admin/efforts.js))
> now returns `responseCount` per effort plus a top-level **`intakeResponseCount`** (responses whose
> `effortId` is null — Intake / pre-walk-list doors). The campaign Survey tab computes the **default
> survey's coverage count** as `intakeResponseCount + Σ responseCount` of efforts **without** an
> override — exact even when the default template is also some walk list's override (a per-survey
> total would double-count there). Guard is `requireCampaignManager`, so leads who run the campaign
> can read counts and set overrides (`PATCH …/efforts/:id { surveyTemplateId }`).

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
| [client/src/pages/SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) | The org **Surveys library** — a pure **list + quick-view** page (authoring lives on `SurveyEditorPage`). `StatCard` row (surveys / total responses / in use / drafts), search + `Segmented` **Active/Archived/All** filter (client-side over `archivedAt`), and a `DataTable` with one row per template: name + created date, **Used in** (campaign names *and* `"{campaign} · {walk list}"` override labels from `usedByWalkLists`), **question count excluding retired questions**, `responseCount`, version/Archived badge, and a `RowMenu` (⋮) with **Edit / Duplicate / Archive-or-Delete** (Delete only when `responseCount === 0` and unused — the server re-checks). Row click opens the **`SurveyQuickView`** drawer. Owns the `duplicate`/`archive`/`unarchive`/`delete` mutations, all invalidating **`['surveys']`** — the one cache key every survey consumer now shares (EffortsPage/CampaignsPage previously used a divergent `['admin','surveys']`; TagsPage's post-delete invalidation had been silently pointing at that dead key). Back-compat: `/surveys?attachTo=<id>` redirects to `/surveys/new?attachTo=<id>`. |
| [client/src/components/SurveyQuickView.jsx](../client/src/components/SurveyQuickView.jsx) | The row-click **quick view**, built on the design-system `ui/Drawer` (right-side slide-over). Sections: version + In use/Draft/Archived badges; created/updated dates + active question count; **Used in** — campaign defaults and walk-list overrides, each linking to `/campaigns/:id?survey=<templateId>` (the dashboard deep-link); **Responses** — org-wide total + the per-campaign split from `responseCountByCampaign` (null-campaign bucket labeled, never linked); a `SurveyPreview` of the questions; and a sticky action bar — **Edit survey** (→ `/surveys/:id/edit`), **Duplicate**, and **Delete** (confirm; only when unused) or **Archive/Unarchive**. Surfaces a delete `409`'s `reasons[]` if one races through the client-side gate. **View full results →** renders one link per campaign in the union of current attachments and campaigns with responses. |
| [client/src/pages/SurveyEditorPage.jsx](../client/src/pages/SurveyEditorPage.jsx) | The **dedicated org builder host** — routes `/surveys/new` and `/surveys/:surveyId/edit` (both in the `requireOrgAdmin` group). Renders the shared `SurveyForm` from [components/SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx) (`QuestionCard`/`OptionRow`/`ConditionEditor`; derives question `key` via `deriveKey` and option `id` by slugify-with-collision-suffix, minted once and held immutable; per-option **read-aloud script**, **Other (specify)**, **Show only if…** with live `ruleError` validation mirroring the server; on a survey with responses only the **type** control locks and removals soft-retire with **Restore**; surfaces the PATCH `409 reasons`). Loads the org tag library (`['admin','tags']`) for the `TagPicker`, same as the in-campaign builder. Edit mode finds its survey in the cached `['surveys']` list (no single-survey GET; load errors render instead of silently bouncing). Two hand-off flows on the create route: **`?attachTo=<campaignId>`** — create → `PATCH /admin/campaigns/:id { surveyTemplateId }` (campaign default) → back to that Survey tab; **`?assignEffort=<effortId>&campaignId=<id>`** — create → `PATCH /admin/campaigns/:id/efforts/:effortId { surveyTemplateId }` (walk-list override) → back to that Survey tab. Plain visits return to `/surveys`. No `refusalOption` UI. |
| [client/src/components/WalkListSurveySelect.jsx](../client/src/components/WalkListSurveySelect.jsx) | The **one** walk-list survey-override picker, shared by `CampaignSurveyPage` and `EffortsPage` so the archived-hiding rule lives in a single place: first option **"Campaign default"** (`''` → `onChange(null)`), then `surveys.filter(s => !s.archivedAt \|\| String(s._id) === current)` — an effort already pinned to a now-archived survey keeps its option (labeled `· archived`) instead of silently reading "Campaign default". A stale/unknown id renders an "Unknown survey" option rather than crashing. |
| [client/src/components/TagPicker.jsx](../client/src/components/TagPicker.jsx) | The per-option tag combobox used by the survey builder's `OptionRow`. Filters the org `tags` prop case-insensitively; selecting an existing tag is the default. The **"Create '…'" action** appears only when nothing matches **and `onCreate` is provided** — so when the builder withholds `onCreateTag` (a **team lead**, since `POST /admin/tags` is admin-only) it becomes pick-only and the placeholder drops "or create one". Renders a selected tag as a clearable chip. |
| [client/src/pages/TagsPage.jsx](../client/src/pages/TagsPage.jsx) | The **org-level Tags management page** (route `/tags`, an `ORG_NAV` entry — [navItems.js](../client/src/components/navItems.js)). Lists every org `Tag` from `GET /admin/tags` with a `usageSummary` ("on M options, across N surveys, K saved searches"), plus search. **Create** (`POST /admin/tags`), inline **Rename** (`PATCH /admin/tags/:id`; a `409 { code: 'tag-exists' }` surfaces a **"merge into it"** button targeting the clashing `tagId`), **Merge** (`POST /admin/tags/:id/merge { targetId }` via a target picker), and **Delete** (`DELETE /admin/tags/:id` behind a usage-aware `confirm`). Delete also invalidates `['surveys']` since the builder reads tagged options. |
| [client/src/pages/CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) | In-campaign **Survey** tab (`/campaigns/:campaignId/survey`) — the **coverage view**. Header holds a top-level **New survey** button (→ `/campaigns/:id/survey/new`). Section 1: the **main survey card** (badge `Default`, `SurveyPreview` behind a **Preview** toggle collapsed by default so the walk-list table stays above the fold, **Change survey** / **Edit survey** → `/campaigns/:id/survey/edit`) whose response count is the **coverage count** (`intakeResponseCount + Σ responseCount` of no-override efforts — see §B), not the template's org-wide total. Section 2: the **Walk list coverage** `DataTable` — per effort: status badge, doors, a `WalkListSurveySelect` wired to `PATCH …/efforts/:id { surveyTemplateId }` (invalidates `['admin','efforts',campaignId]`, the same key `EffortsPage` reads), its `responseCount`; an **Intake** row appears when null-`effortId` responses exist. A `?created=<id>` param (set by the builder after creating a survey that isn't the main) shows a dismissible "assign it to a walk list" banner. States: no default + overrides → warning; no walk lists → pointer to the Walk Lists page; **lit-drop** unchanged. **Authoring affordances (New/Edit) gate on `canManage` = `isOrgAdmin || managedCampaignIds.includes(campaignId)`** — so campaign-managing **leads** author too; the server (`canManageSurvey`) is the real scope gate. Attach/change = `PATCH /admin/campaigns/:id { surveyTemplateId }`; the Change-survey picker hides archived templates unless attached. |
| [client/src/pages/CampaignSurveyBuilderPage.jsx](../client/src/pages/CampaignSurveyBuilderPage.jsx) | **In-drill-in survey builder** (`/campaigns/:campaignId/survey/new` and `/survey/edit`) — **now in the console route group, so campaign-managing leads reach it** (was admin-only). Renders the shared `SurveyForm` inside the campaign so authoring never bounces to the org list. **New (conditional attach):** `POST /admin/surveys`, then **attach as the campaign default only when it has none yet** (`!campaign.surveyTemplateId`) — a new survey never silently replaces the main; either way it returns to the Survey tab with `?created=<id>`. **Edit**: `PATCH /admin/surveys/:id`; when the template is **shared by other campaigns** it warns and offers **Duplicate** (works for leads too — `canManageSurvey` permits editing/duplicating a survey attached to their managed campaign). Loads the org tag library; passes `onCreateTag` **only when `isOrgAdmin`** so leads pick existing tags but the "Create tag" affordance is hidden (`POST /admin/tags` is admin-only). |
| [client/src/components/SurveyPreview.jsx](../client/src/components/SurveyPreview.jsx) | Read-only render of a template (intro · questions sorted by `order` · closing); choice options as radio/checkbox glyphs, text as a placeholder. **Filters out retired questions and retired options** — the preview shows what canvassers actually see in the field. |
| [client/src/lib/surveyVisibility.js](../client/src/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded) — powers the builder's live condition validity and any preview gating. |
| [client/src/pages/CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) | Survey-template dropdown (in `components/campaigns/CampaignFormDrawer.jsx`) shows a heads-up when the chosen survey already has responses (repointing reports new answers separately). Hides **archived** templates unless attached — anchored to the survey attached **when the drawer opened**, so deselecting an archived one mid-edit doesn't make it vanish from the options. |
| [client/src/components/QuestionResults.jsx](../client/src/components/QuestionResults.jsx) | Per-question result charts from `survey-results` (retired/legacy buckets included). Exports **`TagResults`** — the report's **"Tags"** panel: one `TagRow` per `tags[]` entry (bar scaled to the most-reached tag, **distinct** `voterCount`), expandable to its contributing options and an inline `VoterList` that drills via `voters-by-answer?tag=<tag>&surveyTemplateId=<id>` (see §I). |
| [client/src/pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Renders the **Survey results** section. A **survey switcher** appears in the section header when the campaign has answers under a survey other than the one currently attached: `GET /admin/reports/surveys?campaignId=` now returns **every** survey with responses for the campaign (each row flagged **`current`**, current-first), and picking a past one re-queries `survey-results` with that `surveyTemplateId` and shows a "no longer attached" note — so a swapped campaign's old answers are one click away, never hidden. Accepts a **`?survey=<templateId>` deep-link** (the Surveys quick-view's results links): seeds the switcher (the *current* survey's id normalizes to `''`) and scrolls the section into view once both the switcher list and the campaign are known; per-campaign selections (template/effort/canvasser) **reset when `:campaignId` changes**, since the sidebar campaign switcher re-renders the same mounted page. Renders `<TagResults>` below the per-question charts when `surveyResultsQ.data.tags` is non-empty, passing `surveyTemplateId` for the tag drill. |
| [client/src/components/AnswerFilters.jsx](../client/src/components/AnswerFilters.jsx) | The saved-search / targeted-round answer-filter chips. Beyond per-question `answerFilters`, it renders a **"By tag"** chip row from the `tags` palette prop (falling back to the case-insensitive union of option tags) and emits selected tags to the parent via `onTagChange` as **`answerTagFilters: [{ tag }]`** (case-insensitive, display-cased). |
| [client/src/pages/WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) | Saved-search builder. Wires `AnswerFilters` with `tags={surveyTags}` (from `survey-results` `tags[]`) + `answerTagFilters` into the filter (sent to `resolveWalkList`). Per saved search, **Export CSV** (`exportCsv`) does an **authenticated blob download**: `fetch` the export endpoint with `Authorization: Bearer` + `X-Org-Id` headers, read `res.blob()`, then click a synthetic `<a download>` (filename from `Content-Disposition`). |
| [client/src/components/CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx) | A canvasser's individual responses (shows template `version`). |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | The at-the-door form. Imports `makeCell` + `visibleQuestionKeys` and recomputes `visibleQuestions` live as answers change; renders single/multiple/text, inline **option scripts** on the picked option, the synthetic **`__other__`** choice with a "Please specify" box. Required-validation runs over **visible** questions only. Submits `{ optionIds, answer (snapshot), otherText, questionKey, questionLabel }` per visible answer; offline queue + optimistic recolor via `optimisticSubmit`. |
| [mobile/lib/surveyVisibility.js](../mobile/lib/surveyVisibility.js) | Byte-identical mirror of the canonical evaluator (drift-guarded). |

## H. Migrations

**Stable ids.** `npm run migrate:survey-option-ids`
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

**Org tag library (Phase 3.1).** `npm run migrate:org-tags`
([migrations/migrateOrgTags.js](../server/src/migrations/migrateOrgTags.js)) — seeds the `Tag`
library from existing usage and canonicalizes case across surveys. Additive + **idempotent**,
**dry-run by default** (`--apply` to write). It `syncIndexes()` on `Tag`, then per org gathers every
distinct `option.tag` / palette tag (deduped by `normalizeTag`, **first-seen display casing wins**),
upserts a `Tag` doc via `ensureTags`, and runs `rewriteTag` so that display is canonicalized across
all surveys + saved-search filters (so "Supporter"/"supporter" collapse to one). Existing string tags
keep working throughout, so this is **non-breaking** — run it with the Phase 3.1 deploy.

## I. Tags (cross-question rollup, by-tag lists, CSV export)

A **tag** labels a survey **option** and groups options **across questions**, so reports and walk
lists can roll up everyone who picked **any** option carrying that tag. Tags are pure **admin
metadata** — the mobile field app is **unchanged** (canvassers never see them). As of **Phase 3.1**
tags are an **org-level managed library** (the `Tag` collection), not per-survey free text — but the
**reporting/list-building plumbing below (rollup, by-tag walk lists, CSV export) is unchanged**,
because options still store the tag's display name as a string.

**The org tag library (`Tag`).** [models/Tag.js](../server/src/models/Tag.js) is the source of truth:
`{ organizationId, name, normalizedName, color, createdBy }` with a **unique index
`{ organizationId, normalizedName }`** that makes duplicate tags structurally impossible.
`normalizedName = normalizeTag(name)` (trim+lowercase), so matching/dedup is case-insensitive.
Survey options reference a tag only by its display **`name` (a plain string** in `option.tag`).

**The three string homes.** A tag's display name is written into exactly **three** places, and that's
the entire surface rename/merge/delete must rewrite:

1. `SurveyTemplate.questions[].options[].tag` — the per-option label (what the rollup actually reads),
2. `SurveyTemplate.tags[]` — the per-survey **palette** (derived/kept-in-sync, see §A),
3. `SavedSearch.filter.answerTagFilters[].tag` — saved-search "by tag" filters.

**Library operations.** [services/surveys/tagOps.js](../server/src/services/surveys/tagOps.js)
implements the bounded bulk rewrite over those three homes:

| Helper ([tagOps.js](../server/src/services/surveys/tagOps.js)) | Role |
|---|---|
| `rewriteTag(orgId, fromKey, toDisplay)` | The primitive: rewrite every occurrence whose `normalizeTag` === `fromKey` to `toDisplay` across all three homes; re-dedups each survey's palette case-insensitively after the rewrite (so a merge collapses A+B in a survey that used both). Returns `{ surveys, options, savedSearches }` counts. |
| `renameTag(orgId, tag, newName)` | `rewriteTag` to the new display, then update the `Tag` doc's `name`/`normalizedName`. |
| `mergeTags(orgId, sourceTag, targetTag)` | `rewriteTag` all source occurrences → the target's display, then **delete the source `Tag`**. |
| `deleteTag(orgId, tag)` | Null every matching `option.tag`, drop it from palettes + `answerTagFilters`, then delete the `Tag`. Returns the cleared usage. |
| `tagUsage(orgId)` | `Map<normalizedKey, { surveys, options, savedSearches }>` — the usage counts the Tags page and `GET /admin/tags` display. |
| `ensureTags(orgId, names, createdBy)` | Idempotent `Tag.updateOne(..., { upsert: true })` per name (deduped by `normalizedName`); the unique index keeps it safe. Called on **every survey save** so the library stays complete even for API/legacy writes. |

**The Tags API.** [routes/admin/tags.js](../server/src/routes/admin/tags.js), mounted at
`/admin/tags` ([routes/index.js](../server/src/routes/index.js)), guarded by
`requireAuth, orgContext, requireOrgRole('admin')`:

- `GET /admin/tags` — list the org's tags (sorted by name) each annotated with its `tagUsage` block.
- `POST /admin/tags` — create; **upserts by `normalizedName`**, so a case-variant of an existing tag
  returns the existing one (`existed: true`) instead of fracturing. An `11000` race falls back to the
  same lookup.
- `PATCH /admin/tags/:id` — **rename** (→ `renameTag`, bulk-rewrites the three homes). If the new
  normalized name collides with another tag, returns **`409 { code: 'tag-exists', tagId }`** so the
  client can offer a **merge** instead.
- `POST /admin/tags/:id/merge { targetId }` — merge this tag **into** the target (→ `mergeTags`);
  refuses self-merge.
- `DELETE /admin/tags/:id` — delete + **cascade-untag** every option/palette/saved-search (→
  `deleteTag`); the client confirms first using the usage counts.

**Authoring (the pick-or-create combobox).** The survey builder no longer uses a free-text
`<datalist>`. Each option's tag field is a **`TagPicker`** combobox
([components/TagPicker.jsx](../client/src/components/TagPicker.jsx)) fed the org library: you filter
and pick an existing tag, or take an explicit **"Create '…'"** action (which `POST`s `/admin/tags`
and stores the canonical name) — so a typo can't silently fork the picklist (see §G).

**Case-insensitive matching + the save chokepoint.** All grouping/dedup still keys off
`normalizeTag(s) = String(s).trim().toLowerCase()`
([services/surveys/tags.js](../server/src/services/surveys/tags.js)). On every save, the authoring
routes (§B) run `canonicalizeTags(questions, declaredTags)` from the same module: it dedups the
palette case-insensitively (**first casing wins** as the display form), rewrites **every**
`option.tag` to that canonical casing, and drops tags that aren't on a real option — so
"Supporter"/"supporter" collapse to **one** tag within the survey; the route then calls `ensureTags`
to mirror those tags into the library. The other two helpers there:

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
([models/SavedSearch.js](../server/src/models/SavedSearch.js) `tagFilterSchema`).
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
