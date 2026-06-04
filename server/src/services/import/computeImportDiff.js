import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { normalizeAddress, looseAddressKey } from '../../utils/normalizeAddress.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const SAMPLE_CAP = 100;
const CHUNK = 10000;

// Batched `$in` find — keeps the query doc small on 100k+ row files.
async function findInChunks(Model, field, values, projection, extraFilter = {}) {
  const out = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    if (!slice.length) continue;
    const docs = await Model.find({ ...extraFilter, [field]: { $in: slice } }, projection).lean();
    out.push(...docs);
  }
  return out;
}

/**
 * Read-only forecast of what a CSV import would do to THIS campaign. No writes.
 * Takes the already-parsed { validRows, householdMap, errors, dupSvids } from
 * parseAndValidate. Returns { totals, rowIssues, samples } (sample arrays capped).
 *
 * Scoped to the campaign being imported: a voter currently in another campaign's
 * household is counted as an updated voter but not as a within-campaign move/orphan
 * (cross-campaign door ownership is out of scope here).
 */
export async function computeImportDiff(campaign, { validRows, householdMap, errors = [], dupSvids, totalRows = 0 }) {
  const campaignId = campaign._id;
  const orgId = campaign.organizationId;

  const fileAddrSet = new Set(householdMap.keys());

  // Existing doors among the file's addresses.
  const existingHouseholds = await findInChunks(
    Household, 'normalizedAddress', [...fileAddrSet], { normalizedAddress: 1 }, { campaignId }
  );
  const existingAddrSet = new Set(existingHouseholds.map((h) => h.normalizedAddress));
  const newDoors = fileAddrSet.size - existingAddrSet.size;
  const existingDoors = existingAddrSet.size;

  // Existing voters (org-scoped) by stateVoterId → forecast new vs updated.
  const svids = validRows.map((r) => r.voter.stateVoterId);
  const existingVoters = await findInChunks(
    Voter, 'stateVoterId', svids, { stateVoterId: 1, householdId: 1, fullName: 1 }, { organizationId: orgId }
  );
  const existingBySvid = new Map(existingVoters.map((v) => [v.stateVoterId, v]));
  const updatedVoters = existingBySvid.size;
  const newVoters = Math.max(0, validRows.length - updatedVoters);

  // Current address of each existing voter's household (this campaign only).
  const fromHhIds = [...new Set(existingVoters.map((v) => String(v.householdId)).filter((s) => s && s !== 'null'))];
  const fromHouseholds = await findInChunks(
    Household, '_id', fromHhIds.map(oid), { normalizedAddress: 1 }, { campaignId }
  );
  const addrByHhId = new Map(fromHouseholds.map((h) => [String(h._id), h.normalizedAddress]));

  // Moves: an existing voter whose file row maps to a different door than they live at now.
  const moved = [];
  const movingOutByHh = new Map(); // hhId -> count moving away
  for (const row of validRows) {
    const prior = existingBySvid.get(row.voter.stateVoterId);
    if (!prior) continue; // new voter, no move
    const fromAddr = addrByHhId.get(String(prior.householdId));
    const toAddr = normalizeAddress(row.household);
    if (!fromAddr || fromAddr === toAddr) continue; // unknown/other-campaign source, or same door
    const hhKey = String(prior.householdId);
    movingOutByHh.set(hhKey, (movingOutByHh.get(hhKey) || 0) + 1);
    if (moved.length < SAMPLE_CAP) {
      moved.push({
        stateVoterId: row.voter.stateVoterId,
        name: prior.fullName || row.voter.fullName || null,
        fromAddress: fromAddr,
        toAddress: toAddr,
        toIsNew: !existingAddrSet.has(toAddr),
      });
    }
  }
  const movedVoters = [...movingOutByHh.values()].reduce((a, b) => a + b, 0);

  // Orphans: a source door where EVERY current voter moves away AND no file row maps back to it.
  const candidateHhIds = [...movingOutByHh.keys()];
  const voterCounts = candidateHhIds.length
    ? await Voter.aggregate([
        { $match: { householdId: { $in: candidateHhIds.map(oid) } } },
        { $group: { _id: '$householdId', n: { $sum: 1 } } },
      ])
    : [];
  const currentCountByHh = new Map(voterCounts.map((c) => [String(c._id), c.n]));
  const orphans = [];
  let orphanedDoors = 0;
  for (const hhId of candidateHhIds) {
    const fromAddr = addrByHhId.get(hhId);
    const movingOut = movingOutByHh.get(hhId) || 0;
    const current = currentCountByHh.get(hhId) || 0;
    if (movingOut === current && fromAddr && !fileAddrSet.has(fromAddr)) {
      orphanedDoors += 1;
      if (orphans.length < SAMPLE_CAP) orphans.push({ address: fromAddr, voterCount: current });
    }
  }

  // Near-duplicate addresses (advisory only — never affects the upsert): a NEW door whose
  // loose key matches an EXISTING door (formatting drift like "St" vs "Street").
  const newDoorEntries = [...householdMap.entries()].filter(([addr]) => !existingAddrSet.has(addr));
  const nearDups = [];
  let nearDuplicates = 0;
  if (newDoorEntries.length) {
    const newDoorZips = new Set(
      newDoorEntries.map(([, h]) => String(h.zipCode ?? '').slice(0, 5)).filter(Boolean)
    );
    const existingForDup = await Household.find(
      { campaignId },
      { normalizedAddress: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1 }
    ).lean();
    const looseToExisting = new Map(); // looseKey -> existing normalizedAddress (first wins)
    for (const h of existingForDup) {
      const zip5 = String(h.zipCode ?? '').slice(0, 5);
      if (!newDoorZips.has(zip5)) continue;
      const key = looseAddressKey(h);
      if (!looseToExisting.has(key)) looseToExisting.set(key, h.normalizedAddress);
    }
    for (const [addr, h] of newDoorEntries) {
      const match = looseToExisting.get(looseAddressKey(h));
      if (match && match !== addr) {
        nearDuplicates += 1;
        if (nearDups.length < SAMPLE_CAP) nearDups.push({ newAddress: addr, existingAddress: match });
      }
    }
  }

  const missingRequired = errors.filter((e) => e.code === 'missing_required').length;
  const noCoordinates = errors.filter((e) => e.code === 'bad_coords').length;
  const duplicateInFile = dupSvids ? dupSvids.size : 0;

  return {
    totals: {
      totalRows,
      validCount: validRows.length,
      uniqueHouseholds: householdMap.size,
      newDoors,
      existingDoors,
      newVoters,
      updatedVoters,
      movedVoters,
      orphanedDoors,
      nearDuplicates,
    },
    rowIssues: { missingRequired, noCoordinates, duplicateInFile },
    samples: {
      moved,
      orphans,
      nearDups,
      errors: errors.slice(0, SAMPLE_CAP),
    },
  };
}
