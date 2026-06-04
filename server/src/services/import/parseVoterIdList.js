import Papa from 'papaparse';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { suggestMapping } from './canonicalFields.js';

// IDs in a file that didn't match a voter in this campaign — capped so the response
// stays small; the admin downloads these to fix and re-upload.
export const NOT_FOUND_CAP = 10000;

// Parse the CSV, find the voter-id column, and resolve which of this campaign's
// voters it matches. Voters are matched org-wide by stateVoterId (indexed) then
// filtered to those living in THIS campaign's households.
// Shared by early voting (voted.js) and "walk list from CSV" (walklists.js).
export async function parseAndMatch(campaign, fileBuffer, idColumn) {
  const csv = fileBuffer.toString('utf8');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const columns = parsed.meta?.fields || [];
  const col =
    (idColumn && columns.includes(idColumn) && idColumn) ||
    suggestMapping(columns).stateVoterId ||
    columns.find((c) => /voter\s*id/i.test(c)) ||
    null;
  if (!col) return { error: 'Could not detect a Voter ID column — pick one with idColumn.', columns };

  const csvIds = new Set();
  for (const row of parsed.data) {
    const raw = row[col];
    if (raw == null) continue;
    const id = String(raw).trim();
    if (id) csvIds.add(id);
  }
  const ids = [...csvIds];
  const voters = ids.length
    ? await Voter.find(
        { organizationId: campaign.organizationId, stateVoterId: { $in: ids } },
        { _id: 1, stateVoterId: 1, householdId: 1 }
      ).lean()
    : [];
  const hhIds = [...new Set(voters.map((v) => String(v.householdId)))];
  const inCampaignHh = new Set(
    (await Household.find({ _id: { $in: hhIds }, campaignId: campaign._id }, { _id: 1 }).lean()).map((h) => String(h._id))
  );
  const inCampaign = voters.filter((v) => inCampaignHh.has(String(v.householdId)));
  const matchedSvids = new Set(inCampaign.map((v) => v.stateVoterId));
  const notFoundIds = ids.filter((id) => !matchedSvids.has(id));
  return {
    columns,
    col,
    totalRows: parsed.data.length,
    csvCount: csvIds.size,
    inCampaign,
    notFound: notFoundIds.length,
    notFoundIds,
  };
}

// Turn the matched voters from parseAndMatch into a frozen walk-list door set.
// A household enters the set if ANY of its matched voters lives there; the set is
// restricted to cuttable (active, coordinate-bearing) doors — uncuttable matches
// are reported via `noCoordinates` so they aren't silently dropped. `voterIds` is
// ALL voters at those doors (whole-door semantics — claiming a door moves every
// voter at it), mirroring resolveWalkList's no-voter-predicate behavior.
export async function resolveHouseholdsFromVoterMatch(campaign, inCampaign) {
  const hhIds = [...new Set(inCampaign.map((v) => String(v.householdId)))];
  if (!hhIds.length) {
    return { householdIds: [], voterIds: [], householdCount: 0, voterCount: 0, noCoordinates: 0, ownership: [] };
  }
  const cuttable = await Household.find(
    {
      _id: { $in: hhIds },
      campaignId: campaign._id,
      isActive: true,
      'location.coordinates': { $exists: true, $ne: null },
    },
    { _id: 1, effortId: 1 }
  ).lean();
  const householdIds = cuttable.map((h) => h._id);
  const voters = householdIds.length
    ? await Voter.find(
        { organizationId: campaign.organizationId, householdId: { $in: householdIds } },
        { _id: 1 }
      ).lean()
    : [];
  return {
    householdIds,
    voterIds: voters.map((v) => v._id),
    householdCount: householdIds.length,
    voterCount: voters.length,
    noCoordinates: hhIds.length - householdIds.length,
    ownership: cuttable, // [{ _id, effortId }] — lets callers bucket intake vs owned with no extra query
  };
}
