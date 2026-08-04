import mongoose from 'mongoose';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { Person } from '../../models/Person.js';
import { normalizeAddress, looseAddressKey } from '../../utils/normalizeAddress.js';
import { forecast as geocodeForecast } from './geocode/geocodeService.js';
import { IDENTITY_FIELDS, identityEq } from '../person/propagateIdentity.js';

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
    for (const d of docs) out.push(d); // no spread-push: 100k args overflows the stack
  }
  return out;
}

// Read-only shared-voter-DB forecast: of the import's voters, how many link to a canonical
// Person already in the system (cross-org dedup payoff) vs would create a new Person. No
// writes — mirrors the geocoding forecast. uidSource (the vendor namespace) lets uid-keyed
// files forecast on uid; otherwise it forecasts on (state, stateVoterId).
// "N links to existing people · K adds new people" on the import preview.
//
// This used to query Person GLOBALLY. That made it a cross-customer presence oracle: upload a
// one-row CSV and `existingPeople: 1` told you that some OTHER customer already had that named
// voter in their file. For a firm whose competitors are also our customers, that is a real
// disclosure — and it needed no permission beyond "can run an import".
//
// Scoped to the org, the number means what an operator actually wants: "how many of these are
// already in MY file." Which is the useful reading anyway.
async function forecastPersons(validRows, uidSource, orgId) {
  if (!validRows.length) return { enabled: true, voters: 0, existingPeople: 0, newPeople: 0 };
  const svidOf = (r) => {
    const state = String(r.voter.registeredState || r.household?.state || '').toUpperCase();
    return state && r.voter.stateVoterId ? `${state}|${r.voter.stateVoterId}` : null;
  };
  const uidOf = (r) => (uidSource && r.voter.uid ? `${uidSource}|${r.voter.uid}` : null);

  const svidVals = [...new Set(validRows.map((r) => r.voter.stateVoterId).filter(Boolean))];
  const uidVals = uidSource ? [...new Set(validRows.map((r) => r.voter.uid).filter(Boolean))] : [];
  const proj = { uidKeys: 1, svidKeys: 1 };
  const scope = { organizationId: orgId, mergedInto: null };
  // Fold matches straight into the key→person maps via cursors — never accumulate
  // the docs (a person matching on both svid AND uid used to be materialized twice,
  // +75 MB on a 100k-row re-import). The maps retain only the compact key strings.
  const svidToPerson = new Map();
  const uidToPerson = new Map();
  const seen = new Set();
  const fold = (p) => {
    if (seen.has(String(p._id))) return;
    seen.add(String(p._id));
    for (const k of p.svidKeys || []) svidToPerson.set(`${String(k.registeredState || '').toUpperCase()}|${k.stateVoterId}`, String(p._id));
    for (const k of p.uidKeys || []) uidToPerson.set(`${k.uidSource}|${k.uid}`, String(p._id));
  };
  for (const [field, values] of [['svidKeys.stateVoterId', svidVals], ['uidKeys.uid', uidVals]]) {
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK);
      if (!slice.length) continue;
      const cursor = Person.find({ ...scope, [field]: { $in: slice } }, proj).lean().cursor();
      for await (const p of cursor) fold(p);
    }
  }

  const matchedPersonIds = new Set();
  const newKeys = new Set();
  for (const r of validRows) {
    const uk = uidOf(r);
    const sk = svidOf(r);
    const pid = (uk && uidToPerson.get(uk)) || (sk && svidToPerson.get(sk)) || null;
    if (pid) matchedPersonIds.add(pid);
    else newKeys.add(uk || sk || `svid:${r.voter.stateVoterId}`);
  }
  return { enabled: true, voters: validRows.length, existingPeople: matchedPersonIds.size, newPeople: newKeys.size };
}

/**
 * Read-only forecast of what a CSV import would do to THIS campaign. No writes.
 * Takes the already-parsed { validRows, householdMap, errors, dupSvids } from
 * parseAndValidate. Returns { totals, rowIssues, samples } (sample arrays capped).
 *
 * Scoped to the campaign being imported, matching applyImport's per-campaign upsert:
 * a person who exists only in a SIBLING campaign forecasts as a NEW voter here (their
 * row here will be an insert), and never as a move/orphan.
 */
export async function computeImportDiff(campaign, { validRows, householdMap, errors = [], dupSvids, totalRows = 0, uidSource = null }) {
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

  // Existing voters (campaign-scoped, like the apply) by stateVoterId → forecast new vs updated.
  const svids = validRows.map((r) => r.voter.stateVoterId);
  const existingVoters = await findInChunks(
    Voter, 'stateVoterId', svids, { stateVoterId: 1, householdId: 1, fullName: 1 }, { campaignId }
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
    // Zip-scoped + cursor-folded: this was an UNCHUNKED full-collection scan of every
    // household in the campaign (+22 MB at 107k doors, growing linearly forever) with
    // the zip filter applied client-side. $in mixes exact strings and anchored regexes
    // so zip9-stored rows ("33065-1234") still match their file zip5 — both forms ride
    // the index. Only the loose-key map is retained.
    const zipMatchers = [...newDoorZips].flatMap((z) => [z, new RegExp(`^${z}-`)]);
    const looseToExisting = new Map(); // looseKey -> existing normalizedAddress (first wins)
    const dupCursor = Household.find(
      { campaignId, zipCode: { $in: zipMatchers } },
      { normalizedAddress: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1 }
    ).lean().cursor();
    for await (const h of dupCursor) {
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

  // Hand-edit conflicts: fields an admin corrected by hand (Voter.locallyEditedFields) where this
  // file carries a DIFFERENT value. Surfaced so the admin can choose keep-or-overwrite at apply
  // time — by default applyImport keeps the hand edit. A second TARGETED query rather than
  // fattening the main existing-voters projection above: that one is held fully in memory on
  // 100k-row files, while armed voters are typically a handful ('locallyEditedFields.0' exists).
  const ARMED_PROJ = { stateVoterId: 1, fullName: 1, locallyEditedFields: 1 };
  for (const f of IDENTITY_FIELDS) ARMED_PROJ[f] = 1;
  const armedVoters = await findInChunks(
    Voter, 'stateVoterId', svids, ARMED_PROJ,
    { campaignId, 'locallyEditedFields.0': { $exists: true } }
  );
  const armedBySvid = new Map(armedVoters.map((v) => [v.stateVoterId, v]));
  const handEditSamples = [];
  const handEditByField = {};
  const handEditVoterSet = new Set();
  let handEditFieldCount = 0;
  if (armedBySvid.size) {
    for (const row of validRows) {
      const armed = armedBySvid.get(row.voter.stateVoterId);
      if (!armed) continue;
      for (const f of armed.locallyEditedFields || []) {
        if (!IDENTITY_FIELDS.includes(f)) continue;
        if (identityEq(row.voter[f], armed[f])) continue;
        handEditFieldCount += 1;
        handEditByField[f] = (handEditByField[f] || 0) + 1;
        handEditVoterSet.add(row.voter.stateVoterId);
        if (handEditSamples.length < SAMPLE_CAP) {
          handEditSamples.push({
            stateVoterId: row.voter.stateVoterId,
            name: armed.fullName || row.voter.fullName || null,
            field: f,
            keptValue: armed[f] ?? null,
            fileValue: row.voter[f] ?? null,
          });
        }
      }
    }
  }

  const missingRequired = errors.filter((e) => e.code === 'missing_required').length;
  const noCoordinates = errors.filter((e) => e.code === 'bad_coords').length;
  const duplicateInFile = dupSvids ? dupSvids.size : 0;

  // Cache-only geocoding forecast (no provider calls). Only meaningful when geocoding
  // is enabled — otherwise no-coords rows were dropped and householdMap has none.
  const geocoding = await geocodeForecast(householdMap);

  // Shared-voter-DB forecast (always-on): existing-person links vs new persons.
  const persons = await forecastPersons(validRows, uidSource, orgId);

  return {
    geocoding,
    persons,
    handEditConflicts: {
      voters: handEditVoterSet.size,
      fields: handEditFieldCount,
      byField: handEditByField,
      sample: handEditSamples,
    },
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
      // No errors sample: the client never read it, and the preview path persisted
      // the whole diff to ImportJob.diff — raw per-row error objects (with voter
      // ids) were being stored twice for nothing (ImportJob.errors already has them).
    },
  };
}
