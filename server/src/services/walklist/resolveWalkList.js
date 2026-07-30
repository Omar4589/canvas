import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { getPassStatusMap } from '../passes/passStatus.js';
import { answerFilterClause, answerTagClause } from '../surveys/answerAgg.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const arr = (a) => (Array.isArray(a) && a.length ? a : null);

function voterDemographicQuery(filter) {
  const q = {};
  if (arr(filter.genders)) q.gender = { $in: filter.genders };
  if (arr(filter.parties)) q.party = { $in: filter.parties };
  if (arr(filter.precincts)) q.precinct = { $in: filter.precincts };
  if (arr(filter.congressionalDistricts)) q.congressionalDistrict = { $in: filter.congressionalDistricts };
  if (arr(filter.stateSenateDistricts)) q.stateSenateDistrict = { $in: filter.stateSenateDistricts };
  if (arr(filter.stateHouseDistricts)) q.stateHouseDistrict = { $in: filter.stateHouseDistricts };
  if (filter.ageMin != null || filter.ageMax != null) {
    const now = new Date();
    const dob = {};
    if (filter.ageMin != null) dob.$lte = new Date(now.getFullYear() - filter.ageMin, now.getMonth(), now.getDate());
    if (filter.ageMax != null) dob.$gt = new Date(now.getFullYear() - filter.ageMax - 1, now.getMonth(), now.getDate());
    q.dateOfBirth = dob;
  }
  return Object.keys(q).length ? q : null;
}

function householdDemographicQuery(filter) {
  const q = {};
  if (arr(filter.cities)) q.cityValue = { $in: filter.cities };
  if (arr(filter.zips)) q.zipValue = { $in: filter.zips };
  if (arr(filter.counties)) q.countyValue = { $in: filter.counties };
  return Object.keys(q).length ? q : null;
}

// Is this (sub-)filter asking for anything? `combine` and `priorPassId` are modifiers,
// not predicates — a filter carrying only those is inactive (today `{ priorPassId }` alone
// would resolve the full universe and persist a junk Pass.targetFilter). `exclude` is
// active only if the NOT side itself has predicates, so `{ exclude: {} }` can never flip
// a cut into targeted mode, while an exclude-ONLY filter (no includes) IS active.
// Shared by the resolver, generateTurf's targeted gate, and mirrored by the client's
// targetActive check.
export function isActiveTargetFilter(f) {
  return (
    !!f &&
    typeof f === 'object' &&
    Object.entries(f).some(([k, v]) => {
      if (k === 'combine' || k === 'priorPassId') return false;
      if (k === 'exclude') return isActiveTargetFilter(v);
      if (Array.isArray(v)) return v.length > 0;
      return v != null && v !== '' && v !== 'any';
    })
  );
}

// One side's predicate blocks (include or exclude) → { sets, vq, warnings }.
//   sets     — one Set<householdId string> per predicate that RAN. A predicate that ran
//              but matched nothing pushes an EMPTY set; one that could not run (invalid
//              entry, tag filters without a template) pushes NOTHING and records a
//              warning. The distinction drives the degenerate-exclude guard below.
//   vq       — this side's voter-demographic query. The CALLER decides whether it
//              reaches the final voter query (include side: yes; exclude side: never).
//   warnings — human-readable notes on predicates requested but dropped, surfaced by
//              the preview endpoints.
// Reads `f.priorPassId` from THIS side's sub-filter only — the exclude side never
// inherits the include side's round scoping.
async function collectPredicateSets(campaign, f, ctx) {
  const { campaignId, orgId, baseIds, baseOids, template } = ctx;
  const sets = [];
  const warnings = [];

  const vq = voterDemographicQuery(f);
  if (vq) {
    const hids = await Voter.distinct('householdId', { organizationId: orgId, householdId: { $in: baseOids }, ...vq });
    sets.push(new Set(hids.map(String)));
  }

  const hq = householdDemographicQuery(f);
  if (hq) {
    const hs = await Household.find({ campaignId, _id: { $in: baseOids }, ...hq }, { _id: 1 }).lean();
    sets.push(new Set(hs.map((h) => String(h._id))));
  }

  if (arr(f.priorPassStatuses)) {
    const wanted = new Set(f.priorPassStatuses);
    const s = new Set();
    if (f.priorPassId) {
      // Status WITHIN a specific prior round.
      const statusMap = await getPassStatusMap(f.priorPassId, baseIds, campaign.type);
      for (const id of baseIds) if (wanted.has(statusMap.get(id)?.status || 'unknocked')) s.add(id);
    } else {
      // No round chosen → the door's current/global status (fixes "unknocked"
      // returning everything when no prior pass was picked).
      const hs = await Household.find(
        { campaignId, _id: { $in: baseOids }, status: { $in: [...wanted] } },
        { _id: 1 }
      ).lean();
      for (const h of hs) s.add(String(h._id));
    }
    sets.push(s);
  }

  if (f.surveyResponse && f.surveyResponse !== 'any') {
    // Deliberately NOT template-scoped: "has a response" means any response — scoping
    // it would change semantics for campaigns that switched templates mid-flight.
    const srMatch = { campaignId };
    if (f.priorPassId) srMatch.passId = oid(f.priorPassId);
    const withSurvey = new Set((await SurveyResponse.distinct('householdId', srMatch)).map(String));
    const s = new Set();
    for (const id of baseIds) {
      const has = withSurvey.has(id);
      if ((f.surveyResponse === 'exists' && has) || (f.surveyResponse === 'not_exists' && !has)) s.add(id);
    }
    sets.push(s);
  }

  if (arr(f.answerFilters)) {
    for (const af of f.answerFilters) {
      if (!af.questionKey || !arr(af.values)) {
        warnings.push(
          af.questionKey
            ? `answer filter ignored: no options selected for "${af.questionKey}"`
            : 'answer filter ignored: no question chosen'
        );
        continue;
      }
      const srMatch = {
        campaignId,
        ...answerFilterClause(af.questionKey, af.values, af.texts),
      };
      // Template-scoped, matching the map/report endpoints — the same questionKey
      // under a DIFFERENT template (an effort's survey override) no longer cross-matches.
      if (template) srMatch.surveyTemplateId = template._id;
      if (f.priorPassId) srMatch.passId = oid(f.priorPassId);
      sets.push(new Set((await SurveyResponse.distinct('householdId', srMatch)).map(String)));
    }
  }

  // Tag predicate: each tag becomes ONE set of households whose response carries ANY
  // option with that tag (across questions) — a cross-question OR that the per-question
  // answerFilters can't express under the global combine.
  if (arr(f.answerTagFilters)) {
    if (!template) {
      warnings.push('tag filters ignored: campaign has no survey template');
    } else {
      for (const tf of f.answerTagFilters) {
        if (!tf.tag) continue;
        const srMatch = { campaignId, surveyTemplateId: template._id, ...answerTagClause(template, tf.tag) };
        if (f.priorPassId) srMatch.passId = oid(f.priorPassId);
        sets.push(new Set((await SurveyResponse.distinct('householdId', srMatch)).map(String)));
      }
    }
  }

  return { sets, vq, warnings };
}

// Resolve a walk-list filter into a frozen { householdIds, voterIds, counts }.
// Each include predicate becomes a household set; sets are intersected (and) or unioned
// (or). Then `filter.exclude` — the NOT branch — resolves through the same predicate
// machinery, its sets are UNIONED (excludes always OR among themselves), and the union
// is subtracted unconditionally: `combine` never touches it, and nothing can bring an
// excluded door back. Targeted voters = those matching the include side's
// voter-demographic predicate within the final households (or everyone there if none).
export async function resolveWalkList(campaign, filter = {}, options = {}) {
  const campaignId = campaign._id;
  const orgId = campaign.organizationId;

  // options.effortId scopes the whole resolution to one effort's doors (used by
  // targeted follow-up cuts) — every predicate runs within this base set.
  const baseMatch = { campaignId, isActive: true, 'location.coordinates': { $exists: true, $ne: null } };
  if (options.effortId) baseMatch.effortId = oid(options.effortId);
  const baseHouseholds = await Household.find(baseMatch, { _id: 1 }).lean();
  const baseIds = baseHouseholds.map((h) => String(h._id));
  const baseSet = new Set(baseIds);
  if (!baseSet.size) {
    return {
      householdIds: [],
      voterIds: [],
      householdCount: 0,
      voterCount: 0,
      excludedHouseholdIds: [],
      excludedDoorCount: 0,
      excludeDegenerate: false,
      warnings: [],
    };
  }
  const baseOids = baseIds.map(oid);

  // Loaded once, shared by both sides: the tag predicate needs the template's option
  // map, and the answer predicate scopes to it.
  const template = campaign.surveyTemplateId
    ? await SurveyTemplate.findById(campaign.surveyTemplateId).lean()
    : null;
  const ctx = { campaignId, orgId, baseIds, baseOids, template };

  const inc = await collectPredicateSets(campaign, filter, ctx);
  const warnings = [...inc.warnings];

  let finalSet;
  if (!inc.sets.length) {
    // A COPY, never `finalSet = baseSet`: the exclude subtraction below deletes from
    // finalSet in place, and an alias would silently mutate baseSet. This is the exact
    // branch an exclude-only filter takes.
    finalSet = new Set(baseSet);
  } else if ((filter.combine || 'and') === 'or') {
    finalSet = new Set();
    for (const s of inc.sets) for (const id of s) if (baseSet.has(id)) finalSet.add(id);
  } else {
    finalSet = inc.sets.reduce(
      (acc, s) => new Set([...acc].filter((id) => s.has(id))),
      new Set(baseSet)
    );
  }

  // The NOT branch. Structurally safe against the empty-set inversion: exclude sets are
  // pure union, and the union of zero sets is EMPTY — zero exclude predicates excludes
  // nothing, never everything. The residual risk is the opposite (the admin ASKED to
  // exclude but every predicate degenerated — invalid entries, tag filters without a
  // template); excluding nothing is the safe direction, but it must not be silent, so
  // `excludeDegenerate` is set for generateTurf to refuse on and previews to surface.
  const excludedSet = new Set();
  let excludeDegenerate = false;
  if (isActiveTargetFilter(filter.exclude)) {
    const exc = await collectPredicateSets(campaign, filter.exclude, ctx);
    warnings.push(...exc.warnings);
    // Set.delete returns true only when the id was present, so excludedSet is EXACTLY
    // the doors removed from the result (∩ the include result) — the honest "M excluded"
    // the preview shows, not the raw exclusion population.
    for (const s of exc.sets) for (const id of s) if (finalSet.delete(id)) excludedSet.add(id);
    excludeDegenerate = exc.sets.length === 0;
    // exc.vq deliberately dropped: exclude-side demographics only pick doors to remove;
    // they must never constrain the include side's final voter query.
  }

  const householdIds = [...finalSet];
  const voterQuery = { organizationId: orgId, householdId: { $in: householdIds.map(oid) } };
  if (inc.vq) Object.assign(voterQuery, inc.vq);
  // Always-on, not a filter option: do-not-contact voters never enter a walk list's voter set.
  // The DOOR stays (a non-flagged housemate keeps it targetable) — only the flagged individual
  // drops. Applied here, after vq, so no filter combination can override it.
  voterQuery['doNotContact.flagged'] = { $ne: true };
  const voters = await Voter.find(voterQuery, { _id: 1 }).lean();
  const voterIds = voters.map((v) => v._id);

  return {
    householdIds: householdIds.map(oid),
    voterIds,
    householdCount: householdIds.length,
    voterCount: voterIds.length,
    // NOT-branch bookkeeping — additive; existing callers destructure and ignore these.
    excludedHouseholdIds: [...excludedSet].map(oid),
    excludedDoorCount: excludedSet.size,
    excludeDegenerate,
    warnings,
  };
}
