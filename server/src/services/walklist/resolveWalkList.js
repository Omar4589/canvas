import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { getPassStatusMap } from '../passes/passStatus.js';

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

// Resolve a walk-list filter into a frozen { householdIds, voterIds, counts }.
// Each predicate becomes a household set; sets are intersected (and) or unioned
// (or). Targeted voters = those matching the voter-demographic predicate within
// the final households (or everyone there if no voter predicate).
export async function resolveWalkList(campaign, filter = {}) {
  const campaignId = campaign._id;
  const orgId = campaign.organizationId;

  const baseHouseholds = await Household.find(
    { campaignId, isActive: true, 'location.coordinates': { $exists: true, $ne: null } },
    { _id: 1 }
  ).lean();
  const baseIds = baseHouseholds.map((h) => String(h._id));
  const baseSet = new Set(baseIds);
  if (!baseSet.size) return { householdIds: [], voterIds: [], householdCount: 0, voterCount: 0 };
  const baseOids = baseIds.map(oid);

  const predicateSets = [];

  const vq = voterDemographicQuery(filter);
  if (vq) {
    const hids = await Voter.distinct('householdId', { organizationId: orgId, householdId: { $in: baseOids }, ...vq });
    predicateSets.push(new Set(hids.map(String)));
  }

  const hq = householdDemographicQuery(filter);
  if (hq) {
    const hs = await Household.find({ campaignId, _id: { $in: baseOids }, ...hq }, { _id: 1 }).lean();
    predicateSets.push(new Set(hs.map((h) => String(h._id))));
  }

  if (arr(filter.priorPassStatuses) && filter.priorPassId) {
    const statusMap = await getPassStatusMap(filter.priorPassId, baseIds, campaign.type);
    const wanted = new Set(filter.priorPassStatuses);
    const s = new Set();
    for (const id of baseIds) if (wanted.has(statusMap.get(id)?.status || 'unknocked')) s.add(id);
    predicateSets.push(s);
  }

  if (filter.surveyResponse && filter.surveyResponse !== 'any') {
    const srMatch = { campaignId };
    if (filter.priorPassId) srMatch.passId = oid(filter.priorPassId);
    const withSurvey = new Set((await SurveyResponse.distinct('householdId', srMatch)).map(String));
    const s = new Set();
    for (const id of baseIds) {
      const has = withSurvey.has(id);
      if ((filter.surveyResponse === 'exists' && has) || (filter.surveyResponse === 'not_exists' && !has)) s.add(id);
    }
    predicateSets.push(s);
  }

  if (arr(filter.answerFilters)) {
    for (const af of filter.answerFilters) {
      if (!af.questionKey || !arr(af.values)) continue;
      const srMatch = {
        campaignId,
        answers: { $elemMatch: { questionKey: af.questionKey, answer: { $in: af.values } } },
      };
      if (filter.priorPassId) srMatch.passId = oid(filter.priorPassId);
      predicateSets.push(new Set((await SurveyResponse.distinct('householdId', srMatch)).map(String)));
    }
  }

  let finalSet;
  if (!predicateSets.length) {
    finalSet = baseSet;
  } else if ((filter.combine || 'and') === 'or') {
    finalSet = new Set();
    for (const s of predicateSets) for (const id of s) if (baseSet.has(id)) finalSet.add(id);
  } else {
    finalSet = predicateSets.reduce(
      (acc, s) => new Set([...acc].filter((id) => s.has(id))),
      new Set(baseSet)
    );
  }

  const householdIds = [...finalSet];
  const voterQuery = { organizationId: orgId, householdId: { $in: householdIds.map(oid) } };
  if (vq) Object.assign(voterQuery, vq);
  const voters = await Voter.find(voterQuery, { _id: 1 }).lean();
  const voterIds = voters.map((v) => v._id);

  return {
    householdIds: householdIds.map(oid),
    voterIds,
    householdCount: householdIds.length,
    voterCount: voterIds.length,
  };
}
