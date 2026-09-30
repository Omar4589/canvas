import Papa from 'papaparse';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Campaign } from '../../models/Campaign.js';
import { suggestMapping } from './canonicalFields.js';
import { looksLegacyXls, LegacyXlsError } from './parseUpload.js';
import { findVotersByVoterIds } from '../voters/voterIdLookup.js';

// IDs in a file that didn't match a voter in this campaign — capped so the response
// stays small; the admin downloads these to fix and re-upload.
export const NOT_FOUND_CAP = 10000;

const SAMPLE_IDS = 3;

// Shared first half: parse the CSV, find the voter-id column, and match the ids within
// `scopeFilter` — voter rows are per-campaign, so the scope decides whether a sibling campaign's
// row counts as a match. Matching ignores leading zeros in both directions (services/voters/
// voterIdLookup.js): the file's spelling and the stored spelling only have to name the same number.
async function parseIdsAndFindVoters(scopeFilter, fileBuffer, idColumn, projection) {
  // A legacy .xls is binary — Papa would read it as text and hand back one garbage
  // column, so the caller's refusal reads "could not detect a Voter ID column"
  // instead of naming the format. Returned as { error } like every other soft
  // failure here, so all six callers 400 with it unchanged. Before any database
  // work, on purpose: the unit suite calls this with no connection at all.
  if (looksLegacyXls(fileBuffer)) return { error: new LegacyXlsError().message, columns: [] };
  const csv = fileBuffer.toString('utf8');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const columns = parsed.meta?.fields || [];
  const col =
    (idColumn && columns.includes(idColumn) && idColumn) ||
    suggestMapping(columns).stateVoterId ||
    columns.find((c) => /voter\s*id/i.test(c)) ||
    null;
  if (!col) return { error: 'Could not detect a Voter ID column — pick one with idColumn.', columns };

  const raw = parsed.data.map((row) => row[col]);
  const lookup = await findVotersByVoterIds({ scopeFilter, ids: raw, projection });
  // What the chosen column holds, so the page can show it next to the column's name.
  const sampleIds = [];
  for (const v of raw) {
    const s = v == null ? '' : String(v).trim();
    if (s && !sampleIds.includes(s)) sampleIds.push(s);
    if (sampleIds.length >= SAMPLE_IDS) break;
  }
  return {
    columns,
    col,
    totalRows: parsed.data.length,
    csvCount: lookup.idsInFile,
    spellings: lookup.spellings,
    noId: lookup.noId,
    voters: lookup.voters,
    hitsByCanonical: lookup.hitsByCanonical,
    notFoundIds: lookup.notFoundIds,
    matchedViaZeros: lookup.matchedViaZeros,
    zeroMatchExample: lookup.zeroMatchExample,
    sampleIds,
  };
}

// Parse the CSV, find the voter-id column, and resolve which of this campaign's
// voters it matches — {campaignId} on the unique index (rows are per-campaign; a
// person housed only in a sibling campaign is notFound here). One campaign is one
// state, so the same digits are always the same person: no cross-state question.
// Shared by early voting (voted.js) and "walk list from CSV" (walklists.js).
export async function parseAndMatch(campaign, fileBuffer, idColumn) {
  const base = await parseIdsAndFindVoters({ campaignId: campaign._id }, fileBuffer, idColumn, { _id: 1, stateVoterId: 1, householdId: 1 });
  if (base.error) return base;
  const { columns, col, totalRows, csvCount, spellings, noId, voters, notFoundIds, matchedViaZeros, zeroMatchExample, sampleIds } = base;
  return {
    columns,
    col,
    totalRows,
    csvCount,
    spellings,
    noId,
    inCampaign: voters,
    notFound: notFoundIds.length,
    notFoundIds,
    matchedViaZeros,
    zeroMatchExample,
    sampleIds,
  };
}

// The do-not-contact variant. The flag is an org-level fact about the voter (routes/admin/dnc.js),
// but the LOOKUP is scoped to ONE STATE's campaigns, because two states can issue the same digits:
// a stripped Georgia 123456 and a genuine Nebraska 123456 are the same bytes, and nothing in the
// file can tell them apart — only the admin knows which state the list came from. Inside that
// state every candidate row is the same person (siblings in different campaigns), so all of them
// flag together. Anything the file names OUTSIDE the state — exactly or by zeros — is reported and
// downloadable, never flagged and never parked: a list is for one state, and a mixed file must be
// split. Archived and mid-deletion campaigns count as in-state (their rows still exist).
// `notFoundIds` here means "no voter row in this state's campaigns" (those become DncPendingIds,
// stamped with the state).
export async function parseAndMatchState(organizationId, state, fileBuffer, idColumn) {
  if (looksLegacyXls(fileBuffer)) return { error: new LegacyXlsError().message, columns: [] };
  const states = (await Campaign.distinct('state', { organizationId })).filter(Boolean).sort();
  const st = String(state || '').trim().toUpperCase();
  if (!st) return { error: 'Pick the state this list is for.', code: 'STATE_REQUIRED', columns: [], states };
  if (!states.includes(st)) return { error: `No campaign in this organization is in ${st}.`, code: 'STATE_UNKNOWN', columns: [], states };

  const campaigns = await Campaign.find({ organizationId }, { _id: 1, state: 1 }).lean();
  const inState = campaigns.filter((c) => c.state === st).map((c) => c._id);
  const stateOf = new Map(campaigns.map((c) => [String(c._id), c.state]));
  const projection = { _id: 1, stateVoterId: 1, householdId: 1, campaignId: 1, 'doNotContact.flagged': 1 };

  const base = await parseIdsAndFindVoters({ organizationId, campaignId: { $in: inState } }, fileBuffer, idColumn, projection);
  if (base.error) return { ...base, states };
  const { columns, col, totalRows, csvCount, spellings, noId, voters, notFoundIds, matchedViaZeros, zeroMatchExample, sampleIds } = base;

  // The same IDs against the whole organization: whatever matched a voter outside this state is
  // reported. An outside-only hit is a second person's number; a hit that is ALSO in-state is the
  // same person housed in another state's campaign — either way the admin should see it.
  const org = await findVotersByVoterIds({
    scopeFilter: { organizationId },
    ids: notFoundIds.concat(voters.map((v) => v.stateVoterId)),
    projection: { _id: 1, campaignId: 1 },
  });
  const outside = [];
  for (const [canonical, hits] of org.hitsByCanonical) {
    const others = hits.filter((h) => stateOf.get(String(h.campaignId)) !== st);
    if (!others.length) continue;
    const fileSpellings = org.rawsByCanonical.get(canonical) || [canonical];
    outside.push({
      id: fileSpellings[0],
      states: [...new Set(others.map((h) => stateOf.get(String(h.campaignId)) || 'unknown'))].sort(),
      exact: others.some((h) => fileSpellings.includes(h.stateVoterId)),
      alsoInState: base.hitsByCanonical.has(canonical),
    });
  }

  return {
    columns,
    col,
    totalRows,
    csvCount,
    spellings,
    noId,
    state: st,
    states,
    matched: voters,
    notFound: notFoundIds.length,
    notFoundIds,
    matchedViaZeros,
    zeroMatchExample,
    sampleIds,
    outsideState: {
      count: outside.length,
      samples: outside.slice(0, 10),
      ids: outside.slice(0, NOT_FOUND_CAP).map((o) => o.id),
    },
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
        { campaignId: campaign._id, householdId: { $in: householdIds } },
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
