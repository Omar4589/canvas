# Proposal: Parallel efforts within a campaign

> **Status: BUILT (superseded by [EFFORTS.md](EFFORTS.md)).** This proposal has been implemented —
> as **Full Model B** (a first-class `Effort` entity) with **explicit door ownership + Intake**. See
> [EFFORTS.md](EFFORTS.md) for the as-built reference and [IMPORTS.md](IMPORTS.md) for Intake. This
> file is kept for the design rationale and the options that were considered.

Related: [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (current model), [METRICS.md](METRICS.md) (how
knocks/coverage count), [SURVEYS.md](SURVEYS.md) (survey-per-campaign today).

---

# Part 1 — The problem

A campaign often needs **several canvassing efforts running at the same time**, each managed
independently:

- **Different teams, different areas** — a volunteer crew works one area while a paid crew works
  another, simultaneously.
- **Geographic segments** — North / East / West / South of a city, each cut and assigned as its own
  unit, possibly on its own schedule.
- **Different surveys per area** — e.g. North runs survey A, South runs survey B, within one
  campaign.

### Why "split books inside one pass" isn't enough

You *can* assign different books of one pass to different crews today. But:

- Cutting one big pass yields many books that must be **hand-assigned** to the right crew, and border
  doors land in the "wrong" area's book, forcing **manual move-door cleanup**.
- The whole pass shares **one survey** ([`Campaign.surveyTemplateId`](../server/src/models/Campaign.js)).
- **Recut is whole-pass** — you can't re-cut just North without disturbing South.
- **A round is the whole campaign** — North can't advance to Round 2 while South is still on Round 1.

So efforts want to be a **first-class unit** that's cut, surveyed, assigned, and advanced on its own.

### Locked decisions

- **[locked] Efforts are door-disjoint within a campaign** — every household belongs to at most one
  active effort at a time. (Volunteers and paid never knock the same doors simultaneously.)
- **[locked] Same doors worked by two efforts at once ⇒ that's two campaigns**, not two efforts in
  one campaign. (E.g. an org canvassing the same people for two different clients.)
- **[locked] Build order:** the survey guardrails and "add new voters to the live pass as a
  supplemental book" ship first; this efforts model is the next effort.

---

# Part 2 — Design options

## Recommended — Model A: efforts = concurrent, door-disjoint passes

Generalize the existing **Pass** rather than add a new concept:

- **Allow multiple active passes per campaign**, with the invariant that their household sets are
  disjoint. "North Dallas" and "South Dallas" are each a pass; both can be `active`.
- **Optional per-pass survey override**: add `Pass.surveyTemplateId` (nullable) that falls back to
  `Campaign.surveyTemplateId`. North-pass → survey A, South-pass → survey B.
- **Attribution by book→pass, not by time.** Today a knock's `passId` is resolved from the
  `activatedAt` half-open time window — which is ambiguous if two passes are active at once. Switch
  to deterministic resolution: a household is in exactly one active pass's books, so
  `household → turfId → passId` gives the pass directly (and removes the offline-overlap edge cases).

**What changes:**

| Area | Change |
|---|---|
| `Pass` model | Drop the single-active assumption; add `surveyTemplateId?`. |
| `Campaign.activePassId` | Becomes a set (or is derived from `Pass.status === 'active'`). |
| Activation ([passes.js:115](../server/src/routes/admin/passes.js#L115)) | Stop auto-archiving other active passes; instead enforce **household disjointness** at activation. |
| Mobile bootstrap ([bootstrap.js:51](../server/src/routes/mobile/bootstrap.js#L51)) | Union the canvasser's `TurfAssignment`s across **all** active passes, not just one `activePassId`. |
| Pass attribution ([canvass.js](../server/src/routes/mobile/canvass.js)) | Resolve a knock's pass from the household's book, not the time window. |
| Survey resolution | Submit/validation reads the **pass's** survey (override → campaign default). |
| Metrics ([reports.js](../server/src/routes/admin/reports.js)) | Totals still sum across passes (unchanged); add **per-effort** (per-pass) report scoping. |
| Admin UI | Passes page shows multiple concurrent actives; turf cutting is naturally per-pass already. |

**Rounds over time** stay as new passes: "North Round 2" is a new pass after North Round 1 archives.
Per-effort identity (grouping North R1 + North R2) is informal (name / walk-list) under this model.

## Alternative — Model B: a first-class "Effort" (a.k.a. Segment)

Introduce an `Effort` entity that **owns a household subset + a survey**, and let **passes (rounds)
belong to an effort**:

```
Campaign
  └─ Effort (North Dallas; owns its voter subset + survey)
       └─ Pass (Round 1, Round 2, … within North)
            └─ Book → Households
```

- Cleaner per-effort **rounds** and **reporting** (group all of North's passes under "North").
- Survey lives on the Effort.
- Bigger build: new model, new UI layer, migration of existing campaigns into a default Effort.

## Comparison

| | Model A (concurrent passes) | Model B (Effort entity) |
|---|---|---|
| New concepts | none (reuses Pass) | `Effort` |
| Per-area survey | `Pass.surveyTemplateId?` | `Effort.surveyTemplateId` |
| Per-area rounds | new pass each round (informal grouping) | first-class (passes under an effort) |
| Per-effort reporting | filter by pass(es) | native |
| Build size | medium | large |
| Migration | light (existing single pass already fits) | heavier (wrap existing passes in a default effort) |

**Recommendation:** start with **Model A** — it solves all three locked scenarios with the smallest
change and no new vocabulary; revisit Model B only if per-effort *rounds + rollups* become a real
need.

---

# Part 3 — Open questions (resolve before building)

1. **Enforce disjointness how?** Validate at pass activation (reject overlap), or partition by
   requiring each concurrent pass to be bound to a non-overlapping **walk list**?
2. **Per-effort reporting scope** — what exactly does the dashboard show per effort, and does the
   org/campaign rollup stay a simple sum across passes?
3. **Round semantics under Model A** — when North advances to Round 2, what carries over (assignments,
   walk list, survey override)?
4. **UI naming** — surface these as "passes," or rename to "efforts" in the admin UI while keeping
   `Pass` in the schema?
5. **Migration** — existing single-active-pass campaigns: anything to backfill, or does the relaxed
   model subsume them as-is?
6. **Coverage semantics** — coverage is campaign-wide today; do we also want per-effort coverage
   bars, and how do fully-voted doors interact across efforts?

When these are answered, this proposal graduates into the main [PASSES_AND_TURF.md](PASSES_AND_TURF.md).
