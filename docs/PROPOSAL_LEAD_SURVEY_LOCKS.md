# Proposal: A team lead's survey locks — answers anywhere count, only what was saved locks, and "Save my changes as a copy"

> **Status: BUILT 2026-10-03 (uncommitted at time of writing), to this plan as the owner approved it
> on 2026-10-03; A1 shipped; a server deploy only — nothing ships to phones.** A review's fixes were
> folded in on 2026-10-05. Where the build differs from the plan, the code wins: every difference is
> listed in [§N, "As built"](#n-as-built-2026-10-03) at the end, with what the build ran and one
> pre-existing gap it found. Everything else below is the plan as approved, so Part 2's line
> references and its "today" describe the tree at HEAD `5cb42b2`, before the build.
>
> *As approved:* the owner approved this plan on 2026-10-03 and answered every question in §M the
> same day: the reading of R1 is confirmed, A1 is a **yes** and ships, and both privacy confirmations
> are given (the §I.3 stamp, and item 26's own, §M item 4). The owner ruled on both questions the
> investigation raised, on 2026-10-03, in these words:
>
> - **R1** — *"as long as its part of their campaigns, yes"*: a team lead's survey list may say
>   whether a survey on their campaigns has answers anywhere in the organization.
> - **R2** — *"sure why not?"*: include the Duplicate swap guard and a library-only **Save my
>   changes as a copy**.
>
> How this plan reads R1 is spelled out in Part 1 (*How we read the ruling*), and the owner confirmed
> that reading at approval. All four §M questions were answered on 2026-10-03, A1 among them (the
> pre-existing bug found on the way, which the Help fix here depends on).
>
> *How it was checked:* the gap was reproduced over the real API on a throwaway database and traced
> through every page that reads the survey list. A first design was then reviewed adversarially three
> times (a privacy review and two independent full reviews); every correction they asked for is folded
> in as decisions D1-D11 (§B). Every line reference below was re-read at HEAD `5cb42b2`. The server
> change was run in memory against the real `GET` and `PATCH` handlers, with the patch applied as the
> file loaded (nothing written to disk); the client change was prototyped the same way and rendered
> server-side for every case §G pinned before review round 1. The integration suites (apart from one
> reviewer's partial run, §L.2) and a browser were **not** run for this
> plan (§L says what the build runs). The plan was then reviewed three more ways (round 1,
> 2026-10-03): every finding was checked against the code at HEAD and folded in, and where a fix here
> differs from the one a reviewer suggested, the section says why. A second round of three reviews
> (round 2, the same day) found two more ways the builder could undo an author's work — putting a
> question back to its saved type revived the *then go to* arrows that **Switch back** had cleared,
> and retiring a saved block whose words had been cleared failed the save — plus gaps in wording, in
> the privacy record and in the tests. Each was checked against HEAD the same way and folded in. A
> third round (round 3, the same day) found that putting a question back to its saved type brought
> back the survey **as saved** rather than what the switch cleared — silently undoing answers
> reworded, added or removed just before the switch, while Save went through — that the sentence a
> refused save scrolls to never said a campaign's Duplicate switches the campaign at once, and that a
> Help line rewritten here still contradicted its own source doc, plus smaller fixes. Each was
> checked against HEAD and folded in. A fourth round (round 4, the same day) reviewed what round 3
> changed and found no must-fix but five should-fixes: Retire then Restore, or a later return to a
> question's saved type, could still put older answers back over the author's edits; the locked banner
> contradicted a refused Go to save; the plan promised the refusal's lock lasts longer than it does;
> and one manual check could no longer fail. Each was checked against HEAD and folded in with its nits,
> and §L.2 says which additions of the four rounds were exercised in memory and which were not.

What this covers: why a team lead's survey builder could look unlocked and then refuse the save; what
the owner ruled; what a team lead and an admin see before and after; the five builder fixes that ride
along (lead wording for counts, locks that cover only what was saved, a refusal you can actually see,
**Save my changes as a copy**, and Duplicate no longer landing on *Create survey*); two small fixes to
what the campaign **Edit** drawer offers a lead, and a proposed fix to its Save (§M); and — in Part 2 —
the exact code, every string, the tests, the docs and Help Center cascade, the privacy record, and the
rollout. Nothing ships to phones.

Related: [SURVEYS.md](SURVEYS.md) (the survey builder and the edit rules),
[ROLES.md](ROLES.md) (the team lead, and the 2026-08-08 client-lead survey scoping this amends),
[PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) (§O, where the gap was recorded),
[CAMPAIGNS.md](CAMPAIGNS.md) (the campaign Edit drawer),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (item 26), [ADMIN_APP.md](ADMIN_APP.md).

---

# Part 1 — For everyone

## The problem

Once a survey has answers, two changes to it are blocked, for good reason: changing a question's
**answer type** (the stored answers couldn't be totaled any more), and switching a *Show only if*
survey to **Go to** (later visits could record differently from earlier ones). The server refuses
both whenever **any** answer to that survey exists anywhere in the organization. The builder is
supposed to warn first: it greys out the *then go to* menus and the type buttons, shows a banner, and
offers **Duplicate**.

For a **team lead**, the builder decides all of that from a yes/no that only counts the lead's own
campaigns. So on a survey none of whose answers are counted in the lead's campaigns — answers from
another client's campaign, from a campaign that has since switched to a different survey, or in old
records that aren't tied to any campaign — the builder looks completely unlocked. The lead builds
their change, presses **Save**, and gets a red message saying *"Duplicate it"*. On a survey no other
campaign is using right now, there is **no Duplicate button anywhere a lead can reach**. And the
message itself sits under the page's fixed Save bar, so on a desktop screen it is partly or completely
hidden.

Only team leads hit the dead end. Admins hit the same refusal only in a race — when a survey gets its
first answer while they have it open.

## How we read the ruling (R1) — please confirm or correct

*"As long as its part of their campaigns, yes"* is read as:

- A survey is **part of a lead's campaigns** when it is attached to a campaign they manage — as that
  campaign's main survey **or** as a walk-list's own survey (an archived campaign or walk list of
  theirs counts too, exactly as it already keeps the survey in their library). For those, the lead's
  survey list now says whether the survey has answers **anywhere in the organization**, old records
  with no campaign included. Just yes or no.
- A survey that is in a lead's library **only because they wrote it**, and isn't on any of their
  campaigns, keeps today's answer: whether it has answers on *their* campaigns. (A lead can't open such
  a survey in a builder anyway — their builder edits a campaign's main survey. The moment they attach it
  to a campaign, its yes/no covers the whole organization; its count stays theirs.)
- **Counts never widen.** Every number a lead sees still covers only their campaigns, and no other
  campaign's name ever appears. What an admin's survey list says is unchanged.

## What a team lead sees, before and after

The examples use **Lee**, a team lead who manages **Campaign A**, in an organization that also runs
Campaign B and Campaign C for other clients.

**1. The handed-over survey.** An admin built *Door script*, ran it on Campaign B (40 answers), then
switched B to a newer survey, attached *Door script* to Campaign A, and handed A to Lee.

- *Today:* Lee opens **Edit survey**. No banner, nothing greyed out. Lee adds a *then go to* and changes
  a question from single-choice to multiple-choice, presses **Save**, and gets *"This survey has
  responses, so it can't switch to Go to routing. Duplicate it…"* — partly hidden under the Save bar,
  with no Duplicate button on the page.
- *After:* the builder opens with **"This survey has responses in your organization."** The *then go
  to* menus are greyed out with the hint to use Duplicate at the top of the page, the saved questions'
  type buttons are locked, and the box at the top offers **Duplicate to edit a copy**. Lee never sees
  "40" or "Campaign B".

**2. Some answers are Lee's.** *Door script* has 10 answers on Campaign A and 25 on Campaign C.

- *Today:* the builder says *"This survey has 10 responses."* and the Survey tab's Preview says *"10
  responses across all campaigns"* — both wrong (there are 35).
- *After:* **"This survey has 10 responses in your campaigns."** in the builder, and **"This survey has
  10 responses in your campaigns — editing keeps past answers; …"** on the Survey tab. Lee learns
  nothing new about Campaign C — not its name, not its 25.

**3. A fresh survey.** No answers anywhere: nothing is locked, there is no banner, and Save works.
This plan never locks a survey that has no answers (§K, *false positives*).

**4. A survey Lee wrote that isn't on Lee's campaigns.** Its yes/no covers only Lee's campaigns (R1).
Once Lee attaches it to Campaign A with **Change survey**, the builder and the Survey tab lock it
whenever it has answers anywhere in the organization — saying *"responses in your organization"* when
none of them are counted in Lee's campaigns — and still show Lee's own count only, like every other
survey on Lee's campaigns.

**Why "in your organization" and never "elsewhere":** some of those answers may be old records with no
campaign attached — and they may even be Campaign A's own old answers. So the wording says only what is
true.

## What an admin sees

The same counts and the same wording as today (*"This survey has 35 responses."*, *"35 responses
across all campaigns — …"*), except that a count of 1,000 or more gains its thousands separator in the
builder banner and the Change-survey picker (*"1,234 responses"*), as the Survey tab already shows it.
Two things improve for everyone: a refused save is shown where you can see it, with what to do next
(below), and only what a survey was saved with is locked (further below). And in any builder, putting a
saved question back to the type it was saved with brings back, once, the answers the switch cleared, as
they were just before it, unless you've typed new ones — and, only while the survey uses Go to, its
*then go to* arrows, to blocks still after it in the survey.

## If a save is refused anyway: "Save my changes as a copy"

The lock is decided when the builder opens. If a survey gets its **first answer while someone is
editing it**, Save can still be refused. Today that refusal is easy to miss and costs the change. After:

- The reason appears **at the end of the form, just above the Save bar**, and the page scrolls to it.
  The Save bar says **"Not saved — see the message at the end of the form."** The builder then locks
  the way it does for any survey with answers, until you press Save again.
- It says what to do: *"Your changes are still here. Set those questions back to the answer type they
  were saved with and save again, or keep all of it, the refused change included, with Save my changes
  as a copy."* (or, for Go to, *"Switch back to Show only if … and save again, …"*). Because the
  server's own sentence says *"Duplicate it"*, it also says that **Duplicate** copies the survey as
  last saved, without these changes — and, on a campaign's **Edit survey** page, that Duplicate also
  switches the campaign to the copy at once, so only between shifts, while **Save my changes as a
  copy** switches nothing. On that page the box at the top with **Duplicate** now appears as soon as a
  save is refused this way, even on a survey that looked unlocked when it opened, and it stays while
  Duplicate runs.
- **Save my changes as a copy** (in the Save bar) saves **everything on the form** — the refused change
  included — as a **new survey in your library**, named *"Door script (Copy)"*. It does **not** switch
  the campaign to it. A phone that is out canvassing keeps saving surveys under the survey it loaded; if
  the campaign switched at that moment, every survey still waiting to upload under the old one would be
  refused and lost. So the copy waits in the library, and you move the campaign onto it — with **Change
  survey** on the Survey tab, or by putting it on a walk list — **between shifts**, either way. From a
  campaign's Edit survey page you land back on the Survey tab, which says exactly that; from the org
  survey editor you land on the Surveys list.

## What locks, exactly: only what was saved

On a survey with answers:

- A **saved** question's answer type is locked, and removing a saved question, statement or answer
  **retires** it (it stays in your reports), exactly as today.
- Anything **added since you opened the builder** stays fully editable — a new question can still pick
  any answer type, and **Remove** takes a new question or answer straight out. Today a locked survey
  locks the type of brand-new questions too (which the server would have accepted), and removing a
  brand-new blank answer could make the whole save fail. That was an accident of a June change, and this
  restores the earlier rule. Removing a **saved** question, statement or answer whose words you had
  cleared could fail the save the same way (a retired one still needs its words); it now retires with
  the words it was saved with. And a saved question whose answer type you had changed before the lock
  came on retires with the type it was saved with, the way its own type button would put it back —
  keeping its answers, or the ones a switch to *Free text* cleared — because a save refuses a changed
  type even on a retired question. **Restore** brings it back just as it retired, your edits included.
- A saved question's **own saved type stays selectable**, so you can always put it back. Going back to
  it brings back exactly what the switch cleared, as it was just before the switch — the answers a
  switch to *Free text* removed, your edits to them included, or the *then go to* a switch away from
  *Free text* removed. It never brings back the survey as last saved, so nothing you did before the
  switch is quietly undone, and it never replaces answers you have typed. What a switch cleared comes
  back once: back on the saved type it is used up, so answers you blank by hand afterwards stay blank.
  A *then go to* comes back only while the survey uses Go to, and only to a block still after it in the
  survey (an arrow to a block removed, retired or moved above it comes back as Continue): after
  **Switch back to Show only if**, putting a question back brings its answers back with no arrows,
  because one arrow would quietly switch the survey to Go to again.

## Duplicate no longer lands on "Create survey"

Pressing **Duplicate** in the box at the top makes the copy, switches the campaign to it, and reopens
the builder on the copy. While the page's two lists catch up, it could briefly decide nothing was
attached and jump to *Create survey*. It now shows *Loading…* until both lists agree, or, if the
connection drops at that moment, until it comes back. (Duplicate still starts the copy from the
**saved** survey — unsaved edits on the page are not carried over. That is what **Save my changes as a
copy** is for.)

Duplicating a survey whose name is near the 200-character limit also stops producing a copy whose name
is too long to save.

## What a team lead learns, in plain words

From beyond their own campaigns, a team lead now learns **exactly two yes-or-no facts** about a survey
in their library — never which campaign, never how many:

1. whether a campaign they don't manage has it attached — an archived one counts (this already exists,
   as *"also used elsewhere in your organization"*), and
2. for a survey on one of their campaigns, whether it has answers anywhere in the organization (new).

The second is the same thing the server's refusal already tells a lead the moment they try one of the
two blocked changes; now it is shown before they spend time building one. A lead may be the paying
client, so this is treated as customer-facing and recorded in the privacy record for the owner to
confirm (§I). No Privacy Policy, Terms or Data Processing Addendum wording changes.

## What doesn't change

- **Phones:** nothing. The phone never reads the survey list this changes. No app update, no
  over-the-air update, no "Update required" gate, and it doesn't wait on the scripted-survey phone update.
- **The server's rules:** the two blocks, attaching and detaching work as today, and so does Duplicate,
  except that a copy of a name near 200 characters is now shortened to fit.
- **No migration, no new database index, no setting.** It ships with an ordinary server deploy from the
  Heroku dashboard, and the Help Center updates with it.

## One more thing found on the way (open question)

While checking the Help article that describes the campaign **Edit** drawer, it turned out that **a
team lead's Save in that drawer is always refused today**. The drawer sends every field, including the
greyed-out admin-only ones, and the server refuses any admin-only field from a lead even when it hasn't
changed (*"Only an org admin can change a campaign's isActive."*). The door goal can only be set in
that drawer on the web, so a lead can't set their own door goal there at all, despite the 2026-08-14
ruling that they may. A ten-line fix (the drawer sends a lead only the fields they own) is written up in
§E.6. It isn't one of the decided items, so it needs a yes (§M); the Help correction in this plan
depends on it. It changes nothing about who can see or do what — the server's rules for leads stay as
they are — so it is privacy-neutral.

Two smaller drawer fixes ship either way (§E.5). Two of its admin-only controls, **Active** and
**Restricted doors on invoices**, were never greyed out for a lead, although the drawer's own comment,
the docs and the Help all say they are; now they are. And a lead no longer gets the drawer's empty
survey choice once a campaign has a survey, so a lead can swap a campaign's survey there but never
remove it — the rule the Survey tab already has, which can change a campaign's survey but never leave
it with none.

---

# Part 2 — Technical reference

Line numbers are HEAD `5cb42b2`. Paths in links are relative to `docs/`.

## A. The gap as verified

**The list.** `GET /admin/surveys` ([surveys.js](../server/src/routes/admin/surveys.js) :515-634)
runs two org-scoped response aggregates for **every** caller (:541-548) and maps the per-template one
into `counts` (:575), but only the admin branch reads it (:597-606). The lead branch (:608-628) narrows
`usedByCampaigns`, `usedByWalkLists` and `responseCountByCampaign` to managed campaigns, drops the
no-campaign bucket (:614-616), sums `responseCount` from what is left (:617) and derives
`hasResponses: responseCount > 0` from it (:623). `usedElsewhere` (:625-627) compares current
attachments only. The lead's library is the set form of `canManageSurvey` — authored, or in
`attachedSurveyTemplateIds(req, managed)` (:519-531;
[campaignManagement.js](../server/src/services/authz/campaignManagement.js) :60-77, :79-99).

**The save.** The `PATCH` (:670-747) runs `canManageSurvey` (:685) and then, when the body carries
questions, `SurveyResponse.exists({ surveyTemplateId })` (:699) — no campaign filter, no organization
filter. With a hit, entering Script flow is a `409 survey-has-responses` (:705-707) and a retyped saved
question is the same code with `reasons` (:708-715; `classifyQuestionEdits` compares stored keys only,
[diffQuestions.js](../server/src/services/surveys/diffQuestions.js) :23-39). Leaving Go to is never
checked (:701-704).

**What the narrowed yes/no switches off for a lead.** Every lock reads the list row passed as the
builder's `initial`: the page's Duplicate box (`locked`,
[CampaignSurveyBuilderPage.jsx](../client/src/pages/CampaignSurveyBuilderPage.jsx) :132, shown at
:153), the routing lock ([SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx) :935, :957),
the type lock (:714, via `hasResponses={locked}` on every card, :1297 and :1315), the locked banner
(:1138), Retire versus Remove (:1000, :1006, :653) and the *Switch back* confirmation (:1055-1063).
The Survey tab's Preview note is gated on the narrowed count
([CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) :252).

**The dead end.** The box at the top of the campaign builder appears only when the survey is shared or
locked (:153), and it holds the only Duplicate a lead can reach; the list's Duplicate
([SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) :111) is behind `RoleGate require="orgAdmin"`
([App.jsx](../client/src/App.jsx) :203, :213-215). A lead's builder edits only the campaign's main
survey (:114). Leads see only the campaigns they manage
([campaigns.js](../server/src/routes/admin/campaigns.js) :269-272), so that survey is always in the
lead's `attachedSurveyTemplateIds` set.

**Numbers stated as totals.** The banner prints `initial.responseCount` as the survey's count
(SurveyBuilder.jsx :1141); the Survey tab prints it followed by *"across all campaigns"*
(CampaignSurveyPage.jsx :254-255); the Change-survey picker's label and warning (:42, :50-51) and the
campaign drawer ([CampaignFormDrawer.jsx](../client/src/components/campaigns/CampaignFormDrawer.jsx)
:227-229) do the same, and the drawer twice points a lead at the admin-only Surveys page (:204, :229).

**The refusal is hidden.** Both hosts render the error box after `<SurveyForm>`
(CampaignSurveyBuilderPage.jsx :194-205, [SurveyEditorPage.jsx](../client/src/pages/SurveyEditorPage.jsx)
:128-139), i.e. below the form's own `pb-24` (SurveyBuilder.jsx :1137), while Save sits in a
`fixed bottom-0` footer (:1368) and `<main>` has only `md:pb-6` below `md`
([Layout.jsx](../client/src/components/Layout.jsx) :346). Review A measured it in headless Chrome
against the built CSS: 0 px of the Go to refusal visible at 1280×800 and at 1920×1080, 23 of 62 px of a
one-reason type refusal at 1280×800; review B measured 0 px at 1440×900.

**The over-lock and the bad retire.** Commit `16b0c87` (2026-06-27, then in `SurveysPage.jsx`) replaced
`locked={locked && !!original}` with `hasResponses={locked}`, so a locked survey locks the type of
brand-new questions (the server accepts any type for a key it hasn't stored) and retires a brand-new
answer instead of dropping it; a blank one then fails the save, because `cleanBlock` keeps retired
answers (surveyBuilderRules.js :460) and the server requires answer text (surveys.js :98). The unused
`originalByKey` memo (SurveyBuilder.jsx :936-942) is what is left of the old rule; its comment
(:930-934) still describes it. A **saved** answer fails the same way when its text is cleared before it
is removed: the card's input stays editable until the answer is retired (:156-159), the retire keeps the
blank text (:656), and neither the live checks nor Save's look at a retired answer's text
(surveyBuilderRules.js :527, :581), so the save answers a bare `400 Invalid input` (surveys.js
:287-290). **A saved block fails the same way** (found in review round 2). A question's wording and a
statement's read-aloud text stay editable on a saved card (SurveyBuilder.jsx :700-705, :838-845), the
retire keeps the card as typed (:1002), the live checks and Save's skip a retired block
(surveyBuilderRules.js :514, :575), and the server requires every block's label, retired ones included
(`label: z.string().trim().min(1)`, surveys.js :213, a plain zod check with no message of its own;
`checkBlock`'s retired skip at :153 covers only the placeholder rules). Driven through the real `PATCH`
and `POST` handlers up to the parse, a retired question with a blank label answered `400 Invalid input`
to both; with its saved words, the same body
passed.

**The lock can flip mid-edit.** `main.jsx` :23 turns off only `refetchOnWindowFocus`;
`refetchOnReconnect` defaults to true in the installed `@tanstack/query-core` 5.100.6
(`build/modern/queryClient.js` :271-272), and `['surveys']` has no `staleTime` (CampaignSurveyBuilderPage.jsx
:34, SurveyEditorPage.jsx :21). A reconnect therefore refetches the list and `initial` changes without
the form resetting (the reset keys on `initial?._id`, :918-928), and `TypePills` disables every pill
but the active one (:132) — a saved question already retyped would be stuck.

**Duplicate's swap.** `duplicate.onSuccess` attaches the copy and invalidates both lists (:88-102).
When the campaigns list lands first, the campaign names the copy while the survey list doesn't have it
yet, and the edit guard (:117-120) redirects to *Create survey*. For a lead the reverse order fails too:
once detached, the original leaves their list (it is neither authored by them nor attached).

**Verified in memory for this plan** (the real `GET` and `PATCH` handlers, models stubbed, the §C.1
change applied as `surveys.js` loaded):

| Survey (all in the lead's library) | Lead `hasResponses` today → after | Lead `responseCount` | Lead `PATCH`, first *then go to* |
|---|---|---|---|
| On A as a walk-list override; 2 answers on B | false → **true** | 0 | 409 |
| On A; one legacy row with no campaign | false → **true** | 0 | 409 |
| On A; 1 answer on A, 2 on B | true → true | 1 | 409 |
| On A; no answers anywhere | false → false | 0 | **200** |
| On A; 3 answers on C, which no longer uses it | false → **true** | 0 | 409 |
| A's main survey; 1 answer on B | false → **true** | 0 | 409 |
| Lead-authored and on A; 4 answers on B | false → **true** | 0 | 409 |
| Lead-authored, on no lead campaign (D's main); 2 answers on D | false → false (**R1**) | 0 | 409 |
| Lead-authored, on no lead campaign; 1 answer on A from before | true → true | 1 | 409 |

Every attached row agrees with the `PATCH`; the one row that doesn't is R1's deliberate boundary (no
lead builder can open it, §K). Beyond those rows: the lead payload named no other campaign and no
*"No campaign"* bucket; the keys a lead row adds to the template's own are exactly `usedByCampaigns`,
`usedByWalkLists`, `responseCount`, `hasResponses`, `responseCountByCampaign` and `usedElsewhere`; and
the admin payload was **byte-identical** before and after.

## B. Rulings and decisions

**R1 — owner, 2026-10-03, verbatim *"as long as its part of their campaigns, yes"*.** A lead's row
carries the org-wide `hasResponses` only for a template attached to a campaign they manage, as its main
survey or a walk-list override (archived campaigns and walk lists included: `attachedSurveyTemplateIds`
filters on neither, campaignManagement.js :86-96, exactly as for the library itself); a template in the
library only through `createdBy` keeps the narrowed derivation; `responseCount` and
`responseCountByCampaign` stay narrowed on every lead row; admin rows are unchanged. *Why:* the
builder's locks must match the `PATCH`, which counts every row; the ruling keeps the new fact to surveys
the lead runs. This **amends the 2026-08-08 client-lead scoping, which the owner ruled strict** and
which recorded *"0 responses, yet the 409 fires"* as by design (SURVEYS.md :462-466, ROLES.md :329-330):
a second bare yes/no now crosses that line beside `usedElsewhere`.

**R2 — owner, 2026-10-03, verbatim *"sure why not?"*.** Include the Duplicate swap guard (D5) and a
library-only **Save my changes as a copy** (D4).

**D1 — wording.** One helper, `responsesPhrase(survey, { isOrgAdmin })` in
`client/src/lib/surveyBuilderRules.js`: an admin's *"35 responses"*; a lead's own *"10 responses in
your campaigns"*; a lead row locked with none of their own *"responses in your organization"* — never
*"elsewhere"*, because a legacy row with no campaign can't be attributed and may be the lead's own
campaign's old answer. Lead wording is the default, so a host that forgets the flag understates an
admin's total instead of passing a lead's count off as the survey's. `SurveyForm` reads `isOrgAdmin`
from `useAuth` itself (no `countIsTotal` prop with an unsafe default, review A/B); the campaign drawer
keeps its existing `canEditAdminFields` signal. *Why:* the first design's banner would have read *"This
survey has 0 responses."* above the lock (rendered: HEAD's banner fed a post-R1 row prints exactly
that), and three other surfaces already state a lead's count as the survey's.

**D2 — saved-only lock.** The answer-type lock and Retire-instead-of-Remove apply only to blocks and
answers present in the survey as loaded, by stored key (`savedShape`), restoring the per-question rule
`16b0c87` dropped; the dead `originalByKey` memo goes. `TypePills` keeps the stored type's pill enabled
(`savedType`), so a saved question can always go back even if the lock flips mid-edit. Going back to
the saved type restores what the switch cleared (`restoredOnRetype`), **as the card held it just before
the switch**: a choice question's answers when the card holds no typed answer (it came from *Free
text*, or through blank answers), a *Free text* question's own route. Each change of type keeps what it
clears on the card itself, as `retyped`, which `cleanBlock` never sends (review round 3: the round-2
version restored the survey **as saved**, which silently replaced answers reworded, added or removed
before the switch, and an arrow re-pointed before it, while Save went through; HEAD loses those edits
too, but visibly for the answers, leaving two blank answers that block Save). It never brings back the
survey as saved, never replaces a typed answer, and applies in every builder (an unlocked one too,
where it turns an accidental *Free text* click into an exact undo). What a card keeps is used once:
back at the saved type the kept answers leave it, whether they come back or typed answers win (review
round 4: kept, they came back over answers the author blanked later). **A route comes back only while the
form is in Go to, and only to a block the card can still point at** (review round 2): restored after
**Switch back**, an arrow would flip the survey straight back to Go to and leave every condition Switch
back converted as a hand condition that blocks Save (§E.1 says how). A saved answer removed after its
text was cleared retires with the text it was saved with (`retireOption`, added in review round 1) —
the text the server itself keeps for an answer a save leaves out (`reconcileQuestions`, surveys.js
:346-357) — and a saved question, statement or closing retired after its words were cleared retires
with its saved words (`retireBlock`, review round 2), the server's own rule for a block a save leaves
out (:364-367). A saved question retyped before the lock came on retires at the type it was saved
with, as that type's pill would put it back (`restoredOnRetype`: its own answers, or what its switch to
*Free text* cleared), and no arrows (review round 3), because the type check covers retired blocks too
(`classifyQuestionEdits` compares every stored key, diffQuestions.js :23-39); review round 4 stopped it
swapping in the saved answers, which **Restore** then put back over the author's edits. *Why:* without it, R1
puts every gap-case lead in a builder that also locks brand-new questions and can fail a save with a
400; and the reconnect flip, or a refused save (§D.5), would strand a retyped question.

**D3 — the refusal shown where it can be seen.** `SurveyForm` takes `saveError` (and `copyError`) and
renders them as the form's last in-flow block — after the *Closing* section, before the fixed footer,
so the form's `pb-24` sits below it — with the server message, the `reasons` list and the guidance;
an effect scrolls each new one into view and cancels its animation frame in its cleanup; the footer
says *"Not saved — see the message at the end of the form."* Both hosts pass it and drop their own box.
The server's sentence says *"Duplicate it…"*, so the guidance also says where Duplicate is and that it
copies the survey as last saved, without the refused edits — and, on the campaign builder
(`duplicateSwitches`), that it switches the campaign to the copy at once, so only between shifts,
while Save my changes as a copy switches nothing (review round 3: in the race a phone has just
recorded, so canvassers are out, which is exactly why D4 keeps the copy library-only). The campaign
builder shows its Duplicate box as soon as a save is refused with `survey-has-responses`, not only when
the list row said locked (review round 2, §E.2 item 6), and keeps it up while Duplicate runs (review
round 3), because in the race that row was read before the first answer arrived; for the same reason
the form itself locks after such a refusal (§D.5, review round 3).
*Why:* measured hidden today (§A); the new footer note and guidance would otherwise point at nothing.

**D4 — Save my changes as a copy**, on both builder pages, shown only while the last save was refused
with `code: 'survey-has-responses'`. It runs `bodyToSave()` — the same validation as Save — on the
current form, names the copy `copyName(name)`, and POSTs it through its own `copy` mutation on each page
— the same `POST /admin/surveys` *New survey* sends — whose `onSuccess` has **no attach step at all**
(below). `type="button"`; it and Save are both disabled while either runs. On the campaign builder it
lands on the Survey tab with `?created=<id>`, whose hint now says to put it on a walk list or make it
the default with **Change survey** (**Pick a survey** while the campaign has none, review round 3),
either one between shifts (review round 2: a walk list's survey changes its doors' survey at once, just
as the default does); the org editor lands on `/surveys`. *Why:*
reviews A and B both caught that the first design's immediate switch would drop phones' queued surveys
at exactly the moment the button exists for (a 400 from `routes/mobile/canvass.js` :764-768, dropped by
`mobile/lib/offlineQueue.js` :120-124). *Never attached, by construction:* the first version of this
plan reused each page's `create`, and the campaign builder's `create.onSuccess` attaches whenever the
cached campaign has no main survey (CampaignSurveyBuilderPage.jsx :57-61), which a copy could meet only
if someone else detached the main survey while its `POST` was in flight. Review round 1 asked to close
that rather than accept it; the one-condition fix it proposed (`mode !== 'edit'`) would not hold, for
the reason §E.2 item 2 gives, so each page gets a `copy` mutation that attaches nothing (§E.2 item 2,
§E.3).

**D5 — Duplicate swap guard.** In the edit guard, when `attachedId` is set but missing from the list and
either list still has a fetch under way (`surveysQ.fetchStatus !== 'idle' || campaignsQ.fetchStatus !==
'idle'`, which counts a refetch paused while the browser is offline as well as one fetching; review
round 2 caught that `isFetching` alone reads a paused one as settled), render the existing *Loading…*
instead of redirecting; a settled miss still redirects. `duplicate.onSuccess` also clears the stale
refusal (`update.reset()`, `copy.reset()`) once its attach has landed, and the Duplicate box stays up
while Duplicate runs, so a failed attach keeps the refusal and the box (review round 3, §E.2 items 3
and 6). *Why:* the earlier repro and the in-memory render both show the redirect firing mid-swap; for
a lead, reordering the refetches can't fix it.

**D6 — the duplicate route caps the copy's name** the same way (`copyName`, 193 characters + `" (Copy)"`,
never cutting an emoji in half: review round 2 found that a lone half is stored as U+FFFD).
*Why:* `` `${original.name} (Copy)` `` (surveys.js :767) can exceed the 200-character limit every later
`PATCH` validates (:270) — verified in memory: a 207-character copy name answers `400 Invalid input`.

**D7 — lead copy fixes.** The Survey tab's Preview note is gated on `hasResponses` with role wording
(admin keeps *"N responses across all campaigns"*); the Change-survey picker's label and warning use
the lead wording (both stay gated on `responseCount > 0` — they are about reporting, which is
campaign-scoped for a lead); the campaign drawer's heads-up uses the lead wording and never points a
lead at the Surveys page, in either of the two places it does. Review round 1 added one more pointer in
the same spirit: the builder's survey-name hint, *"Surveys are linked to campaigns on the Campaigns
page."*, reads for a lead *"Surveys are linked to a campaign with Change survey on its Survey tab."*
(§D.9). It also added two drawer corrections that ship whether or not A1 does (§E.5 items 4-5): the
**Active** checkbox and the **Restricted doors on invoices** select are disabled for a lead like every
other admin-only control, and a lead gets the empty survey choice only while the campaign has no
survey. Without A1 neither changes what a lead can save, because the drawer's Save is refused for them
anyway; with A1 both are required (§E.6).

**D8 — tests**, §G. **D9 — docs and Help cascade**, §H. **D10 — the privacy record**, §I.
**D11 — no phone change**, no OTA, no client-version gate, no index, no migration; a server deploy from
the Heroku dashboard after `npm run audit:mobile-api` from the repo root (§J).

**Proposed, not yet decided — A1, the lead's drawer Save** (§E.6, §M). Pre-existing and outside
D1-D11; the corrected Help text in §H assumes it ships, and §M item 1 lists the text to use if it
doesn't. Privacy-neutral (§E.6).

## C. Server changes

One file, [server/src/routes/admin/surveys.js](../server/src/routes/admin/surveys.js). No new query, no
index, no new field, no route.

### C.1 The lead branch of `GET /` (R1)

**Which set implements R1, and why.** "Part of their campaigns" is exactly the `attached` array the
handler already computes at :527 — `attachedSurveyTemplateIds(req, managed)`
([campaignManagement.js](../server/src/services/authz/campaignManagement.js) :83-99): every template
that is a managed campaign's `surveyTemplateId` (main survey) or a managed campaign's `Effort`
override. It is, by its own comment, the set form of `canManageSurvey`'s attached arm (:72-76), and it
is the same array the lead's find filter already uses (`{ _id: { $in: attached } }`, :530). So "on a
campaign the lead manages" means the same thing in the list's scope, in the new rule and in the
`PATCH`'s permission check, and nothing new is queried. (Deriving it from the narrowed
`usedByCampaigns`/`usedByWalkLists` would give the same set — both read every org campaign and effort
filtered to managed ids — but would be a second definition to keep in step.)

**Hunk 1 — HEAD :519-528.** Hoist the set:

```js
    // A LEAD's library is scoped: templates they authored, or attached to a campaign
    // they manage (the set form of canManageSurvey). managedSet doubles as the
    // narrowing key for the usage maps below — null means admin, no narrowing — and
    // attachedSet says which templates are on their campaigns (hasResponses, below).
    let templateFilter = { organizationId: orgId };
    let managedSet = null;
    let attachedSet = null;
    if (!isOrgAdmin(req)) {
      const managed = await managedCampaignIds(req);
      managedSet = new Set(managed.map(String));
      const attached = await attachedSurveyTemplateIds(req, managed);
      attachedSet = new Set(attached.map(String));
      templateFilter = {
```

**Hunk 2 — HEAD :608-611 (comment) and :623.** Lines :612-622 and :624-628 are unchanged.

```js
        // Lead view: usage and volumes narrowed to their campaigns (the null-campaign
        // legacy bucket drops too — it's unattributable org-wide volume). Two bare booleans
        // cross that line, never whose campaigns or how much: usedElsewhere ("also used
        // beyond your campaigns", on every row in the library) keeps the shared-edit warning
        // honest, and hasResponses, on a template attached to a campaign they manage, counts
        // the WHOLE org — legacy no-campaign rows included, the very rows the PATCH's 409
        // checks — so the builder's answer-type and Go to locks match the save (owner ruling
        // 2026-10-03: "as long as its part of their campaigns, yes"). A template in the
        // library only because they wrote it keeps the narrowed yes/no.
```

```js
          hasResponses: attachedSet.has(id) ? (counts.get(id) || 0) > 0 : responseCount > 0,
```

`counts` (:575) is keyed by `String(r._id)` from the aggregate `{ $match: { organizationId } } →
{ $group: { _id: '$surveyTemplateId' } }` (:541-544), so every row it counts carries this template's id
and the `PATCH`'s `exists` finds it too: the list can be true only where the save refuses. The one
practical way they can differ is a row stamped with another organization, which the `PATCH` would
find and the list would not: an under-lock. The one theoretical false lock, a row whose
`surveyTemplateId` is stored as a string, has no writer (§K.1).

### C.2 The duplicate route's name cap (D6)

**Hunk 3 — HEAD :749-752.** Add the helper above the route's comment:

```js
// A copy's name. A name is at most 200 characters (upsertSchema), and a copy named past that
// could never be saved again — its next PATCH is a bare 400 'Invalid input' — so a long name is
// cut to leave room for the suffix. The limit counts UTF-16 code units, as zod does, so the cut can
// fall inside an emoji: its lone first half is dropped rather than stored as U+FFFD. The builder's
// Save my changes as a copy names its copy the same way (copyName, client/src/lib/surveyBuilderRules.js).
const COPY_SUFFIX = ' (Copy)';
const copyName = (name) =>
  `${String(name ?? '')
    .trim()
    .slice(0, 200 - COPY_SUFFIX.length)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd()}${COPY_SUFFIX}`;

```

**Hunk 4 — HEAD :767.** `` name: `${original.name} (Copy)`, `` → `name: copyName(original.name),`

Nothing else in the file changes: the `PATCH` gate, `POST`, archive, unarchive and `DELETE` are
untouched, and the admin branch (:597-606) is byte-identical.

## D. Builder changes — [client/src/components/SurveyBuilder.jsx](../client/src/components/SurveyBuilder.jsx)

Owner preference: new code is arrow functions. `TypePills`, `removeOption` and `setType` are rewritten
here, so they convert; `QuestionCard` and `SurveyForm` only gain props, so they keep their `function`
declarations (converting a 500-line component for a parameter list is the bulk migration the rule
warns against). `TypePills` is referenced only inside render bodies, so the `const` is initialized
before any use.

**D.1 Imports.** HEAD :1 adds `useRef`:
`import { useEffect, useId, useMemo, useRef, useState } from 'react';`. After :3 add
`import { useAuth } from '../auth/AuthContext.jsx';`. In the rules import, between `routesLockedHint,`
(:16) and `routeTargets,` (:17) add `responsesPhrase,`, `copyName,`, `savedShape,`, `retireOption,`,
`retireBlock,`, `restoredOnRetype,` and `savedInGoTo,`.

**D.2 `TypePills` — replace HEAD :122-146** (and give it a named export, for the smoke test, §G):

```jsx
// A question's type. Once the survey has responses a saved question's type is locked, but the pill of
// the type it was saved with stays pickable (`savedType`), so the question can always be put back —
// even when the lock comes on mid-edit, as a reconnect's refetch of the survey list can do.
export const TypePills = ({ value, onChange, disabled, savedType = null }) => (
  <div className="inline-flex rounded-md border border-border-strong bg-sunken p-0.5">
    {QUESTION_TYPES.map((t) => {
      const active = value === t.value;
      return (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          disabled={disabled && !active && t.value !== savedType}
          className={
            'rounded px-3 py-1.5 text-xs font-medium transition ' +
            (active
              ? 'bg-card text-fg shadow-sm'
              : 'text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg-muted')
          }
        >
          {t.label}
        </button>
      );
    })}
  </div>
);
```

**D.3 `QuestionCard`.** Above HEAD :637 add
`` // `hasResponses` = the survey has responses AND this block was saved: its type locks, and removing it ``
`` // or a saved answer retires instead. `saved` is its savedShape entry, null for a block added since. ``
and add `saved = null,` after `hasResponses = false,` in the signature. Replace `removeOption`
(HEAD :651-661) and `setType` (:663-671):

```jsx
  const removeOption = (optIdx) => {
    // On a survey with responses a saved answer retires — kept so its past answers still report, with
    // its saved words if the card's were cleared first (retireOption). An answer added since the survey
    // was opened was never saved: it simply goes.
    const retired = hasResponses ? retireOption(value.options[optIdx], saved) : null;
    if (retired) {
      const options = value.options.slice();
      options[optIdx] = retired;
      onChange({ ...value, options });
    } else {
      onChange({ ...value, options: value.options.filter((_, i) => i !== optIdx) });
    }
  };

  const setType = (t) => {
    // What the change clears stays on the card (`retyped`, never sent), and back at the type it was
    // saved with a question gets exactly that back, once: never the survey as saved, never over a typed
    // answer, and a "then go to" only while the survey uses Go to, and only to a block this card can
    // still point at (restoredOnRetype).
    const restored = restoredOnRetype(saved, value, t, {
      flow: route.flow,
      targets: route.targets.map((x) => x.value),
    });
    if (t === 'text') onChange({ ...value, type: t, options: [], ...restored });
    else if (!isChoice) {
      const used = new Set();
      // A text question's own Go to has no place on a choice question, which routes through its
      // answers only (the server refuses a question-level route there).
      onChange({ ...value, type: t, goTo: null, options: [{ id: optionId('', used), text: '' }, { id: optionId('', used), text: '' }], ...restored });
    } else onChange({ ...value, type: t, ...restored });
  };
```

`route` is the card's `routeFor` object (SurveyBuilder.jsx :1071-1083), which every card is given:
its `flow` is the form's as it stands, and its `targets` are exactly the blocks the card's *then go
to* selects offer (`routeTargets`, surveyBuilderRules.js :251-257). On a change of type `restored` is
never null: it always carries the card's updated `retyped`, plus whatever comes back (E.1, review
round 3). It is null only when the pill clicked is the type the card already has, where spreading it
changes nothing. HEAD :714 becomes
`<TypePills value={value.type} onChange={setType} disabled={hasResponses} savedType={saved?.type ?? null} />`.
The hint (:715-717), `BlockActions`' *Retire*/*Remove* label (:583, :691) and `StatementCard` (:807)
need no change: they read the card's `hasResponses`, which now means "saved, on a survey with responses".

**D.4 `SurveyForm` props and role.** Replace the comment and signature at HEAD :896-898:

```jsx
// `duplicateAt` says where the host page offers Duplicate, for the locked banner and the greyed-out
// "then go to" hint: the org editor's is in the survey list, a campaign's builder has its own, which
// also switches the campaign to the copy at once (`duplicateSwitches`), so a refusal's guidance says so.
// `saveError` is the host's last failed save and `copyError` its last failed copy, both shown at the end
// of the form; `onSaveAsCopy`, when the host gives it, takes a refused save's body — the form as it
// stands, already named as a copy — and POSTs it as a new survey that nothing is switched to.
function SurveyForm({ initial, onSave, onCancel, saving, orgTags = [], onCreateTag, duplicateAt = DUPLICATE_IN_LIST, duplicateSwitches = false, saveError = null, copyError = null, onSaveAsCopy, savingCopy = false }) {
  // The locked banner phrases the response count for whoever is looking (responsesPhrase): a lead's
  // count covers their campaigns only. Read here, never passed, so no host can forget it.
  const { isOrgAdmin } = useAuth();
```

`SurveyForm` is rendered only by the two host pages (a `git grep` and a `grep -rna` over `client/src`
agree), both inside `AuthProvider` (`main.jsx` :31); no existing test renders it, so the new hook
breaks no suite.

**D.5 The saved-only lock — replace HEAD :930-945** (the comment, `locked`, the dead `originalByKey`
memo and `loaded`):

```jsx
  // Once responses exist, what the survey was SAVED with is protected, mirroring the server: a saved
  // question's answer type is locked, and a saved block or answer is retired rather than removed, so
  // its past answers keep reporting. Everything else stays open — rename, reword, reorder, Required,
  // add — and a block or answer added since the survey was opened is fully editable, type included,
  // and removed outright. `hasResponses` counts the whole organization for every survey a builder
  // opens (a lead's builder opens only their campaign's own survey: owner ruling 2026-10-03), so
  // these locks match the server's 409. Commit 16b0c87 swapped this per-block rule for a lock on
  // every card; it is restored here. A save the server refused because the survey has responses
  // locks the form too: the row was read before that first answer arrived, and the 409 is the server
  // finding it. The refusal lasts until the next save attempt.
  const refusedForResponses = saveError?.code === 'survey-has-responses';
  const locked = !!initial?.hasResponses || refusedForResponses;
  // The template as the builder opened it (null for a new survey): what One block per screen and
  // Switch back measure the survey against.
  const loaded = useMemo(() => (initial?._id ? initial : null), [initial?._id]);
  // That template by stored key (savedShape): exactly what the two locks above cover.
  const savedBlocks = useMemo(() => savedShape(loaded), [loaded]);
  // Whether the locked banner may call changes to the Go to routes safe (savedInGoTo): only on a survey
  // saved in Go to that still uses it. A refused Go to save leaves the form in Go to on a survey saved
  // in Show only if, and there the banner has to say what the refusal says.
  const goToSaved = savedInGoTo(flow, loaded);
```

`routesLocked` (:957) stays `locked && flow !== 'script'`: entering Go to is a survey-level change, and
the server checks it for the whole survey, new blocks included.

**The refusal locks the form** (review round 3). Read from the list row alone, as at HEAD and in the
round-2 plan, `locked` left the form offering **Remove** on saved blocks, and every type pill and
arrow, after a `409 survey-has-responses`, so a second blocked change could earn a second 409; nothing
refetches `['surveys']` on a 409 (`update` has no `onError`, CampaignSurveyBuilderPage.jsx :76-82,
SurveyEditorPage.jsx :76-82). It can't lock a survey with no answers: the server sends that code only
from the `PATCH`'s two 409s (surveys.js :706 and :712), both inside its `SurveyResponse.exists` hit
(:699-700). `savedType` keeps every saved question returnable, the banner's first line falls back to
*"This survey has responses."*, since the row's count is still the one read before, and its Go to
sentence follows the flow the survey was saved in (`goToSaved`, §D.9). `refusedForResponses` moves here
from D.8.

**How long it lasts** (review round 4): while the host's last save error is that 409, and no longer.
Every Save is a new mutation (`mutationObserver.js` :56-61 in the installed query-core 5.100.6), whose
`pending` state sets `error: null` (`mutation.js` :216-223). So while a new Save is in flight, or
paused offline (mutations keep the default network mode, which waits for the browser to be online:
`retryer.js` :10-11; `main.jsx` :21-25 sets only query options), the form goes by the row alone. Then
a second refusal locks it again, a success leaves the page, and any other failure (a 5xx, a 403, a 400
the builder didn't catch, or a fetch that never reached the server, whose error carries no `code`:
`api/client.js` :49, :131-135) leaves the form as the row says until a save is refused again. Each
such gap only ever opens the lock, so none can lock a survey with no answers, and none loses work: the
server still refuses both blocked changes, and puts back as retired any saved block or answer a save
leaves out (surveys.js :349-367). Offline, the reconnect's refetch of `['surveys']` (refetch on
reconnect is on: `main.jsx` :23 turns off only the focus refetch) brings the lock back through the
row, which by then counts the answer. Part 1 and SURVEYS.md say *until you press Save again*, and
§K.4 *until the next save attempt*, to match (they said *from then on* before this round).
**Refetching `['surveys']` on the 409**, which would hold the lock through all of this with the row's
real count, was left out on purpose: when a background refetch fails, the query keeps its data but sets
`error` (`query.js` :375-388), and the org editor then swaps its whole page, form and edits included,
for *"Couldn't load the survey"* (SurveyEditorPage.jsx :87-94). A new way to lose the author's work is
too high a price for a lapse that only ever unlocks.

**D.6 The scroll effect — after HEAD :965-967** (the `switchTried` effect):

```jsx
  // A failed save's message sits at the end of the form, just above the fixed footer (below the form,
  // where the hosts used to put it, the footer covered it on desktop): bring each new one into view.
  // The frame waits for it to render; the cleanup cancels it if the message changes or the form goes.
  const refusalRef = useRef(null);
  useEffect(() => {
    if (!saveError && !copyError) return undefined;
    const frame = requestAnimationFrame(() =>
      refusalRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    );
    return () => cancelAnimationFrame(frame);
  }, [saveError, copyError]);
```

The dependencies are what the effect reads (the ref is stable). A react-query error object keeps its
identity until the next attempt, so each new refusal scrolls once; under `React.StrictMode`
(`main.jsx` :28) the double mount cancels the first frame. `{ block: 'center', behavior: 'smooth' }`
matches `OrgDetailPage.jsx` :201.

**D.7 Retire only what was saved — `removeQuestion`.** HEAD :1000-1003 (`if (initial?.hasResponses &&
q?.key) {`, its comment, and `return rest.map((p, i) => (i === index ? { ...p, retired: true } : p));`)
become:

```jsx
      if (locked && savedBlocks.has(q?.key)) {
        // Soft-retire a saved block — kept so its past answers still report, with its saved words if
        // the card's were cleared (retireBlock): the server refuses a block with none, retired or not.
        return rest.map((p, i) => (i === index ? retireBlock(p, savedBlocks.get(p.key)) : p));
      }
```

`p` at `index` is the block being removed: `repointRoutes` changes only the routes into it, never its
key or label. A saved question retyped before the lock came on also goes back to the type it was saved
with, as that type's pill would put it back — its own answers, or what its switch to *Free text*
cleared — with no arrows (`retireBlock`, §E.1, review rounds 3 and 4). **Restore** (HEAD :1272,
`updateQuestion(i, { ...q, retired: false })`) brings a block back exactly as it was retired, so the
author gets those answers back too; the round-3 version retired it with the saved answers, which
Restore then put over the edits on the card. HEAD :1006 becomes `const
retires = locked && savedBlocks.has(leaving?.key);`. (A key is minted from a new block's first text,
:979, and never reused while a saved block is in the list, so `savedBlocks.has` is the server's own
test: `reconcileQuestions` matches by key, surveys.js :331-371.)

**D.8 Save, split — HEAD :1109-1134.** The head of `submit` (:1109-1116) becomes `bodyToSave`:

```jsx
  // What Save sends, or null after marking what stops it. Save and Save my changes as a copy both run
  // it on the form as it stands, so a copy never skips a check the survey itself would fail.
  const bodyToSave = () => {
    const v = validate();
    if (v.name || v.noQuestions || Object.keys(v.questions).length || hasBlockingIssues(issues)) {
      setErrors({ ...v, attempted: true });
      return null;
    }
    setErrors({ questions: {} });
```

The body (:1117-1132) is unchanged; its last line (:1133) returns instead of saving, followed by:

```jsx
    return { name, intro, closing, questions: reorder(cleaned), tags: Array.from(seen.values()), flow, presentation };
  };

  const submit = (e) => {
    e.preventDefault();
    const body = bodyToSave();
    if (body) onSave(body);
  };

  // A save refused because the survey has responses (`refusedForResponses`, read with `locked`) can
  // still keep everything: the form as it stands, the refused change included, goes to the library as a
  // NEW survey (copyName). Nothing is switched to it — phones still queued under this survey would have
  // those surveys refused and dropped — so moving a campaign onto the copy stays the author's own step,
  // between shifts.
  const canCopy = !!onSaveAsCopy && refusedForResponses;
  const saveCopy = () => {
    const body = bodyToSave();
    if (body) onSaveAsCopy({ ...body, name: copyName(body.name) });
  };
```

`err.code` is set by the API client from the body's `code` (`api/client.js` :133).

**D.9 The banner's first line — HEAD :1140-1142 — its Go to sentence, :1146-1147, and the survey-name hint, HEAD :1177.**

```jsx
          <p className="font-medium">This survey has {responsesPhrase(initial, { isOrgAdmin }) || 'responses'}.</p>
```

The paragraph under it (:1143-1158) keeps its words but picks them by `goToSaved` (§D.5) instead of
the form's `flow` (review round 4). HEAD :1146 becomes
`and links are safe to add too{goToSaved ? ', and so are changes to its Go to routes' : ''}.{' '}`, and
HEAD :1147 `{goToSaved ? (`. A save refused for entering Go to (stored `list`, sent `script`: surveys.js
:689-691, :705-706) comes from a form that `updateQuestion` put in Go to at its first arrow (:972), and
§D.5's lock now shows the banner at that moment. Worded from `flow`, it said changes to the Go to routes
were safe and only a type change needed a copy, directly above a refusal saying the survey can't switch
to Go to and telling the author to Switch back (a reviewer rendered it server-side with the repo's
React 18.3.1). Worded from `goToSaved`, it says *"Two changes need a fresh copy: changing a question's
type, and adding Go to routing"*, as the refusal does. Everywhere else the two agree: on a survey saved
in Go to the form's flow is the saved one or, after Switch back, `list`, and on one saved in Show only if
it stays `list` until a first arrow, which a locked row doesn't allow (`routesLocked`, :957). HEAD reached the same contradiction once
a reconnect's refetch locked such a form, and this corrects that too. SSR starts the form in the flow it
was saved in, so G.3 pins the rule through `savedInGoTo`, and L.3 step 8 checks it on the page.

The hint under the name field is worded for its
reader (D7, added in review round 1): an org admin links surveys from the Campaigns page's drawer,
while a lead's way is the Survey tab's **Change survey**, the one that works whether or not A1 ships
(without it, a lead's Save in that drawer is refused). HEAD :1177 becomes:

```jsx
            : <p className="mt-2 text-xs text-fg-muted">
                {isOrgAdmin
                  ? 'Surveys are linked to campaigns on the Campaigns page.'
                  : 'Surveys are linked to a campaign with Change survey on its Survey tab.'}
              </p>}
```

**D.10 Per-card lock.** After HEAD :1285 (`const error = …`) add:

```jsx
            // The block as saved, null for one added since the survey was opened: only a saved block's
            // type locks, and only a saved block retires instead of going.
            const saved = savedBlocks.get(q.key) || null;
```

HEAD :1297 (`StatementCard`) becomes `hasResponses={locked && !!saved}`; HEAD :1315 (`QuestionCard`)
becomes `hasResponses={locked && !!saved}` followed by a new line `saved={saved}`.

**D.11 The refusal box and the footer — replace HEAD :1368-1382** (from the footer's opening `<div>`
through Save's `disabled`):

```jsx
      {(saveError || copyError) && (
        <div
          ref={refusalRef}
          role="alert"
          className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger"
        >
          {saveError && <p>{saveError.message}</p>}
          {saveError?.data?.reasons?.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {saveError.data.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {refusedForResponses && (
            <p className="mt-2">
              Your changes are still here.{' '}
              {saveError.data?.reasons?.length > 0
                ? 'Set those questions back to the answer type they were saved with and save again'
                : 'Switch back to Show only if (on the blue Go to banner above) and save again'}
              {canCopy ? ', or keep all of it, the refused change included, with Save my changes as a copy.' : '.'}{' '}
              {/* The server's sentence says to Duplicate, and Duplicate copies the STORED survey. A campaign's
                  Duplicate also switches the campaign to the copy at once (duplicateSwitches), which drops
                  surveys still queued on phones, so the sentence the page scrolls to says so. */}
              Duplicate {duplicateAt} copies the survey as last saved, without these changes
              {duplicateSwitches
                ? `, and switches this campaign to the copy at once, so do it only between shifts.${canCopy ? ' Save my changes as a copy switches nothing.' : ''}`
                : '.'}
            </p>
          )}
          {canCopy && (
            <p className="mt-1 text-xs">
              The copy is a new survey in your library, “{copyName(name)}”. Nothing switches to it: whatever uses
              this survey keeps it until you change it — between shifts, because surveys still queued on phones
              under this one would be dropped.
            </p>
          )}
          {copyError && <p className="mt-2">Couldn’t save the copy: {copyError.message}</p>}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card px-6 py-3 shadow-lg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-3">
          {errors.attempted && stillBlocked ? (
            <p className="mr-auto text-xs text-danger">Can’t save yet: fix what’s marked in red above.</p>
          ) : saveError || copyError ? (
            <p className="mr-auto text-xs text-danger">Not saved — see the message at the end of the form.</p>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken"
          >
            Cancel
          </button>
          {canCopy && (
            <button
              type="button"
              onClick={saveCopy}
              disabled={saving || savingCopy}
              className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken disabled:opacity-60"
            >
              {savingCopy ? 'Saving copy…' : 'Save my changes as a copy'}
            </button>
          )}
          <button
            type="submit"
            disabled={saving || savingCopy}
```

The box is the form's last **in-flow** child (the fixed footer after it takes no space), so the form's
`pb-24` (96 px) plus `<main>`'s `md:pb-6` (24 px) lie below it: scrolled to the end, its bottom edge
sits 120 px above the viewport's, clear of the 63 px footer. Review A measured the weaker variant (an
80 px wrapper) fully visible at 1280×800. Colors are the existing semantic tokens the hosts' boxes used
(`bg-danger-tint`, `border-danger/30`, `text-danger`); the copy button wears Cancel's classes. The
footer row gains `flex-wrap` so three buttons and the note fit at phone width (below `md`, `<main>`'s
`pb-20` adds 80 px more room).

## E. Page changes and the helpers

### E.1 [client/src/lib/surveyBuilderRules.js](../client/src/lib/surveyBuilderRules.js) — eight helpers, and one line in `cleanBlock`

Insert before HEAD :248 (the comment above `routeTargets`), after `routesLockedHint` (:245-246). The
file's own header (:19-23) is why they live here: pure, and pinned by `node --test`. `END_KEY` and
`isChoice`, which `restoredOnRetype` and `retireBlock` read, are already imported (:2, :6), and
`flowOf`, which `savedInGoTo` reads, is the file's own (:47).

```js
// ---- The locked banner ---------------------------------------------------------------------------

// Whether the locked banner may call changes to the Go to routes safe: only on a survey saved in Go to
// that still uses it. The server refuses ENTERING Go to once a survey has responses (the PATCH's 409
// survey-has-responses), so a survey saved in Show only if that has taken its first arrow since — the
// race a refused save ends — still needs a fresh copy for that, and the banner says so, as the refusal
// does. `loaded` is the template as the builder opened it, null for a new survey.
export const savedInGoTo = (flow, loaded) => flow === 'script' && flowOf(loaded) === 'script';

// ---- Responses, as the viewer may see them -------------------------------------------------------

// How a survey's responses read to the person looking. An org admin's row counts the whole
// organization: "35 responses". A team lead's counts cover only the campaigns they manage
// (routes/admin/surveys.js narrows them), so their number says so: "10 responses in your campaigns".
// On a survey on their campaigns none of whose answers are counted in them, the server sends the bare
// yes/no alone (owner ruling 2026-10-03), so the phrase has no number — and never says "elsewhere":
// rows saved before responses carried a campaign may be this campaign's own. null when there is nothing
// to say. Lead wording is the default, so a host that forgets isOrgAdmin under-states an admin's
// total rather than passing a lead's count off as the survey's.
export const responsesPhrase = (survey, { isOrgAdmin = false } = {}) => {
  const count = survey?.responseCount || 0;
  const counted = `${count.toLocaleString()} response${count === 1 ? '' : 's'}`;
  if (isOrgAdmin) return count > 0 ? counted : null;
  if (count > 0) return `${counted} in your campaigns`;
  return survey?.hasResponses ? 'responses in your organization' : null;
};

// The Survey tab's Preview note opens with the survey's responses, worded for its reader: an org
// admin's are the survey's total ("35 responses across all campaigns"), a lead's their own or the bare
// yes/no ("This survey has 10 responses in your campaigns", "This survey has responses in your
// organization"). null = nothing to say, which is exactly when hasResponses is false: an admin's
// hasResponses is their count > 0, and a lead's narrowed count > 0 implies the yes/no.
export const responsesNoteOpening = (survey, { isOrgAdmin = false } = {}) => {
  const phrase = responsesPhrase(survey, { isOrgAdmin });
  if (!phrase) return null;
  return isOrgAdmin ? `${phrase} across all campaigns` : `This survey has ${phrase}`;
};

// A copy's name. A survey's name is at most 200 characters (the POST's and the PATCH's own limit,
// counted in UTF-16 code units), so a long one is cut to leave room for the suffix — never between
// the two halves of an emoji, whose lone first half would be stored as U+FFFD. The server's duplicate
// route caps the same way.
export const COPY_SUFFIX = ' (Copy)';
export const copyName = (name) =>
  `${String(name ?? '')
    .trim()
    .slice(0, 200 - COPY_SUFFIX.length)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd()}${COPY_SUFFIX}`;

// The survey as the builder opened it, by stored block key: each block's type, its words (a
// question's wording, a statement's read-aloud text), and its answers and their ids (retired ones
// included), in the form questionsForEditing loads them.
// What a survey with responses protects is what was SAVED, as on the server — classifyQuestionEdits
// compares stored keys only, and reconcileQuestions retires only stored items — so a block or answer
// added since stays fully editable and is removed outright. Empty for a new survey.
export const savedShape = (loaded) =>
  new Map(
    questionsForEditing(loaded)
      .filter((q) => q && q.key)
      .map((q) => [
        q.key,
        {
          type: q.type,
          label: q.label ?? '',
          options: q.options || [],
          answerIds: new Set((q.options || []).map((o) => o && o.id).filter(Boolean)),
        },
      ])
  );

// A question changing type. What the change clears stays on the card as `retyped`: a choice question's
// answers when it goes to Free text, a Free-text question's own then go to when it goes to a choice
// type (single to multiple choice and back clears nothing, so what is kept stays). A saved question
// going back to the type it was saved with gets exactly that back: the card's own answers or arrow as
// they stood just before the switch, edits included, and never the survey as saved, so an answer
// removed before the switch stays gone. Answers come back only when the card holds no typed answer (it
// came from Free text, or through blank ones), so nothing typed is ever replaced, and only once: back
// at the saved type the kept answers leave `retyped`, whether they come back or typed answers win, so
// answers blanked by hand later can't bring them back. (The kept route needs no such rule: every change
// away from Free text keeps the card's arrow afresh.) A route comes back only while the survey as it
// stands uses Go to (`flow`), and only to a block the card can still point at (`targets`, the keys its
// "then go to" selects offer, or End); any other goes back to Continue. In
// Show only if a restored arrow would switch the survey to Go to (entersScript): after Switch back,
// which clears every route on the cards but not what they keep, it would undo the switch and leave
// every condition the switch converted as a hand condition that blocks Save. Returns what to merge
// into the card, its `retyped` always plus whatever comes back, or null when the type doesn't change.
// `saved` is the block's savedShape entry (null for a block added since the survey was opened, which
// keeps but gets nothing back); `block` is the card as it stands, before the change. `retyped` never
// leaves the builder: cleanBlock drops it, and a builder opened again starts without it.
export const restoredOnRetype = (saved, block, toType, { flow = 'list', targets = [] } = {}) => {
  if (!block || block.type === toType) return null;
  const retyped = { ...block.retyped };
  if (toType === 'text' && isChoice(block)) retyped.options = block.options || [];
  if (block.type === 'text' && isChoice({ type: toType })) retyped.goTo = block.goTo ?? null;
  if (!saved || toType !== saved.type) return { retyped };
  const route = (to) =>
    flow === 'script' && to != null && (to === END_KEY || targets.includes(to)) ? to : null;
  if (toType === 'text') {
    const goTo = route(block.retyped?.goTo);
    return goTo == null ? { retyped } : { retyped, goTo };
  }
  const { options: back, ...keeps } = retyped;
  const typed = (block.options || []).some((o) => o && (o.text || '').trim());
  return typed || !back ? { retyped: keeps } : { retyped: keeps, options: back.map((o) => ({ ...o, goTo: route(o.goTo) })) };
};

// Removing an answer from a saved question on a survey with responses. An answer the survey was saved
// with retires — kept, so its past answers still report — and keeps words: the card's when it has any,
// else the saved ones, the same words the server keeps for an answer a save leaves out
// (reconcileQuestions). A retired answer still goes to the server, which refuses one with no text as a
// bare 400. An answer added since the survey was opened gets null: never saved, it simply goes.
// `saved` is the block's savedShape entry.
export const retireOption = (o, saved) => {
  if (!o || !o.id || !saved || !saved.answerIds.has(o.id)) return null;
  const savedText = saved.options.find((s) => s && s.id === o.id)?.text;
  return { ...o, text: (o.text || '').trim() ? o.text : savedText ?? o.text, retired: true };
};

// Retiring a saved block on a survey with responses — a question, a statement or a closing. It stays,
// so its past answers still report, and keeps words: the card's when it has any, else the saved ones,
// the words the server keeps for a block a save leaves out (reconcileQuestions). A retired block still
// goes to the server, which refuses one with no label as a bare 400 'Invalid input', and the builder's
// own checks skip a retired block, so nothing would have warned. The server's type check covers
// retired blocks too (classifyQuestionEdits), so a question retyped before the lock came on goes back
// to the type it was saved with, as that type's pill would put it back (restoredOnRetype, as in Show
// only if): its own answers, or what its switch to Free text cleared — never the saved ones over them,
// since Restore brings the block back exactly as it was retired. Only its type has to go back for the
// server, which puts back as retired any saved answer the save leaves out (reconcileQuestions). Then
// every arrow goes: a retired block's are never followed, and one brought back by Restore in Show only
// if would switch the survey to Go to. `saved` is the block's savedShape entry; the caller retires
// only a block that has one.
export const retireBlock = (q, saved) => {
  const label = (q.label || '').trim() ? q.label : saved?.label ?? q.label;
  if (!saved || q.type === saved.type) return { ...q, retired: true, label };
  const back = { ...q, type: saved.type, ...(isChoice(saved) ? {} : { options: [] }), ...restoredOnRetype(saved, q, saved.type) };
  return {
    ...back,
    retired: true,
    label,
    options: (back.options || []).map((o) => ({ ...o, goTo: null })),
    goTo: null,
    otherGoTo: null,
  };
};
```

**And `cleanBlock`, HEAD :466-467** (review round 3). `retyped` is the builder's alone, and
`cleanBlock` is the one place a card is spread into what Save sends (`block = { ...q, … }`), so it
drops the field there, the way it already drops `role` from a question (:487-488):

```js
  // What a type change cleared, kept on the card for going back (restoredOnRetype), is the builder's
  // alone: never sent.
  const { retyped, ...card } = q;
  const block = {
    ...card,
```

(the rest of `cleanBlock` still reads `q`). The live checks read blocks through `blocksAsSaved`, which
is `cleanBlock` (:496-497), so they never see it either, and the server's `questionSchema` is a plain
`z.object` (surveys.js :205-250), which would strip an unknown key anyway.

**What comes back, and from where** (review round 3). The round-2 version restored from `savedShape`,
the survey as the builder opened it. A reviewer ran it with HEAD's `cleanBlock`. On an unlocked survey
whose `support` question was saved with Yes / No / Maybe later, the author reworded Yes, added Unsure,
removed Maybe later, then switched to *Free text* and back. The card held Yes / No / Maybe later again,
`emptyIssues` found nothing, and Save sent exactly that. A *Free text* question whose arrow had been
re-pointed to End came back pointing at its saved target. HEAD loses the same edits on the same
clicks, but visibly for the answers: two blank answers that block Save (`emptyIssues`, :581-583). So
each change of type now keeps what it clears on the card itself, as `retyped`: the answers when a
choice question goes to *Free text*, the route when a *Free text* question goes to a choice type.
Single ↔ Multiple clears nothing and leaves what is kept alone. Going back to the saved type restores
that and nothing else. It never restores the saved answers, so an answer removed outright before the
switch stays gone. With nothing kept (a saved question blanked by hand, then Single → Multiple →
Single) nothing comes back. A block added since keeps what it clears but gets nothing back, since it
has no saved type, as at HEAD. `savedShape` still supplies the saved type (the pill that stays
pickable, the type the restore waits for, and the type `retireBlock` puts back on a retyped question)
and the saved words `retireOption` and `retireBlock` fall back to.

**Used once** (review round 4). The round-3 version never dropped what a card kept. Back at the saved
type after an exact undo, the kept answers stayed on the card, and so did they when the card's typed
answers won instead; a reviewer then blanked the answers by hand, went to *Multiple choice* and back,
and the old ones came back — after an exact undo, the survey as saved, the very overwrite round 3
removed. Now,
back at the saved type, the kept answers leave `retyped` whether they come back or not. The kept route
needs no such rule: every change away from *Free text* keeps the card's arrow afresh, so what comes back
at *Free text* is always the arrow the card had just before.

**Retire, then Restore** (review round 4). Restore (SurveyBuilder.jsx :1272) brings a retired block
back exactly as `retireBlock` left it. The round-3 version gave a retyped question the saved answers,
so Retire then Restore silently undid the edits the author could see on the card (a reviewer's probe:
*Yes, definitely* and an added *Unsure* came back as *Yes* / *No* / *Maybe later*, and Save sent
those). Now `retireBlock` puts the question back through `restoredOnRetype`, as its saved type's pill
would: the card's own typed answers stay (Single ↔ Multiple clears nothing); with none typed, what its
last switch to *Free text* cleared comes back; with nothing kept either, blank answers stay blank,
never the saved ones. Only the type has to go back
for the server: `classifyQuestionEdits` compares the type alone (diffQuestions.js :23-39), `cleanBlock`
drops blank answers from what Save sends (surveyBuilderRules.js :460), and `reconcileQuestions` puts
back as retired any saved answer a save leaves out (surveys.js :349-357). If such a block is restored,
`emptyIssues` marks its blank answers on Save, just as when the pill puts a card back with blank ones.

**Routes** (review round 2). What a card keeps can hold arrows from before a **Switch back**, which
converts and clears every route on the cards (surveyRouting.js :271-289; *"so a later Restore can't
revive one"*, surveyBuilderRules.js :384-385) but not what they keep, with no confirmation on an
unlocked survey (SurveyBuilder.jsx :1055-1063). So whether an arrow comes back is decided at the
restore, from the form as it stands. The first version returned the saved arrows whenever the survey
had been saved in Go to, and a reviewer ran it through the real `switchBack`. Switching a choice
question to *Free text* and back then restored `[{ yes }, { no, goTo: 'bye' }]`, and a *Free text*
question taken to a choice and back restored `goTo: '__end__'`. `updateQuestion` sees a route in Show
only if and sets Go to again (`entersScript`, :222; SurveyBuilder.jsx :972), and every block whose
condition Switch back had converted then carries a hand condition that blocks Save (`handRuleError`,
:158-159). Now `QuestionCard` passes its `route.flow` and the keys of `route.targets` (§D.3), so after
Switch back the answers come back with no arrow and `entersScript('list', …)` stays false. In Go to
the arrows come back, except that an arrow to a block removed since comes back as Continue, which is
what `repointRoutes` leaves every route into a block that leaves (:351-375), and so does one to a
block now above the card, which its select can't offer (`routeTargets`, :248-257).

**Run in memory** (review round 3), against HEAD's `cleanBlock` with the line above, and HEAD's
`emptyIssues`, `questionsForEditing`, `routeTargets`, `entersScript` and `switchBack`, with D.3's
`setType` and `removeOption` modeled as pure functions. Each of these held:

- The reviewer's case gives back exactly *Yes, definitely* / *No* / *Unsure*. *Maybe later* stays
  gone, and Save sends no `retyped`.
- The re-pointed arrow stays End.
- After the real `switchBack` the kept arrows stay off, for a choice question and a *Free text* one,
  and `entersScript('list', …)` is false.
- In Go to an arrow to a block that left, or to one above the card, comes back as Continue.
- Typed answers are never replaced.
- Through blank answers the kept ones come back. With nothing kept, nothing comes back.
- A block added since gets nothing back.
- The lock-flip path (to *Free text* before the flip, back by the saved type's pill) brings back the
  saved answer ids.
- `retireBlock` sends a retyped saved question with its saved type and no arrows (which answers it
  keeps changed in review round 4, below).

HEAD's 36 unit tests also pass against the rules file with these changes.

**Run in memory again** (review round 4), with the same HEAD functions, D.7's `removeQuestion` and
HEAD's Restore (:1272) added to the model, and the server's `classifyQuestionEdits`. Each of these held:

- Single → Multiple with *Yes* reworded and *Unsure* added, then the lock, Retire and Restore:
  `single_choice` with the card's own four answers, retired and restored alike; `classifyQuestionEdits`
  finds no change of type in what Save sends; and the form stays in Show only if. Through *Free text*
  instead: the answers that switch cleared, and *Maybe later*, removed before it, stays gone.
- Every answer blanked and nothing kept, then retired: `single_choice` with the blank answers, which
  `cleanBlock` drops from what Save sends.
- A Go to survey's routed question taken to *Free text*, retired, then **Switch back** and Restore: its
  answers with their ids, no arrow, and the form stays in Show only if. A saved *Free text* question
  taken to *Single choice* and retired: `text`, no answers, no arrow.
- Used once: after the exact undo, an edit, *Multiple choice*, every answer blanked and back → the
  blanks stay; *Free text* → *Multiple* → *A*, *B* typed → *Single* → both blanked → *Multiple* →
  *Single* → the blanks stay. The exact undo, a second undo after more edits, *Free text* → *Multiple*
  → *Single*, round 3's reviewer case, the lock-flip path, the re-pointed arrow and the arrows after
  Switch back all come out as before.
- 3,000 random runs of type changes, reworded, blanked and added answers on a saved question: no kept
  answers outlived an arrival at the saved type, Single ↔ Multiple never replaced a typed answer, and
  retiring a retyped question always gave what its saved type's pill gives, minus arrows, passed
  `classifyQuestionEdits`, sent no blank live answer and, restored, stayed in Show only if.
- `savedInGoTo` on G.3's five cases.
- L.3 step 16's first order (Switch back, then *Free text* and back) brings the answers back with no
  arrow whether or not the flow filter is there, so it could not fail; *Free text* first, then Switch
  back, then back brings no arrow with the filter, and without it the arrow and Go to (§L.3 step 16).
- HEAD's 36 unit tests pass against the rules file with this section's code inserted as written.

### E.2 [client/src/pages/CampaignSurveyBuilderPage.jsx](../client/src/pages/CampaignSurveyBuilderPage.jsx)

1. **Header comment, HEAD :13-14.** Replace `same Duplicate when it has responses. Save and cancel both
   return to the Survey tab. No` / `server changes: …` with:
   ```js
   // same Duplicate when it has responses. Save and cancel both return to the Survey tab; a save
   // refused because the survey has responses can go to the library as a copy instead (its own `copy`
   // mutation below, which never attaches anything). No server changes: POST/PATCH
   // /admin/surveys + PATCH /admin/campaigns/:id { surveyTemplateId }.
   ```
2. **Save my changes as a copy — its own mutation, after HEAD :74** (D4; revised in review round 1).
   The first version of this plan sent the copy through `create`, whose `onSuccess` attaches whenever
   the cached campaign has no main survey (:57-61), so a main survey detached by someone else while
   the copy's `POST` was in flight could make the copy the main. The review proposed adding
   `mode !== 'edit'` to that test. That would not close it. TanStack Query 5.100.6 pushes each
   render's options into a mutation that is still pending (`useMutation`'s per-render effect,
   `@tanstack/react-query/build/modern/useMutation.js` :20-21, reaching
   `@tanstack/query-core/build/modern/mutationObserver.js` :34-35). React Router 6.30.3 renders the
   sibling `/survey/new` and `/survey/edit` routes (App.jsx :173-174) with no per-route key, so the
   page instance and its pending mutation survive the edit guard's redirect to `/survey/new`
   (:117-120) — the very redirect such a detach triggers, after which `mode` reads `'new'`. A mutation
   with no attach step can't attach, whatever happens meanwhile:
   ```js
     // Save my changes as a copy (edit mode only): the form as it stands becomes a NEW survey in the
     // library, and nothing is attached to it — phones still queued under the survey being edited would
     // have those surveys refused and dropped. Its own mutation, so no attach can ever run for it; the
     // Survey tab's ?created hint says how to switch, between shifts.
     const copy = useMutation({
       mutationFn: (body) => api('/admin/surveys', { method: 'POST', body }),
       onSuccess: (res) => {
         qc.invalidateQueries({ queryKey: ['surveys'] });
         navigate(`/campaigns/${campaignId}/survey?created=${res.survey._id}`);
       },
     });
   ```
   `create` (:49-74) is unchanged and is used in new mode only.
3. **Duplicate, HEAD :90-101.** Inside `onSuccess`'s `try`, right after the attach's `await api(…)`
   (:92-95) resolves, add:
   ```js
           // The campaign now runs the copy, so a refusal, or a failed copy, from before belongs to the
           // survey it replaced. Only now: if the attach fails, the refusal and the Duplicate box stay.
           update.reset();
           copy.reset();
   ```
   Review round 3 moved these from the top of `onSuccess`. There they cleared the refusal the moment
   Duplicate's `POST` returned, while the attach was still to run. In the race on an unshared survey
   the refusal is all that holds the box at the top up (item 6), so the box, its spinning button and
   the refusal vanished mid-attach. A failed attach, which the `catch` at :96-98 swallows, then left
   the author on the original with their edits, an unattached copy in the library and no refusal; the
   box came back only once the list's refetch said the survey has answers.
4. **The swap guard (D5), HEAD :117-120:**
   ```jsx
   // Edit with nothing attached → there's nothing to edit; fall through to creating one. An attached
   // survey that just isn't in the list YET is Duplicate's swap in flight: the campaign already names
   // the copy while the survey list refetches — or, for a lead, whose list drops the original once it
   // is detached, the list has refetched while the campaign still names the original. Wait for both
   // lists; a settled miss still falls through.
   if (mode === 'edit' && !attachedSurvey) {
     // fetchStatus, not isFetching: a refetch paused because the browser went offline reads isFetching
     // false while it still has to run. Offline, Loading… holds until the connection returns.
     if (attachedId && (surveysQ.fetchStatus !== 'idle' || campaignsQ.fetchStatus !== 'idle')) {
       return <div className="text-sm text-fg-muted">Loading…</div>;
     }
     return <Navigate to={`/campaigns/${campaignId}/survey/new`} replace />;
   }
   ```
   `['surveys']` has no `staleTime` (:34), so on a fresh visit to an edit URL whose survey is genuinely
   gone the mount refetch shows *Loading…* first and the redirect fires when it settles — the existing
   behavior, one fetch later. A campaign with nothing attached (`attachedId` null) redirects at once.
   **Why `fetchStatus`** (review round 2): in the installed query-core 5.100.6, `isFetching` is
   `fetchStatus === "fetching"`, and a query whose fetch can't run because the browser is offline reports
   `fetchStatus: 'paused'` instead (`build/modern/queryObserver.js` :306, :332; `query.js` :415). Checked
   in memory: a seeded, invalidated `['surveys']` mounting offline reads `paused` with `isFetching`
   false, so the first version of this guard would have sent an offline lead to *Create survey*
   mid-swap. It can't spin forever: no observer polls either key on this route, `main.jsx` :23 sets
   `retry: 1`, and the reconnect's refetch settles a paused one.
5. **`SurveyForm` and the error box, HEAD :182-205** — the props change and the box below the form is
   deleted (it now lives in `SurveyForm`, D.11):
   ```jsx
      {/* Save my changes as a copy is the `copy` mutation (item 2): it never attaches, so the copy goes
          to the library and the Survey tab's ?created hint says how to switch to it, between shifts. */}
      <SurveyForm
        initial={editing ? attachedSurvey : { name: '', intro: '', closing: '', questions: [] }}
        onSave={(body) => {
          if (!editing) return create.mutate(body);
          copy.reset();
          return update.mutate({ id: attachedSurvey._id, body });
        }}
        onCancel={back}
        saving={editing ? update.isPending : create.isPending}
        orgTags={orgTags}
        onCreateTag={isOrgAdmin ? createTag : undefined}
        duplicateAt="at the top of this page"
        duplicateSwitches
        saveError={editing ? update.error : create.error}
        copyError={editing ? copy.error : null}
        onSaveAsCopy={editing ? (body) => copy.mutate(body) : undefined}
        savingCopy={editing && copy.isPending}
      />
   ```
   `copy.reset()` before a new Save clears an earlier copy failure; react-query clears `update.error`
   itself when the new attempt starts. One new mutation, no new request type: the copy is the same
   `POST /admin/surveys` the page's *New survey* already sends (open to leads, `createdBy` stamped,
   surveys.js :636-668). `duplicateSwitches` (review round 3) because this page's Duplicate attaches
   the copy at once (:88-101), so the refusal's guidance says so (§D.11); the org editor's Duplicate, in
   the survey list, switches nothing (SurveysPage.jsx :76-82).
6. **The Duplicate box after a refused save, HEAD :132 and :153** (review round 2). The box at the top
   holds the only Duplicate a lead can reach, and HEAD shows it only when the survey is shared or
   `locked`, which is read from the list row the builder opened with. In the race (a survey's first
   answer arrives while it is open) neither holds on a survey no other campaign uses, yet the refusal's
   first line, the server's own sentence, says *"Duplicate it…"* (surveys.js :438-439, :711), and
   nothing refetches the list on a 409 (`update` has no `onError`, :76-82). After :132 add:
   ```js
     // A save refused because the survey has responses: `locked` was read when the builder opened,
     // before that first answer arrived, and the refusal tells the author to Duplicate.
     const refusedForResponses = editing && update.error?.code === 'survey-has-responses';
   ```
   and :153 becomes `{editing && (shared || locked || refusedForResponses || duplicate.isPending) && (`.
   The box's third wording (:161, *"Duplicate makes a fresh copy of this survey and switches this
   campaign to it. The original keeps its responses."*) is the one it shows, and its between-shifts line
   (:174-177) stays. `duplicate.isPending` (review round 3) keeps the box, and its button's spinner
   (:167), up while Duplicate runs: the installed query-core 5.100.6 awaits `onSuccess`, attach
   included, before it marks the mutation done (`build/modern/mutation.js` :123, :144). The resets
   follow a successful attach (item 3), so the box and the refusal go once the campaign names the copy;
   if the attach fails, both stay, and Duplicate can be pressed again. Because this box sits above a
   form whose edits it doesn't carry, the refusal box's guidance says that Duplicate copies the survey
   as last saved, and that this page's Duplicate switches the campaign at once (§D.11); the form itself
   locks on the same refusal (§D.5). Like that lock, the box goes by the row alone while a later Save is
   in flight, and after a later failure of another kind, until a save is refused again (§D.5, *How long
   it lasts*). SSR can't put an error into a fresh `useMutation`, or hold one
   pending, so the box after a refusal is pinned only by a manual check (L.3 step 7), and the box held
   up while Duplicate runs, with the resets after its attach, only by reading (§L.2).

### E.3 [client/src/pages/SurveyEditorPage.jsx](../client/src/pages/SurveyEditorPage.jsx)

After HEAD :74 (`create`) add the org editor's own `copy`. Its `create` attaches or assigns only in
new mode (`attachTo`/`assignEffort` are read at render only when `mode === 'new'`, :17-18), so it can't
attach a copy in practice; the separate mutation keeps both pages alike, and neither copy's `onSuccess`
contains an attach at all:

```js
  // Save my changes as a copy (edit mode only): a NEW survey in the library, attached and assigned to
  // nothing; it lands on /surveys, where the copy is listed. Its own mutation, so no attach can run.
  const copy = useMutation({
    mutationFn: (body) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      navigate('/surveys');
    },
  });
```

Then replace HEAD :119-139 (the form and the box below it):

```jsx
      <SurveyForm
        initial={editing ? survey : { name: '', intro: '', closing: '', questions: [] }}
        onSave={(body) => {
          if (!editing) return create.mutate(body);
          copy.reset();
          return update.mutate({ id: survey._id, body });
        }}
        onCancel={back}
        saving={editing ? update.isPending : create.isPending}
        orgTags={orgTags}
        onCreateTag={createTag}
        saveError={editing ? update.error : create.error}
        copyError={editing ? copy.error : null}
        onSaveAsCopy={editing ? (body) => copy.mutate(body) : undefined}
        savingCopy={editing && copy.isPending}
      />
```

The route is admin-only (App.jsx :203, :214-215), so `useAuth` in `SurveyForm` reads an org admin
here and the banner keeps its total. It passes no `duplicateSwitches`: this editor's Duplicate is the
survey list's, which switches nothing (SurveysPage.jsx :76-82).

### E.4 [client/src/pages/CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx)

1. After HEAD :11 add `import { responsesPhrase, responsesNoteOpening } from '../lib/surveyBuilderRules.js';`.
2. **`ChangeSurveyModal`** (HEAD :27-73) converts to an arrow, takes the role, and gains a named export
   for the smoke test (G.4 case 9):
   `// \`isOrgAdmin\` words the counts: a lead's cover their campaigns only (responsesPhrase).` /
   `export const ChangeSurveyModal = ({ surveys, currentId, onClose, onAttach, saving, error, isOrgAdmin = false }) => {`,
   and its closing `}` (:73) becomes `};`. The page's default export is unchanged; both exports are
   components, so Vite's fast refresh is unaffected.
3. **Picker label, HEAD :42:**
   ``{s.responseCount > 0 ? `, ${responsesPhrase(s, { isOrgAdmin })}` : ''}``
4. **Picker warning, HEAD :48-54:**
   ```jsx
        {/* Gated on the count, not hasResponses: this is about reporting, and a lead's reports are
            campaign-scoped, so their narrowed count is the honest one here. */}
        {chosen?.responseCount > 0 && !isSame && (
          <p className="rounded border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
            This survey already has {responsesPhrase(chosen, { isOrgAdmin })}. New answers for this campaign report
            alongside them — separate from any survey this campaign used before.
          </p>
        )}
   ```
5. **The created hint, HEAD :186-187** (D4) — the second sentence becomes two:
   ```jsx
            Assign it to a walk list below to run it on those doors, or make it this campaign's default with{' '}
            <strong className="font-medium">{attachedSurvey ? 'Change survey' : 'Pick a survey'}</strong>. Do either
            between shifts: surveys still queued on phones under the survey those doors use now would be dropped.
   ```
   It shows for any survey created here that isn't the main one (:153-156), so it fits both *New
   survey* and a copy. It names the button the tab shows (review round 3): *Change survey* when the
   campaign has a default (state A, :238), *Pick a survey* when it has none (state B, :289). The hint
   can show with none when `create.onSuccess`'s attach fails, which it catches and ignores
   (CampaignSurveyBuilderPage.jsx :61-71), or when the main survey is detached while a copy's `POST` is
   in flight (E.2 item 2). **Both routes are between-shifts steps** (review round 2; the first version put
   *between shifts* on the default switch only). A walk list's own survey wins over the campaign's
   default at its doors (`services/surveys/effectiveTemplate.js` :14-17), the walk-list select saves at
   once (`setOverride`, :110-119), and a survey a phone saved under the survey those doors used before
   is then refused (`routes/mobile/canvass.js` :764-768) and dropped from its queue
   (`mobile/lib/offlineQueue.js` :120-124), exactly as after **Change survey**.
6. **The Preview note, HEAD :252-257** — the gate and the opening phrase change; the rest of the
   sentence and its Go to clause (:258-263) stay:
   ```jsx
                  {/* Shown whenever the survey has answers anywhere it counts — for a lead that includes
                      answers not counted in their campaigns, which is exactly when the builder locks. Only
                      an org admin's count is the survey's total. */}
                  {attachedSurvey.hasResponses && (
                    <div className="border-b border-border bg-sunken px-5 py-2 text-xs text-fg-muted">
                      {responsesNoteOpening(attachedSurvey, { isOrgAdmin })}{' '}
                      — editing keeps past answers; only changing a question&apos;s{' '}
                      <strong className="font-medium text-fg">answer type</strong>
   ```
   The opening phrase comes from `responsesNoteOpening` (E.1), so its three wordings are pinned by a
   unit test (G.3) rather than only by a render SSR can't reach (the note sits behind the Preview
   toggle). Under this gate it is never null (E.1's comment says why).
7. **Mount, HEAD :391-393:** add `isOrgAdmin={isOrgAdmin}` to `<ChangeSurveyModal>` (`isOrgAdmin` is
   already read at :86).

### E.5 [client/src/components/campaigns/CampaignFormDrawer.jsx](../client/src/components/campaigns/CampaignFormDrawer.jsx)

1. After HEAD :4 add `import { responsesPhrase } from '../../lib/surveyBuilderRules.js';`.
2. **The empty option, HEAD :204** — the lead's label (D7) and, for a lead, when it appears (item 5):
   ```jsx
              {/* The empty choice detaches the survey. An org admin always has it; a lead has it only
                  while the campaign has no survey yet (item 5). */}
              {(canEditAdminFields || !initialSurveyId) && (
                <option value="">
                  {canEditAdminFields
                    ? '— None yet (add later on the Surveys page) —'
                    : '— None yet (add later on the campaign’s Survey tab) —'}
                </option>
              )}
   ```
3. **The heads-up, HEAD :225-231** (the `return` inside the IIFE; its gate is unchanged):
   ```jsx
              // A lead's count covers their own campaigns (responsesPhrase), and a lead has no Surveys page:
              // their Duplicate is at the top of the campaign's Edit survey page.
              return chosen?.responseCount > 0 ? (
                <p className="mt-1 text-xs text-warning-fg">
                  Heads up: this survey already has {responsesPhrase(chosen, { isOrgAdmin: canEditAdminFields })}. New
                  answers will report under it alongside the existing ones.{' '}
                  {canEditAdminFields
                    ? 'To run different questions, duplicate it on the Surveys page and pick the copy.'
                    : 'To run different questions, save, then use Duplicate at the top of the campaign’s Edit survey page.'}
                </p>
              ) : null;
   ```
   `canEditAdminFields` is the drawer's existing role signal (:24-28; `CampaignsPage.jsx` :317 passes
   `isOrgAdmin`). The lead sentence says "save" — true only with A1 (§E.6); if A1 is declined, the lead
   branch reads *"To run different questions, pick it on the campaign's Survey tab instead, then use
   Duplicate at the top of its Edit survey page."* If A1 is declined, the key dates' lead line (:242)
   changes too, to the wording in §M item 1, because its *"You can still set the door goal below"*
   promises a save that fails (review round 2).
4. **Active and Restricted doors on invoices, disabled for a lead — HEAD :326-345** (added in review
   round 1; ships whether or not A1 does). Every other admin-only control already reads
   `!canEditAdminFields` (the type radios :131 and :139, State :160, the dates :251, :261 and :270, the
   note :279); these two never did, although the header comment (:24-27), CAMPAIGNS.md :1220-1221,
   ROLES.md :59-60 and the Help (`guides/campaigns-manage.md` :35) all say a lead's admin-only fields
   are read-only. The server refuses both from a lead (campaigns.js :497), and archiving stops the
   billing clock (:122-123). HEAD :326-333 becomes:
   ```jsx
        <div>
          <label
            className={`flex items-center gap-2 text-sm ${canEditAdminFields ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={!canEditAdminFields}
            />
            Active (visible to canvassers)
          </label>
          {!canEditAdminFields && (
            <p className="mt-1 text-xs text-fg-muted">Only an org admin can archive or reactivate a campaign.</p>
          )}
        </div>
   ```
   The label takes the type radios' treatment (:131), and the wrapper keeps the note with its checkbox
   inside the form's `space-y-5`. The Restricted-doors `<Select>` (HEAD :339) gains
   `disabled={!canEditAdminFields}` (the shared `Select` passes it to its `<select>`, whose field class
   already greys a disabled one, `ui/Input.jsx` :5 and :21-27), and after its explanation (:346-351)
   comes `{!canEditAdminFields && <p className="mt-1 text-xs text-fg-muted">Only an org admin can change
   this.</p>}`. Both notes follow the key dates' lead line (:240-242). After this, the controls a lead
   can change are exactly name, timezone, survey, door goal and goal date: A1's `LEAD_CAMPAIGN_FIELDS`
   (§E.6).
5. **A lead's empty survey choice, only while there is no survey** (item 2's condition; added in review
   round 1, ships whether or not A1 does). The drawer sends `surveyTemplateId: null` for the empty
   choice (:86), and the `PATCH` lets anyone who may edit the campaign detach (campaigns.js :633-635,
   *"Detach (null) stays free"*). Today that is moot for a lead, whose drawer Save is always refused.
   With A1 it would become the only place a lead could remove a campaign's main survey: the Survey tab
   can swap a campaign's survey but never leave it with none (*Attach survey* is disabled with no
   selection, CampaignSurveyPage.jsx :66; SURVEYS.md :492, there is *no "unlink"*), and the phone
   PATCHes a campaign only for its outcome and door-add settings
   (`mobile/app/(app)/admin/app-customization.jsx` :81, :111, :150). So, to keep a lead's survey powers
   exactly what the Survey tab gives them, a lead gets the empty choice only while the campaign had no
   survey when the drawer opened (`initialSurveyId`, :39), the one case its label describes; a lead can
   still swap the survey for another in their library, as on the Survey tab. An org admin always has
   it, as today. (The detach cliff, an admin's survey leaving a lead's library once it is off the last
   of their campaigns, `guides/surveys.md` :132, is not the reason: a swap meets it just the same,
   which is what that Help paragraph already warns about. Of the two ways to handle this the review
   offered, a warning beside the choice was the other.)
6. **The header comment, HEAD :24-27,** is true after items 4-5, and names them:
   ```jsx
     // Org admins edit everything. A LEAD reaches this drawer too (they can run a campaign), but of this
     // drawer's fields the server accepts only name, survey, timezone and the door goal from them
     // (routes/admin/campaigns.js) — so everything else renders read-only (Active and the invoice policy
     // included) rather than letting them fill in a field the PATCH will 403, and a lead never empties
     // the survey once the campaign has one. Create is admin-only, so this is an edit-mode concern.
   ```

### E.6 Proposed with this change, needs a yes — A1, a lead's drawer Save (§M)

**The bug, verified.** `CampaignFormDrawer.submit` (HEAD :80-99) always sends `type`, `state`,
`isActive`, the key dates, `datesNote` and `billRestrictedDoors`; for a lead, `PATCH
/admin/campaigns/:id` refuses any of those with a 403 before it reads the campaign
([campaigns.js](../server/src/routes/admin/campaigns.js) :496-505). Driving the real handler in memory
with the drawer's exact body as a lead returned `403 {"error":"Only an org admin can change a
campaign's isActive."}` without reaching the lookup; the same request without those fields passed the
check. The drawer has been open to leads since 2026-08-14 (`9b1b151`), and it is the only web control
for the door goal a lead may set (the phone only shows it).

**The fix.** A new pure module, `client/src/lib/campaignPatch.js`:

```js
// What the campaign Edit drawer may send for its viewer. Of the drawer's fields a team lead owns a
// campaign's name, survey, timezone and door goal. routes/admin/campaigns.js 403s each field on its
// admin-only list (isActive, type, state, the key dates, the dates note, the invoice policy, the opt-in
// outcomes) when a lead sends it, even sent back unchanged, so the drawer, which shows those read-only
// to a lead, must not send them. (A lead may also set disabledOutcomes and doorAddPolicy, on App
// Customization; neither is a drawer field.) Org admins send the whole form, as before.
export const LEAD_CAMPAIGN_FIELDS = ['name', 'surveyTemplateId', 'timeZone', 'doorGoal', 'goalDate'];

export const campaignPatchFor = (body, { isOrgAdmin }) =>
  isOrgAdmin
    ? body
    : Object.fromEntries(LEAD_CAMPAIGN_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));
```

In the drawer, `submit` (HEAD :80-99, converted to an arrow while it is edited) wraps its body:
`onSave(campaignPatchFor({ …the same fields… }, { isOrgAdmin: canEditAdminFields }))`, with the import
added beside E.5's. Create is admin-only (`CampaignsPage.jsx` :291), so creation always sends the whole
form.

**What it relies on.** §E.5 items 4-5, which ship either way. Without item 4 a lead could untick
**Active** or change the invoice policy, press Save and get a 200 that silently dropped the change, where
today the same Save fails loudly with a 403; after it, the drawer's enabled controls for a lead are
exactly `LEAD_CAMPAIGN_FIELDS`. Without item 5 the empty survey choice would become a working detach.

**Privacy: neutral.** The server's lead allow-list (campaigns.js :496-505) and its attach check
(`canManageSurvey`, :633-641) are unchanged; A1 only stops the drawer sending fields it already shows
read-only. Nothing new is collected, exposed or shared, and a lead's name and door-goal changes land in
**History** (`CampaignChange`, :129-145 and :658-673) as the 2026-08-14 ruling intended; `timeZone`
and `surveyTemplateId` stay out of History by design (:125-128).

**Tests (§G.5).** A unit test pins `campaignPatchFor` against the server's refused list, and an
integration test sends the drawer's whole body through the real `PATCH` as a lead — refused, as today —
then the same body through `campaignPatchFor`, which lands.

### E.7 [client/src/pages/CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) — a drawer save refreshes the survey list

`update.onSuccess` (HEAD :155-168) refreshes the campaigns, the rollup and the reports, but not
`['surveys']`, although a drawer save can attach or swap a campaign's survey, which changes
`usedByCampaigns` and `usedElsewhere` on the rows involved and — for a lead, by R1 — whether a row's
`hasResponses` counts the whole organization. The builder renders from the cached list and refetches on
mount (no `staleTime`, CampaignSurveyBuilderPage.jsx :34), so a stale row would open it unlocked until
the refetch lands (D2 makes that flip safe, but it shouldn't happen). After HEAD :165 add:

```js
      // A drawer save can attach or swap the campaign's survey, which changes the survey list's usage
      // (usedByCampaigns, usedElsewhere) and, for a lead, which surveys count organization-wide
      // (hasResponses, owner ruling 2026-10-03): refresh it, as the Survey tab's attach does.
      qc.invalidateQueries({ queryKey: ['surveys'] });
```

The page observes `['surveys']` itself (:136-139), so it refetches at once. It matters to a lead only
with A1 (without it their drawer Save is refused), but it is right either way: an admin's attach changes
the same usage annotations, and the **Archive** action, which shares this mutation (:258), changes the
`isActive` each usage entry carries (surveys.js :558). Added in review round 1; it ships either way.
No render test can drive this mutation (SSR can't click), so L.3 step 15 checks it in the browser's
Network tab (review round 2).

## F. Exact user-facing copy, per role

Straight from the code above; a curly apostrophe where the file's neighbors use one.

| Where | Org admin | Team lead |
|---|---|---|
| Builder banner, first line (both builders) | *This survey has 35 responses.* (*1 response*; *1,234 responses*); after a save refused because the survey has responses, on a row that said none: *This survey has responses.* | *This survey has 10 responses in your campaigns.* (*1 response in your campaigns*); with none of their own: *This survey has responses in your organization.*; after a refused save on a row that said none: *This survey has responses.* |
| Builder banner, the rest | today's words (:1143-1158), but *…, and so are changes to its Go to routes* and *The only change that needs a fresh copy is changing a question's type …* only on a survey saved in Go to that still uses it; after a refused Go to save on a survey saved in Show only if: *Two changes need a fresh copy: changing a question's type, and adding Go to routing — use Duplicate … for those.* (§D.9) | same |
| Builder, the survey-name hint | *Surveys are linked to campaigns on the Campaigns page.* (unchanged) | *Surveys are linked to a campaign with Change survey on its Survey tab.* |
| Card hint, *Retire*/*Remove* labels | unchanged words; shown on saved blocks only | same |
| Refusal box, line 1 | the server's message, unchanged: *This survey has responses, so it can't switch to Go to routing. Duplicate it to build the scripted version.* / *This survey has responses, so a question's answer type can't change. Duplicate it to make these changes.* + one bullet per reason (*Question "…" changed type (single_choice → multiple_choice).*) | same |
| Refusal box, guidance (type refusal) | *Your changes are still here. Set those questions back to the answer type they were saved with and save again, or keep all of it, the refused change included, with Save my changes as a copy.* | same |
| Refusal box, guidance (Go to refusal) | *Your changes are still here. Switch back to Show only if (on the blue Go to banner above) and save again, or keep all of it, the refused change included, with Save my changes as a copy.* | same |
| Refusal box, Duplicate line (either refusal) | *Duplicate from the survey list copies the survey as last saved, without these changes.* (the org editor) / *Duplicate at the top of this page copies the survey as last saved, without these changes, and switches this campaign to the copy at once, so do it only between shifts. Save my changes as a copy switches nothing.* (a campaign's builder; the last sentence only while the copy button is offered) | the second (a lead's only builder is a campaign's) |
| Refusal box, copy line | *The copy is a new survey in your library, "Door script (Copy)". Nothing switches to it: whatever uses this survey keeps it until you change it — between shifts, because surveys still queued on phones under this one would be dropped.* | same |
| Refusal box, failed copy | *Couldn't save the copy: ‹server message›* | same |
| Footer note | *Not saved — see the message at the end of the form.* | same |
| Footer button | *Save my changes as a copy* / *Saving copy…* | same |
| Survey tab, Preview note | *35 responses across all campaigns — editing keeps past answers; only changing a question's answer type, or switching it to Go to, needs Duplicate.* (the Go to clause only on a non-Go-to survey, as today) | *This survey has 10 responses in your campaigns — editing keeps …* or *This survey has responses in your organization — editing keeps …* |
| Survey tab, created hint | *‹name› was created and added to your library. Assign it to a walk list below to run it on those doors, or make it this campaign's default with Change survey. Do either between shifts: surveys still queued on phones under the survey those doors use now would be dropped.* (*Pick a survey* in place of *Change survey* while the campaign has no default survey) | same |
| Campaign builder, the Duplicate box at the top | unchanged words; also shown now once a save is refused with `survey-has-responses`, and kept up while Duplicate runs (§E.2 item 6) | same |
| Change-survey picker, option | *Door script (v3, 35 responses)* | *Door script (v3, 10 responses in your campaigns)* |
| Change-survey picker, warning | *This survey already has 35 responses. New answers for this campaign report alongside them — separate from any survey this campaign used before.* | *This survey already has 10 responses in your campaigns. New answers …* |
| Campaign drawer, empty option | *— None yet (add later on the Surveys page) —* (always offered, as today) | *— None yet (add later on the campaign's Survey tab) —*, offered only while the campaign has no survey (§E.5 item 5) |
| Campaign drawer, heads-up | *Heads up: this survey already has 10 responses. New answers will report under it alongside the existing ones. To run different questions, duplicate it on the Surveys page and pick the copy.* (unchanged) | *Heads up: this survey already has 10 responses in your campaigns. New answers will report under it alongside the existing ones. To run different questions, save, then use Duplicate at the top of the campaign's Edit survey page.* (A1 declined: §E.5) |
| Campaign drawer, under *Active (visible to canvassers)* | — (the checkbox works, as today) | *Only an org admin can archive or reactivate a campaign.*, the checkbox greyed out |
| Campaign drawer, under *Restricted doors on invoices* | — (the select works, as today) | *Only an org admin can change this.*, the select greyed out |
| Campaign drawer, under *Key dates* | *Optional — surfaced on campaign cards and dashboards.* (unchanged) | with A1, unchanged: *Only an org admin can change the key dates. You can still set the door goal below.* — if A1 is declined: *Only an org admin can change the key dates. For now, only an admin can save this drawer, so ask an admin to set the door goal.* (§M item 1) |
| A duplicate's name | *‹name› (Copy)*, cut to 200 characters | same |

Counts use `toLocaleString()`, as the Survey tab and the drawer already did; the builder banner and the
Change-survey picker's label gain the separator for counts of 1,000 or more (HEAD prints the raw
number in both, SurveyBuilder.jsx :1141 and CampaignSurveyPage.jsx :42). No new or changed lead string
contains a count of another campaign, a campaign name, or the word *elsewhere*. The only lead strings
with that word are the two unchanged `usedElsewhere` labels, *"also used elsewhere in your
organization"* (CampaignSurveyPage.jsx :228) and *"This survey is also used elsewhere in your
organization — changes apply there too."* (CampaignSurveyBuilderPage.jsx :160), and both are about
where a survey is attached, not where its answers came from.

## G. Tests

### G.1 Server — [server/test/teamLead.int.test.js](../server/test/teamLead.int.test.js), one new test after HEAD :488

Self-contained, after the attach test, which ends with A back on no main survey (:484-487). It covers
both arms of "part of their campaigns" (`attachedSurveyTemplateIds`, campaignManagement.js :86-91 and
:92-96): four surveys ride on A as walk-list overrides, and a sixth (added in review round 1) is A's
main survey for the length of the test — the only kind of survey a lead's builder opens (§K.2). It uses
only what the file already has: the models imported at :20 and :25-29, `mongoose` (:4), `call`
(:150-163), `ctx.admin`/`ctx.lead` (:131), no new `before()` (the file's one is :40), no `await
import()` between tests, and everything it creates or changes is put back in `finally`.

```js
test('a lead\'s survey list says whether a survey on their campaigns has answers anywhere in the org — never whose or how many', { skip }, async () => {
  const { leadTok, adminTok, org, A, B, admin, lead } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const questions = [
    { key: 'support', label: 'Can we count on your support?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
    { key: 'why_not', label: 'Why not?', type: 'text', options: [] },
    { key: 'anything_else', label: 'Anything else?', type: 'text', options: [] },
  ];
  // The builder's own first "then go to" on a Show-only-if survey (accepted on one with no answers).
  const firstRoute = {
    flow: 'script',
    questions: [{ ...questions[0], options: [{ id: 'yes', text: 'Yes', goTo: 'anything_else' }, { id: 'no', text: 'No' }] }, questions[1], questions[2]],
  };
  const mk = (name, createdBy) => SurveyTemplate.create({ organizationId: org._id, name, createdBy, version: 1, flow: 'list', questions });
  const [elsewhere, legacy, mixed, none, authored, main] = await Promise.all([
    mk('Gap elsewhere', admin._id), mk('Gap legacy', admin._id), mk('Gap mixed', admin._id), mk('Gap none', admin._id),
    mk('Gap authored', lead._id), // in the lead's library only because they wrote it: on none of their campaigns
    mk('Gap main', admin._id), // A's main survey for the length of this test (set inside the try)
  ]);
  const ids = [elsewhere, legacy, mixed, none, authored, main].map((s) => s._id);
  // Four on A as walk-list overrides; `main` is A's own survey, the arm a lead's builder opens.
  const efforts = await Effort.create([elsewhere, legacy, mixed, none].map((s) => ({
    organizationId: org._id, campaignId: A._id, name: `WL ${s.name}`, surveyTemplateId: s._id,
  })));
  // Raw rows with REAL ObjectIds everywhere: the list keys its counts by String(), so a string id would
  // still count there while the PATCH's ObjectId-cast exists missed it — a fake disagreement. A fresh
  // voterId and passId per row keep the {voterId, passId} unique index quiet. campaignId null is a
  // legacy row, which the schema now refuses (SurveyResponse.js :43-48) — hence the raw insert.
  const row = (s, campaignId) => ({
    organizationId: org._id, campaignId, surveyTemplateId: s._id,
    voterId: new mongoose.Types.ObjectId(), passId: new mongoose.Types.ObjectId(), submittedAt: new Date(),
  });
  await SurveyResponse.collection.insertMany([
    row(elsewhere, B._id), row(elsewhere, B._id),
    row(legacy, null),
    row(mixed, A._id), row(mixed, B._id), row(mixed, B._id),
    row(authored, B._id),
    row(main, B._id),
  ]);
  try {
    // The attach test above left A with no main survey; `finally` puts that back.
    await Campaign.updateOne({ _id: A._id }, { $set: { surveyTemplateId: main._id } });
    const leadList = await call('GET', '/api/admin/surveys', opt);
    assert.strictEqual(leadList.status, 200);
    const mine = new Map(leadList.json.surveys.map((s) => [String(s._id), s]));
    const of = (s) => mine.get(String(s._id));
    for (const s of [elsewhere, legacy, mixed, main]) assert.strictEqual(of(s).hasResponses, true, `${s.name}: answers somewhere in the org lock it`);
    assert.strictEqual(of(none).hasResponses, false, 'no answers anywhere: never locked');
    assert.strictEqual(of(authored).hasResponses, false, 'only authored, on none of their campaigns: narrowed (owner ruling 2026-10-03)');
    for (const s of [elsewhere, legacy, authored, main]) {
      assert.strictEqual(of(s).responseCount, 0, `${s.name}: counts stay theirs`);
      assert.deepStrictEqual(of(s).responseCountByCampaign, []);
    }
    assert.strictEqual(of(mixed).responseCount, 1);
    assert.deepStrictEqual(of(mixed).responseCountByCampaign.map((b) => [b.campaignName, b.count]), [['Campaign A', 1]]);
    const text = JSON.stringify(leadList.json);
    assert.ok(!text.includes('Campaign B'), 'no other campaign anywhere in the payload');
    assert.ok(!text.includes('No campaign'), 'no legacy bucket either');
    // Exactly the two bare booleans and the narrowed annotations — a future org-wide number would fail here.
    const stored = await SurveyTemplate.findById(mixed._id).lean();
    assert.deepStrictEqual(
      Object.keys(of(mixed)).filter((k) => !(k in stored)).sort(),
      ['hasResponses', 'responseCount', 'responseCountByCampaign', 'usedByCampaigns', 'usedByWalkLists', 'usedElsewhere']
    );

    // The list and the save agree on every survey on the lead's campaigns…
    for (const s of [elsewhere, legacy, mixed, main]) {
      const res = await call('PATCH', `/api/admin/surveys/${s._id}`, { ...opt, body: firstRoute });
      assert.strictEqual(res.status, 409, `${s.name}: ${JSON.stringify(res.json)}`);
      assert.strictEqual(res.json.code, 'survey-has-responses');
    }
    const free = await call('PATCH', `/api/admin/surveys/${none._id}`, { ...opt, body: firstRoute });
    assert.strictEqual(free.status, 200, JSON.stringify(free.json));
    // …and the save still guards the one the ruling leaves narrowed (no lead builder opens it).
    const guarded = await call('PATCH', `/api/admin/surveys/${authored._id}`, { ...opt, body: firstRoute });
    assert.strictEqual(guarded.status, 409);

    // The admin branch is unchanged: org-wide counts (never assert bucket order — it is unsorted).
    const adminList = await call('GET', '/api/admin/surveys', { token: adminTok, orgId: org._id });
    const all = new Map(adminList.json.surveys.map((s) => [String(s._id), s]));
    assert.deepStrictEqual([elsewhere, legacy, mixed, none, main].map((s) => all.get(String(s._id)).responseCount), [2, 1, 3, 0, 1]);
    assert.strictEqual(all.get(String(none._id)).hasResponses, false);
    assert.ok(!('usedElsewhere' in all.get(String(mixed._id))), 'admin rows carry no usedElsewhere');
  } finally {
    await Campaign.updateOne({ _id: A._id }, { $set: { surveyTemplateId: null } });
    await SurveyResponse.deleteMany({ surveyTemplateId: { $in: ids } });
    await Effort.deleteMany({ _id: { $in: efforts.map((e) => e._id) } });
    await SurveyTemplate.deleteMany({ _id: { $in: ids } });
  }
});
```

Every assertion on the first five surveys was checked against the patched handlers in memory (§A), not
against a database; a round-1 reviewer then ran the test as first written against a scratch mongod
with the server change loaded (the file's 21 tests passing, and this one failing at HEAD on its
intended assertion). The sixth survey, `main`, is §A's row *"A's main survey; 1 answer on B"*, but
this test's version of it has not been run: L.1 is its first run.

### G.2 Server — [server/test/surveys.int.test.js](../server/test/surveys.int.test.js), one new test after HEAD :263 (D6)

```js
test('a duplicate\'s name fits the 200 characters a save accepts', { skip }, async () => {
  const { adminTok, org } = ctx;
  const opt = { token: adminTok, orgId: org._id };
  // Made on the model, which sets no length limit (SurveyTemplate.js :99): the builder caps a name at
  // 200, and " (Copy)" used to push one past it.
  const long = await SurveyTemplate.create({ organizationId: org._id, name: 'x'.repeat(200), questions: [] });
  // Cut at a space: the server's copyName must trim it, exactly as the client's does (G.3's same input).
  const gap = await SurveyTemplate.create({ organizationId: org._id, name: `${'a'.repeat(192)} bbbbbbbbb`, questions: [] });
  const short = await SurveyTemplate.create({ organizationId: org._id, name: 'Door script', questions: [] });
  // An emoji astride the cut (code units 193-194): never half of it, since a lone half is stored as U+FFFD.
  const astral = await SurveyTemplate.create({ organizationId: org._id, name: `${'a'.repeat(192)}😀${'b'.repeat(10)}`, questions: [] });
  const made = [];
  try {
    const dupLong = await call('POST', `/api/admin/surveys/${long._id}/duplicate`, opt);
    assert.strictEqual(dupLong.status, 201);
    made.push(dupLong.json.survey._id);
    assert.strictEqual(dupLong.json.survey.name, `${'x'.repeat(193)} (Copy)`);
    const resave = await call('PATCH', `/api/admin/surveys/${dupLong.json.survey._id}`, { ...opt, body: { name: dupLong.json.survey.name } });
    assert.strictEqual(resave.status, 200, 'the copy saves again');
    const dupGap = await call('POST', `/api/admin/surveys/${gap._id}/duplicate`, opt);
    assert.strictEqual(dupGap.status, 201);
    made.push(dupGap.json.survey._id);
    assert.strictEqual(dupGap.json.survey.name, `${'a'.repeat(192)} (Copy)`, 'no double space at the cut');
    const dupShort = await call('POST', `/api/admin/surveys/${short._id}/duplicate`, opt);
    assert.strictEqual(dupShort.status, 201);
    made.push(dupShort.json.survey._id);
    assert.strictEqual(dupShort.json.survey.name, 'Door script (Copy)', 'a short name is unchanged');
    const dupAstral = await call('POST', `/api/admin/surveys/${astral._id}/duplicate`, opt);
    assert.strictEqual(dupAstral.status, 201);
    made.push(dupAstral.json.survey._id);
    // Read back from the database: a lone half would have come back as U+FFFD.
    const storedAstral = await SurveyTemplate.findById(dupAstral.json.survey._id).lean();
    assert.strictEqual(storedAstral.name, `${'a'.repeat(192)} (Copy)`, 'the emoji goes whole, never half of it');
    assert.ok(!storedAstral.name.includes('\uFFFD'));
  } finally {
    await SurveyTemplate.deleteMany({ _id: { $in: [long._id, gap._id, short._id, astral._id, ...made] } });
  }
});
```

### G.3 Client unit — [client/src/lib/surveyBuilderRules.test.js](../client/src/lib/surveyBuilderRules.test.js), eight tests at the end (36 → 44)

Add `responsesPhrase`, `responsesNoteOpening`, `COPY_SUFFIX`, `copyName`, `savedShape`,
`restoredOnRetype`, `retireOption`, `retireBlock` and `savedInGoTo` to the import (HEAD :3-44; the file already
imports `questionsForEditing`, `entersScript`, `routeTargets`, `switchBack`, `cleanBlock`,
`emptyIssues` and `END_KEY`). Each assertion below passed against the E.1 code in memory (the
`responsesNoteOpening` and `retireOption` tests' in review round 1, with `savedShape` reading through
the real `questionsForEditing`). Round 2's additions (the flow-aware `restoredOnRetype`,
`retireBlock`, `savedShape`'s labels and `copyName`'s emoji cut) were run the same way against the
revised helpers, with the real `switchBack`, `routeTargets`, `entersScript` and `cleanBlock`. Round
3's re-pinned `restoredOnRetype` and `retireBlock`'s retyped case were run as the scenarios §E.1
lists, against the revised helpers and HEAD's real functions (with E.1's `cleanBlock` line), not yet
as this test code, and so were round 4's: `restoredOnRetype` used once, `retireBlock` through it, and
`savedInGoTo`.

- **`responsesPhrase`**: admin 35 → `'35 responses'`, admin 1 → `'1 response'`, admin 1234 →
  `` `${(1234).toLocaleString()} responses` ``, admin 0 → `null`; lead 10 → `'10 responses in your
  campaigns'`, lead 1 → `'1 response in your campaigns'`, lead 0 with `hasResponses` →
  `'responses in your organization'`, lead 0 without → `null`; no options → the lead wording; `null`
  survey → `null`; and for every lead combination of 0/1/10 × true/false, no phrase starts with `0 ` or
  contains `elsewhere`.
- **`copyName`**: `'Door script'` and `'  Door script  '` → `'Door script (Copy)'`; a 200-character name
  → length 200; 193 characters → itself + `COPY_SUFFIX`; `` `${'a'.repeat(192)} bbbbbbbbb` `` →
  `'a' × 192 + ' (Copy)'` (no double space at the cut); `` `${'a'.repeat(192)}😀${'b'.repeat(10)}` ``, an
  emoji astride the cut → `'a' × 192 + ' (Copy)'`, 199 characters with no lone surrogate (review round
  2); and `` `${'a'.repeat(191)}😀…` ``, an emoji that fits → kept whole, 200 characters.
- **`savedShape`**: on a Go to survey with a question (answers `yes` routed, `no`, a retired `old`), a
  routed text question and a closing — keys `['support', 'why_not', 'close_2']`, the statement typed
  `statement`, answer ids `yes,no,old`, the routed answer's route kept as loaded, each entry's stored
  `label` (the question's wording, the closing's read-aloud text), and no `goTo` key on any entry (a
  block's own route is never read back from it since review round 3: the restore reads what the card
  kept, and `retireBlock` sends no arrow); on a Show-only-if survey a stray stored route on an answer
  comes back `null`; `savedShape(null).size === 0`.
- **`restoredOnRetype`** (re-pinned in review round 3: what comes back is what the card kept,
  `retyped`, never the survey as saved). A saved choice question whose answers were reworded, added to
  and one removed outright, taken to Free text → `retyped.options` holding exactly those answers; back
  to its saved type → exactly those answers (copies), the removed one still gone, `emptyIssues` empty,
  and `cleanBlock` of the card carrying no `retyped` key. In Go to (`{ flow: 'script', targets }`, the
  targets from the real `routeTargets`), each kept answer keeps its arrow while its target is offered,
  and an arrow to a block removed since, or now above the card, comes back as Continue (`null`). A
  saved Free-text question whose arrow was re-pointed to End, taken to a choice type and back in Go to
  → `goTo: END_KEY`, not its saved target. **After the real `switchBack` of a Go to survey** (review
  round 2), which clears the cards' routes but not what they kept, a restore in `flow: 'list'` carries
  no route at all — the answers come back with `goTo: null`, the Free-text question gets none — and
  `entersScript('list', …)` of the card as restored is `false` for both. Multiple back to saved Single
  with typed answers → only `retyped`; through blank answers (Free text → Multiple → Single) → the kept
  answers; with nothing kept (answers blanked by hand, Single → Multiple → Single) → only `retyped`,
  never the saved answers; **used once** (review round 4): back at the saved type the returned
  `retyped` carries no `options`, whether the kept answers came back or typed answers won, so Free text
  and back, an edit, Multiple, every answer blanked and back to the saved type → only `retyped`, and
  Free text → Multiple → *A*, *B* typed → Single → both blanked → Multiple → Single → only `retyped`,
  while a second Free text and back restores the answers as they stood just before it; with only a
  retired answer carrying text → only `retyped`; a block with no saved entry → only `retyped` (it
  keeps, and gets nothing back); a type other than the saved one → only `retyped`; the same type →
  `null`; Free text before a lock flip and back by the saved type's pill → the answers with their saved
  ids.
- **`responsesNoteOpening`**: admin 35 → `'35 responses across all campaigns'`; lead 10 → `'This
  survey has 10 responses in your campaigns'`; lead 0 with `hasResponses` → `'This survey has
  responses in your organization'`; nothing to say (admin 0, lead 0 without `hasResponses`, `null`) →
  `null`. This pins the Survey tab's Preview note, which SSR can't open (G.4).
- **`retireOption`**, against `savedShape` of a saved `support` question (`yes` "Yes", `no` "No", a
  retired `old`): `yes` with its text cleared → `{ id: 'yes', text: 'Yes', retired: true }`, and only
  spaces → the same; `yes` reworded to *"Yes, definitely"* → retired with the typed words; an answer
  added since (`yes_2`) → `null`; no saved entry → `null`; an answer with no id → `null`; the card's
  answer object is never mutated.
- **`retireBlock`** (review round 2), against the same `savedShape`: the saved Free-text question with
  its wording cleared → retired with *"Why not?"*, and the closing with only spaces → retired with its
  saved read-aloud text; a reworded question → retired with the typed words; the card's object is never
  mutated; and `cleanBlock` of each retired block sends a non-blank label, the one the server requires
  of every block. On the `savedShape` bullet's Go to survey, its `support` question (answer `yes`
  routed) taken to Free text before the lock came on, then retired → `single_choice` again, with the
  answers that switch kept (here its saved ids and words), every answer's `goTo`, the block's `goTo`
  and its `otherGoTo` all `null`, no `options` left in its `retyped`, and `cleanBlock` sends that type,
  so the server's type check passes (review round 3). Review round 4: Single → Multiple with *Yes*
  reworded and *Unsure* added, then retired → `single_choice` with exactly the card's own answers,
  never the saved ones, and the same block with `retired: false` (Restore) → those answers again, with
  `entersScript('list', …)` false; reworded before a switch to Free text, then retired → the reworded
  answers; every answer blanked with nothing kept → `single_choice` with the blank answers, which
  `cleanBlock` drops; a saved Free-text question taken to Single choice and retired → `text`, no
  answers, no `goTo`. A block whose type is still the saved one keeps its own answers; and the
  `savedShape` entry is never mutated.
- **`savedInGoTo`** (review round 4): `('script', { flow: 'script' })` → `true`; `('script', { flow:
  'list' })`, a survey saved in Show only if that has taken an arrow since → `false`; `('list', {
  flow: 'script' })`, after Switch back → `false`; `('script', {})`, a template from before Go to →
  `false`; `('script', null)` → `false`. It is the only automatic pin of the banner's Go to sentence
  after a refused Go to save: SSR starts the form in the flow it was saved in (G.4).

### G.4 Client render smoke — new `client/src/lib/surveyBuilderLockRender.smoke.test.js`

The harness is [campaignResolveRender.smoke.test.js](../client/src/lib/campaignResolveRender.smoke.test.js)'s
(:32-105): a temporary directory per test inside the client tree, removed in `finally`; esbuild with
`packages: 'external'`; `renderToString`; no jsdom. Three stubs: `auth/AuthContext.jsx` →
`export const useAuth = () => globalThis.__auth; export const useOrgTimeZone = () => 'America/Chicago';`
(the entry sets `globalThis.__auth` per render — `useAuth` runs at render time, after the entry's top
line); `.css` → an empty module; and **`Overlay.jsx`** → a plain wrapper, for the drawer and picker
cases (8 and 9) only, because `createPortal(…, document.body)` (`ui/Overlay.jsx` :68-82) throws
`document is not defined` in node — checked. The Overlay stub and its filter, `/(^|\/)Overlay\.jsx$/`,
are [modalScroll.smoke.test.js](../client/src/lib/modalScroll.smoke.test.js)'s (:18-50), which already
renders `Modal` this way; `Drawer`, `Modal` and `ui/index.js` all import it as `'./Overlay.jsx'`. The
entry's `QueryClient` uses `{ retry: false, staleTime: Infinity }`, so a seeded list reads
as **settled** and an `invalidateQueries` models a refetch in flight; with the default `staleTime` 0 the
page's mount refetch makes every seeded `['surveys']` read as fetching (checked: a settled miss then
renders *Loading…*). `fetch` never resolves. Seeds: `['admin','campaigns']` (campaign `c1`, its
`surveyTemplateId` as `{ _id }`), `['surveys']`, `['admin','tags']`. Strip `<!-- -->` before matching.
The survey row: *Door script*, List flow, a single-choice `support` (`yes`, `no`, retired `old`), a text
`why_not`, a statement — all keyed.

1. **A lead's gap row locks up front** (lead; `hasResponses: true, responseCount: 0,
   usedElsewhere: false`; `CampaignSurveyBuilderPage` edit): contains *This survey has responses in your
   organization.*; doesn't match `/This survey has 0/`; contains *Duplicate to edit a copy*; the
   `title` of three *then go to* selects equals `routesLockedHint('at the top of this page')`; two
   *Type is locked once there are responses* hints (the two saved questions); three *Retire* labels;
   and the name hint *Surveys are linked to a campaign with Change survey on its Survey tab.*, with no
   *on the Campaigns page*.
2. **The banner words its reader's count**: lead with 10 → *This survey has 10 responses in your
   campaigns.*; admin with 35 → *This survey has 35 responses.*; admin with 1234 → the
   `toLocaleString` form; and `SurveyEditorPage` (`/surveys/s1/edit`, admin, 35) → *This survey has 35
   responses.* Both admin renders keep the name hint *Surveys are linked to campaigns on the Campaigns
   page.*
3. **No answers anywhere locks nothing** (lead; `hasResponses: false`): no *This survey has*, no
   *Duplicate to edit*, no locked title, no type hint, no *Retire*, three *Remove*. The screen-level
   false-positive guard.
4. **Only what was saved locks** (`SurveyForm` directly, lead, locked row plus one appended block with
   key `''` — the render-level stand-in for a block added in the builder, which SSR can't click): the
   saved choice card's pills read *on, off, off* (active Single only); the new card's read *on, on, on*;
   two type hints (saved cards only); three *Retire*, one *Remove*.
5. **The saved type stays pickable** (`TypePills` directly): `value: 'multiple_choice', disabled: true,
   savedType: 'single_choice'` → *Single choice* enabled, *Free text* disabled; without `savedType`,
   *Single choice* disabled.
6. **A refused save is shown where it can be seen** (`SurveyForm` directly, on the row with
   `hasResponses: false` and `responseCount: 0`, as it was read before the race's first answer): with a
   type 409 (`code: 'survey-has-responses'`, one reason) and `onSaveAsCopy` → the message, the reason,
   the type guidance, *Duplicate from the survey list copies the survey as last saved, without these
   changes.* (the default `duplicateAt`; with `duplicateAt="at the top of this page"`, *Duplicate at the
   top of this page copies …*, review round 2), the copy line naming *“Door script (Copy)”*, the footer
   note, and `<button type="button" …>Save my changes as a copy`; the box's index is after the last
   `Closing</h2>` and before `fixed bottom-0`. The same 409 **locks the form** (§D.5, review round 3):
   *This survey has responses.*, three *Retire*, two type hints, and the saved choice card's pills *on,
   off, off*. With `duplicateAt="at the top of this page"` and `duplicateSwitches` → *Duplicate at the
   top of this page copies the survey as last saved, without these changes, and switches this campaign
   to the copy at once, so do it only between shifts. Save my changes as a copy switches nothing.*
   (review round 3). On a row saved in Go to (`flow: 'script'`, a routed answer), the same type 409
   leaves the banner's *…and so are changes to its Go to routes.* (`goToSaved`, review round 4; the
   state a Go to refusal leaves, a form in Go to on a survey saved in Show only if, is beyond SSR and
   pinned by G.3's `savedInGoTo`). A Go to 409 (no reasons) → the Go to guidance and the Duplicate
   line. A 400 (`code: null`) → the message and the footer note, no guidance, no Duplicate line, no
   copy button, and nothing locked (no banner, three *Remove*). A 409 with no `onSaveAsCopy` → *…and save again.*
   followed by the Duplicate line, no button (with `duplicateSwitches`, the line ends *…so do it only
   between shifts.* with no copy sentence). `savingCopy: true` → *Saving copy…* and Save rendered
   `disabled`. No error → no `role="alert"`, no note.
7. **Duplicate's swap waits** (lead, `CampaignSurveyBuilderPage` edit): the campaign names `copy1`, the
   list lacks it, `['surveys']` invalidated → *Loading…*; the lead order — the campaign still names `s1`,
   the list has only `copy1`, `['admin','campaigns']` invalidated → *Loading…*; the same seeds settled →
   `''` (the redirect); nothing attached and `['surveys']` invalidated → `''`; found → the form. And
   **offline** (review round 2): the entry calls `onlineManager.setOnline(false)` (from
   `@tanstack/react-query`) before `renderToString` and `setOnline(true)` straight after it, since the
   manager is one per node process; the first seeds again → *Loading…*, where a guard on `isFetching`
   alone renders `''` (the refetch reads `paused`).
8. **The drawer shows a lead what is theirs** (`CampaignFormDrawer`, Overlay stubbed,
   `initial.surveyTemplateId: 's1'`, the survey with `responseCount: 10`): with
   `canEditAdminFields={false}` → *Heads up: this survey already has 10 responses in your campaigns.*,
   the lead's Duplicate sentence, no *Surveys page* and no *None yet* option at all (the campaign has a
   survey, §E.5 item 5); the *Active* checkbox (`<input type="checkbox"`) and the Restricted-doors
   `<select>` (the one holding `value="inherit"`) both render `disabled=""`, with *Only an org admin can
   archive or reactivate a campaign.* and *Only an org admin can change this.* With
   `canEditAdminFields={false}` and `initial.surveyTemplateId: null` → *— None yet (add later on the
   campaign’s Survey tab) —*. With `canEditAdminFields={false}`, the key dates' lead line is whichever
   ships (review round 2): with A1, *Only an org admin can change the key dates. You can still set the
   door goal below.*; if A1 is declined, §M item 1's *"Only an org admin can change the key dates. For
   now, only an admin can save this drawer, so ask an admin to set the door goal."* (reworded in review
   round 3). With `true` → *Heads up: this survey already has 10 responses.*, two *Surveys page* (the
   empty option and the heads-up), neither control disabled, and neither note.
9. **The Change-survey picker words a lead's count as theirs** (`ChangeSurveyModal`, the named export
   of E.4 item 2, Overlay stubbed; `currentId: 's1'`, so its `sel` starts on the attached survey and the
   option labels render on the first render; added in review round 1): as admin with `responseCount: 35`
   → *Door script (v3, 35 responses)*; as lead with 10 → *Door script (v3, 10 responses in your
   campaigns)*; a second survey, *Gap*, with `responseCount: 0` and `hasResponses: true` → *Gap (v1)*
   for both, and no *in your organization* anywhere (the picker stays count-gated, D7).
10. **The created hint makes both routes a between-shifts step** (`CampaignSurveyPage` at
    `/campaigns/c1/survey?created=s2`, admin, with `managedCampaignIds: []` in the auth stub because the
    page reads it at :86-88; `c1` names `s1`, the list holds `s1` and a second survey `s2`, *Door script
    v2*, and `['admin','efforts','c1']` is seeded `{ efforts: [] }`, all settled; added in review round
    2, for §E.4 item 5): with tags and `<!-- -->` stripped and `&#x27;` decoded → *Door script v2 was
    created and added to your library. Assign it to a walk list below to run it on those doors, or make
    it this campaign's default with Change survey. Do either between shifts: surveys still queued on
    phones under the survey those doors use now would be dropped.*; at `?created=s1`, the main survey →
    no *was created*; and with nothing attached (`c1`'s `surveyTemplateId` null, `?created=s2`; review
    round 3) → the same hint with *Pick a survey* in place of *Change survey*, the button that state
    shows. The page renders without the Overlay stub: its modal mounts only after a click, and
    `campaignResolveRender.smoke.test.js` already renders this page the same way.

Cases 1-8 as first written were rendered in memory against the patched sources and produced exactly
those results. What review round 1 added — the name-hint lines in cases 1 and 2, case 8's empty-choice,
disabled-control and note checks, and case 9 — has **not** been rendered yet, and neither has anything
round 2 added (case 6's Duplicate line, case 7's offline line, case 8's key-dates line and case 10),
round 3 added (case 6's lock and `duplicateSwitches` lines, case 8's reworded key-dates line and case
10's nothing-attached line, whose wordings were rendered only as standalone snippets, §L.2) or round 4
added (case 6's Go to-saved banner line): L.1 is their first run. The campaign builder's Duplicate box
after a refused save (§E.2 item 6) can't be rendered here at all, because SSR can't put an error into a
fresh `useMutation`; L.3 step 7 checks it.
The picker's labels render without a click; its warning needs a selection (`sel` starts on the attached
survey, so `isSame` hides it) and the Survey tab's Preview note sits behind a toggle, neither of which
SSR can operate — the in-memory run that forced the toggle open printed the three Preview sentences of
§F, the wording is pinned through `responsesNoteOpening` (G.3), and the manual checks cover both (§L). A
click — retyping a card, removing a new answer, pressing the copy button — needs a DOM the harness
doesn't have (`client/package.json` has no jsdom); those paths are pinned through the pure helpers (G.3)
and the manual checks.

### G.5 A1 only — a client unit test, and the drawer's body through the real `PATCH`

**Unit — new `client/src/lib/campaignPatch.test.js`.**

The drawer's lead body (`name`, `type`, `state`, `surveyTemplateId`, `isActive`, `timeZone`, the three
key dates, `datesNote`, `doorGoal`, `goalDate`, `billRestrictedDoors`) through
`campaignPatchFor(body, { isOrgAdmin: false })` keeps exactly `doorGoal, goalDate, name,
surveyTemplateId, timeZone` and none of the server's refused list (campaigns.js :497 — `isActive`,
`type`, `state`, `electionDay`, `earlyVotingStart`, `earlyVotingEnd`, `datesNote`, `billRestrictedDoors`,
`enabledOutcomes`, named in the test with that pointer); with `isOrgAdmin: true` it returns the same
object. Checked in memory.

**Integration — [server/test/campaignGoal.int.test.js](../server/test/campaignGoal.int.test.js), one
new test after HEAD :255** (added in review round 1). The unit test compares the helper with a list
copied from the server, so a change on either side could slip past it; this sends the drawer's real
body through the real `PATCH`. Server tests already import plain client modules (`metricHelp.test.js`
:12-13, `actionLabels.test.js` :97), and CI's integration job checks out the whole repository
(`.github/workflows/tests.yml` :75). At the top of the file, after HEAD :29 — never between tests:

```js
// The campaign Edit drawer's own filter — plain ESM with no React, so node loads it here (the
// metricHelp.test.js pattern) and this suite sends exactly what a lead's Save sends.
const { campaignPatchFor } = await import(new URL('../../client/src/lib/campaignPatch.js', import.meta.url).href);
```

and the test, after the lead test that ends at :255:

```js
test('a TEAM LEAD\'s Edit-drawer Save lands once it sends only the fields a lead owns', { skip }, async () => {
  // The drawer's body as CampaignFormDrawer.submit builds it: every field, the admin-only ones sent back
  // unchanged, the goal changed.
  const stored = await Campaign.findById(ctx.campaign._id).lean();
  const drawer = {
    name: stored.name, type: stored.type, state: stored.state, surveyTemplateId: stored.surveyTemplateId || null,
    isActive: stored.isActive, timeZone: stored.timeZone, electionDay: stored.electionDay || null,
    earlyVotingStart: stored.earlyVotingStart || null, earlyVotingEnd: stored.earlyVotingEnd || null,
    datesNote: stored.datesNote || '', doorGoal: 250, goalDate: shift(todayIn(TZ), 20),
    billRestrictedDoors: stored.billRestrictedDoors ?? null,
  };
  try {
    const whole = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, { ...leadAuth(), body: drawer });
    assert.strictEqual(whole.status, 403, 'refused on the first admin-only field, unchanged or not');
    assert.strictEqual(whole.json.error, "Only an org admin can change a campaign's isActive.");
    const owned = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
      ...leadAuth(),
      body: campaignPatchFor(drawer, { isOrgAdmin: false }),
    });
    assert.strictEqual(owned.status, 200, JSON.stringify(owned.json));
    assert.strictEqual(owned.json.campaign.doorGoal, 250);
  } finally {
    // Straight to the model, so the restore adds no History row.
    await Campaign.updateOne({ _id: ctx.campaign._id }, { $set: { doorGoal: stored.doorGoal ?? null, goalDate: stored.goalDate ?? null } });
  }
});
```

It uses only what the file has: `Campaign` (:23), `call` (:128-145), `leadAuth` (:148), `shift`,
`todayIn` and `TZ` (:34, :45-51), and the lead's grant on `ctx.campaign` (:73). The full body passes
`updateSchema` (campaigns.js :170, the partial of :88-114), so the 403 is the lead check's (:496-505),
whose first refused field is `isActive`. No test in the file reads History. The file goes from 12
tests to 13. Not run yet: L.1 is its first run.

### G.6 Commands (from the repo root) and what must stay green

```
npm --prefix server run test:int -- test/teamLead.int.test.js test/surveys.int.test.js test/surveyBlocks.int.test.js test/leadWalkthrough.int.test.js
npm --prefix server test
npm --prefix client test
npm run test:mobile
npm --prefix client run build
npm --prefix server run test:int
npm run audit:mobile-api
```

The first runs the two changed suites (teamLead 20 → 21 tests, surveys 6 → 7) and the two that pin
the 409s (`surveyBlocks.int.test.js` :825-866) and the lead's live walkthrough; with A1 it also takes
`test/campaignGoal.int.test.js` (12 → 13, G.5). The middle four are CI's fast job
(`.github/workflows/tests.yml`); the full marathon is CI's `main` job. No existing test reads a lead
row's `hasResponses` (the only `hasResponses` assertion is the admin one, `surveys.int.test.js` :139)
or renders `SurveyForm`, `CampaignFormDrawer` or `CampaignsPage`, and no existing server or mobile test
reads the client files this touches (`grep -rla` and `git grep --text` agree). One existing suite does
render a touched file: [campaignResolveRender.smoke.test.js](../client/src/lib/campaignResolveRender.smoke.test.js)
renders `CampaignSurveyPage.jsx` (:144-162), whose bundle gains `surveyBuilderRules.js` through E.4's
import; it only reaches the page's loading and redirect paths, and it must stay green. So nothing
existing should move.

## H. Docs and Help Center cascade

Per the repo's cascade (code → docs Part 1 and Part 2 → Help Center), every passage below is quoted
by its HEAD line. Help copy comes from the Part 1 text, never Part 2. Files another session has open
(`docs/README.md`, `docs/PRIVACY_VERIFICATION.md`, `faq/_INBOX.md`) and the two files the
investigation's uncommitted docs patch touched (`docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md`, `docs/README.md`)
are cited at HEAD and handed over as hunks (§J).

### H.1 [docs/SURVEYS.md](SURVEYS.md) — Part 1

1. **:224-229**, the bullet *"Once a survey has answers, it can't switch to Go to."* — becomes:
   > - **Once a survey has answers — anywhere in your organization — it can't switch to Go to.**
   >   Redrawing the branching as arrows could change who is asked what, so later visits would record
   >   differently from earlier ones. The "then go to" menus are greyed out on such a survey;
   >   **Duplicate** it and build the script on the copy — from the **Surveys** list, or at the top of
   >   the campaign's **Edit survey** page, which is where a team lead finds it (see *Editing a survey*
   >   below). A team lead sees this lock even when none of its answers are counted in their own
   >   campaigns (another campaign's, or older records not tied to any campaign). Every survey that
   >   existed before Go to is a "Show only if" survey, and stays one until someone sets an arrow.
2. **:450-453**, *Creating a survey* — the paraphrased hint *"'X' created — assign it to a walk list
   below,"* becomes *"'X' created — assign it to a walk list below, or make it this campaign's default
   with Change survey — either one between shifts,"* (E.4 item 5). Added in review round 1; *either
   one* in round 2, since putting a survey on a walk list changes its doors' survey at once too.
3. **:462-466**, from *"and the response counts a lead sees cover **their campaigns only**, so a survey
   shared beyond their view can read "0 responses" …"* to *"… in that case)."* — becomes:
   > and the response counts a lead sees cover **their campaigns only** — they read "10 responses in
   > your campaigns". Whether a survey on their campaigns has answers *at all* is counted across the
   > whole organization, though (owner ruling 2026-10-03), because that is what the server checks
   > before it refuses an answer-type change or a switch to Go to: on a survey none of whose answers are
   > counted in their campaigns — another campaign's (one that uses it, or used it before), or older
   > records not tied to any campaign, which can include their own campaign's oldest answers — the
   > builder locks both up front and says "This survey has responses in your organization", with no
   > count and no campaign name, and **Duplicate** sits at the top of the page. A survey that's in a
   > lead's library only because they wrote it, and isn't on one of their campaigns, isn't counted that
   > way — and they can't open it in a builder until it is one of their campaigns' main survey.
4. **:488-491**, *Swapping mid-canvass* — append: *"For a team lead, the warning counts the responses
   in their own campaigns."*
5. **:752**, *"Once a survey has responses:"* → *"Once a survey has responses (anywhere in your
   organization):"*; and after the *Blocked: switching …* bullet (:764-767) add:
   > - **What you add stays yours to change until you save it.** A question added since you opened the
   >   builder can still change its answer type, and **Remove** takes a new question or answer straight
   >   out — nothing has been recorded against it. It's what the survey was saved with that is
   >   protected: retired, never deleted, and with its saved words if you had cleared them first. A
   >   question you add and save is protected from then on, like the rest. A saved question's own type
   >   always stays selectable, so you can put it back; going back to it brings back the answers the
   >   switch cleared, exactly as you had them just before it, unless you've typed new ones (once:
   >   answers you blank by hand afterwards stay blank) — and, only while the survey uses Go to, its
   >   *then go to* arrows, to blocks still after it in the survey.
6. **After :780** (the end of the *Need to change a question's type…* paragraph) add a paragraph, and in
   :778-780 change *"the Campaigns page shows a heads-up when you pick a survey that already has
   responses"* to *"… already has responses (for a team lead, the responses in their own campaigns)"*:
   > **If a survey gets its first answers while you're editing it,** Save can't make those two changes;
   > it says why at the end of the form, with your edits still on the page, and the builder locks the
   > way it does for any survey with answers until you press **Save** again. Set the change back and
   > save again, or click **Save my changes as a copy**: everything you did, the refused change
   > included, becomes a new survey in your library, named "… (Copy)". Nothing is switched to it — the campaign keeps the
   > survey it has, so phones out canvassing keep saving normally — and you move the campaign onto the
   > copy, with **Change survey** on its Survey tab or by putting it on a walk list, between shifts.
   > (**Duplicate** is different: it copies the survey as last saved, without the changes on the page,
   > and the one at the top of a campaign's **Edit survey** page also switches the campaign to the copy
   > at once.)

### H.2 [docs/SURVEYS.md](SURVEYS.md) — Part 2

7. **:870**, the `GET /admin/surveys` row — replace *"`responseCount`/`hasResponses` re-derive from the
   narrowed buckets, and **`usedElsewhere: true`** (bare boolean) marks a template also attached beyond
   the lead's campaigns so the builder's shared-edit warning still fires."* with:
   > `responseCount` re-derives from the narrowed buckets, and two bare booleans cross the line, never
   > names or volumes: **`usedElsewhere: true`** marks a template also attached beyond the lead's
   > campaigns (current attachments only, archived campaigns and walk lists included, on every row in
   > the library, authored ones included) so the builder's shared-edit warning still fires, and
   > **`hasResponses`** —
   > on a template in `attachedSurveyTemplateIds(managed)` — is org-wide: `(counts.get(id) || 0) > 0`
   > from the same org-scoped aggregate, legacy no-campaign rows included, i.e. the rows the `PATCH`'s
   > `409 survey-has-responses` checks (owner ruling 2026-10-03), so the builder's locks match the save;
   > a template in the library only through `createdBy` keeps the narrowed `responseCount > 0`.
8. **:873**, the duplicate row — *"(`name: "<name> (Copy)"`"* → *"(`name: copyName(original.name)` —
   `"<name> (Copy)"`, the name cut so the whole fits the 200 characters every later `PATCH` validates,
   never between the two halves of an emoji; uncapped, a long name's copy could never be saved again;
   pinned by [surveys.int.test.js](../server/test/surveys.int.test.js)"*.
9. **:906-919**, the two-hard-blocks callout — append:
   > Both mirrors hold for every role: the locks read the list's `hasResponses`, which is org-wide for
   > every survey a builder opens (a lead's builder edits only their campaign's own survey), and a save
   > refused with `survey-has-responses`, which the row could not yet know about. The type
   > lock covers **saved** questions only, matched by stored key exactly as `classifyQuestionEdits`
   > matches them (`savedShape`, §G), so a question added since the builder opened keeps a free type.
10. **:975-976** — *"those reach the author only as the 400's sentence in the error box under the
    form."* → *"those reach the author only as the 400's sentence in the refusal box at the end of the
    form (`SurveyForm`'s `saveError`, above the fixed footer)."* Added in review round 1.
11. **:1280**, the `SurveyEditorPage.jsx` row — replace *"surfaces the PATCH `409 reasons` and, through
    its existing error block, every server 400's plain-English `error`)"* with *"a failed save — the
    `409 reasons` and every server 400's plain-English `error` — renders inside `SurveyForm` (`saveError`),
    at the end of the form above the fixed footer)"*, and append: *"**Save my changes as a copy**
    (`onSaveAsCopy`) is its own `copy` mutation — the same `POST`, with no attach or assign step — and
    lands on `/surveys`."*
12. **:1281**, the `SurveyBuilder.jsx` row — after *"…the locked banner says the same)."* insert:
    > With responses (`locked = initial.hasResponses`, org-wide for every survey a builder opens, or a
    > save refused with `survey-has-responses`, until the next save attempt), only what the survey was
    > **saved** with is protected: `savedShape(loaded)` maps each stored key to its type, its words and
    > its answers, and a card gets `hasResponses={locked && !!saved}` — its `TypePills` lock every pill
    > but the active one and the saved type's (`savedType`) — and Remove retires it only when it was
    > saved, with its saved words when the card's were cleared (`retireBlock`) and, if it was retyped
    > before the lock came on, at its saved type as that type's pill would put it back (its own answers,
    > or what its switch to Free text cleared, never the saved ones over them) with no arrows;
    > `removeOption` retires only a saved answer id, the same way (`retireOption`) — in both, the words
    > the server keeps for a block or answer a save leaves out, since it refuses a blank one even
    > retired; each change of type keeps what it clears on the card (`retyped`: the answers going to
    > Free text, the route leaving it), which `cleanBlock` drops, and `restoredOnRetype` gives a question
    > going back to its saved type exactly that, once (the kept answers leave `retyped` there, whether
    > they come back or typed answers win) — never the survey as saved, never over typed answers — with
    > a route only while the form is in Go to and only to a block the card's selects still offer
    > (`route.flow`, `route.targets`), so a retype after **Switch back** never revives an arrow. The
    > banner's first line is `responsesPhrase(initial, { isOrgAdmin })` (`useAuth`), and the next calls
    > changes to the Go to routes safe only when `savedInGoTo(flow, loaded)`, on a survey saved in Go to
    > that still uses it, so after a refused Go to save it says what the refusal says; the survey-name
    > hint is worded by role (a lead's points at **Change survey** on the Survey tab). Save runs
    > `bodyToSave()`; while the host's `saveError.code` is
    > `survey-has-responses` and it passes `onSaveAsCopy`, the footer offers **Save my changes as a
    > copy** (`type="button"`, disabled while either save runs), which sends `bodyToSave()` named by
    > `copyName`. `saveError`/`copyError` render as the form's last in-flow block (inside its `pb-24`,
    > so the fixed footer never covers them) with the message, `reasons`, guidance (which also says that
    > Duplicate, `duplicateAt`, copies the survey as last saved and, with `duplicateSwitches`, the
    > campaign builder's, that it switches the campaign to the copy at once, so only between shifts) and
    > the copy line; a
    > `requestAnimationFrame` effect scrolls each new one into view and cancels in its cleanup; the
    > footer says *Not saved — see the message at the end of the form.*
13. **:1285**, the `CampaignSurveyPage.jsx` row — append:
    > The Preview note shows when `hasResponses`, opening with `responsesNoteOpening`: an org admin
    > reads *N responses across all campaigns*, a lead *This survey has N responses in your campaigns*
    > or *This survey has responses in your organization*. The Change-survey picker
    > (`ChangeSurveyModal`, also a named export for the render test) words its label and warning with
    > `responsesPhrase` and keeps them gated on `responseCount` (they are about reporting,
    > campaign-scoped for a lead). The `?created=` hint says that putting the survey on a walk list and
    > making it the default with **Change survey** (**Pick a survey** while the campaign has none) are
    > both between-shifts steps.
14. **:1286**, the `CampaignSurveyBuilderPage.jsx` row — append:
    > The edit guard waits (*Loading…*) while the attached id is missing from the list and either list's
    > `fetchStatus` isn't `idle` — Duplicate's swap in flight, fetching or paused offline — instead of
    > falling through to Create; a settled miss still does. The Duplicate box also shows once a save is
    > refused with `survey-has-responses` (`refusedForResponses`), since the lock was read before that
    > answer arrived, and stays up while Duplicate runs (`duplicate.isPending`). `duplicate.onSuccess`
    > resets `update` and `copy` once its attach has landed, so a failed attach keeps the refusal and
    > the box. The page passes `duplicateSwitches`, because its Duplicate switches the campaign to the
    > copy at once. **Save my changes as a copy** is
    > its own `copy` mutation — the same `POST`, with no attach step, so the copy goes to the library
    > whatever the campaign holds meanwhile — and lands on the Survey tab with `?created=<id>`; `create`
    > serves new mode only. Failed saves render inside `SurveyForm` (`saveError`, `copyError`).
15. **:1291**, the `CampaignsPage.jsx` row — append: *"For a team lead (`canEditAdminFields={false}`)
    the heads-up counts their own campaigns (`responsesPhrase`) and points at Duplicate on the campaign's
    Edit survey page, and the empty option at the Survey tab — never at the admin-only Surveys page; a
    lead gets the empty option only while the campaign has no survey, so a lead never detaches one
    there. A drawer save refreshes `['surveys']`, since it can attach or swap a survey. (A1:) Save sends
    a lead only the drawer fields a lead owns — name, survey, timezone, door goal and goal date
    (`campaignPatchFor`) — because the `PATCH` 403s each field on its admin-only list (campaigns.js
    :497) when a lead sends it, even unchanged."*
16. **:1997**, the `surveyBuilderRules.test.js` row — `(36)` → `(44)`, and append *"; `responsesPhrase`
    by role (never a lead count passed off as the survey's, never "elsewhere") and the Preview note's
    opening (`responsesNoteOpening`), `copyName`'s cap (never half an emoji), `savedShape`,
    `restoredOnRetype` (what the card held just before the switch, once, never the survey as saved; no
    arrow back after Switch back, none to a block that left), `retireOption` and `retireBlock` (a saved
    answer, question or statement whose words were cleared retires with its saved words, and a question
    retyped before the lock came on retires at its saved type, keeping its answers), and `savedInGoTo`
    (the locked banner calls Go to route changes safe only on a survey saved in Go to)"*.
17. **:1999** — add `surveyBuilderLockRender.smoke.test.js` to the row's file list, and to its pins:
    *"the builder's locks, its banner wording and name hint by role, and the refusal box with Save my
    changes as a copy, where Duplicate is and whether it switches the campaign, and the lock it puts on,
    with the banner's Go to sentence on a survey saved in Go to; the saved-only lock and the saved type's
    pill; Duplicate's swap waiting, offline too; the drawer's lead wording, its greyed-out Active and
    invoice controls, its key-dates line and its empty survey choice; the Change-survey picker's labels
    by role; the Survey tab's created hint, by whether the campaign has a default"*.

### H.3 [docs/ROLES.md](ROLES.md)

18. **:36-38**, Part 1 — after *"…never another client's scripts, campaign names, or volumes."* add:
    > Two plain yes-or-no facts about a survey in that library do reach a lead from beyond their
    > campaigns — never which campaign, never how many: whether a campaign they don't manage has it
    > attached (an archived one counts), and, for a survey on one of their campaigns, whether it already
    > has answers anywhere in the organization (owner ruling 2026-10-03). The second decides whether its
    > answer types and Go to are locked; the save would refuse those changes anyway.
19. **:329-332**, Part 2 — replace *"`responseCount` / `hasResponses` re-derive from the narrowed buckets,
    and a bare **`usedElsewhere` boolean** (no names, no volumes) tells the builder to keep its
    shared-edit warning honest when a template is also used beyond the lead's view."* with:
    > `responseCount` re-derives from the narrowed buckets, and exactly two bare booleans cross that line
    > (no names, no volumes): **`usedElsewhere`** — on every row in the library, authored ones included:
    > the template is attached beyond the lead's campaigns right now (archived campaigns and walk lists
    > count; neither list behind it is filtered by status) — keeps the builder's shared-edit warning
    > honest, and **`hasResponses`** is org-wide for a template attached to a managed campaign
    > (`attachedSurveyTemplateIds`; owner ruling 2026-10-03, verbatim *"as long as its part of their
    > campaigns, yes"*) — the rows the `PATCH`'s `409 survey-has-responses` checks, legacy no-campaign
    > rows included — so the builder's answer-type and Go to locks match the save; a template in the
    > library only through `createdBy` keeps the narrowed yes/no. Recorded in
    > [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 26.
20. **:704-706**, the `teamLead.int.test.js` description — after *"…(own or managed-attached yes,
    unmanaged-attached no)."* add *"The lead's survey list carries `hasResponses` org-wide for a survey
    on their campaigns — as a walk-list survey or as the campaign's own (another campaign's answers, a
    legacy no-campaign row) — and narrowed for one they only authored; on every survey on their
    campaigns it agrees with the `PATCH`'s 409 (the authored-only one keeps its narrowed false while its
    save still refuses, by ruling); it never names another campaign, and carries exactly six annotation
    keys."*

### H.4 [docs/CAMPAIGNS.md](CAMPAIGNS.md)

21. **:251**, Part 1 — *"- **Name, state** — always editable."* becomes two bullets: *"- **Name** — always
    editable."* and *"- **State** — always editable, **org admins only**."* Pre-existing drift (the
    `PATCH` refuses `state` from a lead, campaigns.js :497), corrected because it is the Part 1 source
    of H.8 item 32's Help line. Added in review round 1.

    **And :67-68**, Part 1 (added in review round 3) — *"Each card/row's **⋮ menu** holds View
    dashboard, Assignments, and — for org admins — Edit, Archive/Reactivate, and Delete."* becomes
    *"Each card/row's **⋮ menu** holds View dashboard, Assignments, History and Edit — the Edit drawer
    opens for team leads too, with the org-admin-only fields greyed out — and, for org admins,
    Archive/Reactivate and Delete."* Pre-existing drift too: every viewer gets View dashboard,
    Assignments, History and Edit, and only Archive/Reactivate and Delete sit under `isOrgAdmin`
    (`CampaignsPage.jsx` :240-267), and the rest of Part 1 already says so (:155 for History,
    :252-255 for a lead's edits in the drawer). It is the Part 1 source of H.8 item 32's :24 line,
    which Help copy may not take from Part 2. True with or without A1, since §E.5 item 4 ships either
    way; a second search (`git grep --text` and `grep -rna` over `docs/` and the Help tree) found no
    other Part 1 line that makes Edit admin-only.
22. **:271-274**, Part 1 — replace *"Repointing a survey campaign warns you if the chosen survey already
    has responses (new answers report alongside the old ones). To change questions, duplicate the survey
    on the Surveys page and pick the copy."* with:
    > Repointing a survey campaign warns you if the chosen survey already has responses (new answers
    > report alongside the old ones) — for a team lead the warning counts the responses in their own
    > campaigns. To change questions, an org admin duplicates the survey on the Surveys page and picks
    > the copy; a team lead, who has no Surveys page, attaches it with **Change survey** on the
    > campaign's Survey tab, then uses **Duplicate** at the top of the campaign's **Edit survey** page.
    > A team lead never leaves a campaign with no survey: the Survey tab can change a campaign's survey
    > but not remove it, and the **Edit** drawer offers a lead its empty survey choice only while the
    > campaign has no survey yet.

    (True whether or not A1 ships: it names the Survey tab, the bullet's own subject, and says only what
    the drawer offers. Its last sentence, added in review round 2, is the Part 1 source for H.8 item
    32's *"removing it is left to an admin"*, which Help copy may not take from Part 2; it describes
    §E.5 item 5, which ships either way.)
23. **:1218-1221** — append, whether or not A1 ships: *"Every org-admin-only control reads
    `canEditAdminFields`, **Active** and **Restricted doors on invoices** included (only since ‹build
    date›, though this sentence already said so), and for a lead the survey select offers its empty
    choice only while the campaign has no survey, so a lead can swap the survey here but never detach
    it — the Survey tab's own rule, where *Attach survey* needs a choice."* **With A1**, append as well:
    *"Save sends a lead only `name`, `surveyTemplateId`, `timeZone`, `doorGoal` and `goalDate`
    (`lib/campaignPatch.js`): the `PATCH` 403s each field on its admin-only list — `isActive`, `type`,
    `state`, the three key dates, `datesNote`, `billRestrictedDoors`, `enabledOutcomes` (campaigns.js
    :497) — when a lead sends it, even unchanged, and until ‹build date› the drawer sent them all, so a
    lead's Save was always refused. (`disabledOutcomes` and `doorAddPolicy` are lead-editable too, on
    App Customization; they aren't drawer fields.) Pinned by
    [campaignPatch.test.js](../client/src/lib/campaignPatch.test.js), against the server's refused
    list, and by [campaignGoal.int.test.js](../server/test/campaignGoal.int.test.js), which sends the
    drawer's real body through the real `PATCH`."*

### H.5 [docs/ADMIN_APP.md](ADMIN_APP.md)

24. **:721-724** — *"entering it is blocked once a survey has responses"* → *"entering it is blocked once
    a survey has responses anywhere in the organization"*, and *"where team leads find it"* → *"where team
    leads find it; a lead sees the lock even when none of the answers are counted in their own
    campaigns"*.

### H.6 [docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md)

25. **:3-5**, the status — final text of the bold sentence: *"Status: BUILT 2026-10-02 to the design
    agreed with the owner that day (three rounds of rulings), with a five-angle review's fixes folded in
    on 2026-10-03; committed in 5cb42b2 and deployed to the server 2026-10-03, with the phone's
    over-the-air update waiting on the owner's device checks. No ruling open: the team-lead lock gap at
    the end of §O was ruled on 2026-10-03 and fixed by
    [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md)."*
26. **:1232-1233** — *"bullets below describe the tree with them. Uncommitted at time of writing."* →
    *"bullets below describe the tree with them, as committed in 5cb42b2 and deployed to the server on
    2026-10-03."*
27. **:1395** — *"**Known gap (2026-10-03).** Found by the review and not fixed in this build."* →
    *"**Known gap (2026-10-03) — fixed ‹build date› by
    [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md).** Found by the review and not fixed
    in this build."*; and after :1401 (after the investigation's paragraph, if it has been committed —
    change its *"open for an owner ruling"* to *"ruled the same day"*) add:
    > *Fixed ‹build date›* (owner rulings 2026-10-03: *"as long as its part of their campaigns, yes"* and
    > *"sure why not?"*). A lead's survey list now says whether a survey on their campaigns has answers
    > anywhere in the organization — a bare yes/no, counts still theirs — so the builder locks up front.
    > As ruled, that is only for a survey attached to a campaign the lead manages: one they only wrote
    > keeps the narrowed yes/no, and its save still refuses
    > ([PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md) §K.2), which is narrower than the
    > *"fix, if ruled in"* above, where every lead row widened. The lead's banner, Survey-tab note,
    > picker and campaign drawer word the count as theirs; the type lock and Retire cover only what the
    > survey was saved with (`16b0c87`'s per-question rule restored); a refused save shows its reason
    > above the footer with **Save my changes as a copy** (library only); Duplicate's swap waits instead
    > of landing on *Create survey*; and a duplicate's name is capped at 200 characters.

Items 25-26 match what the investigation's patch already says, minus its "one ruling is open"; whether
that patch is committed first or not, these are the final texts. **Their status facts — and item
28's — follow §I.2's rule:** the build checks them with the owner before writing them, and if the
production OTA has gone out by then, they say so, with its date, instead of *"waiting on the owner's
device checks"*.

### H.7 [docs/README.md](README.md)

28. **:59**, the `PROPOSAL_SURVEY_SCRIPT_FLOW.md` row — its bold lead becomes: *"BUILT 2026-10-02 to the
    design agreed the same day after three rounds of owner rulings and a verification pass against the
    code; committed in 5cb42b2 and deployed to the server 2026-10-03; production OTA pending the owner's
    device checks. Where the build differs from the plan is listed in its "As built" section (§O, at the
    end), including the team-lead lock gap, ruled 2026-10-03 and fixed by
    [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md)."* (the rest of the row unchanged; its
    OTA fact checked with the owner as above).
29. **New row after :59:**
    > | [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md) | **BUILT ‹build date›
    > (uncommitted at time of writing), to the plan the owner approved ‹date› after rulings on
    > 2026-10-03; a server deploy only — nothing ships to phones.** Why a team lead's survey builder
    > looked unlocked on a survey none of whose answers counted in their campaigns, and then refused the
    > save; the owner's ruling that a lead's survey list says whether a survey on their campaigns has
    > answers anywhere in the organization (a bare yes/no; counts stay theirs); lead wording for counts;
    > locks that cover only what a survey was saved with; a refused save shown above the footer with
    > **Save my changes as a copy**; Duplicate's swap; the campaign Edit drawer's lead fixes; the
    > privacy record; tests and rollout. |

This proposal itself is copied to `docs/PROPOSAL_LEAD_SURVEY_LOCKS.md` by the build, its Status updated
to *BUILT* with an *As built* section for anything that differs.

### H.8 Help Center (`server/src/content/help/`)

30. **[guides/surveys.md](../server/src/content/help/guides/surveys.md)** (audience `lead`):
    - **After :132**, a new paragraph:
      > And when a survey on your campaign says it **has responses in your organization**, with no
      > number, none of its answers are counted in your campaigns. They belong to another campaign (one
      > that uses it now or used it before), or they're older records that aren't tied to any campaign,
      > which can even be your own campaign's from back then. You won't see whose or how many, but they
      > count: its answer types are locked and it can't switch to Go to, so **Duplicate** it (at the top
      > of its **Edit survey** page) to make either change. When your campaigns do have answers, the
      > counts you see are yours: *10 responses in your campaigns*.
    - **:138**, append: *"Anything you add stays fully editable until you save it: a new question can
      still change its answer type, and **Remove** takes a new question or answer straight out. It's
      what the survey was saved with that's protected."*
    - **:142**, the Heads up: after *"Two changes need a fresh copy once a survey has responses"* insert
      *" — responses anywhere in your organization, not just your campaign's"*, and at the end add:
      *"And if a survey gets its first responses while you're editing it, **Save** can't make those two
      changes and says why at the bottom of the page, with your edits still there: set that change back
      and save again, or click **Save my changes as a copy** to keep everything on a new survey in your
      library. Nothing switches to the copy on its own — use **Change survey** on the campaign's Survey
      tab, or put it on a walk list, between shifts."*
31. **[guides/roles-and-team.md](../server/src/content/help/guides/roles-and-team.md)** (audience
    `admin`), **:34** — becomes:
    > A team lead doesn't have to be someone from your own organization. If you run a canvassing
    > operation hired by campaigns, the lead you grant might be **the client's own campaign manager** —
    > which is exactly why the role is walled the way it is: a lead works inside the campaigns you grant
    > them. Their **survey library** works the same way: it shows only surveys they authored or ones
    > already attached to their campaigns — never another campaign's scripts, names, or numbers. Two
    > things about a survey in that library do reach them from beyond their campaigns, each a plain yes
    > or no, never which campaign or how many: whether a campaign they don't manage has it attached (an
    > archived one counts), and — for a survey on one of their campaigns — whether it already has
    > answers anywhere in your organization. The second decides whether its answer types and Go to are
    > locked; the save would refuse those changes anyway.

    (*"a lead sees their campaigns and nothing else"* goes: with `usedElsewhere`, the new yes/no and the
    org-wide do-not-contact flag a lead reads on their campaign's voters (ROLES.md :101-105), it isn't
    true.)
32. **[guides/campaigns-manage.md](../server/src/content/help/guides/campaigns-manage.md)** (audience
    `lead`) — pre-existing drift (it says Edit is admin-only, against its own :35, `CampaignsPage.jsx`
    :246-249 and CAMPAIGNS.md :1218; its Part 1 source said the same at CAMPAIGNS.md :67-68, which H.4
    item 21 corrects), corrected here because this change rewrites the drawer's lead copy. With A1:
    - **:24** — *"…a ⋮ menu for View dashboard, Assignments, and (for admins) Edit, Archive, and
      Delete."* → *"…a ⋮ menu for View dashboard, Assignments, History and Edit, plus Archive and Delete
      for admins."* (its Part 1 source is CAMPAIGNS.md :67-68, H.4 item 21).
    - **:28** — becomes: *"The **Edit** drawer (in the ⋮ menu on Campaigns) is open to team leads as well
      as admins. As a lead you change a campaign's name, timezone and door goal there, and can swap its
      survey for another in your library (removing it is left to an admin); the admin-only fields show
      but are greyed out — for those, ask an admin. You can also attach or swap the survey from the
      campaign's Survey tab (see [surveys](surveys))."* Its Part 1 sources are CAMPAIGNS.md :251-255
      (H.4 item 21) and, for *"removing it is left to an admin"*, H.4 item 22's last sentence.
    - **:30** — *"**Name and state** — always editable."* → *"**Name and state** — always editable (the
      state by admins only)."* (its Part 1 source is H.4 item 21).

    :34, :35, :115 and :128 are true with A1 and stay. **If A1 is declined**, :24 and :30 still change as
    above, and these passages, which say a lead sets the door goal (or the name and timezone) in that
    drawer, change instead — sentences documenting a bug, which is why A1 is recommended:
    - **:28** — *"The **Edit** drawer (in the ⋮ menu on Campaigns) opens for team leads too, but only an
      admin can save it for now — as a lead, attach or swap the survey from the campaign's Survey tab
      (see [surveys](surveys)) and ask an admin for the rest."*
    - **:34** — *"**Door goal + goal date** — admins **and leads.** The one exception to the line above:
      if you run a campaign, its target is yours to set — but for now only an admin can save the Edit
      drawer, so as a lead, ask an admin to set it. Every change is recorded in the campaign's
      [History](#history--who-changed-what) with the name of whoever made it."*
    - **:35** — *"**Name, survey, timezone** — admins and leads. As a lead, attach or swap the survey from
      the campaign's Survey tab; for the name and timezone, ask an admin for now. The Edit drawer opens
      for you with the admin-only fields greyed out, but it can't save a lead's change yet."*
    - **:115** — its first sentence becomes *"Both fields sit in the same create/edit drawer as the key
      dates, and unlike the dates, **a team lead is allowed to set them** on a campaign they run — though
      for now only an admin can save that drawer, so ask an admin."*
    - **:128** — *"…and a lead can change it."* → *"…and a lead may change it."* (the permission stands;
      only the drawer's Save is broken).
    - **[faq/how-many-doors-a-day.md](../server/src/content/help/faq/how-many-doors-a-day.md) :14** (audience
      `lead`) — its last two sentences become *"Leave the goal date blank and Election Day is used. Org
      admins set this. A **team lead** on a campaign they run is allowed to as well, but for now only an
      admin can save that drawer, so as a lead, ask an admin."*
    - Their Part 1 sources change with them: **CAMPAIGNS.md :107-109** gains *"(For now a lead's Save in
      that drawer is refused — it sends the admin-only fields too, which the server refuses from a lead
      — so an admin sets the goal; [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md) §M.)"*;
      **CAMPAIGNS.md :252-255**, after the door-goal bullet, gains *"(For now a lead's Save in the drawer
      is refused, so an admin saves a lead's name, timezone and goal changes — see *Door goal and
      pace*.)"*; and
      **ROLES.md :59-60** becomes *"Leads reach the campaign edit drawer for this reason, with the
      org-admin-only fields rendered read-only rather than withheld — though for now its Save is
      refused for a lead, because the drawer sends those read-only fields too
      ([PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md) §M)."*
33. **[faq/_INBOX.md](../server/src/content/help/faq/_INBOX.md)**, after HEAD :11 (*"- (add questions
    here)"*), two lines in the file's format:
    > - "I'm a team lead, my campaign hasn't collected anything, but the builder says the survey **has
    >   responses in your organization** and won't let me change an answer type or add Go to" → by design
    >   (‹build date›; owner ruling 2026-10-03): answers anywhere in the organization lock a survey's
    >   answer types and its switch to Go to, and a lead learns only that they exist — never whose or how
    >   many (they may be another campaign's, or older records with no campaign). **Duplicate** at the top
    >   of the campaign's Edit survey page makes an unlocked copy. Covered in guides/surveys.md (*Who can
    >   edit what*, *Editing a live survey*) — candidate FAQ (audience lead) if it recurs
    > - "I clicked **Save my changes as a copy** — where's my copy, and why is the campaign still on the
    >   old survey?" → by design (‹build date›): the copy goes to the survey library only, named "… (Copy)";
    >   switch the campaign to it with **Change survey** on its Survey tab (or put it on a walk list),
    >   between shifts — switching at
    >   once would make phones drop surveys still waiting to upload under the old one. Covered in
    >   guides/surveys.md (*Editing a live survey*) — candidate FAQ (audience lead) if it recurs
34. **[getting-started/lead-getting-started.md](../server/src/content/help/getting-started/lead-getting-started.md)**
    (audience `lead`, `sourceDoc: ROLES.md`), **:14** (added in review round 2) — its last sentence,
    *"Outside them, you see nothing at all."*, becomes:
    > Outside them you see almost nothing. Two yes-or-no facts about a survey in your library do reach
    > you — never which campaign, never how many: whether a campaign you don't run has it attached (an
    > archived one counts), and, for a survey on your campaigns, whether it already has answers anywhere
    > in the organization (see [Building and assigning surveys](surveys)).

    Its Part 1 source is ROLES.md :36-38 with H.3 item 18's addition. It is the lead-facing twin of the
    sentence item 31 removes from the admin guide, *"a lead sees their campaigns and nothing else"*, and
    goes for the same reason: `usedElsewhere` already made it untrue on 2026-08-08, and this change adds
    the second fact. The link is to a `lead` article from a `lead` one, which `test/helpLinks.test.js`
    accepts. A second search, `git grep --text` and `grep -rna` over the Help tree for *nothing at all*,
    *nothing else* and *see nothing*, found no other claim of this kind about a lead.

Checked and left alone: `pages/page-survey.md` (it describes the Survey tab without the Preview note's
wording), `faq/team-lead-vs-admin.md` :12 and `getting-started/lead-getting-started.md` :23 (both about
which surveys appear, unchanged; that article's :14 changes, item 34), `faq/set-election-dates.md` :12
(the key dates are admin-only either way) and, with A1, `faq/how-many-doors-a-day.md` :14 (true once a
lead's Save works). A `grep -rna` of the Help tree for *across all campaigns*, *has responses*, *greyed
out*, *Type is locked*, *Surveys page* and *Duplicate* found no other copy this changes. One for
*drawer* and *⋮ menu* (review round 1, `git grep --text`) found, beyond the passages above, only
`campaigns-manage.md` :18 (creating a campaign, admin-only either way) and
`faq/who-changed-the-door-goal.md` :12 (History, unchanged).

## I. The privacy record — [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)

**Privacy-affecting, said out loud.** This changes what a team lead can see (the repo's *who can
access customer data* trigger), so it changes what this record says a lead's survey list carries. It
changes no Privacy Policy, Terms or DPA sentence. It adds no third party, so it is not a DPA §6
event, and it touches no data category, retention, deletion, export, report or share link. There are
two additions, both stamps: the file's rule is to add a dated stamp and never rewrite the audit text
under it (the investigation's first design edited item 26's status sentence in place, and review B
caught it). Line numbers are HEAD's, because the other session has this file open (§I.4).

**A1, if approved, is privacy-neutral and needs no stamp.** The server's rules for leads are unchanged
(the admin-only list, campaigns.js :496-505, and `canManageSurvey` for an attach, :633-641): A1 only
stops the drawer sending fields it already shows read-only. The drawer fixes that ship either way
(§E.5 items 4-5) only grey out two controls and stop offering a lead a detach. Nothing new is
collected, exposed or shared.

### I.1 Where the record stands at HEAD

- **No account of a lead's survey row.** `usedElsewhere`, `hasResponses`, `responseCount`,
  `responseCountByCampaign` and `survey-has-responses` appear nowhere in it, and nothing records the
  2026-08-08 client-lead survey scoping (`grep -a` and a Python scan of
  `git show HEAD:docs/PRIVACY_VERIFICATION.md` agree). Its one sentence about a lead's survey
  library is 26(c)'s *"a lead's library is scoped to surveys they authored or that are attached to a
  campaign they manage"* (:2019-2020). It stays true: no template joins or leaves a lead's library.
- **Item 26** is HEAD :1967-2088. Its status, *"built 2026-10-02, uncommitted at time of writing"*,
  is at :1972-1973; **(c) Who can access** is :2016-2030; and its closing *"Owner to confirm before
  the production deploy and OTA, as with items 17-25 — specifically the lead-visible,
  lead-authorable note in (c)"* is :2086-2088.
- **The models.** The v5 one-boolean stamp (:910-923: a lead *"learns one boolean … about a
  canvasser **already inside their scope**"*, then *"Assessment: **no policy text change.**"* with
  the reason for the widening); item 22's lead-visibility assessment (:1598-1609), which rests on
  `privacy.html:105`; item 22's ruling block (:1611-1651), the precedent for a bold-led addition of
  several paragraphs inside an item; and item 24(d)'s concealment decision (:1829-1833), which this
  change has to answer.

### I.2 Stamp 1 — item 26's status, after HEAD :1986

It goes on the line after HEAD :1986, the last line of item 26's lead paragraph
(*"…[SURVEYS.md](SURVEYS.md)."*), with no blank line between, the way HEAD :1491 and :1496 stamp
item 22's lead paragraph. The sentence it brings up to date (:1972-1973) stays as written.

```md
    *[v6 ‹build date› status: committed in 5cb42b2; the server deployed 2026-10-03; the production
    OTA is pending the owner's device checks. The owner's confirmation this item asks for at its end
    (the lead-visible, lead-authorable note in (c)) was due before the production deploy and OTA. It
    was not on record when the server was deployed on 2026-10-03, and it is not on record yet. It is
    still owed before the production OTA.]*
```

The build checks the facts with the owner before writing it, and the stamp always states where item
26's own confirmation stands — silence would let the record read as though that gate had been met
(review round 1) — and it states the gate as item 26 set it, *before the production deploy and OTA*,
including that the deploy half went ahead without the confirmation on record (review round 2: the
first wording, *"owed before the production OTA"*, quietly narrowed the gate to the OTA). If the
production OTA has gone out by then, the stamp says so, with its date. If the owner has given the
confirmation (§M, item 4), its last three sentences become one: *"The owner's confirmation this item
asks for at its end (the lead-visible, lead-authorable note in (c)) was given on ‹date›."*, and when
‹date› is after 2026-10-03 it ends *"…was given on ‹date›, after the server deploy."*

### I.3 Stamp 2 — a lead's survey row, under 26(c), after HEAD :2030

It goes after HEAD :2030, the last line of (c), which says the note was put to the owner in the
scripted-survey plan, with one blank line before it; HEAD :2031's blank line then separates it from
(d) at :2032. It sits under (c) because (c) is item 26's *who can access* paragraph and the gap was
found in item 26's own build review (PROPOSAL_SURVEY_SCRIPT_FLOW.md §O). Its shape is item 22's
ruling block (a bold, bracketed, dated lead, then bold-led paragraphs). It echoes the v5 one-boolean
stamp (:910-923) in form only: v5's boolean is about a canvasser **already inside** the lead's scope,
while this one, like `usedElsewhere` before it, is computed from records **outside** that scope
(responses on campaigns the lead doesn't manage, and legacy ones). That is why it rests on the
owner's ruling and says plainly what it reveals (*Against item 24(d)*, rewritten in review round 1).

```md
    **[v6 ‹build date› — recorded under (c), whose readers of template text are unchanged: by owner
    ruling, a team lead's survey list now says whether a survey on their campaigns has answers
    anywhere in the organization — a bare yes/no, never whose or how many. A "who can access
    customer data" change, said out loud here as the repo invariant requires: no new data, no new
    recipient, no subprocessor, no policy edit. Docs:
    [PROPOSAL_LEAD_SURVEY_LOCKS.md](PROPOSAL_LEAD_SURVEY_LOCKS.md).]** This record never described a
    lead's row in `GET /admin/surveys` (`routes/admin/surveys.js`): the 2026-08-08 client-lead
    survey scoping, which the owner ruled strict, was not recorded here. This is the first full
    account of it.

    **What a lead's row carries.** Whole template documents, and only for the surveys in their library:
    ones they authored (`createdBy`), or ones attached to a campaign they manage, as its main survey or
    a walk-list override, archived campaigns and walk lists included (`attachedSurveyTemplateIds`, the
    set form of `canManageSurvey`, `services/authz/campaignManagement.js`). On every row, usage
    (`usedByCampaigns`, `usedByWalkLists`) and counts (`responseCountByCampaign`, and `responseCount`,
    their sum) cover the lead's campaigns only, and the bucket of legacy responses with no campaign is
    dropped, so no other campaign's name and no other campaign's volume appears. Exactly two bare
    booleans cross that line, never names or counts. `usedElsewhere`, on every row in the library,
    authored ones included: the template is attached beyond their campaigns right now (current
    attachments only, archived campaigns and walk lists included). And `hasResponses`: for a template
    attached to a campaign they manage, **any response anywhere in the organization, legacy rows with
    no campaign included** (new); for a template in the library only because they wrote it, whether it
    has answers on their campaigns, as before. The ruling, verbatim: *"as long as its part of their
    campaigns, yes"* (owner, 2026-10-03), read as "attached to a campaign they manage, as its main
    survey or a walk-list override", an archived campaign or walk list of theirs included, as for the
    library itself; the proposal's Part 1 sets the reading out for the owner to confirm or correct.

    **Why.** The builder locks a saved question's answer type, and the switch to Go to, from
    `hasResponses`, while the save refuses both (`409 survey-has-responses`) whenever
    `SurveyResponse.exists({ surveyTemplateId })` finds a response anywhere. Narrowed, the yes/no
    let a lead build changes that the save then refused, on a survey none of whose answers were
    counted in their campaigns (another campaign's, or legacy rows) — and, once no other campaign
    used it, with no Duplicate in reach
    ([PROPOSAL_SURVEY_SCRIPT_FLOW.md](PROPOSAL_SURVEY_SCRIPT_FLOW.md) §O, "Known gap (2026-10-03)").

    **Already disclosed, except while the organization is read-only.** That 409 already gives the
    same lead the same yes/no for every survey in their library, authored ones too:
    `canManageSurvey` runs before the response check, and a refused save stores nothing. (For a
    survey in the library only because the lead wrote it, the list now says less than the save does,
    by the ruling.) The exception: while an organization is read-only (paused, trial ended,
    canceled), a lead's save is answered 402 before the survey router runs (`requireEntitlement`,
    `middleware/entitlement.js`, mounted ahead of it in `routes/index.js`), so there the list is the
    only place a lead sees it. The responses that can arrive meanwhile are few: phone submissions
    recorded before the pause (the gate's grace for them), a desk conversion an admin started before
    it and still running in the background (the conversion worker,
    `services/canvass/conversionProcessor.js`, checks no entitlement), and anything Doorline staff
    record under support access (super-admins are exempt from the gate).

    **Against item 24(d).** There, a voter outside the lead's campaign answers 404
    `VOTER_NOT_IN_CAMPAIGN` so that a client-lead cannot probe other campaigns' voter ids and learn
    that they exist. This goes the other way on purpose, and it does reveal what 24(d) would not:
    for a survey on the lead's campaigns whose answers their own campaigns don't account for, **that
    such answers exist** — another campaign's, or legacy rows with no campaign. It never names a
    campaign, a voter, a count or a time (read again and again, it could date the first such answer,
    as retrying a save already could), and it covers only surveys on the lead's own campaigns, which
    a lead can't pick at will: they can attach only a survey already in their library. Any
    organization-wide edit guard reveals the same bit by accepting or refusing a save (the 409
    above). 24(d) protects something different: whether an identified person is in another client's
    campaign, which could be tested for any id. The alternative that reveals nothing, narrowing the
    409 to the lead's campaigns, was rejected: a lead could then retype a question or redraw the
    branching under answers other campaigns collected, which breaks how those answers add up and
    changes what later visits record.

    **Copies.** *Save my changes as a copy*, new in the same change, saves through the existing
    `POST /admin/surveys`, which stamps the caller as `createdBy` exactly as Duplicate
    (`POST /admin/surveys/:surveyId/duplicate`) does. A lead who saves one becomes its author; the
    copy carries the form's notes and links, as a Duplicate carries the original's; and it stays in
    that lead's library through `createdBy` for as long as they are a lead in the organization,
    whatever happens to their campaign grants. Nothing here is new beyond Duplicate and *New
    survey*, both already open to leads; it is recorded because this change steers leads toward
    copies.

    **Assessment: no Privacy Policy / ToS / DPA text edit is required; not a DPA §6 event.** No new
    data category, field, recipient, export, report, share link, retention or deletion change.
    `privacy.html:105` (information is available "to authorized users of the customer organization
    you belong to, according to their role", and customer data is not visible to other customer
    organizations: the sentence item 22's lead-visibility assessment rests on) and the closing
    sentence of `:91` ("Access is limited to that customer's authorized users") both stay true: a
    lead, client or not, is an authorized user of that organization holding that role, and the
    yes/no is computed from that organization's responses only (the list's aggregate matches on
    `organizationId`), so nothing crosses tenants (`DPA.md` §4, tenant isolation). `:90` (canvassing
    activity, "such as a survey response", which "authorized administrators within the same
    organization may review") stays true as well: a lead is a scoped administrator of that
    organization (`services/authz/campaignManagement.js`), and a bare yes/no is less than reviewing
    the activity. A lead may be the paying client (lead-visible = client-visible, the standing
    ruling items 22 and 24 record), which is why this is recorded rather than assumed. **Owner to
    confirm before the production deploy, this stamp on its own:** it is not the confirmation item
    26 asks for at its end, and that one does not cover it.
```

What each paragraph records, and the HEAD code behind it:

| D10 asks for | Paragraph | Rests on |
|---|---|---|
| The lead's row in full: library scope | *What a lead's row carries* | surveys.js :519-531 (the `$or` at :530), the whole document spread at :619; campaignManagement.js :83-99 |
| Usage and counts narrowed, no-campaign bucket dropped | same | surveys.js :612-617 (the bucket at :614-616) |
| `usedElsewhere` | same | surveys.js :625-627; :537-540 (neither the campaign list nor the walk-list list is filtered by status, so archived attachments count) |
| `hasResponses` org-wide on attached surveys, legacy rows included; narrowed on authored-only ones | same | surveys.js :541-544 (matched on the organization only), :575; §C.1 hunk 2 |
| Why | *Why* | surveys.js :699 (no campaign filter), :705-715; :614-617 (what the lead's count leaves out) |
| The owner's ruling | *What a lead's row carries* | R1 (§B) |
| `privacy.html` :105 and :91 (and :90) | *Assessment* | `client/public/privacy.html` :90, :91 and :105 at HEAD; campaignManagement.js :8 (a lead is a campaign-scoped admin) |
| The contrast with item 24(d) | *Against item 24(d)* | PRIVACY_VERIFICATION.md :1829-1833; option (e) of the design, rejected; what the bit reveals (review round 1): surveys.js :612-617 against :541-544 and :575; a lead attaches only from their library, campaigns.js :633-641 |
| The read-only caveat | *Already disclosed…* | routes/index.js :89 before :120; middleware/entitlement.js :47 (super-admins exempt), :55-56, :69-78 (the phones' grace), :80-86; services/canvass/conversionProcessor.js and surveyConversion.js (no entitlement check in either: `grep -a` and a Python scan of both agree), surveyConversion.js :492 |
| Save-as-copy authorship | *Copies* | surveys.js :659 and :780 (`createdBy`), :772-773 (Duplicate copies notes and links), :35 and :530 (library through `createdBy`); campaignManagement.js :62, :66-68 |
| Its own *Owner to confirm* line | *Assessment*, last sentence | — |

At build time, ‹build date› becomes the date, and the clause *"the proposal's Part 1 sets the
reading out for the owner to confirm or correct"* becomes the reading as approved, with its date. If
§M item 2 corrects the reading, *What a lead's row carries* is rewritten to the code that ships.

### I.4 Staying clear of the other session's hunks

The other session (GPS accuracy) has three uncommitted hunks in this file (`git diff --text`,
2026-10-03): the item-25 anchor refresh inserted after HEAD :1966, five lines directly above item
26; a grep-hygiene stamp on the record's background-location check, after HEAD :2678; and a
location-fallback stamp after HEAD :2723. None of them is this change's. This change's two hunks
share no line with them: their context is HEAD :1984-1989 and :2029-2034, and the nearest foreign
hunk's is :1964-1969.

- The frozen patch's version of the file is HEAD's blob
  (`git show HEAD:docs/PRIVACY_VERIFICATION.md`) plus the two stamps, never the working-tree file.
- The build writes the same two stamps into the working-tree file as well, so that after the commit
  the tree shows only the other session's text, and it checks both directions (§J.4).
- **Rehearsed for this plan** in a scratch repository, with the real repo untouched. The patch has
  two hunks, `@@ -1984,6 +1984,8 @@` and `@@ -2029,6 +2031,81 @@`. `git apply --cached --check`
  passes against HEAD, and `git apply --check` passes against a copy of the working-tree file with
  the other session's three hunks in place. After both were applied, the unstaged diff left behind
  was exactly the other session's lines, byte for byte. That rehearsal used the stamps as first
  written; review round 1 lengthened both (stamp 1 now always states item 26's confirmation, and
  stamp 2 says plainly what the bit reveals) and round 2 reworded both (stamp 1 states item 26's gate
  in full; stamp 2's lead says what it records under (c), and its attachments include archived ones),
  so the hunks add more lines, while their anchors and context lines stay the same. The build re-runs
  the rehearsal on the final text (§J.4).
- If the other session commits first, HEAD gains its five lines above item 26: the build re-anchors
  by content and makes the patch against that HEAD.

### I.5 Nothing on the legal pages

No published sentence becomes false, so nothing goes to the owner for a deliberate edit of the legal
pages. `privacy.html` :105 and :91 stay true (the stamp's *Assessment* says why). `DPA.md` :41 (§4,
tenant isolation) stays true, because the yes/no is computed from the organization's own rows
(surveys.js :542) and never crosses tenants. DPA §6 is not triggered: no third party. `terms.html`
makes no promise about roles: it contains neither "role" nor "team lead" (`grep -c -a -i` and a
Python scan agree), and its two "administrator" sentences are about accounts. **No customer notice;
no `privacy.html`, Terms or DPA edit.**

## J. Phones, gate, rollout and deploy

### J.1 Nothing ships to phones

- **The phone never calls `/admin/surveys`.** Three checks agree. `grep -rna` over `mobile/app`,
  `mobile/lib` and `mobile/components` finds no `admin/surveys`; `git grep --text` over `mobile/`
  finds none; and the repo's own surface list, `npm run audit:mobile-api -- --list` (run for this
  plan: *"Mobile calls 105 endpoints — 76 of them under /admin/\*."*), has no `/admin/surveys` path.
  Its survey endpoints are `/admin/households/:x/surveys…`, `/admin/reports/duplicate-surveys`,
  `/admin/reports/survey-results` and `/admin/voters/:x/surveys/:x…`. The door runner reads
  templates from the bootstrap (`routes/mobile/bootstrap.js`), which this does not touch.
- **No file under `mobile/` changes.** So there is no OTA on either lane (`ota:staging`,
  `ota:production`), no build and no build-currency variable (`MOBILE_CURRENT_RUNTIME_*`). It
  neither waits for nor holds up the scripted-survey OTA.
- **No client-version gate.** `CLIENT_API_VERSION` stays 1 (`mobile/lib/config.js` :22) and
  `MIN_CLIENT_API_VERSION` stays 1 (`server/src/config/clientVersion.js` :6). No field is removed or
  renamed and nothing becomes required: for a lead one boolean's value changes, on a route no phone
  calls, and a duplicate's name changes only past 193 characters.
- **Help reaches phones with the deploy.** The phone's Help screens read the same library from the
  server (CLAUDE.md, *Help Center content*), so the new copy needs no app release.

### J.2 No migration, no index, no setting

There is no new query: the org-scoped response aggregate a lead's row now reads already runs for
every caller (surveys.js :541-548). So there is no index to build (production `autoIndex` is off,
and an index would need `npm run migrate:build-indexes -- --apply`; none is added), no migration, no
Run console step, no config var and no Procfile change.

### J.3 Before building

1. **The investigation's docs patch is still uncommitted.** It records the gap and the shipped
   status in `docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md` (its status lines, the as-built note and a
   paragraph at the end of §O) and in `docs/README.md` :59. `git apply --cached --check` passes on
   the index, and `git apply --check -R` of it passes on the working tree file by file
   (`--include=docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md` as it is, `--include=docs/README.md` with `-C1`),
   so it is in the tree and is neither staged nor committed. The whole-patch reverse check now fails
   (`patch failed: docs/README.md:56`, re-run in review round 3) only because the GPS session's
   `PROPOSAL_GPS_UPGRADES.md` row sits in the trailing context of the patch's README hunk, so run that
   check per file or with `-C1`. The commit-first step is unaffected: it applies with `--cached`,
   against the index. Commit it first, as handed over on 2026-10-03, so that H.6's and H.7's hunks are
   made on top of it. If it is folded into this commit instead, the build carries
   its hunks in the frozen patch and says so in the hand-off.
2. **Line numbers in this plan are 5cb42b2's.** If HEAD has moved (that commit, or the other
   session's), every hunk is re-anchored by content and the patch is made against the HEAD of the
   day.

### J.4 The hand-off: one frozen patch

The owner commits whole files, and three of this change's files are also open in the GPS session
(`docs/PRIVACY_VERIFICATION.md`, `docs/README.md`, `server/src/content/help/faq/_INBOX.md`), while
`docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md` and `docs/README.md` carry the investigation's patch until
J.3's commit. So the build hands over one frozen patch, never a list of files to add:

1. **Sort the tree.** Run `git status --porcelain -uall` and sort every change into this change's
   and the other session's, by content. Re-check right before handing over, because the other
   session keeps writing. On 2026-10-03 the other session's were `docs/AUDIT.md`,
   `docs/CANVASSER_APP.md`, `docs/MAPS.md`, `docs/PERFORMANCE.md`, the new `docs/GPS_ACCURACY.md`,
   its three hunks in `PRIVACY_VERIFICATION.md` (§I.4), the `GPS_ACCURACY.md` row in `README.md`
   (after HEAD :53), two lines at the end of `_INBOX.md`, six Help articles
   (`faq/why-location-required.md`, `getting-started/canvasser-first-day.md`, `guides/audit.md`,
   `guides/canvasser-dispositions.md`, `guides/canvasser-map.md`, `guides/canvasser-offline.md`) and
   two new FAQ files (`faq/blue-dot-not-where-i-am.md`, `faq/canvasser-dot-off-will-it-flag.md`); by
   the evening of 2026-10-03 it had added a new `docs/PROPOSAL_GPS_UPGRADES.md` as well, and its row
   in `README.md`, right after the `PROPOSAL_NOT_TARGET_OUTCOME.md` row (HEAD :60).
2. **Shared files hold HEAD plus this change only.** For each shared file, the frozen version is
   HEAD's blob plus this change's hunks, checked both ways: HEAD to frozen adds nothing foreign, and
   frozen to working tree drops nothing of this change. The build also writes its hunks into the
   working-tree files, so after the commit the tree shows only the other session's text. For
   `docs/README.md` that write can't be a plain `git apply` (review round 3): the GPS session's
   `PROPOSAL_GPS_UPGRADES.md` row sits right after the `PROPOSAL_NOT_TARGET_OUTCOME.md` row (HEAD
   :60), which is the row that follows H.7 item 29's new one, so it falls inside that hunk's trailing
   context. Simulated on scratch copies, with the investigation's README change in place, a hunk with
   default context fails on the working-tree file (`patch failed: docs/README.md:57`) and applies
   with `git apply -C1`. So the build writes README's working-tree copy by content (or with `-C1`):
   item 29's row goes above the `PROPOSAL_NOT_TARGET_OUTCOME.md` row and the GPS rows stay where they
   are. The frozen README stays HEAD's blob plus this change's hunks,
   and README is checked both ways, as §I.4 does for `PRIVACY_VERIFICATION.md`.
3. **One patch.** In a scratch repository at HEAD, copy in every file of this change in its frozen
   form (the list below), `git add -A`, and write `git diff --cached --binary` to one patch file.
   Dry-run it on the real repo with `git apply --cached --check`, rehearse the owner's exact
   commands in a fresh clone, and run every suite there (§L.1).
4. **The owner's commands**, from the repo root:
   ```
   git apply --cached <the patch>
   git diff --cached --stat
   ```
   The stat must list exactly the files below and no GPS file. The working tree is never touched, so
   the other session's text stays unstaged. Then comes the commit message, which the build hands
   over as text only, with no double quote, dollar sign, backtick or exclamation mark, checked
   mechanically rather than by eye.

The files, 25 — 28 with A1, or 26 if A1 is declined:

- **Server:** `server/src/routes/admin/surveys.js`; tests `server/test/teamLead.int.test.js` and
  `server/test/surveys.int.test.js`. With A1, also `server/test/campaignGoal.int.test.js` (G.5).
- **Web:** `client/src/components/SurveyBuilder.jsx`, `client/src/lib/surveyBuilderRules.js`,
  `client/src/pages/CampaignSurveyBuilderPage.jsx`, `client/src/pages/SurveyEditorPage.jsx`,
  `client/src/pages/CampaignSurveyPage.jsx`, `client/src/pages/CampaignsPage.jsx` (§E.7),
  `client/src/components/campaigns/CampaignFormDrawer.jsx`; tests
  `client/src/lib/surveyBuilderRules.test.js` and the new
  `client/src/lib/surveyBuilderLockRender.smoke.test.js`. With A1, also the new
  `client/src/lib/campaignPatch.js` and `client/src/lib/campaignPatch.test.js`.
- **Docs:** `docs/SURVEYS.md`, `docs/ROLES.md`, `docs/CAMPAIGNS.md`, `docs/ADMIN_APP.md`,
  `docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md`, `docs/README.md`, `docs/PRIVACY_VERIFICATION.md`, and this
  proposal as the new `docs/PROPOSAL_LEAD_SURVEY_LOCKS.md`.
- **Help:** `server/src/content/help/guides/surveys.md`, `guides/roles-and-team.md`,
  `guides/campaigns-manage.md`, `getting-started/lead-getting-started.md` (H.8 item 34) and
  `faq/_INBOX.md`. If A1 is declined, also `faq/how-many-doors-a-day.md` (H.8 item 32).

### J.5 Deploy, in order

1. **Confirm §I.3's stamp** (§M, item 3), before the production deploy.
2. **Commit and push.** The owner commits (§J.4) and pushes `main` to GitHub. CI's fast job runs on
   every push and the integration marathon on `main` (`.github/workflows/tests.yml`); deploy once
   both are green. A push to the `heroku` remote alone runs nothing.
3. **Run `npm run audit:mobile-api -- 5cb42b2`** from the repo root on your computer, where the ref
   is the commit production runs (the dashboard's **Activity** tab shows it; 5cb42b2 since
   2026-10-03). Expect exactly one flagged file: `server/src/routes/admin/surveys.js`, *"mounted at
   /admin/surveys — mobile calls 0 endpoint(s) there:"*, with nothing listed under it. Zero
   endpoints is the all-clear. The file is flagged at all only because the script's skip test
   (`scripts/mobile-api-surface.mjs` :116) reads `matches.size` on an array, so it never skips a
   file with no matches; run for this plan against 5cb42b2's own change, it printed exactly that
   line for `surveys.js`. That skip test is a bug in the script (its one-line fix is
   `if (!matches.length) continue;`), outside this change: the build names it in the hand-off as a
   follow-up for its own change, so a later reader doesn't take a *"calls 0 endpoint(s)"* line for a
   finding. During the build, before the commit, the plain `npm run audit:mobile-api`
   reports the same single file: it reads only server route and service files, and the other
   session's changes are docs and Help.
4. **Deploy:** Heroku dashboard → **Deploy** tab → **Manual deploy** → `main`. The server, the web
   console and the Help Center go live together. There is nothing to type in **More → Run console**,
   and the Procfile is unchanged, so the worker's formation is untouched.
5. **Run the checks in §L.3.**

**The deploy window.** A console tab that already had the builder loaded keeps running the old
builder against the new list until it reloads. For a gap-case lead it now locks correctly, but
HEAD's banner prints the lead's own count, *"This survey has 0 responses."* (SurveyBuilder.jsx
:1141). A reload fixes it.

**Rolling back.** Nothing this change stores needs the new code: no field, no collection, no
setting, and a copy is an ordinary survey. Rolling back (dashboard → **Activity** → roll back to the
previous release) restores today's narrowed yes/no and today's builder, and copies made in between
stay in the library.

## K. Risks, and what stays as it is

### K.1 False positives: a survey with no answers is never locked

The owner's rule is that a false positive is worse than a miss, so this is the property the change
must not break. It holds by construction, and each exception is named here.

- **The server's yes comes from the rows the save checks.** A lead's `hasResponses` on an attached
  survey is `(counts.get(id) || 0) > 0`, and `counts` (surveys.js :575) is keyed by the `$group` on
  `surveyTemplateId` of an aggregate matched on the organization only (:541-544). Every row it
  counts carries this template's id, so the save's `SurveyResponse.exists({ surveyTemplateId })`
  (:699) finds it: when the list says yes, the save refuses. The two can differ in only two ways.
   - **A row stamped with another organization.** The save finds it and the list does not. That is
     an under-lock: the save still refuses, now where it can be seen and with *Save my changes as a
     copy* (D3, D4). It is a miss, never a false lock.
   - **A row whose `surveyTemplateId` is stored as a string.** The list's `String()` keys would
     count it while the save's ObjectId cast would miss it: the one theoretical false lock. No
     writer stores one. The model types the field as an ObjectId (`models/SurveyResponse.js` :53);
     the bulk inserts go through the model and cast (`services/canvass/surveyConversion.js` :492,
     `services/platform/demoActivity.js` :318); and the only raw insert, the turf snapshot restore
     (`services/turf/snapshot.js` :159), re-inserts rows captured with `.lean()` (:43) and kept in a
     `TurfSnapshot` document (:47), so their ids are still ObjectIds. G.1 builds its raw rows from
     real ObjectIds for exactly this reason.
- **The lock is read when the list loads.** If a survey's last answers are removed while a builder
  is open (an unknock, a deleted response, a reverted desk conversion), it stays locked until the
  list refetches, on a reload or a reconnect. That is today's behavior for admins, and now for leads
  too. It is never a lock from answers that never existed, and the save reads the live table, so it
  never refuses for answers already gone.
- **The client adds a lock only on the server's word.** D2 removes one: today a locked survey locks
  the type of brand-new questions, which the server would accept. The one it adds (§D.5, review round
  3) follows a save the server refused with `survey-has-responses`, which the server sends only when
  its `SurveyResponse.exists` found an answer (surveys.js :699-715), and it lasts until the next save
  attempt. D3-D7 change wording, placement and navigation only; D5 can only delay a redirect.
  *"Responses in your organization"* prints only when `hasResponses` is true.
- **Pinned.** G.1's `none` survey (no answers anywhere: `hasResponses` false, and the `PATCH`
  answers 200) and G.4's case 3 (a lead's builder on such a survey: no banner, nothing greyed out,
  no Retire).

### K.2 R1's boundary: the one place the list and the save disagree on purpose

For a survey in a lead's library only because they wrote it, the list keeps the narrowed yes/no
while the save counts the whole organization. §A's table has the one such row (*false → false (R1)*,
`PATCH` 409). Nothing a lead uses acts on it:

- A lead's only builder is the campaign builder, and it opens the campaign's **main** survey
  (CampaignSurveyBuilderPage.jsx :114-115). That survey is always attached to a campaign they
  manage, so it is always counted org-wide. The org editor, which can open any survey, sits behind
  `RoleGate require="orgAdmin"` (App.jsx :203, :213-215).
- The Survey tab's Preview note reads the same main survey (CampaignSurveyPage.jsx :143-144). The
  Change-survey picker and the campaign drawer read the narrowed count, by D7.
- Attaching the survey, with **Change survey** or as a walk-list survey, invalidates `['surveys']`
  (CampaignSurveyPage.jsx :104-106, :116-118), and the refetched row is counted org-wide. With A1 the
  campaign drawer becomes a third way for a lead to attach one; its save refreshes `['surveys']` too
  (§E.7 — at HEAD it doesn't, CampaignsPage.jsx :155-168), so the builder never opens on a stale,
  narrowed row.
- A save sent to it some other way still gets the 409 (G.1 asserts it): the boundary changes what
  the list says, never what the save allows.

If the owner reads the ruling more widely, §M item 2 says what changes.

### K.3 What a lead learns, by ruling

The change is a disclosure, made on purpose. A lead, who may be the paying client, learns for each
survey on their campaigns whether it has answers anywhere in the organization, without trying a
save. They never learn which campaign or how many: counts, campaign names and the no-campaign bucket
stay theirs. It amends the 2026-08-08 client-lead scoping the owner ruled strict (§B, R1). It is
recorded in full in §I.3 for the owner's confirmation (§M, item 3), and the reading of the ruling is
§M, item 2.

### K.4 Smaller risks, named

1. **The race stays.** A survey's first answer can still arrive while someone is editing it, and
   Save is then refused. What changes is that the refusal can be seen, says what to do, keeps the work
   and locks the builder until the next save attempt (D3, D4, §D.5).
2. **The deploy window** (§J.5): a builder already loaded before the deploy prints *"This survey has
   0 responses."* for a gap-case lead until the tab reloads.
3. **Retyping back restores, in every builder.** Going back to a question's saved type brings back
   what the switch cleared (D2's `restoredOnRetype`) in an unlocked builder too, which admins will
   notice: a choice question switched to Free text and back gets back the answers it had just before
   the switch, edits included, instead of two blank ones, when nothing has been typed on the card. It
   is never the survey as saved, so nothing done before the switch is quietly undone (review round 3),
   it comes back once (review round 4), and with nothing kept, nothing comes back. Their arrows come
   back only while the survey is in Go to, and only to blocks still after it in the survey; after
   **Switch back** they never do, so a retype can't put a survey back into Go to (review round 2). What
   a card keeps lasts until it is used or the builder closes: opening it again starts without it.
4. **Saved means saved.** A question added and saved on a survey with answers is type-locked at the
   next open, before it has answers of its own. The server compares stored keys
   (`classifyQuestionEdits`, diffQuestions.js :23-39), and the builder mirrors it.
5. **The picker and the drawer stay count-gated** (D7). A lead choosing a survey none of whose
   answers are counted in their campaigns sees no warning there; the lock and the Preview note show
   once it is attached.
6. **With A1, the drawer's lead fields are a list to maintain.** After §E.5 items 4-5 the controls a
   lead can change are exactly `LEAD_CAMPAIGN_FIELDS` (name, timezone, survey, door goal, goal date),
   and the survey select can swap but never empty a lead's survey, so nothing a lead can change today
   is silently dropped. A field later opened to leads in the drawer must join `LEAD_CAMPAIGN_FIELDS`
   and lose its `disabled`, or a lead's change to it is silently not sent. G.5's unit half pins the
   helper against a copy of the server's refused list, and its integration half sends the drawer's
   whole body through the real `PATCH`, so a server change that starts refusing a field the helper
   sends fails there; neither can see a new drawer field, which is the one thing left to review by
   hand.
7. **Duplicate copies the saved survey**, as today: unsaved edits on the page don't travel with it.
   That is what *Save my changes as a copy* is for, and Part 1 says so.

### K.5 What stays as it is

- **The server's rules.** The two blocks once a survey has answers (an answer-type change, and
  entering Go to); leaving Go to is never refused (surveys.js :701-704); the attach and detach
  scopes; `POST` open to leads (:636-638); Duplicate's scope (:763) and what it copies (only the
  name is now capped); and archive, unarchive and `DELETE` stay admin-only (:791, :809, :829), so
  *"It has survey responses."* never reaches a lead.
- **A lead's library.** Which surveys appear is unchanged (the find filter, :528-531).
- **Every count a lead sees**, every campaign name, and what `usedElsewhere` means (current
  attachments only, :625-627).
- **Admin rows**, byte-identical (§A). `responseCountByCampaign` stays unsorted (the aggregate has
  no `$sort`, :545-548), so no test asserts its order.
- **The phone and every shipped app** (§J.1).
- **Copies.** Names may repeat, as Duplicate's already do: `SurveyTemplate.name` has no unique index
  (`models/SurveyTemplate.js` :99; the only indexed fields are at :97, :100 and :118). A copy keeps
  the form's retired questions and answers retired, as Duplicate's does, because the `POST`'s schema
  carries `retired` (surveys.js :101, :243).

## L. Verification

### L.1 What the build runs, from the repo root

In this order. Every one must pass.

1. **The four suites that pin this change.** `server/scripts/test-int.sh` takes file arguments and
   supervises its own mongod:
   ```
   npm --prefix server run test:int -- test/teamLead.int.test.js test/surveys.int.test.js test/surveyBlocks.int.test.js test/leadWalkthrough.int.test.js
   ```
   With A1, add `test/campaignGoal.int.test.js`: G.5 adds a test to it (12 → 13), beside *"a TEAM
   LEAD may set the goal but still cannot touch the key dates"* (:234), the server half A1 relies on.
   Expected counts: `teamLead.int.test.js` goes from 20 tests to 21; `surveys.int.test.js` from 6 to
   7; `surveyBlocks.int.test.js` (30) and `leadWalkthrough.int.test.js` (14) are unchanged.
2. **CI's fast job, all four** (`.github/workflows/tests.yml`):
   ```
   npm --prefix server test
   npm --prefix client test
   npm run test:mobile
   npm --prefix client run build
   ```
   `npm --prefix server test` includes `test/helpLinks.test.js`, which parses every Help article's
   frontmatter and checks each internal link against the reader's audience; H.8 edits three guides
   and a getting-started article, whose new link to `surveys` this test checks (and
   `faq/how-many-doors-a-day.md` if A1 is declined).
   `npm --prefix client test` (`node --test src/`) picks up the new and extended files:
   `surveyBuilderRules.test.js` goes from 36 tests to 44, `surveyBuilderLockRender.smoke.test.js` brings
   ten cases, `campaignResolveRender.smoke.test.js` (which renders the edited `CampaignSurveyPage.jsx`)
   must stay green, and with A1 there is `campaignPatch.test.js`. `npm run test:mobile` must stay green
   with no mobile file touched.
3. **The full marathon:** `npm --prefix server run test:int`. There are 117 suites at HEAD and still
   117 after, since no suite file is added; it is CI's `main` job.
4. **`npm run audit:mobile-api`**, expecting exactly §J.5's output.
5. **On the frozen tree.** The working tree holds another session's files (`helpLinks.test.js` reads
   its two new FAQ articles), so a failure there would not necessarily be this change's, and a pass
   there would not prove the patch. So the build makes the patch (§J.4), dry-runs
   `git apply --cached --check` on the real repo, then in a fresh clone at HEAD runs the owner's two
   commands exactly, puts the patched files on disk (`git checkout-index -a -f`), installs the
   dependencies and runs 1-4 again there.
6. **Housekeeping.** `git status --porcelain -uall` shows no stray file (the smoke test removes its
   temporary directories in `finally`). None of the touched files is one of the three NUL-bearing files
   CLAUDE.md lists, and a Python scan of the frozen files finds no NUL. Every new line reference in the
   docs resolves at the new HEAD, and the Help copy says what docs Part 1 says. A grep of the lines the
   frozen docs, Help and code hunks add (the proposal itself aside, code comments included) for
   *elsewhere*, *outside* and *beyond* (review rounds 1 and 2): every hit must quote the existing *"also
   used elsewhere in your organization"* label, be about where a survey is attached, or say nothing
   about where a survey's answers came from, since an answer with no campaign can't be placed.
   Last, an adversarial review of the diff (false positives, lead wording and privacy, the swap guard,
   the hand-off) comes before the commit message.

### L.2 What this plan verified, and what it didn't

- **Verified for this plan:** the server change, against the real `GET` and `PATCH` handlers in
  memory (§A's table); every G.1 assertion on its first five surveys against those patched handlers,
  not a database; every G.3 and G.5-unit assertion against the helpers, in memory (`retireOption` and
  `responsesNoteOpening` in review round 1, with `savedShape` reading through the real
  `questionsForEditing`); G.4's eight cases as first written, rendered server-side against the
  patched sources; the privacy record's patch as first written, rehearsed both ways in a scratch
  repository (§I.4); and `npm run audit:mobile-api`, in list mode and against 5cb42b2's own change
  (§J.5). Review round 1 also read, in the installed packages, why the copy needs its own mutation
  (TanStack Query 5.100.6 updates a pending mutation's options; React Router 6.30.3 keeps one page
  instance across the sibling builder routes, §E.2 item 2).
- **Verified in review round 2, in memory:** the round-1 `restoredOnRetype` reviving arrows after
  **Switch back** (a reviewer's probe, re-run here against the real `switchBack`); the revised one
  bringing the answers back with no arrow and `entersScript('list', …)` false, for a choice question
  and a *Free text* one, keeping the arrows in Go to, and sending an arrow to a block removed or moved
  above back to Continue; `retireBlock`, `savedShape`'s labels and `cleanBlock` sending the retired
  block's label; the real `PATCH` and `POST` handlers, driven up to their parse (a reviewer's probe,
  re-run here), answering `400 Invalid input` for a retired question with a blank label and passing it
  with its saved words; `copyName` with an emoji astride the cut (the first version left a lone half,
  which a UTF-8 round trip turns into U+FFFD); and query-core 5.100.6's optimistic result for a seeded,
  invalidated `['surveys']` mounting offline (`fetchStatus: 'paused'`, `isFetching: false`).
- **Verified in review round 3, in memory or on scratch copies:** the round-2 `restoredOnRetype`
  putting the survey as saved back over an author's reworded, added and removed answers, and over a
  re-pointed arrow (a reviewer's probe, re-run here: Save sent Yes / No / Maybe later); the revised
  one, restoring the card's own `retyped`, on the cases §E.1 lists, against HEAD's `cleanBlock` (with
  E.1's line), `emptyIssues`, `questionsForEditing`, `routeTargets`, `entersScript` and `switchBack`;
  HEAD's 36 unit tests passing against the rules file with E.1's changes; `retireBlock`'s type revert;
  query-core 5.100.6 awaiting `onSuccess` before it marks a mutation done (`mutation.js` :123, :144),
  which is why Duplicate's box needs `isPending` to outlast the attach; the refusal's Duplicate line
  with and without `duplicateSwitches`, the created hint in both states and the A1-declined key-dates
  line, rendered server-side as standalone snippets with the repo's React 18.3.1; the investigation
  patch's reverse check per file and with `-C1` (§J.3); and README's hunk failing on the working tree
  with default context and applying with `-C1`, on scratch copies (§J.4).
- **Verified in review round 4, in memory or by rendering:** HEAD's banner JSX with §D.5's lock,
  rendered server-side by a reviewer with the repo's React 18.3.1 and re-run here, printing *…and so
  are changes to its Go to routes* after a Go to refusal on a survey saved in Show only if, and the
  same banner worded by `goToSaved` (§D.9), rendered with the repo's React for three cases: that
  refusal (*Two changes need a fresh copy…*), a survey saved in Go to (*…and so are changes to its Go to
  routes*), and one switched back from it (*Two changes…*); and, with
  HEAD's `questionsForEditing`, `routeTargets`, `entersScript`, `switchBack`, `repointRoutes`,
  `surveyIssues` and `cleanBlock` (with E.1's line), the server's `classifyQuestionEdits`, and D.3's
  `setType`, D.7's `removeQuestion` and HEAD's Restore (:1272) modeled as pure functions: round 3's
  `retireBlock` putting the saved answers back on Restore, through *Multiple choice* and through *Free
  text*, and round 3's `restoredOnRetype` bringing old answers back over ones blanked by hand, in the
  reviewer's sequence and in the skeptic's (all re-run here); the revised helpers on every case §E.1
  lists, and 3,000 random runs of them (§E.1); L.3 step 16's two orders; and HEAD's 36 unit tests
  against the rules file with E.1's code inserted as written. The helpers and the `cleanBlock` line were taken from this file's §E.1 and loaded
  in place of the rules file through a module hook, so what passed is the code as written here, and
  nothing was written to disk.
- **Reported by a round-1 reviewer, not re-run here:** G.1 and G.2 as first written, against a
  scratch mongod with the server change loaded by a loader hook — `teamLead.int.test.js` 21 of 21 and
  `surveys.int.test.js` 7 of 7, each new test failing at HEAD on its intended assertion — with
  `surveyBlocks.int.test.js` (30) and `leadWalkthrough.int.test.js` (14) still green.
- **Not run:** the suites themselves on a patched tree, integration or unit; what review round 1
  added to the tests — G.1's `main` survey, G.2's word-gap case, G.5's integration test, G.4's
  name-hint lines, case 8's additions and case 9; everything review round 2 added to the tests — G.2's
  emoji case, G.3's new assertions and its `retireBlock` test as test code, G.4 case 6's Duplicate line,
  case 7's offline line, case 8's key-dates line and case 10; everything review round 3 added to the
  tests — G.3's re-pinned `restoredOnRetype` and `retireBlock` assertions as test code, G.4 case 6's
  lock and `duplicateSwitches` lines, case 8's reworded key-dates line and case 10's nothing-attached
  line, inside the real pages; everything review round 4 added to the tests — G.3's use-once,
  `retireBlock` and `savedInGoTo` assertions as test code and G.4 case 6's Go to-saved banner line —
  and L.3's new step 8; the campaign builder's Duplicate box after a refused save, which only
  L.3 step 7 checks; the box held up while Duplicate runs and the refusal kept when its attach fails,
  which no render reaches and no manual step stages; a browser; and every click path SSR can't
  exercise, such as retyping a card, removing a new answer or a cleared saved one, pressing the copy button,
  Switch back's confirmation and the scroll (§G.4). L.1 and L.3 are their first real runs.

### L.3 The owner's checks on the web, after the deploy

Run them in an organization you test in, never a customer's. The demo organization's people are
synthetic.

**Setup, as an org admin.** Make two survey campaigns, **A** and **B**, and a test user who is a **team
lead on A only**. Make a survey, *Door script*, in *Show only if*, with a single-choice question and a
Free-text one. Make a second, *Go script*: a single-choice question whose first answer has a *then go
to* pointing at a second question, saved while it has no answers (so it saves in **Go to**). Attach
*Door script* to **B** and record one survey under it at a door on B from a phone. Then make *Door
script* **A**'s survey (**Change survey** on A's Survey tab), switch **B** to *Go script*, and record
one survey under *Go script* at a door on B. *Door script* now has one answer, on a campaign the lead
can't see and that no longer uses it: the dead end of Part 1's example 1. Whenever a step records from a
phone, first make sure the phone shows the survey the campaign uses now: a survey saved under one the
campaign has switched away from is refused (`routes/mobile/canvass.js` :764-768), which is the
between-shifts rule.

**As the team lead:**

1. **The lock, up front.** A → Survey → **Edit survey**. Expect *"This survey has responses in your
   organization."*; the box at the top with **Duplicate to edit a copy**; every *then go to* greyed
   out, its hint *"This survey has responses, so it can’t switch to Go to routing. Use Duplicate at
   the top of this page to build the scripted version."*; under each saved question *"Type is locked
   once there are responses — Duplicate to change it."*, with only its own type's pill pickable; and
   **Retire** on saved blocks. No number of responses and no "Campaign B" anywhere on the page.
2. **Only what was saved.** Still there, **+ Add question**: its type pills all work and it offers
   **Remove**; remove it. Add a blank answer to a saved question and press its **×**: it goes (no
   struck-through row with **Restore**). Clear the words of a saved answer and press its **×**: it
   shows struck through, with **Restore**, and its saved words back. Clear the wording of the saved
   Free-text question and **Retire** it: its struck-through row shows its saved wording. Then **Save**,
   with both still retired: it saves, with no *Invalid input* (the three removals are the saves D2, `retireOption` and `retireBlock` keep from failing;
   review round 2 moved the Save before any **Restore**, which would send the answer live again and
   test nothing). Open **Edit survey** again: the retired answer and the retired question show their
   saved words. Press **Restore** on each and **Save**, so the survey is as it was for the next steps.
3. **The Survey tab.** Open the preview: *"This survey has responses in your organization — editing
   keeps past answers; only changing a question's answer type, or switching it to Go to, needs
   Duplicate."* Open **Change survey**: *Door script*'s option shows no count. Close it.
4. **Their own answers.** Record a survey at a door on A from a phone, then reload. The builder says
   *"This survey has 1 response in your campaigns."*, the preview *"This survey has 1 response in
   your campaigns — editing keeps …"*, and **Change survey** lists *"Door script (v…, 1 response in
   your campaigns)"*.
5. **Duplicate.** In the builder, press **Duplicate to edit a copy**. Expect at most a moment of
   *Loading…*, then **Edit survey** on *"Door script (Copy)"*, never *Create survey*. A now uses the
   copy.
6. **No answers, no lock.** On the copy there is no banner, nothing is greyed out and every block
   says **Remove**. Reword one answer of the saved choice question, then switch the question to *Free
   text* and back: its answers come back exactly as you left them, the reworded one included (review
   round 3). Reword a question and **Save**: it saves.
7. **The race, and Save my changes as a copy.** Open **Edit survey** on the copy, switch its
   single-choice question to *Multiple choice* and don't save. Record a survey at a door on A from a
   phone, then press **Save**. The page scrolls to the message at the end of the form: the server's sentence, the
   question it names, *"Your changes are still here. Set those questions back to the answer type
   they were saved with and save again, or keep all of it, the refused change included, with Save my
   changes as a copy. Duplicate at the top of this page copies the survey as last saved, without
   these changes, and switches this campaign to the copy at once, so do it only between shifts. Save
   my changes as a copy switches nothing."* and the copy line. The Save bar says *"Not saved — see the
   message at the end of the form."*, and the box at the top of the page now offers **Duplicate to
   edit a copy**, which wasn't there when the builder opened, because the survey had no answers then
   (§E.2 item 6). The builder is locked now too: its banner says *"This survey has responses."*, and
   the question you retyped offers only its new type and the one it was saved with (§D.5). Press
   **Save my changes as a copy**: you land on the Survey tab, whose hint ends *"…or make it this
   campaign's default with Change survey. Do either between shifts: surveys still queued on phones
   under the survey those doors use now would be dropped."* A still uses *"Door script (Copy)"*, and
   **Change survey** lists *"Door script (Copy) (Copy)"*.
8. **The race for Go to** (review round 4). On the Survey tab, make *Door script (Copy) (Copy)* A's
   survey with **Change survey**: it has no answers. **Edit survey**: nothing is locked. On an answer of
   its first question, set *then go to* to its second question (the blue Go to banner appears), and
   don't save. Record a survey at a door on A from a phone, then press **Save**. The message at the end
   of the form is the server's *"This survey has responses, so it can't switch to Go to routing.
   Duplicate it to build the scripted version."* with *"Your changes are still here. Switch back to Show
   only if (on the blue Go to banner above) and save again, or keep all of it, the refused change
   included, with Save my changes as a copy. …"*, and the banner above the form reads *"This survey has
   responses."* and then *"…Two changes need a fresh copy: changing a question's type, and adding Go to
   routing — use Duplicate at the top of this page for those."*, never *"…and so are changes to its Go
   to routes"* (§D.9). Press **Switch back to Show only if** — no confirmation, since the survey was
   saved in Show only if — and **Save**: it saves.
9. **The campaign drawer.** Campaigns → A's **⋮** → **Edit**. A's survey is selected, with step 8's
   answer: *"Heads up: this survey already has 1 response in your campaigns. New answers will report
   under it alongside the existing ones. To run different questions, save, then use Duplicate at the
   top of the campaign’s Edit survey page."* (without A1, E.5's alternative last sentence). The
   survey select offers no empty choice, because A has a survey, and *Surveys page* appears nowhere.
   **Active (visible to canvassers)** and **Restricted doors on invoices** are greyed out, with *"Only
   an org admin can archive or reactivate a campaign."* and *"Only an org admin can change this."*
   Leave the survey as it is. **With A1:** change only the door goal and **Save**; it saves, and
   **History** shows it. **Without A1:** Save answers *"Only an org admin can change a campaign's
   isActive."*, as today.
10. **Switch back asks first.** As the org admin, make *Go script* **A**'s survey with **Change
    survey** (between shifts, as always). As the lead, A → Survey → **Edit survey**: the banner says
    *"This survey has responses in your organization."* Press **Switch back to Show only if** on the
    blue Go to banner: expect the confirmation *"This survey has responses, so once it is saved without
    Go to it can’t use Go to again — only a duplicate can. Switch back to Show only if?"* (today a
    lead gets no confirmation there, SurveyBuilder.jsx :1055-1063), and **Cancel** keeps Go to. Leave
    with **Cancel** at the bottom, and as the admin put A back on *Door script (Copy) (Copy)*.
11. **Help.** In Help, the Surveys guide's *Who can edit what* explains *has responses in your
    organization*, *Editing a live survey* says what you add stays editable until you save it, and
    its Heads up ends with what to do when a save is refused: *Save my changes as a copy*, then
    *Change survey* or a walk list, between shifts. The Campaigns guide's Edit paragraph matches
    the answer to A1, and *Get started as a team lead* no longer says a lead sees *nothing at all*
    outside their campaigns: it names the two yes-or-no facts.

**As an org admin:**

12. **Wording unchanged.** On a survey with answers on several campaigns, expect the builder's
    *"This survey has N responses."* (the organization's total), the preview's *"N responses across
    all campaigns — …"* and **Change survey**'s *"(v…, N responses)"*.
13. **The org editor's refusal and copy.** Attach a survey with no answers to a test campaign and
    open it from **Surveys** → **Edit**. Switch an answer type and don't save; record a survey under
    it from a phone; press **Save**. Expect the same message at the end of the form and the same
    Save bar note. **Save my changes as a copy** lands on **Surveys**, with the copy listed.
14. **A long name.** Make a survey with a 200-character name and Duplicate it from the Surveys list.
    The copy's name ends *" (Copy)"*, is 200 characters long, and the copy saves again.
15. **The drawer, as before.** The heads-up reads *"…already has N responses. … duplicate it on the
    Surveys page and pick the copy."*, the empty survey choice is offered, **Active** and
    **Restricted doors on invoices** work with no note under them, and Save works. With the browser's
    developer tools open on the **Network** tab, switch the test campaign's survey in the drawer and
    **Save**: the `PATCH` to `/api/admin/campaigns/…` is followed at once by a `GET /api/admin/surveys`
    (§E.7, the refresh a lead's builder relies on once A1 makes the drawer a way to attach; added in
    review round 2). The Network tab is the check because the builder can't show the difference: it
    refetches the list on opening anyway, a moment after it first renders. Switch the survey back
    afterwards.
16. **Switch back stays switched.** In **Surveys**, make a new survey: a single-choice question whose
    second answer has a *then go to* pointing at a Free-text question, so it saves in **Go to**. Open it
    again from **Surveys** → **Edit** (it has no answers, so nothing is locked). While it is still in Go
    to, switch the single-choice question to *Free text*. Then press **Switch back to Show only if**: no
    confirmation, and the blue Go to banner goes. Switch the question back to *Single choice*: its two
    answers come back with no *then go to*, and the banner stays gone. **Save**: it saves. (Review rounds
    2 and 4. The answers the switch to *Free text* kept still carry their *then go to*, because Switch
    back clears the arrows on the cards but not what a card keeps; brought back in Show only if, that
    arrow would quietly switch the survey back to Go to, and the blue banner would come back. Pressing
    Switch back first, as this step once did, clears the arrow before anything is kept, so the step
    could not fail.)
17. **Help.** The Roles and team guide names the two yes-or-no facts a lead learns.
18. **Duplicate, then a campaign switch** (§N, fixed 2026-10-05). Make sure A runs a survey with
    answers, so its **Edit survey** offers **Duplicate to edit a copy** at the top, and note which
    survey B runs. Open A → Survey → **Edit survey**, then throttle the connection in the browser's
    developer tools (**Network** tab, *Slow 3G*). Press **Duplicate to edit a copy** and, before it
    finishes, switch to **B** with the sidebar's campaign switcher. You stay on B's **Edit survey**,
    with B's survey on the form; until A's Duplicate finishes, B's page shows the Duplicate box with
    its button spinning and Save greyed out, because the page runs one of them at a time. Turn the
    throttling off. A's Survey tab shows the copy (its name ends *(Copy)*), and B's still shows the
    survey you noted: the copy attached to the campaign you started on, and the campaign you switched
    to kept its survey, so nothing queued on its phones is dropped.
19. **Change survey offline, then a campaign switch** (§N, fixed 2026-10-05). Note which survey B
    runs. On A's Survey tab, set the browser's developer tools to *Offline* (**Network** tab). Press
    **Change survey**, pick another survey and press **Attach survey** (nothing is sent yet), press
    **Cancel**, then switch to **B** with the sidebar's campaign switcher. Go back online: A's Survey
    tab shows the survey you picked, and B still runs the survey you noted.

Afterwards, archive the test surveys: one with answers can't be deleted (`DELETE` refuses it,
surveys.js :836-845).

## M. Open questions for the owner

**All four were answered by the owner on 2026-10-03, with the plan's approval:** (1) A1 — **yes**, so
the *Yes* branch ships; (2) the reading of R1 — **confirmed** as written; (3) the §I.3 stamp —
**confirmed** (the build writes it with that date, and its *Owner to confirm* line records the
confirmation); (4) item 26 — **confirmed**, the lead-visible, lead-authorable note in (c) included,
so §I.2's status stamp records the confirmation as given on 2026-10-03 and the production OTA of
scripted surveys is no longer waiting on it. The questions as they were put follow.

1. **A1 needs a yes (§E.6).** A team lead's **Save** in the campaign **Edit** drawer is refused
   every time today. The drawer sends every field, including the admin-only ones it shows greyed out
   (CampaignFormDrawer.jsx :80-99), and `PATCH /admin/campaigns/:id` refuses any admin-only field a
   lead sends, changed or not, before it reads the campaign (campaigns.js :496-505: *"Only an org
   admin can change a campaign's isActive."*). The drawer has been open to leads since 2026-08-14
   (`9b1b151`), and it is the web's only control for the door goal the owner ruled that day a lead
   may set. The fix sends a lead only the fields they own (`lib/campaignPatch.js`, §E.6). **Privacy:
   neutral** — the server's rules for leads (campaigns.js :496-505, and `canManageSurvey` for an
   attach, :633-641) don't change; A1 only stops the drawer sending fields it already shows
   read-only, and a lead's name and door-goal changes land in History as the 2026-08-14 ruling
   intended. Either way, §E.5 items 4-5 ship: **Active** and **Restricted doors on invoices** are
   greyed out for a lead, and a lead gets the empty survey choice only while the campaign has no
   survey — without A1 neither changes what a lead can save; with A1 both are required.
   - **Yes:** E.6 and G.5 (its unit and integration halves) ship; the drawer's lead heads-up says
     *"save, then use Duplicate…"* (§E.5); CAMPAIGNS.md :1218-1221 takes H.4 item 23's A1 sentence
     as well as its always-on one, and H.2 item 15 keeps its *(A1:)* sentence;
     `guides/campaigns-manage.md` :28 takes H.8 item 32's main text; and L.3 step 9 expects the save
     to work. 28 files (§J.4).
   - **No:** E.5's alternative lead sentence is used; G.5, H.4 item 23's A1 sentence and H.2 item
     15's *(A1:)* sentence are dropped; and H.8 item 32's *If A1 is declined* list is used — six Help
     passages that say a lead sets the door goal, name or timezone in the drawer
     (`guides/campaigns-manage.md` :28, :34, :35, :115 and :128, and `faq/how-many-doors-a-day.md`
     :14) and their Part 1 sources (CAMPAIGNS.md :107-109 and :252-255, ROLES.md :59-60). The
     drawer's own lead line under *Key dates*, *"Only an org admin can change the key dates. You can
     still set the door goal below."* (CampaignFormDrawer.jsx :242), which would promise a save that
     fails, becomes *"Only an org admin can change the key dates. For now, only an admin can save this
     drawer, so ask an admin to set the door goal."*, and G.4 case 8 asserts it (review round 2;
     reworded in round 3). The bug stays, documented. 26 files (§J.4).
2. **Confirm or correct the reading of R1** (Part 1, *How we read the ruling*). It is read as: a
   survey is *part of their campaigns* when it is attached to a campaign they manage, as its main
   survey **or** as a walk-list's survey (an archived campaign or walk list of theirs counts too,
   exactly as it already keeps the survey in their library); a survey in their library only because
   they wrote it keeps today's narrowed answer; and counts never widen.
   - **Wider** (authored surveys too): §C.1's hunk 2 becomes
     `hasResponses: (counts.get(id) || 0) > 0` on every lead row and hunk 1's `attachedSet` goes;
     G.1 expects `true` for its authored survey; and §I.3, ROLES.md, SURVEYS.md and the Help say *a
     survey in their library*.
   - **Narrower** (main surveys only): the test becomes `usedByCampaigns.length > 0`, using the
     narrowed list of managed campaigns whose main survey this is (surveys.js :612); G.1's four
     walk-list surveys then expect the narrowed answer and only `main` the org-wide one; and the
     wording follows. The builder is unaffected either way, since it only ever opens a main survey.
3. **Confirm the privacy stamp (§I.3)**, at approval or any time before the production deploy. It
   records the lead's survey row in full, says why, quotes the ruling, and says plainly how it
   differs from item 24(d), including what it reveals that 24(d) would not: on a survey on the lead's
   campaigns, that answers their campaigns don't account for exist. No Privacy Policy, Terms or DPA
   text changes.
4. **For the record: item 26's own confirmation.** Item 26 still reads *"Owner to confirm before the
   production deploy and OTA … specifically the lead-visible, lead-authorable note in (c)"* (HEAD
   :2086-2088). The server deployed on 2026-10-03, and nothing in the record says that confirmation
   was given. §I.2's status stamp records where it stands either way: if you tell the build it was
   given, the date (and, if that was after 2026-10-03, that it came after the server deploy);
   otherwise, that it was due before the production deploy and OTA, was not on record when the server
   deployed on 2026-10-03, and is still owed before the production OTA. Approving this plan, or §I.3's
   stamp, is not that confirmation.

**Before the build starts,** the investigation's docs patch is committed (§J.3). *(As built: it was
not committed first; it rides in this change's commit, as §J.3 allows, §N.)*

## N. As built (2026-10-03)

Built 2026-10-03 from this plan as the owner approved it. A review then read the change three ways
(the code, its words, and its fidelity to this plan), a skeptic re-checked every finding, and the fixes
were folded in on 2026-10-05. The bullets below describe the tree with them, uncommitted at time of
writing. Where the build differs from the text above, the code wins and this section says how; where
the text above uses a name or a count that did not ship, read it as the shipped one. Everything else
above is the plan as approved.

**The answers to §M.** A1's *Yes* branch shipped: §E.6 and §G.5, H.2 item 15's *(A1:)* sentence, H.4
item 23's A1 sentence, H.8 item 32's main text and the drawer's *"save, then use Duplicate…"* heads-up,
with `faq/how-many-doors-a-day.md` untouched, so the change is 28 files (§J.4). R1's reading shipped as
written. Both privacy confirmations are recorded (below). The investigation's docs patch was not
committed first: it rides in this change's commit, §J.3's alternative, and the hand-off says so.

**Fixed after the review (2026-10-05)**

1. **A failed save speaks only for the survey it was sent for.** Both builder pages handed `SurveyForm`
   their mutation's last error whatever survey was on the form, and §D.5's lock read it. The campaign
   builder outlives a change of the attached survey: Duplicate swaps it in place, and the sidebar's
   campaign switcher keeps `/survey/edit` (`Layout.jsx` :273) under one `<Route>` element (`App.jsx`
   :174), so the page instance and its mutations survive. So a 409 on one campaign's survey locked the
   next campaign's, one with no answers anywhere included: its banner, the type pills, Retire, the Go
   to lock, the Duplicate box and the copy button. That breaks §K.1 (*the client adds a lock only on
   the server's word*) and §D.5 (*it can't lock a survey with no answers*), the owner's false-positive
   rule. Inside the feature, a Save pressed while Duplicate's swap was in flight left the fresh copy
   locked by the original's refusal. The fix is a new helper in `surveyBuilderRules.js`, in a section
   of its own after `savedInGoTo`: `saveErrorFor(mutation, surveyId)` returns the mutation's error only
   when its `variables.id` is the survey on the form (query-core 5.100.6 keeps the variables in the
   mutation's state, `build/modern/mutation.js` :226, which `useMutation`'s result spreads). The
   campaign builder computes `saveError` with it and §E.2 item 6's `refusedForResponses` from that,
   and passes `copyError` only with that refusal; the org editor passes `copyError` only with a failed
   save of its own survey. No in-app link changes the org editor's `:surveyId` in place, so there it is
   hardening. G.3 gains a test for the helper.
2. **Duplicate and the two saves never run together, and Duplicate holds through the swap.** §E.2
   item 3 reset `update` and `copy` as soon as the attach landed and fired the two refetches without
   waiting, and nothing kept Duplicate from running beside a save or a copy (D4 disabled only Save and
   the copy button against each other). So Duplicate pressed while *Save my changes as a copy* ran
   also switched the campaign, and mid-swap the original came back unlocked with Save enabled, where a
   Save put edits on a survey the campaign no longer used. Now `duplicate.onSuccess`, once its attach
   lands, awaits both invalidations and only then resets (if the attach fails, the `catch` refetches
   both lists without waiting, as before). The query core holds the mutation pending until `onSuccess`
   returns (`mutation.js` :123, :144), so the box, its spinner and a new `SurveyForm` prop, `busy`
   (`busy={editing && duplicate.isPending}`), hold until both lists name the copy. `busy` disables both
   footer buttons, which keep their own labels, and the Duplicate button takes
   `disabled={update.isPending || copy.isPending}`. D4's *"it and Save are both disabled while either
   runs"* now covers Duplicate as well, and §E.2 item 6's *"the box and the refusal go once the
   campaign names the copy"* reads *once both lists name the copy*. G.4 case 6 pins `busy`.
3. **A retype and Remove's rule are pure helpers.** G.3's `retype` was a hand copy of
   `QuestionCard.setType`, so a regression in the component's own merge passed every test. In the
   review's mutation runs, spreading what comes back before the two blank answers (the exact undo
   silently lost), or passing `flow: 'script'` for the card's `route.flow` (review round 2's Switch
   back bug back again), left all 59 tests of the four client suites that load these files passing.
   The whole change of type is now `retypedCard(saved, card, toType, route, blankAnswers)`, beside
   `restoredOnRetype`; `setType` passes the card's `route` and a function that mints the two blank
   answers. Remove's rule, read at both of `removeQuestion`'s places, is
   `retiresOnRemove(locked, savedBlocks, key)`. Nothing behaves differently. G.3's `retype` now calls
   `retypedCard`, and its `routeAt` hands it `routeFor`'s `{ value, label }` targets. Run against
   scratch copies, those two mutations made inside `retypedCard` now fail tests, and so do six more:
   its targets passed as objects, a *Free text* question's own route kept on a choice type,
   `retiresOnRemove` retiring every keyed block, `saveErrorFor` ignoring the id, and `busy` dropped
   from either footer button. What still passes them is the page wiring a render can't drive: a page
   that stops calling a helper, or stops passing `busy`. §L.3 checks that by hand, and the review
   checked it in a DOM (below).

So §E.1's *eight helpers* are eleven (`saveErrorFor`, `retypedCard` and `retiresOnRemove` join
them), and `surveyBuilderRules.test.js` has 47 tests, not G.3's 44.

**Smaller differences**

- *Code comments.* The campaign builder's comment above `SurveyForm` says *"the `copy` mutation
  above"* for §E.2 item 5's *"(item 2)"*, and now also says the three actions never run together; the
  drawer's empty-choice comment drops §E.5 item 2's *"(item 5)"*; the drawer's `submit` carries a
  two-line comment §E.6 doesn't show; and the rules file's new section dividers are 99 columns wide,
  the file's width, where §E.1 shows 101.
- *What the drawer test sends.* `campaignGoal.int.test.js` says it sends *"a body shaped like the
  drawer's"*, not §G.5's *"exactly what a lead's Save sends"*: the test builds the body by hand, and
  only `campaignPatchFor` is the drawer's own. `campaignPatch.test.js`'s comments and CAMPAIGNS.md's
  Part 2 sentence (H.4 item 23, *"the drawer's real body"*) say the same.
- *Tests beyond the plan.* `campaignPatch.test.js` has three tests where §G.5 describes one: the
  lead's body, a field set to null or left out, and an admin's whole form. The render smoke test
  asserts a little more than §G.4 lists: case 3 checks that every type pill stays pickable, case 7
  mounts a second observer on `['surveys']` (`Probe`) to show the offline refetch reads `paused` with
  `isFetching` false, and case 6 pins `busy` (fix 2). Its header now names the helpers that pin the
  click paths.
- *SURVEYS.md table cell.* The `GET /admin/surveys` row writes `(counts.get(id) \|\| 0) > 0`, escaping
  the pipes so the table holds (H.2 item 7 quotes them bare).
- *Wrapping.* Several docs and Help passages wrap differently from the text quoted in §H; the words
  are the quoted ones except as listed here.
- *"Beyond their campaigns."* ROLES.md Part 1 (H.3 item 18) and `guides/roles-and-team.md` (H.8 item
  31) say the two facts *"do reach a lead"* and *"do reach them"*, without *"from beyond their
  campaigns"*: the answers can be the lead's own campaign's older records with no campaign, so the
  phrase failed §L.1 item 6's rule. The lead-facing `lead-getting-started.md` already read *"do reach
  you"*.
- *The swap warning.* SURVEYS.md Part 1 (H.1 item 4) and CAMPAIGNS.md Part 1 (H.4 item 22) say that
  for a team lead the warning *"counts only the responses in their own campaigns, and shows only when
  there are some"*: D7's count gate, said out loud (§K.4 item 5).
- *SURVEYS.md Part 2.* Its rows also name `saveErrorFor`, `retypedCard`, `retiresOnRemove`, `busy`
  and the held swap (H.2 items 11, 12 and 14), its test rows read (47) and pin the new helpers and
  `busy` (items 16 and 17), and the two-blocks callout (item 9) says the refusal that locks is that
  survey's own.
- *The privacy record.* Stamp 1 (§I.2) does not use the same-day form *"…was given on 2026-10-03."*
  It says the confirmation was due before the production deploy and OTA, and was given on 2026-10-03
  with this plan's approval, *"after that day's server deploy, which went ahead without it on
  record"*. §I.2 added an *after the server deploy* clause only for a later date, which left item 26's
  gate reading as met. The session record has the owner reporting the deploy at 11:35 and confirming
  at 22:09, local time, both on 2026-10-03. Stamp 2's lead (§I.3) says the 2026-08-08 scoping
  *"appears here only as (c)'s parenthesis on who reads template text"*, not *"was not recorded
  here"*: (c) already says a lead's library is scoped. Both edits are inside this change's two hunks;
  the other session's are untouched. Stamp 1 is now six lines, so the hand-off's patch differs from
  §I.4's rehearsal in line counts only.
- *README.* This plan's row (H.7 item 29) also points at this section.
- *The hand-off's base.* §I.4 took it that if the other session committed first, its item-25 anchor
  refresh would reach HEAD with it. That session committed first (23a4e0b and 1da8062, 2026-10-05)
  without it, so those five lines stay uncommitted above item 26, still its own. The patch is made
  against 1da8062 from HEAD's blob plus this change's two stamps (§I.4), so it leaves them out.

**What §L.1 ran**

- *At the build (2026-10-03), on the working tree:* step 1 with A1's suite (`teamLead.int.test.js`
  21, `surveys.int.test.js` 7, `surveyBlocks.int.test.js` 30, `leadWalkthrough.int.test.js` 14,
  `campaignGoal.int.test.js` 13, all passing); step 2 (server unit 441, client unit 514, mobile 164,
  the web build); step 4 (`npm run audit:mobile-api`, §J.5's single `surveys.js` line).
- *After the review's fixes (2026-10-05), on the working tree:* step 2 again (server unit 441, client
  unit 517 with G.3's three new tests, mobile 164, the web build); step 4, the same single line; and
  step 3, the full marathon (`npm --prefix server run test:int` from the repo root): 117 suites and
  1,317 tests, all passing, the five above with the same counts among them.
- *Not run by the build:* step 5, the frozen tree, which is the hand-off's (§J.4) and comes after this
  section was written; the hand-off reports it. §L.3 is the owner's, after the deploy.

**Checked in a DOM, for the review.** The real `CampaignSurveyBuilderPage` and `SurveyEditorPage`,
under a router and a query client in jsdom (read from another project's installed copy, in the
session's scratch folder; nothing was added to the repo), against a fake `fetch`, before and after the
fixes:

- *A refusal, then the campaign switcher.* After a 409 on campaign A's survey, campaign C's survey,
  which has no answers anywhere, showed the banner, A's refusal, the Duplicate box, the copy button,
  two Retire and locked type pills; after the fix, none of it, every pill pickable. Back on A, A's own
  refusal and lock show again: a refusal stands until the next save attempt.
- *Duplicate after a refusal, both lists slow to refetch.* Before: mid-swap the original showed
  unlocked with Save enabled, a second Save went out, and the copy opened locked by the original's
  refusal. After: mid-swap the original stays locked with Save and Duplicate disabled, no second Save
  goes out, and the copy opens unlocked with Save enabled.
- *Save my changes as a copy in flight, then Duplicate.* Before: Duplicate was enabled, and pressing it
  switched the campaign to its duplicate. After: Duplicate is disabled and the campaign keeps its
  survey.
- *A survey's own refusal* still locks it, before and after: the banner, the refusal, the Duplicate
  box, the copy button, Retire on its two saved questions, and on each of them only the pill of the
  type it was saved with.
- *The org editor*, refused on one survey and then shown another: before, the second was locked;
  after, it isn't.

**Fixed at the owner's request (2026-10-05): a campaign switch mid-request.** Recorded here first as a
known gap, and older than this change (HEAD's Duplicate, create and Save have it; `copy` is new here):
press **Duplicate** on one campaign's Edit survey page, switch campaigns with the sidebar's switcher
before the copy's `POST` returns, and the copy was attached to the campaign switched to, replacing its
survey, which drops the surveys still queued on that campaign's phones (D4's harm). The query core
pushes each render's options into a pending mutation (`build/modern/mutationObserver.js` :34-35, the
mechanism §E.2 item 2 gives for `copy`), so every `onSuccess` on the page read the campaign switched
to: `create` also looked up that campaign's main survey and could attach the new one there, and
`create`, `copy` and `update` navigated there. Now each mutation carries the campaign it was started on
in its variables (`duplicate.mutate({ id, campaignId })`, and `{ body, campaignId }` or
`{ id, body, campaignId }` for the other three), and its `onSuccess` goes by that campaign: Duplicate
and `create` attach there (`create` after looking up that campaign's main survey), and the page
navigates, or Duplicate resets `update` and `copy`, only while it is still on that campaign
(`stillOn`). `stillOn` reads a render-assigned ref, not the `campaignId` an `onSuccess` closes over,
because `create` and Duplicate await their attach first and a switch during that wait would slip past
it. Moved on, the write still lands on the campaign the action started on and the page stays where the
user went; until a Duplicate started elsewhere finishes, the Edit survey page they went to still shows
its box spinning and holds its saves, as before (`duplicate.isPending` is the page's); a campaign with
no survey opens Create survey instead, with no box and Save live, and a survey created there attaches
to that campaign beside the Duplicate. Leaving the builder for another page from that campaign is not a
switch: as before the fix, a create, a Save or a copy that lands afterwards still opens its Survey tab,
because the ref keeps the campaign the page was last on. Checked in jsdom, as above, with each request
held pending while the switcher moved the page from A to C. Before: A's copy went to C; a survey
created on A became C's main survey (or A was left without its main); Save, Save my changes as a copy
and create each landed on C's Survey tab. After: each attach went to A (none where A had its main
survey) and the page stayed on C, a switch during the attach included (with a render-read `campaignId`
in place of the ref, create still sent the user from C back to A's Survey tab). Switched instead to a
campaign that runs no survey, the page opened its Create survey, with no box and Save live mid-swap,
before and after; a survey saved there now went to that campaign and A got the copy, where before A's
copy replaced it and A kept the original. Left for another page mid-request, create, Save and Save my
changes as a copy each landed on A's Survey tab, before and after. With no switch, all four behave as
before, and the review's DOM checks above give the same results. With it, client unit (517, the render
smoke test's 10 among them) and the web build pass again; no other code changed. §L.3 step 18 checks it
by hand.

**Fixed at the owner's request (2026-10-05): Change survey on the Survey tab, paused offline.** Found
by the review of that fix on 2026-10-05. At HEAD the Survey tab's `attach` builds its `PATCH` address
from the render's `campaignId` inside its `mutationFn` (`CampaignSurveyPage.jsx` HEAD :101-103), and the query core reads `this.options.mutationFn` only
when the request runs (`build/modern/mutation.js` :70-74). Offline, the request waits (`retryer.js`
:118-123) and runs when the connection returns (`queryClient.js` :42-44), with the options the latest
render pushed into it (the mechanism above). So: offline on A, press **Change survey**, pick a survey
and press **Attach survey** (nothing is sent), press **Cancel** (it stays enabled while the request
waits, `CampaignSurveyPage.jsx` :68), switch to C with the sidebar's switcher (`/survey` is one
`<Route>`, `App.jsx` :169), and come back online: the survey is attached to C, replacing its survey,
with D4's harm. Reproduced in jsdom on this tree before the edit:
`PATCH /api/admin/campaigns/c2 {"surveyTemplateId":"s3"}`. Online it can't happen: mutations keep no
retry and the default network mode (`main.jsx` sets defaults for queries only), so the address is fixed
when the request starts. `setOverride` builds its address the same way, but a stale one gets a 404, not
a wrong write (`loadEffort` looks the walk list up under the address's campaign,
`server/src/routes/admin/efforts.js` :81). The fix is the one above:
`attach.mutate({ campaignId, surveyTemplateId })` with the address built from the variables, the same
for `setOverride`, whose `onSuccess` then invalidates `['admin', 'efforts', vars.campaignId]`. The
owner asked for it in the same commit, so it ships here (`CampaignSurveyPage.jsx` :104-130): both
writes build their address from their variables, and `setOverride` invalidates the campaign it wrote.
The builder's four `mutationFn`s already take everything from their variables, so a request paused
there goes where it was started, and both pages' comments say to keep them that way. Re-run after the
edit: the client suite and the render smoke test, the web build, and the jsdom repro, which now sends
the `PATCH` to A.
