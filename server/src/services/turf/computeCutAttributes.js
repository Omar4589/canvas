import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';

// Voter-derived cut columns -> the Voter field they come from. (city/zip/county
// come from the household's own fields, so they work for lit_drop/voter-less
// households too.)
const VOTER_ATTR_COLUMNS = {
  precinctValue: 'precinct',
  congressionalValue: 'congressionalDistrict',
  stateSenateValue: 'stateSenateDistrict',
  stateHouseValue: 'stateHouseDistrict',
};

function modal(values) {
  const counts = new Map();
  for (const v of values) {
    if (v == null || v === '') continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (counts.size === 0) return { value: null, conflict: false };
  let best = null;
  let bestCount = -1;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return { value: best, conflict: counts.size > 1 };
}

// Pure: compute the denormalized cut columns for one household from its voters.
export function computeCutValues(household, voters) {
  const set = {
    cityValue: household.city || null,
    zipValue: household.zipCode ? String(household.zipCode).slice(0, 5) : null,
    countyValue: household.county || null,
  };
  const conflicts = {};
  for (const [col, field] of Object.entries(VOTER_ATTR_COLUMNS)) {
    const { value, conflict } = modal(voters.map((v) => v[field]));
    set[col] = value;
    if (conflict) conflicts[col] = true;
  }
  set.cutConflicts = conflicts;
  return set;
}

// Recompute cut columns for every household in a campaign. Used by the importer
// and the M-b backfill migration. Idempotent + batched.
export async function recomputeCutAttributesForCampaign(campaignId, { batchSize = 2000 } = {}) {
  const households = await Household.find(
    { campaignId },
    { _id: 1, city: 1, zipCode: 1, county: 1 }
  ).lean();
  if (!households.length) return 0;

  const householdIds = households.map((h) => h._id);
  const voterAgg = await Voter.aggregate([
    { $match: { householdId: { $in: householdIds } } },
    {
      $group: {
        _id: '$householdId',
        voters: {
          $push: {
            precinct: '$precinct',
            congressionalDistrict: '$congressionalDistrict',
            stateSenateDistrict: '$stateSenateDistrict',
            stateHouseDistrict: '$stateHouseDistrict',
          },
        },
      },
    },
  ]);
  const votersByHousehold = new Map(voterAgg.map((g) => [String(g._id), g.voters]));

  const ops = households.map((h) => {
    const set = computeCutValues(h, votersByHousehold.get(String(h._id)) || []);
    return { updateOne: { filter: { _id: h._id }, update: { $set: set } } };
  });

  let updated = 0;
  for (let i = 0; i < ops.length; i += batchSize) {
    const r = await Household.bulkWrite(ops.slice(i, i + batchSize), { ordered: false });
    updated += r.modifiedCount || 0;
  }
  return updated;
}
